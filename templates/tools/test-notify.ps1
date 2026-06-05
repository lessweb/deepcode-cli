#Requires -Version 5.1
<#
.SYNOPSIS
  Automated smoke test for the built-in DeepCode Windows notification script.

.DESCRIPTION
  This verifies that deepcode-notify.ps1 can compile its Win32 declarations,
  create Windows Forms notification dependencies, and restore a minimized
  target window. It opens a disposable WinForms window and closes it after
  the test.
#>

param(
  [string]$NotifyScript = (Join-Path $PSScriptRoot "deepcode-notify.ps1"),
  [switch]$ShowBalloonSmoke,
  [switch]$ManualClickTest,
  [switch]$CurrentTerminalClickTest
)

$ErrorActionPreference = "Stop"

function Invoke-NotifyScriptJson {
  param([string[]]$Arguments)

  $output = & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $NotifyScript @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "deepcode-notify.ps1 failed with exit code $LASTEXITCODE. Output: $output"
  }

  try {
    return ($output | Out-String | ConvertFrom-Json)
  } catch {
    throw "deepcode-notify.ps1 did not return valid JSON. Output: $output"
  }
}

function Start-TestWindow {
  $testDir = Join-Path ([System.IO.Path]::GetTempPath()) "deepcode-notify-test-$PID"
  New-Item -ItemType Directory -Path $testDir -Force | Out-Null

  $helperPath = Join-Path $testDir "window-helper.ps1"
  $hwndPath = Join-Path $testDir "hwnd.txt"

  @'
param([string]$HwndPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "DeepCode Notify Test Window"
$form.Size = New-Object System.Drawing.Size(420, 180)
$form.StartPosition = "CenterScreen"
$form.ShowInTaskbar = $true
$form.TopMost = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = "DeepCode notification smoke test target"
$label.Dock = "Fill"
$label.TextAlign = "MiddleCenter"
$form.Controls.Add($label)

$form.Add_Shown({
  $form.Handle.ToInt64().ToString() | Out-File -FilePath $HwndPath -NoNewline -Encoding ASCII
})

[System.Windows.Forms.Application]::Run($form)
'@ | Out-File -FilePath $helperPath -Encoding UTF8

  $proc = Start-Process powershell.exe -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile",
    "-File", $helperPath,
    "-HwndPath", $hwndPath
  ) -PassThru

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $hwndPath) {
      $raw = Get-Content -LiteralPath $hwndPath -Raw
      $hwnd = [int64]0
      if ([int64]::TryParse($raw.Trim(), [ref]$hwnd) -and $hwnd -ne 0) {
        return @{
          Process = $proc
          Hwnd = $hwnd
          Directory = $testDir
        }
      }
    }
    Start-Sleep -Milliseconds 200
  }

  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
  throw "Timed out waiting for the disposable WinForms test window."
}

function Invoke-TestMouseClick {
  param(
    [int]$X,
    [int]$Y
  )

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DeepCodeNotifyTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    public static class Mouse {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    }
}
'@ -ErrorAction SilentlyContinue

  $moved = [DeepCodeNotifyTest.Mouse]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 80
  $point = New-Object DeepCodeNotifyTest.POINT
  [DeepCodeNotifyTest.Mouse]::GetCursorPos([ref]$point) | Out-Null
  $hit = [DeepCodeNotifyTest.Mouse]::WindowFromPoint($point)
  $root = [DeepCodeNotifyTest.Mouse]::GetAncestor($hit, 2)
  Write-Host "   Mouse moved=$moved cursor=($($point.X),$($point.Y)) hitHwnd=$($hit.ToInt64()) rootHwnd=$($root.ToInt64())"
  [DeepCodeNotifyTest.Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [DeepCodeNotifyTest.Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Write-Host "   mouse_event click sent"
  Start-Sleep -Milliseconds 350
}

function Get-TestWindowCenter {
  param([int64]$Hwnd)

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DeepCodeNotifyTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static class WindowRect {
        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    }
}
'@ -ErrorAction SilentlyContinue

  $rect = New-Object DeepCodeNotifyTest.RECT
  $ok = [DeepCodeNotifyTest.WindowRect]::GetWindowRect([IntPtr]::new($Hwnd), [ref]$rect)
  if (-not $ok) {
    throw "GetWindowRect failed for HWND $Hwnd"
  }

  return @{
    X = [int](($rect.Left + $rect.Right) / 2)
    Y = [int](($rect.Top + $rect.Bottom) / 2)
  }
}

function Get-ForegroundWindowHwnd {
  Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@ -Name Foreground -Namespace DeepCodeNotifyTest -ErrorAction SilentlyContinue

  return [DeepCodeNotifyTest.Foreground]::GetForegroundWindow().ToInt64()
}

function Set-TestWindowMinimized {
  param([int64]$Hwnd)

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DeepCodeNotifyTest {
    public static class WindowState {
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);
    }
}
'@ -ErrorAction SilentlyContinue

  [DeepCodeNotifyTest.WindowState]::ShowWindow([IntPtr]::new($Hwnd), 6) | Out-Null
  Start-Sleep -Milliseconds 300
  return [DeepCodeNotifyTest.WindowState]::IsIconic([IntPtr]::new($Hwnd))
}

function Wait-JsonFile {
  param(
    [string]$Path,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      try {
        $raw = Get-Content -LiteralPath $Path -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
          $json = $raw | ConvertFrom-Json
          if ($json) {
            return $json
          }
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 100
  }

  throw "Timed out waiting for JSON file: $Path"
}

function Wait-ProcessExit {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) {
      return
    }
    Start-Sleep -Milliseconds 100
  }

  try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch { }
  throw "Timed out waiting for process $($Process.Id) to exit."
}

Write-Host "=== DeepCode Notify Automated Smoke Test ===" -ForegroundColor Cyan
Write-Host "Script: $NotifyScript"

if (-not (Test-Path -LiteralPath $NotifyScript)) {
  throw "Notify script not found: $NotifyScript"
}

Write-Host "1. Validating script dependencies..."
$validate = Invoke-NotifyScriptJson @("-ValidateOnly")
if (-not $validate.ok) {
  throw "ValidateOnly failed: $($validate | ConvertTo-Json -Compress)"
}
Write-Host "   PASS: Add-Type and Windows Forms dependencies loaded"

if ($CurrentTerminalClickTest) {
  Write-Host "2. Current terminal click test: click the DeepCode desktop tip within 45 seconds..."
  $testDir = Join-Path ([System.IO.Path]::GetTempPath()) "deepcode-notify-current-terminal-$PID"
  New-Item -ItemType Directory -Path $testDir -Force | Out-Null
  $debugLog = Join-Path $testDir "notify-current-terminal.log"
  $resultPath = Join-Path $testDir "notify-current-terminal.json"

  try {
    $foregroundHwnd = Get-ForegroundWindowHwnd
    $env:STATUS = "completed"
    $env:TITLE = "DeepCode Current Terminal Test"
    $env:QUESTION = "Current terminal click test"
    $env:BODY = "Click this tip to focus the terminal that launched the test"
    $env:DURATION = "1"
    $env:DEEPCODE_NOTIFY_WINDOW_HWND = "$foregroundHwnd"
    $env:DEEPCODE_NOTIFY_PARENT_PID = "$PID"
    $env:DEEPCODE_NOTIFY_PROCESS_PID = "$PID"
    $env:DEEPCODE_NOTIFY_DEBUG = "1"
    $env:DEEPCODE_NOTIFY_DEBUG_LOG = $debugLog

    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $NotifyScript `
      -TimeoutSeconds 45 `
      -ResultPath $resultPath

    if ($LASTEXITCODE -ne 0) {
      throw "Current terminal click test failed with exit code $LASTEXITCODE"
    }

    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    Write-Host "   Captured foreground HWND: $foregroundHwnd"
    Write-Host "   Result: clicked=$($result.clicked) activated=$($result.activated) finalForeground=$($result.finalForeground) targetHwnd=$($result.targetHwnd)"
    Write-Host "   Debug log:"
    if (Test-Path -LiteralPath $debugLog) {
      Get-Content -LiteralPath $debugLog | ForEach-Object { Write-Host "   $_" }
    } else {
      Write-Host "   <no debug log was written>"
    }

    if (-not $result.ok) {
      throw "Current terminal click test did not focus the resolved terminal window."
    }

    Write-Host ""
    Write-Host "RESULT: PASS" -ForegroundColor Green
    exit 0
  } finally {
    Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "2. Validating current terminal PID resolution..."
$previousNotifyWindowHwnd = $env:DEEPCODE_NOTIFY_WINDOW_HWND
$previousNotifyParentPid = $env:DEEPCODE_NOTIFY_PARENT_PID
$previousNotifyProcessPid = $env:DEEPCODE_NOTIFY_PROCESS_PID
try {
  Remove-Item Env:\DEEPCODE_NOTIFY_WINDOW_HWND -ErrorAction SilentlyContinue
  $env:DEEPCODE_NOTIFY_PARENT_PID = "$PID"
  $env:DEEPCODE_NOTIFY_PROCESS_PID = "$PID"
  $pidResolve = Invoke-NotifyScriptJson @("-ValidateOnly")
  if (-not $pidResolve.ok -or -not $pidResolve.hasTargetWindow -or [int64]$pidResolve.targetHwnd -eq 0) {
    throw "Current terminal PID resolution failed: $($pidResolve | ConvertTo-Json -Compress)"
  }
  Write-Host "   PASS: targetHwnd=$($pidResolve.targetHwnd)"
} finally {
  if ($null -eq $previousNotifyWindowHwnd) {
    Remove-Item Env:\DEEPCODE_NOTIFY_WINDOW_HWND -ErrorAction SilentlyContinue
  } else {
    $env:DEEPCODE_NOTIFY_WINDOW_HWND = $previousNotifyWindowHwnd
  }
  if ($null -eq $previousNotifyParentPid) {
    Remove-Item Env:\DEEPCODE_NOTIFY_PARENT_PID -ErrorAction SilentlyContinue
  } else {
    $env:DEEPCODE_NOTIFY_PARENT_PID = $previousNotifyParentPid
  }
  if ($null -eq $previousNotifyProcessPid) {
    Remove-Item Env:\DEEPCODE_NOTIFY_PROCESS_PID -ErrorAction SilentlyContinue
  } else {
    $env:DEEPCODE_NOTIFY_PROCESS_PID = $previousNotifyProcessPid
  }
}

Write-Host "3. Opening disposable WinForms target..."
$target = Start-TestWindow
$targetHwnd = $target.Hwnd
Write-Host "   Target HWND: $targetHwnd"

try {
  Write-Host "4. Testing minimized-window restore and taskbar flash..."
  $selfTest = Invoke-NotifyScriptJson @("-SelfTest", "-TestWindowHwnd", "$targetHwnd")
  if (-not $selfTest.ok) {
    throw "SelfTest failed: $($selfTest | ConvertTo-Json -Compress)"
  }

  Write-Host "   PASS: minimized=$($selfTest.minimized) restored=$($selfTest.restored) flashed=$($selfTest.flashed) foreground=$($selfTest.foreground)"

  Write-Host "5. Testing desktop tip click path with automatic click..."
  $autoClickResultPath = Join-Path $target.Directory "toast-auto-click.json"
  $autoClickReadyPath = Join-Path $target.Directory "toast-auto-click-ready.json"
  $autoClickDebugLog = Join-Path $target.Directory "toast-auto-click.log"
  $env:STATUS = "completed"
  $env:TITLE = "DeepCode Notify Auto Click"
  $env:QUESTION = "Automated click path test question"
  $env:BODY = "Automated click path test"
  $env:DURATION = "1"
  $env:DEEPCODE_NOTIFY_WINDOW_HWND = "$targetHwnd"
  $env:DEEPCODE_NOTIFY_DEBUG = "1"
  $env:DEEPCODE_NOTIFY_DEBUG_LOG = $autoClickDebugLog

  $notifyProc = Start-Process powershell.exe -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile",
    "-File", $NotifyScript,
    "-TimeoutSeconds", "8",
    "-ReadyPath", $autoClickReadyPath,
    "-ResultPath", $autoClickResultPath
  ) -PassThru

  $ready = Wait-JsonFile -Path $autoClickReadyPath -TimeoutSeconds 5
  Write-Host "   Ready: hwnd=$($ready.hwnd) left=$($ready.left) top=$($ready.top) width=$($ready.width) height=$($ready.height) centerX=$($ready.centerX) centerY=$($ready.centerY)"
  if ([int64]$ready.hwnd -ne 0) {
    $center = Get-TestWindowCenter -Hwnd ([int64]$ready.hwnd)
    Write-Host "   HWND center: x=$($center.X) y=$($center.Y)"
  } elseif ([int]$ready.centerX -ne 0 -and [int]$ready.centerY -ne 0) {
    $center = @{
      X = [int]$ready.centerX
      Y = [int]$ready.centerY
    }
  } else {
    throw "Desktop tip ready data did not include a usable HWND or center point: $($ready | ConvertTo-Json -Compress)"
  }
  Write-Host "   Clicking tip center: x=$($center.X) y=$($center.Y)"
  Invoke-TestMouseClick -X $center.X -Y $center.Y
  Wait-ProcessExit -Process $notifyProc -TimeoutSeconds 10

  if ($notifyProc.ExitCode -ne 0) {
    throw "Desktop tip click failed with exit code $($notifyProc.ExitCode)"
  }

  $autoClick = Get-Content -LiteralPath $autoClickResultPath -Raw | ConvertFrom-Json
  if (-not $autoClick.ok) {
    if (Test-Path -LiteralPath $autoClickDebugLog) {
      Write-Host "   Debug log:"
      Get-Content -LiteralPath $autoClickDebugLog | ForEach-Object { Write-Host "   $_" }
    }
    throw "Desktop tip auto-click did not pass: $($autoClick | ConvertTo-Json -Compress)"
  }
  Write-Host "   PASS: clicked=$($autoClick.clicked) activated=$($autoClick.activated) finalForeground=$($autoClick.finalForeground) flashed=$($autoClick.flashed)"

  Write-Host "6. Testing desktop tip click path while target is minimized..."
  $minimizedClickResultPath = Join-Path $target.Directory "toast-minimized-click.json"
  $minimizedClickReadyPath = Join-Path $target.Directory "toast-minimized-click-ready.json"
  $minimizedClickDebugLog = Join-Path $target.Directory "toast-minimized-click.log"
  $targetMinimized = Set-TestWindowMinimized -Hwnd $targetHwnd
  if (-not $targetMinimized) {
    throw "Failed to minimize target window before click test."
  }

  $env:STATUS = "completed"
  $env:TITLE = "DeepCode Notify Minimized Click"
  $env:QUESTION = "Minimized click path test question"
  $env:BODY = "Click should restore and focus the minimized target"
  $env:DURATION = "1"
  $env:DEEPCODE_NOTIFY_WINDOW_HWND = "$targetHwnd"
  $env:DEEPCODE_NOTIFY_DEBUG = "1"
  $env:DEEPCODE_NOTIFY_DEBUG_LOG = $minimizedClickDebugLog

  $minimizedNotifyProc = Start-Process powershell.exe -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-NoProfile",
    "-File", $NotifyScript,
    "-TimeoutSeconds", "8",
    "-ReadyPath", $minimizedClickReadyPath,
    "-ResultPath", $minimizedClickResultPath
  ) -PassThru

  $minimizedReady = Wait-JsonFile -Path $minimizedClickReadyPath -TimeoutSeconds 5
  if ([int64]$minimizedReady.hwnd -eq 0) {
    throw "Minimized-target tip ready data did not include a usable HWND: $($minimizedReady | ConvertTo-Json -Compress)"
  }
  $minimizedCenter = Get-TestWindowCenter -Hwnd ([int64]$minimizedReady.hwnd)
  Write-Host "   Clicking minimized-target tip center: x=$($minimizedCenter.X) y=$($minimizedCenter.Y)"
  Invoke-TestMouseClick -X $minimizedCenter.X -Y $minimizedCenter.Y
  Wait-ProcessExit -Process $minimizedNotifyProc -TimeoutSeconds 10

  if ($minimizedNotifyProc.ExitCode -ne 0) {
    throw "Minimized target click failed with exit code $($minimizedNotifyProc.ExitCode)"
  }

  $minimizedClick = Get-Content -LiteralPath $minimizedClickResultPath -Raw | ConvertFrom-Json
  if (-not $minimizedClick.ok) {
    if (Test-Path -LiteralPath $minimizedClickDebugLog) {
      Write-Host "   Debug log:"
      Get-Content -LiteralPath $minimizedClickDebugLog | ForEach-Object { Write-Host "   $_" }
    }
    throw "Desktop tip minimized-target click did not pass: $($minimizedClick | ConvertTo-Json -Compress)"
  }
  Write-Host "   PASS: clicked=$($minimizedClick.clicked) activated=$($minimizedClick.activated) finalForeground=$($minimizedClick.finalForeground) flashed=$($minimizedClick.flashed)"

  if ($ShowBalloonSmoke) {
    Write-Host "7. Showing a one-second desktop tip smoke test..."
    $env:STATUS = "completed"
    $env:TITLE = "DeepCode Notify Smoke"
    $env:QUESTION = "Smoke test question"
    $env:BODY = "Automated smoke test"
    $env:DURATION = "1"
    $env:DEEPCODE_NOTIFY_WINDOW_HWND = "$targetHwnd"
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $NotifyScript -TimeoutSeconds 1
    if ($LASTEXITCODE -ne 0) {
      throw "BalloonTip smoke failed with exit code $LASTEXITCODE"
    }
    Write-Host "   PASS: desktop tip path exited successfully"
  }

  if ($ManualClickTest) {
    Write-Host "8. Manual click test: click the DeepCode desktop tip within 45 seconds..."
    $debugLog = Join-Path $target.Directory "notify-click.log"
    $env:STATUS = "completed"
    $env:TITLE = "DeepCode Manual Click Test"
    $env:QUESTION = "Manual click test question"
    $env:BODY = "Click this notification to focus the test window"
    $env:DURATION = "1"
    $env:DEEPCODE_NOTIFY_WINDOW_HWND = "$targetHwnd"
    $env:DEEPCODE_NOTIFY_DEBUG = "1"
    $env:DEEPCODE_NOTIFY_DEBUG_LOG = $debugLog

    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $NotifyScript -TimeoutSeconds 45
    if ($LASTEXITCODE -ne 0) {
      throw "Manual click test failed with exit code $LASTEXITCODE"
    }

    Write-Host "   Debug log:"
    if (Test-Path -LiteralPath $debugLog) {
      Get-Content -LiteralPath $debugLog | ForEach-Object { Write-Host "   $_" }
    } else {
      Write-Host "   <no debug log was written>"
    }
  }
} finally {
  if ($target) {
    try {
      Get-Process -Id $target.Process.Id -ErrorAction SilentlyContinue | Stop-Process -Force
    } catch { }
    Remove-Item -LiteralPath $target.Directory -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "RESULT: PASS" -ForegroundColor Green
