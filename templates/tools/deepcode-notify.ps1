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
    BODY        - Last user message body
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
# Win32 API declarations (used to capture & activate the console window)
# ---------------------------------------------------------------------------
Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
'@ -Name Win32 -Namespace DC

$consoleHwnd = [DC.Win32]::GetConsoleWindow()

if ($consoleHwnd -eq [IntPtr]::Zero) {
  Write-Warning "DeepCode: Could not capture console window handle."
  exit 0
}

# ---------------------------------------------------------------------------
# Helper: activate & focus the target console window
# ---------------------------------------------------------------------------
function Activate-ConsoleWindow {
  param([IntPtr]$hwnd)

  # 1. Restore from minimized
  [DC.Win32]::ShowWindow($hwnd, 9) | Out-Null          # SW_RESTORE
  Start-Sleep -Milliseconds 200

  if ([DC.Win32]::IsIconic($hwnd)) {
    [DC.Win32]::ShowWindow($hwnd, 1) | Out-Null         # SW_SHOWNORMAL
    Start-Sleep -Milliseconds 200
  }

  # 2. Set as foreground window
  #    (called from the main thread while we still have foreground rights
  #     from the BalloonTip click)
  [DC.Win32]::SetForegroundWindow($hwnd) | Out-Null

  # 3. Undocumented fallback that often works on modern Windows
  Start-Sleep -Milliseconds 50
  [DC.Win32]::SwitchToThisWindow($hwnd, $true)
}

# ---------------------------------------------------------------------------
# Build the notification
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon              = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle   = $titleText
$notify.BalloonTipText    = $bodyText
$notify.BalloonTipIcon    = $iconType
$notify.Visible           = $true

# Register BalloonTipClicked WITHOUT -Action.
# We will capture the event in the main thread via Wait-Event so that
# Activate-ConsoleWindow runs with the foreground rights granted by the click.
$clickSub = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClicked

# Dismiss handler — no action needed, just clean up
$dismissSub = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClosed

$notify.ShowBalloonTip(30000)

# ---------------------------------------------------------------------------
# Event loop: wait for click, dismiss, or timeout
# ---------------------------------------------------------------------------
try {
  $remaining = 35  # seconds
  while ($remaining -gt 0) {
    $event = Wait-Event -Timeout $remaining
    if (-not $event) {
      break  # timeout
    }

    if ($event.SourceIdentifier -eq $clickSub.Name) {
      # User clicked the notification → activate the console window.
      # This runs in the MAIN thread, so SetForegroundWindow is allowed.
      try { Activate-ConsoleWindow $consoleHwnd } catch { }
      break
    }

    if ($event.SourceIdentifier -eq $dismissSub.Name) {
      break  # dismissed / timed out
    }

    Remove-Event -EventIdentifier $event.EventIdentifier
    $remaining -= 1
  }
} finally {
  Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
  try { $notify.Dispose() } catch { }
}
