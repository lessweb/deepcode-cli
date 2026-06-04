#Requires -Version 5.1
<#
.SYNOPSIS
  DeepCode CLI built-in Windows notification script.
  Shows a BalloonTip when a task completes or fails.
  Click the notification to jump to the originating terminal window.

.DESCRIPTION
  Invoked automatically by DeepCode CLI on Windows when the `notify`
  setting is either unset or set to "builtin".

  Environment variables passed by the CLI:
    STATUS      - "completed" | "failed" | "interrupted"
    TITLE       - Session summary / task title
    BODY        - Last assistant message body
    DURATION    - Task wall-clock duration in seconds
#>

param()

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Read context from environment variables
# ---------------------------------------------------------------------------
$Status   = $env:STATUS
$Title    = $env:TITLE
$Body     = $env:BODY
$Duration = $env:DURATION

# ---------------------------------------------------------------------------
# Build notification text
# ---------------------------------------------------------------------------
$statusLabel = switch ($Status) {
  "failed"      { "Failed" }
  "interrupted" { "Interrupted" }
  default       { "Completed" }
}

$iconType = if ($Status -eq "failed") { "Error" } else { "Info" }
$titleText = if ($Title) { "$Title" } else { "DeepCode Task" }

$shortBody = if ($Body) {
  if ($Body.Length -gt 120) { $Body.Substring(0, 117) + "..." } else { $Body }
} else { "" }

$parts = @()
if ($shortBody) { $parts += $shortBody }
$parts += "[$statusLabel]  Duration: ${Duration}s"
$parts += "Click here to jump to the terminal window"
$bodyText = $parts -join "`n"

# ---------------------------------------------------------------------------
# Capture the console window handle
# Running in the same console as the parent deepcode process, so
# GetConsoleWindow() returns the correct HWND.
# ---------------------------------------------------------------------------
Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")]
public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
'@ -Name Win32 -Namespace DeepCodeNotify

$consoleHwnd = [DeepCodeNotify.Win32]::GetConsoleWindow()

if ($consoleHwnd -eq [IntPtr]::Zero) {
  Write-Warning "DeepCode: Could not capture console window handle."
  exit 0
}

# Persist the HWND so the click handler can reach it even from a
# background job that has no access to the main-script scope.
$hwndFileBase = Join-Path ([System.IO.Path]::GetTempPath()) "deepcode\notify-hwnd"
New-Item -ItemType Directory -Path (Split-Path $hwndFileBase) -Force | Out-Null
$hwndFile = "$hwndFileBase-$PID.txt"
$consoleHwnd.ToInt64().ToString() | Out-File -FilePath $hwndFile -NoNewline

# ---------------------------------------------------------------------------
# Window activation helper (written to disk so the click handler can
# invoke it as a fresh process that respects foreground rules).
# ---------------------------------------------------------------------------
$activatePs1 = "$hwndFileBase-activate-$PID.ps1"
@'
param([uint64]$WindowHwnd)

Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
"@ -Name W32 -Namespace DA

$hwnd = [IntPtr]::new([int64]$WindowHwnd)

# 1. Restore the window if minimized
[DA.W32]::ShowWindow($hwnd, 9)   # SW_RESTORE
Start-Sleep -Milliseconds 50

# 2. Bring to top briefly to give it Z-order priority
$SWP_NOMOVE = 0x0002; $SWP_NOSIZE = 0x0001
$HWND_TOPMOST = [IntPtr](-1); $HWND_NOTOPMOST = [IntPtr](-2)
[DA.W32]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE)
[DA.W32]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE)

# 3. Simulate Alt key press to gain foreground activation permission
[DA.W32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)           # Alt down
Start-Sleep -Milliseconds 50
[DA.W32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)           # Alt up
Start-Sleep -Milliseconds 50

# 4. AttachThreadInput + SetForegroundWindow
$fgHwnd = [DA.W32]::GetForegroundWindow()
$tidTarget = 0; $null = [DA.W32]::GetWindowThreadProcessId($hwnd, [ref]$tidTarget)
$tidFg     = 0; $null = [DA.W32]::GetWindowThreadProcessId($fgHwnd, [ref]$tidFg)
if ($tidTarget -and $tidFg) {
  [DA.W32]::AttachThreadInput($tidTarget, $tidFg, $true)
}
[DA.W32]::SetForegroundWindow($hwnd)
if ($tidTarget -and $tidFg) {
  [DA.W32]::AttachThreadInput($tidTarget, $tidFg, $false)
}

# 5. Fallback: SwitchToThisWindow (undocumented, often works on Win11)
Start-Sleep -Milliseconds 50
[DA.W32]::SwitchToThisWindow($hwnd, $true)
'@ | Out-File -FilePath $activatePs1 -Encoding UTF8

# ---------------------------------------------------------------------------
# Show the notification
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon              = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle   = $titleText
$notify.BalloonTipText    = $bodyText
$notify.BalloonTipIcon    = $iconType
$notify.Visible           = $true

# Register click handler.
# Register-ObjectEvent runs the -Action in a background job.  The job
# cannot reliably call SetForegroundWindow itself (foreground-lock),
# so we make the action spawn a short-lived helper PowerShell that
# uses AttachThreadInput to gain permission and activate the window.
Register-ObjectEvent -InputObject $notify -EventName BalloonTipClicked `
  -MessageData @{
    HwndFile    = $hwndFile
    ActivatePs1 = $activatePs1
  } `
  -Action {
    try {
      $data = $Event.MessageData
      $hwndVal = Get-Content $data.HwndFile -Raw -ErrorAction Stop
      Start-Process powershell.exe -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-NoProfile",
        "-File", $data.ActivatePs1,
        "-WindowHwnd", $hwndVal.Trim()
      ) -WindowStyle Hidden -Wait
    } catch { }

    try { $Event.Sender.Dispose() } catch { }
  } | Out-Null

# Dismiss handler
Register-ObjectEvent -InputObject $notify -EventName BalloonTipClosed -Action {
  try { $Event.Sender.Dispose() } catch { }
} | Out-Null

$notify.ShowBalloonTip(30000)

# ---------------------------------------------------------------------------
# Keep the process alive to receive events
# ---------------------------------------------------------------------------
try {
  Wait-Event -Timeout 35
} finally {
  Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
  try { $notify.Dispose() } catch { }
  Remove-Item $hwndFile, $activatePs1 -Force -ErrorAction SilentlyContinue
}
