$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "topplan-clickthrough-smoke-$PID"
$workspace = Join-Path $tempRoot 'workspace'
$stdout = Join-Path $tempRoot 'tauri.stdout.log'
$stderr = Join-Path $tempRoot 'tauri.stderr.log'
$devProcess = $null

function Get-DescendantProcessIds([int]$RootId) {
  $processes = Get-CimInstance Win32_Process
  $ids = [Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootId)
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {
        [void]$ids.Add([int]$process.ProcessId)
        $added = $true
      }
    }
  } while ($added)
  return $ids
}

function Invoke-ClickThroughDriver([string]$Action) {
  node (Join-Path $PSScriptRoot 'clickthrough-smoke-driver.mjs') $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Click-through browser driver failed during '$Action'."
  }
}

try {
  if (Get-NetTCPConnection -LocalPort 1430, 9223 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Ports 1430 or 9223 are already in use.'
  }
  [IO.Directory]::CreateDirectory($workspace) | Out-Null
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223 --remote-allow-origins=*'
  $env:TOPPLAN_TEST_WORKSPACE = $workspace
  $env:CARGO_TARGET_DIR = Join-Path $repo 'src-tauri\target\clickthrough-smoke'
  $pnpm = (Get-Command pnpm).Source
  $command = "& '$pnpm' tauri dev --config 'scripts\tauri.clickthrough-test.conf.json'"
  $devProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', $command) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

  $appProcessId = $null
  for ($attempt = 0; $attempt -lt 180; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if ($devProcess.HasExited) {
      throw "Tauri dev exited early.`n$(Get-Content $stderr -Raw -ErrorAction SilentlyContinue)"
    }
    $descendants = Get-DescendantProcessIds $devProcess.Id
    $candidate = Get-CimInstance Win32_Process | Where-Object {
      $descendants.Contains([int]$_.ProcessId) -and $_.Name -eq 'topplan.exe'
    } | Select-Object -First 1
    if ($candidate -and (Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue)) {
      $appProcessId = [int]$candidate.ProcessId
      break
    }
  }
  if (-not $appProcessId) {
    throw "Timed out waiting for TopPlan test app.`n$(Get-Content $stderr -Raw -ErrorAction SilentlyContinue)"
  }

  Invoke-ClickThroughDriver enable
  & (Join-Path $PSScriptRoot 'assert-clickthrough-window.ps1') -ProcessId $appProcessId -Mode enabled
  Invoke-ClickThroughDriver disable
  & (Join-Path $PSScriptRoot 'assert-clickthrough-window.ps1') -ProcessId $appProcessId -Mode disabled
  Invoke-ClickThroughDriver enable
  & (Join-Path $PSScriptRoot 'assert-clickthrough-window.ps1') -ProcessId $appProcessId -Mode enabled
  Invoke-ClickThroughDriver disable
  & (Join-Path $PSScriptRoot 'assert-clickthrough-window.ps1') -ProcessId $appProcessId -Mode disabled
  Write-Output 'Click-through smoke test passed.'
} finally {
  if ($devProcess) {
    $ids = Get-DescendantProcessIds $devProcess.Id
    $ids | Sort-Object -Descending | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    $ids | ForEach-Object { Wait-Process -Id $_ -Timeout 5 -ErrorAction SilentlyContinue }
    try { [void]$devProcess.WaitForExit(5000) } catch {}
  }
  if (Test-Path $tempRoot) {
    Get-ChildItem -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
      try { $_.Attributes = [IO.FileAttributes]::Normal } catch {}
    }
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path $tempRoot); $attempt += 1) {
      try {
        [IO.Directory]::Delete($tempRoot, $true)
      } catch [IO.IOException] {
        if ($attempt -eq 19) {
          throw
        }
        Start-Sleep -Milliseconds 100
      }
    }
  }
}
