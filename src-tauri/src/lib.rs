use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, Position, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Space";
const DEFAULT_FILE_NAME: &str = "TopPlan.md";
const MAIN_WINDOW_MARGIN: f64 = 24.0;
const MINI_WINDOW_WIDTH: f64 = 260.0;
const MINI_WINDOW_HEIGHT: f64 = 320.0;
const MINI_WINDOW_MIN_WIDTH: f64 = 210.0;
const MINI_WINDOW_MIN_HEIGHT: f64 = 180.0;
const MINI_WINDOW_MAX_WIDTH: f64 = 390.0;
const MINI_WINDOW_MAX_HEIGHT: f64 = 560.0;
const MINI_WINDOW_MARGIN: f64 = 28.0;
const MINI_WINDOW_GAP: f64 = 12.0;

#[derive(Default)]
struct MiniNoteWindowRegistry(Mutex<HashMap<String, String>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSettings {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub always_on_top: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyFileSettings {
    pub enabled: bool,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniNoteSettings {
    pub opacity: f64,
    #[serde(default = "default_mini_background_color")]
    pub background_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub active_file_path: Option<String>,
    #[serde(default = "default_window_settings")]
    pub window: WindowSettings,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_daily_file_settings")]
    pub daily_file: DailyFileSettings,
    #[serde(default = "default_mini_note_settings")]
    pub mini_note: MiniNoteSettings,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFile {
    pub path: String,
    pub name: String,
    pub modified_at: String,
    pub size: u64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageReference {
    pub source_file: String,
    pub line: usize,
    pub raw_path: String,
    pub resolved_path: Option<String>,
    pub status: String,
}

fn default_window_settings() -> WindowSettings {
    WindowSettings {
        x: MAIN_WINDOW_MARGIN as i32,
        y: MAIN_WINDOW_MARGIN as i32,
        width: 420,
        height: 640,
        always_on_top: true,
    }
}

fn default_daily_file_settings() -> DailyFileSettings {
    DailyFileSettings {
        enabled: false,
        pattern: "YYYY-MM-DD.md".to_string(),
    }
}

fn default_mini_note_settings() -> MiniNoteSettings {
    MiniNoteSettings {
        opacity: 1.0,
        background_color: "#ffffff".to_string(),
    }
}

fn default_mini_background_color() -> String {
    "#ffffff".to_string()
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_language() -> String {
    "zh".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            workspace_root: None,
            active_file_path: None,
            window: default_window_settings(),
            hotkey: default_hotkey(),
            auto_start: false,
            daily_file: default_daily_file_settings(),
            mini_note: default_mini_note_settings(),
            theme: default_theme(),
            language: default_language(),
        }
    }
}

fn app_config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("settings.json"))
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

fn modified_at(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|| "0".to_string())
}

fn plan_file(path: &Path, active_file_path: Option<&str>) -> Result<PlanFile, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let normalized = normalize(path);
    Ok(PlanFile {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(DEFAULT_FILE_NAME)
            .to_string(),
        is_active: active_file_path.map(|active| active == normalized).unwrap_or(false),
        path: normalized,
        modified_at: modified_at(path),
        size: metadata.len(),
    })
}

fn collect_markdown_files(dir: &Path, active_file_path: Option<&str>, output: &mut Vec<PlanFile>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.file_name().and_then(|name| name.to_str()) == Some(".topplan") {
            continue;
        }

        if path.is_dir() {
            collect_markdown_files(&path, active_file_path, output)?;
        } else if is_markdown(&path) {
            output.push(plan_file(&path, active_file_path)?);
        }
    }

    Ok(())
}

fn ensure_child_path(root: &Path, child_name: &str) -> Result<PathBuf, String> {
    let clean = child_name.replace('\\', "/");
    if clean.contains("../") || clean.starts_with('/') || clean.contains(':') {
        return Err("File name must stay inside the selected workspace.".to_string());
    }
    Ok(root.join(clean))
}

fn clean_markdown_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("File name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains(':') || trimmed.contains("..") {
        return Err("File name cannot contain path separators or parent segments.".to_string());
    }
    let file_name = if trimmed.to_ascii_lowercase().ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };
    if !is_markdown(Path::new(&file_name)) {
        return Err("Only Markdown files can be renamed here.".to_string());
    }
    Ok(file_name)
}

fn monitor_work_area_logical(monitor: &tauri::Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    (
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    )
}

fn primary_work_area_logical(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_work_area_logical(&monitor))
}

fn main_monitor_work_area_logical(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    app.get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .map(|monitor| monitor_work_area_logical(&monitor))
        .or_else(|| primary_work_area_logical(app))
}

fn main_window_position(app: &AppHandle) -> Option<(f64, f64)> {
    primary_work_area_logical(app).map(|(x, y, _width, _height)| (x + MAIN_WINDOW_MARGIN, y + MAIN_WINDOW_MARGIN))
}

fn mini_note_window_position(app: &AppHandle, open_count: usize) -> Option<(f64, f64)> {
    let (area_x, area_y, area_width, area_height) = main_monitor_work_area_logical(app)?;
    let horizontal_step = MINI_WINDOW_WIDTH + MINI_WINDOW_GAP;
    let vertical_step = MINI_WINDOW_HEIGHT + MINI_WINDOW_GAP;
    let usable_width = (area_width - MINI_WINDOW_MARGIN * 2.0).max(MINI_WINDOW_WIDTH);
    let columns = ((usable_width + MINI_WINDOW_GAP) / horizontal_step).floor().max(1.0) as usize;
    let column = open_count % columns;
    let row = open_count / columns;
    let right_x = area_x + area_width - MINI_WINDOW_WIDTH - MINI_WINDOW_MARGIN;
    let raw_x = right_x - column as f64 * horizontal_step;
    let raw_y = area_y + MINI_WINDOW_MARGIN + row as f64 * vertical_step;
    let min_x = area_x + MINI_WINDOW_MARGIN;
    let max_y = area_y + area_height - MINI_WINDOW_HEIGHT - MINI_WINDOW_MARGIN;
    Some((raw_x.max(min_x), raw_y.min(max_y).max(area_y + MINI_WINDOW_MARGIN)))
}

fn safe_image_extension(extension: &str) -> Result<&'static str, String> {
    match extension.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "png" => Ok("png"),
        "jpg" | "jpeg" => Ok("jpg"),
        "gif" => Ok("gif"),
        "webp" => Ok("webp"),
        _ => Err("Unsupported clipboard image format.".to_string()),
    }
}

fn extract_image_paths(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut output = Vec::new();
    let mut index = 0;

    while index + 3 < bytes.len() {
        if bytes[index] == b'!' && bytes[index + 1] == b'[' {
            if let Some(close_label) = line[index + 2..].find("](") {
                let path_start = index + 2 + close_label + 2;
                if let Some(close_path) = line[path_start..].find(')') {
                    let raw = line[path_start..path_start + close_path].trim();
                    if !raw.is_empty() && !raw.starts_with("http://") && !raw.starts_with("https://") && !raw.starts_with("data:") {
                        output.push(raw.to_string());
                    }
                    index = path_start + close_path + 1;
                    continue;
                }
            }
        }
        index += 1;
    }

    output
}

fn extract_image_paths_from_content(content: &str) -> Vec<String> {
    content.lines().flat_map(extract_image_paths).collect()
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn resolve_image(root: &Path, source_file: &Path, raw: &str) -> (Option<String>, String) {
    let raw_path = PathBuf::from(raw);
    let candidates = if raw_path.is_absolute() {
        vec![raw_path]
    } else {
        vec![
            source_file.parent().unwrap_or(root).join(raw),
            root.join(raw),
        ]
    };

    for candidate in candidates {
        if candidate.exists() {
            let status = if candidate.starts_with(root) { "ok" } else { "external" };
            return (Some(normalize(&candidate)), status.to_string());
        }
    }

    (None, "missing".to_string())
}

fn collect_image_references(root: &Path, source_file: &Path, output: &mut Vec<ImageReference>) -> Result<(), String> {
    let content = fs::read_to_string(source_file).map_err(|error| error.to_string())?;

    for (line_index, line) in content.lines().enumerate() {
        for raw_path in extract_image_paths(line) {
            let (resolved_path, status) = resolve_image(root, source_file, &raw_path);
            output.push(ImageReference {
                source_file: normalize(source_file),
                line: line_index + 1,
                raw_path,
                resolved_path,
                status,
            });
        }
    }

    Ok(())
}

fn collect_workspace_images(root: &Path, dir: &Path, output: &mut Vec<ImageReference>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.file_name().and_then(|name| name.to_str()) == Some(".topplan") {
            continue;
        }

        if path.is_dir() {
            collect_workspace_images(root, &path, output)?;
        } else if is_markdown(&path) {
            collect_image_references(root, &path, output)?;
        }
    }

    Ok(())
}

fn cleanup_deleted_images(dir: &Path, cutoff: SystemTime) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            if path.file_name().and_then(|name| name.to_str()) == Some(".topplan") {
                let deleted_images = path.join("deleted-images");
                if deleted_images.exists() {
                    for image in fs::read_dir(&deleted_images).map_err(|error| error.to_string())? {
                        let image = image.map_err(|error| error.to_string())?;
                        let image_path = image.path();
                        if !image_path.is_file() {
                            continue;
                        }
                        let modified = fs::metadata(&image_path)
                            .and_then(|metadata| metadata.modified())
                            .unwrap_or(SystemTime::now());
                        if modified < cutoff {
                            fs::remove_file(&image_path).map_err(|error| error.to_string())?;
                        }
                    }
                }
            } else if path.file_name().and_then(|name| name.to_str()) == Some("deleted-images")
                && path.parent().and_then(|parent| parent.file_name()).and_then(|name| name.to_str()) == Some(".topplan")
            {
                for image in fs::read_dir(&path).map_err(|error| error.to_string())? {
                    let image = image.map_err(|error| error.to_string())?;
                    let image_path = image.path();
                    if !image_path.is_file() {
                        continue;
                    }
                    let modified = fs::metadata(&image_path)
                        .and_then(|metadata| metadata.modified())
                        .unwrap_or(SystemTime::now());
                    if modified < cutoff {
                        fs::remove_file(&image_path).map_err(|error| error.to_string())?;
                    }
                }
            } else {
                cleanup_deleted_images(&path, cutoff)?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = app_config_file(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = app_config_file(&app)?;
    let content = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_markdown_files(workspace_root: String, active_file_path: Option<String>) -> Result<Vec<PlanFile>, String> {
    let root = PathBuf::from(workspace_root);
    let mut files = Vec::new();
    collect_markdown_files(&root, active_file_path.as_deref(), &mut files)?;
    files.sort_by(|left, right| right.modified_at.cmp(&left.modified_at).then_with(|| left.name.cmp(&right.name)));
    Ok(files)
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_markdown_file(workspace_root: String, name: String, content: String) -> Result<PlanFile, String> {
    let root = PathBuf::from(workspace_root);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let path = ensure_child_path(&root, &name)?;

    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, content).map_err(|error| error.to_string())?;
    }

    plan_file(&path, Some(&normalize(&path)))
}

#[tauri::command]
fn rename_markdown_file(path: String, new_name: String) -> Result<PlanFile, String> {
    let current_path = PathBuf::from(&path);
    if !current_path.exists() || !is_markdown(&current_path) {
        return Err("Only existing Markdown files can be renamed.".to_string());
    }
    let Some(parent) = current_path.parent() else {
        return Err("Current Markdown file has no parent directory.".to_string());
    };
    let clean_name = clean_markdown_file_name(&new_name)?;
    let next_path = parent.join(clean_name);
    if next_path == current_path {
        return plan_file(&current_path, Some(&normalize(&current_path)));
    }
    if next_path.exists() {
        return Err("A Markdown file with that name already exists.".to_string());
    }
    fs::rename(&current_path, &next_path).map_err(|error| error.to_string())?;
    plan_file(&next_path, Some(&normalize(&next_path)))
}

#[tauri::command]
fn scan_image_references(workspace_root: String) -> Result<Vec<ImageReference>, String> {
    let root = PathBuf::from(&workspace_root);
    let mut references = Vec::new();
    if root.exists() {
        collect_workspace_images(&root, &root, &mut references)?;
    }

    let index_dir = root.join(".topplan");
    fs::create_dir_all(&index_dir).map_err(|error| error.to_string())?;
    let index_path = index_dir.join("image-index.json");
    let content = serde_json::to_string_pretty(&references).map_err(|error| error.to_string())?;
    fs::write(index_path, content).map_err(|error| error.to_string())?;

    Ok(references)
}

#[tauri::command]
fn cleanup_stale_deleted_images(workspace_root: String, max_age_hours: u64) -> Result<(), String> {
    let root = PathBuf::from(workspace_root);
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_hours.saturating_mul(60 * 60)))
        .unwrap_or(UNIX_EPOCH);
    cleanup_deleted_images(&root, cutoff)
}

#[tauri::command]
fn resolve_local_asset(path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
    Ok(path.exists().then(|| normalize(&path)))
}

#[tauri::command]
fn read_local_image_data_url(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", image_mime(&path), encoded))
}

#[tauri::command]
fn reconcile_picture_assets(active_file_path: String, content: String) -> Result<(), String> {
    let active_path = PathBuf::from(active_file_path);
    let Some(parent) = active_path.parent() else {
        return Ok(());
    };

    let picture_dir = parent.join("picture");
    let trash_dir = parent.join(".topplan").join("deleted-images");
    fs::create_dir_all(&trash_dir).map_err(|error| error.to_string())?;

    let referenced: HashSet<String> = extract_image_paths_from_content(&content)
        .into_iter()
        .filter_map(|raw| {
            let normalized = raw.replace('\\', "/");
            normalized
                .strip_prefix("picture/")
                .filter(|name| !name.contains('/') && !name.contains(".."))
                .map(|name| name.to_string())
        })
        .collect();

    fs::create_dir_all(&picture_dir).map_err(|error| error.to_string())?;

    for file_name in &referenced {
        let current = picture_dir.join(file_name);
        let deleted = trash_dir.join(file_name);
        if !current.exists() && deleted.exists() {
            fs::rename(&deleted, &current).map_err(|error| error.to_string())?;
        }
    }

    for entry in fs::read_dir(&picture_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("topplan-") {
            continue;
        }
        if referenced.contains(file_name) {
            continue;
        }
        let deleted = trash_dir.join(file_name);
        if deleted.exists() {
            fs::remove_file(&deleted).map_err(|error| error.to_string())?;
        }
        fs::rename(&path, deleted).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn save_pasted_image(active_file_path: String, bytes: Vec<u8>, extension: String) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Clipboard image is empty.".to_string());
    }

    let active_path = PathBuf::from(active_file_path);
    let Some(parent) = active_path.parent() else {
        return Err("Current Markdown file has no parent directory.".to_string());
    };

    let extension = safe_image_extension(&extension)?;
    let picture_dir = parent.join("picture");
    fs::create_dir_all(&picture_dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let file_name = format!("topplan-{timestamp}.{extension}");
    let image_path = picture_dir.join(&file_name);
    fs::write(&image_path, bytes).map_err(|error| error.to_string())?;

    Ok(format!("picture/{file_name}"))
}

#[tauri::command]
async fn open_mini_note_window(app: AppHandle, registry: State<'_, MiniNoteWindowRegistry>, path: String) -> Result<(), String> {
    let markdown_path = PathBuf::from(&path);
    if !markdown_path.exists() || !is_markdown(&markdown_path) {
        return Err("Only existing Markdown files can be opened as mini notes.".to_string());
    }
    let normalized_path = normalize(&markdown_path);

    if let Some(existing_label) = registry.0.lock().map_err(|error| error.to_string())?.remove(&normalized_path) {
        if let Some(existing_window) = app.get_webview_window(&existing_label) {
            existing_window.close().map_err(|error| error.to_string())?;
            return Ok(());
        }
    }

    let open_count = registry.0.lock().map_err(|error| error.to_string())?.len();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let label = format!("mini-note-{timestamp}");
    let encoded_path = general_purpose::URL_SAFE_NO_PAD.encode(path.as_bytes());
    let fallback_offset = open_count as f64 * MINI_WINDOW_GAP;
    let (x, y) = mini_note_window_position(&app, open_count).unwrap_or((72.0 + fallback_offset, 72.0));
    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App(format!("index.html?topplanMode=mini&file={encoded_path}").into()),
    )
    .title("TopPlan 便签")
    .inner_size(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT)
    .min_inner_size(MINI_WINDOW_MIN_WIDTH, MINI_WINDOW_MIN_HEIGHT)
    .max_inner_size(MINI_WINDOW_MAX_WIDTH, MINI_WINDOW_MAX_HEIGHT)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .resizable(true)
    .always_on_top(true)
    .visible(true)
    .focused(true)
    .shadow(false)
    .build()
    .map_err(|error| error.to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;

    registry
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(normalized_path.clone(), window.label().to_string());
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) {
            {
                let registry = app_for_close.state::<MiniNoteWindowRegistry>();
                if let Ok(mut windows) = registry.0.lock() {
                    windows.remove(&normalized_path);
                };
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn open_file_in_main(app: AppHandle, path: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit_to("main", "open-file-in-main", path)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_app_windows(app: AppHandle) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let windows = app.webview_windows();
    if main_window.is_visible().map_err(|error| error.to_string())? {
        for window in windows.values() {
            window.hide().map_err(|error| error.to_string())?;
        }
    } else {
        for window in windows.values() {
            window.show().map_err(|error| error.to_string())?;
            window.unminimize().map_err(|error| error.to_string())?;
        }
        main_window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let mut builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(MiniNoteWindowRegistry::default())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                if let Some((x, y)) = main_window_position(app.handle()) {
                    let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_markdown_files,
            read_markdown_file,
            write_markdown_file,
            create_markdown_file,
            rename_markdown_file,
            scan_image_references,
            cleanup_stale_deleted_images,
            resolve_local_asset,
            read_local_image_data_url,
            reconcile_picture_assets,
            save_pasted_image,
            open_mini_note_window,
            open_file_in_main,
            toggle_app_windows
        ])
        .run(tauri::generate_context!())
        .expect("error while running TopPlan");
}
