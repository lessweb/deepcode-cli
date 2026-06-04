#Requires -Version 5.1
<#
.SYNOPSIS
  DeepCode CLI built-in Windows notification script.
  Shows a BalloonTip when a task completes or fails.
  Click the notification to locate the originating terminal window.

.DESCRIPTION
  Invoked automatically by DeepCode CLI on Windows when the `notify`
  setting is either unset or set to "builtin".

  On BalloonTip click:
    1. Restores the console window from minimized state.
    2. Flashes the taskbar button until the user clicks it.
       (Windows 11 security prevents programmatic foreground stealing,
        so flashing is the most reliable way to direct the user.)

  Environment variables passed by the CLI:
    STATUS      - "completed" | "failed" | "interrupted"
    TITLE       - Session summary / task title
    BODY        - Last user message body
    DURATION    - Task wall-clock duration in seconds
#>

param()

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Read context
# ---------------------------------------------------------------------------
$Status   = $env:STATUS
$Title    = $env:TITLE
$Body     = $env:BODY
$Duration = $env:DURATION

$statusLabel = switch ($Status) {
  "failed"      { "Failed" }
  "interrupted" { "Interrupted" }
  default       { "Completed" }
}

$iconType = if ($Status -eq "failed") { "Error" } else { "Info" }
$titleText = if ($Title) { "$Title" } else { "DeepCode Task" }

$shortBody = if ($Body) {
  if ($Body.Length -gt 100) { $Body.Substring(0, 97) + "..." } else { $Body }
} else { "" }

$parts = @()
if ($shortBody) { $parts += $shortBody }
$parts += "[$statusLabel]  Duration: ${Duration}s"
$parts += "Click to locate the terminal (look for flashing taskbar icon)"
$bodyText = $parts -join "`n"

# ---------------------------------------------------------------------------
# P/Invoke: console capture + window restore + taskbar flash
# ---------------------------------------------------------------------------
Add-Type -MemberDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FLASHWINFO {
    public uint  cbSize;
    public IntPtr hwnd;
    public uint  dwFlags;
    public uint  uCount;
    public uint  dwTimeout;
}

public static class DeepCodeNotify {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    // dwFlags: 0x03 = FLASHW_ALL (caption + taskbar)
    //          0x0C = FLASHW_TIMERNOFG (keep flashing until foreground)
    private const uint FLASH_UNTIL_FG = 0x03 | 0x0C;

    public static void RestoreWindow(IntPtr hwnd) {
        ShowWindow(hwnd, 9);                     // SW_RESTORE
        System.Threading.Thread.Sleep(200);
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, 1);                 // SW_SHOWNORMAL
            System.Threading.Thread.Sleep(200);
        }
    }

    public static void FlashTaskbar(IntPtr hwnd) {
        FLASHWINFO info = new FLASHWINFO();
        info.cbSize    = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
        info.hwnd      = hwnd;
        info.dwFlags   = FLASH_UNTIL_FG;
        info.uCount    = 0;
        info.dwTimeout = 0;
        FlashWindowEx(ref info);
    }
}
'@ -Name Win32 -Namespace DC

$consoleHwnd = [DC.DeepCodeNotify]::GetConsoleWindow()

if ($consoleHwnd -eq [IntPtr]::Zero) {
  # Running in a non-console terminal (mintty, Windows Terminal, etc.).
  # We cannot flash a specific taskbar button, but the BalloonTip alone
  # is still useful as a notification.
  Write-Warning "DeepCode: Could not capture console window handle."
  exit 0
}

# ---------------------------------------------------------------------------
# BalloonTip notification
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon              = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle   = $titleText
$notify.BalloonTipText    = $bodyText
$notify.BalloonTipIcon    = $iconType
$notify.Visible           = $true

$clickSub   = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClicked
$dismissSub = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClosed

$notify.ShowBalloonTip(30000)

# ---------------------------------------------------------------------------
# Event loop
# ---------------------------------------------------------------------------
try {
  $remaining = 35
  while ($remaining -gt 0) {
    $event = Wait-Event -Timeout $remaining
    if (-not $event) { break }

    if ($event.SourceIdentifier -eq $clickSub.Name) {
      try {
        [DC.DeepCodeNotify]::RestoreWindow($consoleHwnd)
        [DC.DeepCodeNotify]::FlashTaskbar($consoleHwnd)
      } catch { }
      break
    }

    if ($event.SourceIdentifier -eq $dismissSub.Name) { break }

    Remove-Event -EventIdentifier $event.EventIdentifier
    $remaining -= 1
  }
} finally {
  Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
  try { $notify.Dispose() } catch { }
}
