#Requires -Version 5.1
$ErrorActionPreference = "Continue"

Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
'@ -Name W32 -Namespace T

$WM_SYSCOMMAND = 0x0112
$SC_MINIMIZE   = [IntPtr]0xF020

Write-Host "=== DeepCode Window Activation Diagnostic ===" -ForegroundColor Cyan

# Open notepad
Start-Process notepad.exe | Out-Null
Start-Sleep -Seconds 3

# Find actual notepad UI process
$proc = Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Host "ERROR: No notepad window found"; exit 1 }
$hwnd = $proc.MainWindowHandle
Write-Host "HWND=$hwnd Title='$($proc.MainWindowTitle)'"

function Test-Restore($label, [ScriptBlock]$activate) {
  Write-Host "--- $label ---"
  [T.W32]::SendMessage($hwnd, $WM_SYSCOMMAND, $SC_MINIMIZE, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 600
  Write-Host "  Minimized: $([T.W32]::IsIconic($hwnd))"
  & $activate
  Start-Sleep -Milliseconds 400
  $ok = -not [T.W32]::IsIconic($hwnd)
  $fg = ([T.W32]::GetForegroundWindow() -eq $hwnd)
  Write-Host "  restored=$ok foreground=$fg"
  return $ok
}

$r1 = Test-Restore "M1: ShowWindow+SetFg (main thread)" {
  [T.W32]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep 0.2
  [T.W32]::SetForegroundWindow($hwnd) | Out-Null
}
$r2 = Test-Restore "M2: SwitchToThisWindow" {
  [T.W32]::SwitchToThisWindow($hwnd, $true)
}
$r3 = Test-Restore "M3: ShowWindow+Switch" {
  [T.W32]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep 0.2
  [T.W32]::SwitchToThisWindow($hwnd, $true)
}

# M4: Spawned helper (simulates real BalloonTip scenario)
Write-Host "--- M4: Spawned helper ---"
[T.W32]::SendMessage($hwnd, $WM_SYSCOMMAND, $SC_MINIMIZE, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 600
Write-Host "  Minimized: $([T.W32]::IsIconic($hwnd))"

$h = $hwnd.ToInt64()
$tmp = Join-Path $env:TEMP "dc-diag-helper.ps1"
$helperLines = @(
  'param([uint64]$w)',
  'Add-Type -MemberDefinition "[DllImport(\"user32.dll\")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h, int n);[DllImport(\"user32.dll\")]public static extern void SwitchToThisWindow(IntPtr h, bool f);" -Name X -Namespace Y',
  '$h = [IntPtr]::new([int64]$w)',
  '[Y.X]::ShowWindow($h, 9) | Out-Null',
  'Start-Sleep -Milliseconds 300',
  '[Y.X]::SetForegroundWindow($h) | Out-Null',
  'Start-Sleep -Milliseconds 100',
  '[Y.X]::SwitchToThisWindow($h, $true)'
)
$helperLines -join "`n" | Out-File -FilePath $tmp -Encoding UTF8

Start-Process powershell -ArgumentList "-ExecutionPolicy","Bypass","-NoProfile","-File",$tmp,"-w",$h -WindowStyle Hidden -Wait
Start-Sleep -Milliseconds 500
$r4 = -not [T.W32]::IsIconic($hwnd)
$fg4 = ([T.W32]::GetForegroundWindow() -eq $hwnd)
Write-Host "  restored=$r4 foreground=$fg4"
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
Write-Host "M1 (main ShowWindow+SetFg):  $(if($r1){'PASS'}else{'FAIL'})"
Write-Host "M2 (main SwitchToThis):      $(if($r2){'PASS'}else{'FAIL'})"
Write-Host "M3 (main ShowWindow+Switch): $(if($r3){'PASS'}else{'FAIL'})"
Write-Host "M4 (spawned helper):         $(if($r4){'PASS'}else{'FAIL'})"
if (-not $r4) {
  Write-Host "ROOT CAUSE: Spawned child process cannot SetForegroundWindow on Win11" -ForegroundColor Yellow
}

Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Done."
