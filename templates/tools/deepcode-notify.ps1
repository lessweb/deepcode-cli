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
# (runs in the same console as the parent deepcode process)
# ---------------------------------------------------------------------------
Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]   public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]   public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@ -Name Win32 -Namespace DeepCodeNotify

$consoleHwnd = [DeepCodeNotify.Win32]::GetConsoleWindow()

if ($consoleHwnd -eq [IntPtr]::Zero) {
  # No console attached — show a non-clickable notification and exit
  Write-Warning "DeepCode: Could not capture console window handle."
  exit 0
}

# ---------------------------------------------------------------------------
# Show the notification
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon          = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle  = $titleText
$notify.BalloonTipText   = $bodyText
$notify.BalloonTipIcon   = $iconType
$notify.Visible          = $true

# Register click handler.
# Register-ObjectEvent runs the -Action in a background job, so we must
# redeclare the P/Invoke types inside the action.
Register-ObjectEvent -InputObject $notify -EventName BalloonTipClicked `
  -MessageData $consoleHwnd `
  -Action {
    param($eventSourceIdentifier, $eventSender)
    $hwnd = $Event.MessageData
    try {
      Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@ -Name Win32 -Namespace DeepCodeNotifyClick -IgnoreWarnings
    } catch { }

    [DeepCodeNotifyClick.Win32]::ShowWindow($hwnd, 9)          # SW_RESTORE
    [DeepCodeNotifyClick.Win32]::SetForegroundWindow($hwnd)

    if ($Event.Sender) {
      $Event.Sender.Dispose()
    }
  } | Out-Null

# Register dismiss handler so we clean up even if timed out
Register-ObjectEvent -InputObject $notify -EventName BalloonTipClosed -Action {
  if ($Event.Sender) { $Event.Sender.Dispose() }
} | Out-Null

$notify.ShowBalloonTip(30000)   # Show for up to 30 seconds

# ---------------------------------------------------------------------------
# Keep the process alive to receive click / dismiss events
# ---------------------------------------------------------------------------
try {
  Wait-Event -Timeout 35
} finally {
  Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
  try { $notify.Dispose() } catch { }
}
