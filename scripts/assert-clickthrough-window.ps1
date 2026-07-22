param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [Parameter(Mandatory = $true)]
  [ValidateSet('enabled', 'disabled')]
  [string]$Mode
)

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClickThroughProbe {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    public static long Style(IntPtr hwnd) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, -20).ToInt64() : GetWindowLong32(hwnd, -20); }
    public static string Text(IntPtr hwnd) { var value = new StringBuilder(512); GetWindowTextW(hwnd, value, value.Capacity); return value.ToString(); }
    public static string ClassName(IntPtr hwnd) { var value = new StringBuilder(256); GetClassNameW(hwnd, value, value.Capacity); return value.ToString(); }
}
'@

Add-Type -TypeDefinition $source -ErrorAction Stop

$topLevels = [Collections.Generic.List[object]]::new()
$enumTop = [ClickThroughProbe+EnumWindowsProc]{
  param([IntPtr]$hwnd, [IntPtr]$lParam)
  $nativePid = [uint32]0
  [void][ClickThroughProbe]::GetWindowThreadProcessId($hwnd, [ref]$nativePid)
  if ($nativePid -eq $ProcessId -and [ClickThroughProbe]::IsWindowVisible($hwnd)) {
    $rect = [ClickThroughProbe+RECT]::new()
    [void][ClickThroughProbe]::GetWindowRect($hwnd, [ref]$rect)
    $topLevels.Add([pscustomobject]@{
      handle = $hwnd
      title = [ClickThroughProbe]::Text($hwnd)
      className = [ClickThroughProbe]::ClassName($hwnd)
      rect = $rect
    })
  }
  return $true
}
[void][ClickThroughProbe]::EnumWindows($enumTop, [IntPtr]::Zero)

$minis = @($topLevels | Where-Object {
  $_.className -eq 'Tauri Window' -and
  $_.title -ne 'TopPlan Clickthrough Test' -and
  ($_.rect.Right - $_.rect.Left) -gt 100 -and
  ($_.rect.Bottom - $_.rect.Top) -gt 100
})
if ($minis.Count -ne 2) {
  throw "Expected two test mini-note windows, found $($minis.Count)."
}

$transparentBit = 0x20L
$probeResults = [Collections.Generic.List[object]]::new()
foreach ($mini in $minis) {
  $windows = [Collections.Generic.List[object]]::new()
  $windows.Add([pscustomobject]@{
    handle = $mini.handle
    className = [ClickThroughProbe]::ClassName($mini.handle)
    visible = [ClickThroughProbe]::IsWindowVisible($mini.handle)
    style = [ClickThroughProbe]::Style($mini.handle)
  })
  $enumChild = [ClickThroughProbe+EnumWindowsProc]{
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    $windows.Add([pscustomobject]@{
      handle = $hwnd
      className = [ClickThroughProbe]::ClassName($hwnd)
      visible = [ClickThroughProbe]::IsWindowVisible($hwnd)
      style = [ClickThroughProbe]::Style($hwnd)
    })
    return $true
  }
  [void][ClickThroughProbe]::EnumChildWindows($mini.handle, $enumChild, [IntPtr]::Zero)

  if ($Mode -eq 'enabled') {
    $notTransparent = $windows | Where-Object { $_.visible -and (($_.style -band $transparentBit) -eq 0) }
    if ($notTransparent) {
      throw "Visible mini-note HWNDs are still interactive: $($notTransparent.className -join ', ')"
    }
  } else {
    $interactiveClasses = @('Tauri Window', 'WRY_WEBVIEW', 'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'TAURI_DRAG_RESIZE_BORDERS')
    $stillTransparent = $windows | Where-Object {
      $_.visible -and $_.className -in $interactiveClasses -and (($_.style -band $transparentBit) -ne 0)
    }
    if ($stillTransparent) {
      throw "Mini-note HWND styles were not restored: $($stillTransparent.className -join ', ')"
    }
  }

  $point = [ClickThroughProbe+POINT]::new()
  $point.X = [int](($mini.rect.Left + $mini.rect.Right) / 2)
  $point.Y = [int](($mini.rect.Top + $mini.rect.Bottom) / 2)
  $hit = [ClickThroughProbe]::WindowFromPoint($point)
  $hitRoot = [ClickThroughProbe]::GetAncestor($hit, 2)
  if ($Mode -eq 'enabled' -and $hitRoot -eq $mini.handle) {
    throw 'WindowFromPoint still resolves to a mini-note while click-through is enabled.'
  }
  if ($Mode -eq 'disabled' -and $hitRoot -ne $mini.handle) {
    throw 'WindowFromPoint does not resolve to a mini-note after click-through is disabled.'
  }
  $probeResults.Add([pscustomobject]@{
    miniHandle = ('0x{0:X}' -f $mini.handle.ToInt64())
    hitRoot = ('0x{0:X}' -f $hitRoot.ToInt64())
    hitRootClass = [ClickThroughProbe]::ClassName($hitRoot)
  })
}

$controls = @($topLevels | Where-Object {
  $_.className -eq 'Tauri Window' -and
  ($_.rect.Right - $_.rect.Left) -le 64 -and
  ($_.rect.Bottom - $_.rect.Top) -le 64
})
if ($Mode -eq 'enabled') {
  if ($controls.Count -ne $minis.Count) {
    throw "Expected one independent control window per mini note; found $($controls.Count)."
  }
  foreach ($control in $controls) {
    $controlWidth = $control.rect.Right - $control.rect.Left
    $controlHeight = $control.rect.Bottom - $control.rect.Top
    if ($controlWidth -ne $controlHeight -or $controlWidth -lt 16) {
      throw "Unexpected control window geometry: ${controlWidth}x${controlHeight}."
    }
  }
} elseif ($controls.Count -ne 0) {
  throw 'Click-through control windows remained open after disabling click-through.'
}

[pscustomobject]@{
  mode = $Mode
  minis = $probeResults
  controlSizes = @($controls | ForEach-Object { "$($_.rect.Right - $_.rect.Left)x$($_.rect.Bottom - $_.rect.Top)" })
} | ConvertTo-Json -Compress
