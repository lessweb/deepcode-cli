#Requires -Version 5.1
$ErrorActionPreference = "Continue"

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

public static class DeepCodeTest {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    public static void RestoreWindow(IntPtr hwnd) {
        ShowWindow(hwnd, 9);
        System.Threading.Thread.Sleep(200);
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, 1);
            System.Threading.Thread.Sleep(200);
        }
    }

    public static void FlashTaskbar(IntPtr hwnd) {
        FLASHWINFO info = new FLASHWINFO();
        info.cbSize    = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
        info.hwnd      = hwnd;
        info.dwFlags   = 0x03 | 0x0C;  // FLASHW_ALL | FLASHW_TIMERNOFG
        FlashWindowEx(ref info);
    }
}
'@

Write-Host "=== DeepCode Notify Test ===" -ForegroundColor Cyan

$hwnd = [DeepCodeTest]::GetConsoleWindow()
Write-Host "1. Console HWND: $hwnd"

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Host "   ERROR: Must run from cmd.exe (not Git Bash)" -ForegroundColor Red
    exit 1
}

Write-Host "2. Current: iconic=$([DeepCodeTest]::IsIconic($hwnd)) foreground=$(([DeepCodeTest]::GetForegroundWindow() -eq $hwnd))"

# Minimize & auto-restore test
Write-Host "3. Minimizing in 2s..."
Start-Sleep 2
[DeepCodeTest]::ShowWindow($hwnd, 6) | Out-Null
Start-Sleep 1
Write-Host "   Minimized: iconic=$([DeepCodeTest]::IsIconic($hwnd))"

Write-Host "4. Restoring in 1s..."
Start-Sleep 1
[DeepCodeTest]::RestoreWindow($hwnd)
Write-Host "   After restore: iconic=$([DeepCodeTest]::IsIconic($hwnd))"
Write-Host "   RESULT: $(if (-not [DeepCodeTest]::IsIconic($hwnd)){'RESTORED'}else{'STILL MINIMIZED'})"

# BalloonTip click → taskbar flash test
Write-Host ""
Write-Host "5. BalloonTip test: click notification, then look for FLASHING taskbar icon for THIS window"
Add-Type -AssemblyName System.Windows.Forms

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = "Test - Click Me"
$notify.BalloonTipText = "Click to flash this window's taskbar icon.`nLook for the orange flashing button!"
$notify.Visible = $true

$clickSub = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClicked
$dismissSub = Register-ObjectEvent -InputObject $notify -EventName BalloonTipClosed
$notify.ShowBalloonTip(15000)

Write-Host "   BalloonTip shown (15s timeout)..."
try {
    $remaining = 20
    while ($remaining -gt 0) {
        $event = Wait-Event -Timeout $remaining
        if (-not $event) { Write-Host "   Timeout."; break }
        if ($event.SourceIdentifier -eq $clickSub.Name) {
            Write-Host "   CLICKED! Restoring + flashing taskbar..."
            [DeepCodeTest]::RestoreWindow($hwnd)
            [DeepCodeTest]::FlashTaskbar($hwnd)
            Write-Host "   Window should now be visible. Look for the flashing taskbar icon!" -ForegroundColor Green
            Write-Host "   (Click the taskbar icon to stop flashing)"
            break
        }
        if ($event.SourceIdentifier -eq $dismissSub.Name) { Write-Host "   Dismissed."; break }
        Remove-Event -EventIdentifier $event.EventIdentifier
        $remaining -= 1
    }
} finally {
    Get-EventSubscriber | Unregister-Event -Force -ErrorAction SilentlyContinue
    try { $notify.Dispose() } catch { }
}

Write-Host ""
Write-Host "Test complete."
