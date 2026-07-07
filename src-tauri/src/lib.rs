use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Space";
const DEFAULT_FILE_NAME: &str = "TopPlan.md";

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
        x: 0,
        y: 0,
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
fn resolve_local_asset(path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
    Ok(path.exists().then(|| normalize(&path)))
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
fn toggle_main_window(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    if window.is_visible().map_err(|error| error.to_string())? {
        window.hide().map_err(|error| error.to_string())?;
    } else {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let mut builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
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
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: 0, y: 0 }));
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
            scan_image_references,
            resolve_local_asset,
            save_pasted_image,
            toggle_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running TopPlan");
}
