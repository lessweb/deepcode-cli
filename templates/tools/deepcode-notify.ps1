#Requires -Version 5.1
<#
.SYNOPSIS
  DeepCode CLI built-in Windows notification script.
  Shows a clickable desktop tip when a task completes or fails.
  Click the notification to focus the originating terminal window.

.DESCRIPTION
  Invoked automatically by DeepCode CLI on Windows when the `notify`
  setting is unset.  Test-only switches are available for the smoke test
  script in this directory; the CLI calls this script without arguments.

  Environment variables passed by the CLI:
    STATUS                       - "completed" | "failed" | "interrupted"
    TITLE                        - Session summary / task title
    QUESTION                     - Last user prompt text
    BODY                         - Last assistant message body
    DURATION                     - Task wall-clock duration in seconds
    DEEPCODE_NOTIFY_PARENT_PID   - Parent process id used to locate terminal
    DEEPCODE_NOTIFY_PROCESS_PID  - DeepCode process id
    DEEPCODE_NOTIFY_DEBUG_LOG    - Optional path for script error logging
#>

param(
  [switch]$ValidateOnly,
  [switch]$SelfTest,
  [int64]$TestWindowHwnd = 0,
  [int]$TimeoutSeconds = 35,
  [int]$AutoClickAfterMilliseconds = 0,
  [string]$ReadyPath,
  [string]$ResultPath
)

$ErrorActionPreference = "Stop"

function Write-NotifyDebug {
  param([string]$Message)

  $logPath = $env:DEEPCODE_NOTIFY_DEBUG_LOG
  if (-not $logPath) { return }

  try {
    $dir = Split-Path -Parent $logPath
    if ($dir) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    "[$timestamp] $Message" | Out-File -FilePath $logPath -Append -Encoding UTF8
  } catch { }
}

function Write-TestResult {
  param([hashtable]$Result)

  $json = $Result | ConvertTo-Json -Compress -Depth 6
  if ($ResultPath) {
    $dir = Split-Path -Parent $ResultPath
    if ($dir) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $json | Out-File -FilePath $ResultPath -Encoding UTF8
  } else {
    Write-Output $json
  }
}

function Convert-ToWindowHandle {
  param([object]$Value)

  if ($null -eq $Value) { return [IntPtr]::Zero }
  $text = "$Value".Trim()
  if (-not $text) { return [IntPtr]::Zero }

  $raw = [int64]0
  if ([int64]::TryParse($text, [ref]$raw) -and $raw -ne 0) {
    return [IntPtr]::new($raw)
  }
  return [IntPtr]::Zero
}

try {
  # ---------------------------------------------------------------------------
  # P/Invoke: console capture + window restore + activation + taskbar flash.
  # ---------------------------------------------------------------------------
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace DC {
    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    public static class DeepCodeNotify {
        private const int SW_SHOWNORMAL = 1;
        private const int SW_MINIMIZE = 6;
        private const int SW_RESTORE = 9;
        private const uint WM_SYSCOMMAND = 0x0112;
        private static readonly IntPtr SC_RESTORE = new IntPtr(0xF120);
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const byte VK_MENU = 0x12;
        private const uint FLASH_UNTIL_FOREGROUND = 0x03 | 0x0C;
        private static string lastActivationSummary = "";

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AttachConsole(uint dwProcessId);

        [DllImport("kernel32.dll")]
        public static extern bool FreeConsole();

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        [DllImport("user32.dll")]
        public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        public static string GetLastActivationSummary() {
            return lastActivationSummary ?? "";
        }

        public static int GetWindowProcessId(IntPtr hwnd) {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            return (int)processId;
        }

        public static IntPtr GetConsoleWindowForProcess(uint processId) {
            FreeConsole();
            if (!AttachConsole(processId)) {
                return IntPtr.Zero;
            }

            IntPtr hwnd = GetConsoleWindow();
            FreeConsole();
            return hwnd;
        }

        public static bool MinimizeWindow(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) {
                return false;
            }
            ShowWindow(hwnd, SW_MINIMIZE);
            Thread.Sleep(250);
            return IsIconic(hwnd);
        }

        public static bool RestoreWindow(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) {
                return false;
            }

            SendMessage(hwnd, WM_SYSCOMMAND, SC_RESTORE, IntPtr.Zero);
            ShowWindowAsync(hwnd, SW_RESTORE);
            ShowWindow(hwnd, SW_RESTORE);
            Thread.Sleep(200);

            if (IsIconic(hwnd)) {
                ShowWindow(hwnd, SW_SHOWNORMAL);
                Thread.Sleep(200);
            }

            return !IsIconic(hwnd);
        }

        public static bool ActivateWindow(IntPtr hwnd) {
            if (!RestoreWindow(hwnd)) {
                lastActivationSummary = "restore=false";
                return false;
            }

            bool top1 = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            bool top2 = SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            bool bringTop = BringWindowToTop(hwnd);

            // The classic Alt-key nudge relaxes Windows foreground-lock rules.
            keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(60);

            uint targetPid;
            uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
            IntPtr foregroundBefore = GetForegroundWindow();
            uint foregroundPid;
            uint foregroundThread = GetWindowThreadProcessId(foregroundBefore, out foregroundPid);
            uint currentThread = GetCurrentThreadId();

            bool attachCurrentTarget = false;
            bool attachCurrentForeground = false;
            bool attachTargetForeground = false;
            if (targetThread != 0) {
                attachCurrentTarget = AttachThreadInput(currentThread, targetThread, true);
            }
            if (foregroundThread != 0) {
                attachCurrentForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && foregroundThread != 0 && targetThread != foregroundThread) {
                attachTargetForeground = AttachThreadInput(targetThread, foregroundThread, true);
            }

            bool setForeground = SetForegroundWindow(hwnd);
            int setForegroundError = Marshal.GetLastWin32Error();
            BringWindowToTop(hwnd);

            if (targetThread != 0 && foregroundThread != 0 && targetThread != foregroundThread) {
                AttachThreadInput(targetThread, foregroundThread, false);
            }
            if (foregroundThread != 0) {
                AttachThreadInput(currentThread, foregroundThread, false);
            }
            if (targetThread != 0) {
                AttachThreadInput(currentThread, targetThread, false);
            }

            Thread.Sleep(100);

            if (GetForegroundWindow() == hwnd) {
                lastActivationSummary =
                    "restore=true topmost=" + top1 +
                    " notopmost=" + top2 +
                    " bringTop=" + bringTop +
                    " attachCurrentTarget=" + attachCurrentTarget +
                    " attachCurrentForeground=" + attachCurrentForeground +
                    " attachTargetForeground=" + attachTargetForeground +
                    " setForeground=" + setForeground +
                    " setForegroundError=" + setForegroundError +
                    " switch=false foreground=true";
                return true;
            }

            SwitchToThisWindow(hwnd, true);
            Thread.Sleep(100);
            bool foregroundAfterSwitch = GetForegroundWindow() == hwnd;
            lastActivationSummary =
                "restore=true topmost=" + top1 +
                " notopmost=" + top2 +
                " bringTop=" + bringTop +
                " attachCurrentTarget=" + attachCurrentTarget +
                " attachCurrentForeground=" + attachCurrentForeground +
                " attachTargetForeground=" + attachTargetForeground +
                " setForeground=" + setForeground +
                " setForegroundError=" + setForegroundError +
                " switch=true foreground=" + foregroundAfterSwitch;
            return foregroundAfterSwitch;
        }

        public static bool FlashTaskbar(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) {
                return false;
            }

            FLASHWINFO info = new FLASHWINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
            info.hwnd = hwnd;
            info.dwFlags = FLASH_UNTIL_FOREGROUND;
            info.uCount = 0;
            info.dwTimeout = 0;
            return FlashWindowEx(ref info);
        }
    }
}
'@

  function Test-TerminalProcessName {
    param([string]$ProcessName)

    $name = "$ProcessName".ToLowerInvariant()
    return $name -in @(
      "windowsterminal",
      "wt",
      "conhost",
      "openconsole",
      "cmd",
      "powershell",
      "pwsh"
    )
  }

  function Test-UsableWindowProcessName {
    param([string]$ProcessName)

    $name = "$ProcessName".ToLowerInvariant()
    return $name -notin @(
      "explorer",
      "shellexperiencehost",
      "searchhost",
      "startmenuexperiencehost",
      "systemsettings"
    )
  }

  function Test-UsableWindowHandle {
    param([IntPtr]$WindowHwnd)

    if ($WindowHwnd -eq [IntPtr]::Zero -or -not [DC.DeepCodeNotify]::IsWindow($WindowHwnd)) {
      return $false
    }

    try {
      $windowPid = [DC.DeepCodeNotify]::GetWindowProcessId($WindowHwnd)
      if ($windowPid -le 0) { return $false }
      $proc = Get-Process -Id $windowPid -ErrorAction Stop
      Write-NotifyDebug "window candidate hwnd=$($WindowHwnd.ToInt64()) pid=$windowPid name=$($proc.ProcessName) title='$($proc.MainWindowTitle)'"
      return Test-UsableWindowProcessName $proc.ProcessName
    } catch {
      Write-NotifyDebug "window candidate hwnd=$($WindowHwnd.ToInt64()) lookup failed: $($_.Exception.Message)"
      return $false
    }
  }

  function Find-ConsoleWindowHandle {
    param([int]$StartProcessId)

    $current = $StartProcessId
    $seen = @{}
    Write-NotifyDebug "Find-ConsoleWindowHandle startPid=$StartProcessId"
    while ($current -gt 0 -and -not $seen.ContainsKey($current)) {
      $seen[$current] = $true

      try {
        $consoleHwnd = [DC.DeepCodeNotify]::GetConsoleWindowForProcess([uint32]$current)
        Write-NotifyDebug "AttachConsole pid=$current hwnd=$($consoleHwnd.ToInt64())"
        if ($consoleHwnd -ne [IntPtr]::Zero -and [DC.DeepCodeNotify]::IsWindow($consoleHwnd)) {
          return $consoleHwnd
        }
      } catch {
        Write-NotifyDebug "AttachConsole pid=$current failed: $($_.Exception.Message)"
      }

      try {
        $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $current" -ErrorAction Stop
        if (-not $cim -or -not $cim.ParentProcessId) { break }
        $current = [int]$cim.ParentProcessId
      } catch {
        break
      }
    }

    return [IntPtr]::Zero
  }

  function Find-AncestorWindowHandle {
    param([int]$StartProcessId)

    $current = $StartProcessId
    $seen = @{}
    $fallbackHwnd = [IntPtr]::Zero
    Write-NotifyDebug "Find-AncestorWindowHandle startPid=$StartProcessId"
    while ($current -gt 0 -and -not $seen.ContainsKey($current)) {
      $seen[$current] = $true

      try {
        $proc = Get-Process -Id $current -ErrorAction Stop
        Write-NotifyDebug "process pid=$current name=$($proc.ProcessName) hwnd=$($proc.MainWindowHandle) title='$($proc.MainWindowTitle)'"
        if ((Test-TerminalProcessName $proc.ProcessName) -and $proc.MainWindowHandle -and $proc.MainWindowHandle -ne 0) {
          return [IntPtr]::new([int64]$proc.MainWindowHandle)
        }
        if (
          $fallbackHwnd -eq [IntPtr]::Zero -and
          (Test-UsableWindowProcessName $proc.ProcessName) -and
          $proc.MainWindowHandle -and
          $proc.MainWindowHandle -ne 0
        ) {
          $fallbackHwnd = [IntPtr]::new([int64]$proc.MainWindowHandle)
          Write-NotifyDebug "ancestor fallback candidate pid=$current hwnd=$($fallbackHwnd.ToInt64()) name=$($proc.ProcessName)"
        }
      } catch { }

      try {
        $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $current" -ErrorAction Stop
        if (-not $cim -or -not $cim.ParentProcessId) { break }
        Write-NotifyDebug "process pid=$current parentPid=$($cim.ParentProcessId)"
        $current = [int]$cim.ParentProcessId
      } catch {
        Write-NotifyDebug "process pid=$current parent lookup failed: $($_.Exception.Message)"
        break
      }
    }

    return $fallbackHwnd
  }

  function Resolve-TargetWindowHandle {
    $explicitHwnd = Convert-ToWindowHandle $TestWindowHwnd
    if ($explicitHwnd -ne [IntPtr]::Zero) { return $explicitHwnd }

    $envHwnd = Convert-ToWindowHandle $env:DEEPCODE_NOTIFY_WINDOW_HWND
    if ($envHwnd -ne [IntPtr]::Zero) { return $envHwnd }

    foreach ($pidValue in @($env:DEEPCODE_NOTIFY_PARENT_PID, $env:DEEPCODE_NOTIFY_PROCESS_PID)) {
      $pidText = "$pidValue".Trim()
      if (-not $pidText) { continue }

      $pidNumber = 0
      if ([int]::TryParse($pidText, [ref]$pidNumber)) {
        $consoleHwnd = Find-ConsoleWindowHandle $pidNumber
        if ($consoleHwnd -ne [IntPtr]::Zero) {
          Write-NotifyDebug "resolved via console attach pid=$pidNumber hwnd=$($consoleHwnd.ToInt64())"
          return $consoleHwnd
        }

        $hwnd = Find-AncestorWindowHandle $pidNumber
        if ($hwnd -ne [IntPtr]::Zero) {
          Write-NotifyDebug "resolved via ancestor terminal pid=$pidNumber hwnd=$($hwnd.ToInt64())"
          return $hwnd
        }
      }
    }

    $foregroundHwnd = [DC.DeepCodeNotify]::GetForegroundWindow()
    if (Test-UsableWindowHandle $foregroundHwnd) {
      Write-NotifyDebug "resolved via startup foreground hwnd=$($foregroundHwnd.ToInt64())"
      return $foregroundHwnd
    }

    $ownConsoleHwnd = [DC.DeepCodeNotify]::GetConsoleWindow()
    Write-NotifyDebug "fallback own GetConsoleWindow hwnd=$($ownConsoleHwnd.ToInt64())"
    return $ownConsoleHwnd
  }

  function Invoke-ActivateTargetWindow {
    param(
      [IntPtr]$WindowHwnd,
      [int]$Attempts = 1
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
      $activated = [DC.DeepCodeNotify]::ActivateWindow($WindowHwnd)
      Write-NotifyDebug "ActivateWindow attempt=$attempt activated=$activated summary='$([DC.DeepCodeNotify]::GetLastActivationSummary())'"
      if ($activated) { return $true }
      Start-Sleep -Milliseconds 150
    }

    try {
      Add-Type -AssemblyName Microsoft.VisualBasic
      $targetPid = [DC.DeepCodeNotify]::GetWindowProcessId($WindowHwnd)
      if ($targetPid -gt 0) {
        $appActivated = [Microsoft.VisualBasic.Interaction]::AppActivate([int]$targetPid)
        Write-NotifyDebug "AppActivate pid=$targetPid result=$appActivated"
        Start-Sleep -Milliseconds 250
        if ([DC.DeepCodeNotify]::GetForegroundWindow() -eq $WindowHwnd) {
          return $true
        }
      }
    } catch {
      Write-NotifyDebug "AppActivate failed: $($_.Exception.Message)"
    }

    return $false
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -WarningAction SilentlyContinue -TypeDefinition @'
namespace DC {
    public class DeepCodeToastForm : System.Windows.Forms.Form {
        private const int WM_MOUSEACTIVATE = 0x0021;
        private const int CS_DROPSHADOW = 0x00020000;
        private static readonly System.IntPtr MA_ACTIVATE = new System.IntPtr(1);

        public event System.EventHandler ToastClickRequested;

        protected override System.Windows.Forms.CreateParams CreateParams {
            get {
                System.Windows.Forms.CreateParams cp = base.CreateParams;
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        protected override void WndProc(ref System.Windows.Forms.Message m) {
            if (m.Msg == WM_MOUSEACTIVATE) {
                m.Result = MA_ACTIVATE;
                if (!IsCloseButtonUnderCursor()) {
                    System.EventHandler handler = ToastClickRequested;
                    if (handler != null) {
                        handler(this, System.EventArgs.Empty);
                    }
                }
                return;
            }
            base.WndProc(ref m);
        }

        private bool IsCloseButtonUnderCursor() {
            System.Drawing.Point clientPoint = PointToClient(System.Windows.Forms.Cursor.Position);
            System.Windows.Forms.Control child = GetChildAtPoint(clientPoint);
            return child != null && child.Name == "DeepCodeToastClose";
        }
    }
}
'@

  $targetHwnd = Resolve-TargetWindowHandle
  $hasTargetWindow = $targetHwnd -ne [IntPtr]::Zero -and [DC.DeepCodeNotify]::IsWindow($targetHwnd)
  Write-NotifyDebug "resolved targetHwnd=$($targetHwnd.ToInt64()) hasTargetWindow=$hasTargetWindow parentPid=$env:DEEPCODE_NOTIFY_PARENT_PID processPid=$env:DEEPCODE_NOTIFY_PROCESS_PID"

  if ($ValidateOnly) {
    Write-TestResult @{
      ok = $true
      mode = "validate"
      targetHwnd = if ($hasTargetWindow) { $targetHwnd.ToInt64() } else { 0 }
      hasTargetWindow = $hasTargetWindow
      formsLoaded = $true
    }
    exit 0
  }

  if ($SelfTest) {
    if (-not $hasTargetWindow) {
      throw "SelfTest requires a valid target window handle."
    }

    $minimized = [DC.DeepCodeNotify]::MinimizeWindow($targetHwnd)
    $restored = [DC.DeepCodeNotify]::RestoreWindow($targetHwnd)
    $foreground = Invoke-ActivateTargetWindow $targetHwnd
    $flashed = [DC.DeepCodeNotify]::FlashTaskbar($targetHwnd)
    $ok = $minimized -and $restored -and -not [DC.DeepCodeNotify]::IsIconic($targetHwnd)

    Write-TestResult @{
      ok = $ok
      mode = "selftest"
      targetHwnd = $targetHwnd.ToInt64()
      minimized = $minimized
      restored = $restored
      foreground = $foreground
      flashed = $flashed
      activationSummary = [DC.DeepCodeNotify]::GetLastActivationSummary()
      iconicAfterRestore = [DC.DeepCodeNotify]::IsIconic($targetHwnd)
    }

    if (-not $ok) { exit 1 }
    exit 0
  }

  # ---------------------------------------------------------------------------
  # Read context and build notification text.
  # ---------------------------------------------------------------------------
  function Normalize-NotifySnippet {
    param(
      [string]$Text,
      [int]$MaxChars,
      [int]$MaxLines
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
      return ""
    }

    $lines = @()
    foreach ($line in ("$Text" -split "\r?\n")) {
      $normalized = (($line -replace "\s+", " ").Trim())
      if ($normalized) {
        $lines += $normalized
      }
      if ($lines.Count -ge $MaxLines) {
        break
      }
    }

    if ($lines.Count -eq 0) {
      return ""
    }

    $snippet = $lines -join " "
    if ($snippet.Length -gt $MaxChars) {
      $take = [Math]::Max(0, $MaxChars - 3)
      return $snippet.Substring(0, $take).TrimEnd() + "..."
    }

    return $snippet
  }

  function New-RoundedRectanglePath {
    param(
      [System.Drawing.Rectangle]$Rectangle,
      [int]$Radius
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($Radius -le 0) {
      $path.AddRectangle($Rectangle)
      return $path
    }

    $diameter = [Math]::Max(1, $Radius * 2)
    $path.AddArc($Rectangle.Left, $Rectangle.Top, $diameter, $diameter, 180, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Top, $diameter, $diameter, 270, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rectangle.Left, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
  }

  function Invoke-ToastShownSound {
    if ($ResultPath) { return }

    try {
      [System.Media.SystemSounds]::Asterisk.Play()
    } catch {
      Write-NotifyDebug "toast sound failed: $($_.Exception.Message)"
    }
  }

  function Set-ToastVisualScale {
    param(
      [System.Windows.Forms.Form]$ToastForm,
      [int]$BaseLeft,
      [int]$BaseTop,
      [int]$BaseWidth,
      [int]$BaseHeight,
      [double]$Scale,
      [double]$Opacity
    )

    try {
      $width = [Math]::Max(1, [int][Math]::Round($BaseWidth * $Scale))
      $height = [Math]::Max(1, [int][Math]::Round($BaseHeight * $Scale))
      $left = $BaseLeft + [int][Math]::Round(($BaseWidth - $width) / 2)
      $top = $BaseTop + [int][Math]::Round(($BaseHeight - $height) / 2)

      $ToastForm.SetBounds($left, $top, $width, $height)
      $ToastForm.Opacity = [Math]::Min(1, [Math]::Max(0, $Opacity))

      $path = New-RoundedRectanglePath (New-Object System.Drawing.Rectangle(0, 0, $ToastForm.Width, $ToastForm.Height)) 10
      $oldRegion = $ToastForm.Region
      $ToastForm.Region = New-Object System.Drawing.Region($path)
      if ($oldRegion) { $oldRegion.Dispose() }
      $path.Dispose()

      $ToastForm.Refresh()
      [System.Windows.Forms.Application]::DoEvents()
    } catch {
      Write-NotifyDebug "toast animation frame failed: $($_.Exception.Message)"
    }
  }

  function Invoke-ToastClickAnimation {
    param([System.Windows.Forms.Form]$ToastForm)

    $baseLeft = $ToastForm.Left
    $baseTop = $ToastForm.Top
    $baseWidth = $ToastForm.Width
    $baseHeight = $ToastForm.Height

    foreach ($frame in @(
      @{ Scale = 0.96; Opacity = 0.96; Delay = 35 },
      @{ Scale = 1.02; Opacity = 1.0; Delay = 45 },
      @{ Scale = 0.94; Opacity = 0.65; Delay = 35 },
      @{ Scale = 0.90; Opacity = 0.15; Delay = 25 }
    )) {
      Set-ToastVisualScale $ToastForm $baseLeft $baseTop $baseWidth $baseHeight $frame.Scale $frame.Opacity
      Start-Sleep -Milliseconds $frame.Delay
    }
  }

  $Status = $env:STATUS
  $Title = $env:TITLE
  $Question = $env:QUESTION
  $Body = $env:BODY
  $Duration = $env:DURATION

  $statusLabel = switch ($Status) {
    "failed" { "Failed" }
    "interrupted" { "Interrupted" }
    default { "Completed" }
  }

  $titleText = "deepcode"
  $questionText = Normalize-NotifySnippet $Question 128 2
  if (-not $questionText) {
    $questionText = Normalize-NotifySnippet $Title 128 2
  }
  if (-not $questionText) {
    $questionText = "Task finished"
  }

  $answerText = Normalize-NotifySnippet $Body 210 3
  if (-not $answerText -and $env:FAIL_REASON) {
    $answerText = Normalize-NotifySnippet $env:FAIL_REASON 210 2
  }
  if (-not $answerText) {
    $answerText = if ($Duration) { "$statusLabel in ${Duration}s" } else { $statusLabel }
  }

  # ---------------------------------------------------------------------------
  # Clickable desktop tip window.
  # ---------------------------------------------------------------------------
  $script:notifyClicked = $false
  $script:notifyActivated = $false
  $script:notifyFlashed = $false
  $script:finalForeground = $false
  $script:handlingClick = $false

  $backgroundColor = [System.Drawing.Color]::FromArgb(248, 248, 250)
  $brandColor = [System.Drawing.Color]::FromArgb(38, 39, 43)
  $questionColor = [System.Drawing.Color]::FromArgb(31, 31, 35)
  $answerColor = [System.Drawing.Color]::FromArgb(101, 104, 111)
  $chromeColor = [System.Drawing.Color]::FromArgb(77, 80, 86)
  $chromeHoverColor = [System.Drawing.Color]::FromArgb(230, 231, 235)

  $form = New-Object DC.DeepCodeToastForm
  $form.Text = $titleText
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $form.ClientSize = New-Object System.Drawing.Size(382, 144)
  $form.BackColor = $backgroundColor
  $form.Cursor = [System.Windows.Forms.Cursors]::Hand

  $roundedRegionPath = New-RoundedRectanglePath (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)) 10
  $form.Region = New-Object System.Drawing.Region($roundedRegionPath)
  $roundedRegionPath.Dispose()

  $form.Add_Paint({
    param($sender, $eventArgs)

    try {
      $graphics = $eventArgs.Graphics
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $diameter = 20
      $path.AddArc($rect.Left, $rect.Top, $diameter, $diameter, 180, 90)
      $path.AddArc($rect.Right - $diameter, $rect.Top, $diameter, $diameter, 270, 90)
      $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
      $path.AddArc($rect.Left, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
      $path.CloseFigure()
      $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(197, 199, 204), 1)
      $graphics.DrawPath($pen, $path)
      $pen.Dispose()
      $path.Dispose()
    } catch {
      Write-NotifyDebug "toast paint failed: $($_.Exception.Message)"
    }
  })

  $workArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Left = [Math]::Max($workArea.Left, $workArea.Right - $form.Width - 18)
  $form.Top = [Math]::Max($workArea.Top, $workArea.Bottom - $form.Height - 18)

  $iconImage = $null
  $iconPath = Join-Path $PSScriptRoot "deepcode-icon.png"
  if (Test-Path -LiteralPath $iconPath) {
    try {
      $iconImage = [System.Drawing.Image]::FromFile($iconPath)
    } catch {
      Write-NotifyDebug "icon load failed: $($_.Exception.Message)"
    }
  }

  $iconBox = New-Object System.Windows.Forms.PictureBox
  $iconBox.Left = 18
  $iconBox.Top = 15
  $iconBox.Width = 20
  $iconBox.Height = 20
  $iconBox.BackColor = $backgroundColor
  $iconBox.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
  $iconBox.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($iconImage) {
    $iconBox.Image = $iconImage
  }

  $titleLabel = New-Object System.Windows.Forms.Label
  $titleLabel.AutoSize = $false
  $titleLabel.Left = 46
  $titleLabel.Top = 12
  $titleLabel.Width = 205
  $titleLabel.Height = 26
  $titleLabel.BackColor = $backgroundColor
  $titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Regular)
  $titleLabel.ForeColor = $brandColor
  $titleLabel.Text = $titleText
  $titleLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $menuLabel = New-Object System.Windows.Forms.Label
  $menuLabel.AutoSize = $false
  $menuLabel.Left = $form.ClientSize.Width - 76
  $menuLabel.Top = 9
  $menuLabel.Width = 34
  $menuLabel.Height = 28
  $menuLabel.BackColor = $backgroundColor
  $menuLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Regular)
  $menuLabel.ForeColor = $chromeColor
  $menuLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $menuLabel.Text = "..."
  $menuLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $closeLabel = New-Object System.Windows.Forms.Label
  $closeLabel.Name = "DeepCodeToastClose"
  $closeLabel.AutoSize = $false
  $closeLabel.Left = $form.ClientSize.Width - 40
  $closeLabel.Top = 9
  $closeLabel.Width = 28
  $closeLabel.Height = 28
  $closeLabel.BackColor = $backgroundColor
  $closeLabel.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Regular)
  $closeLabel.ForeColor = $chromeColor
  $closeLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $closeLabel.Text = [string][char]0x00D7
  $closeLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $closeOnly = {
    if ($script:handlingClick) { return }
    $script:handlingClick = $true
    try { $timeoutTimer.Stop() } catch { }
    if ($autoClickTimer) {
      try { $autoClickTimer.Stop() } catch { }
    }
    $form.Close()
  }

  $questionLabel = New-Object System.Windows.Forms.Label
  $questionLabel.AutoSize = $false
  $questionLabel.Left = 24
  $questionLabel.Top = 50
  $questionLabel.Width = $form.ClientSize.Width - 48
  $questionLabel.Height = 25
  $questionLabel.AutoEllipsis = $true
  $questionLabel.BackColor = $backgroundColor
  $questionLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Regular)
  $questionLabel.ForeColor = $questionColor
  $questionLabel.Text = $questionText
  $questionLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $answerLabel = New-Object System.Windows.Forms.Label
  $answerLabel.AutoSize = $false
  $answerLabel.Left = 24
  $answerLabel.Top = 77
  $answerLabel.Width = $form.ClientSize.Width - 48
  $answerLabel.Height = 52
  $answerLabel.AutoEllipsis = $true
  $answerLabel.BackColor = $backgroundColor
  $answerLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10.5, [System.Drawing.FontStyle]::Regular)
  $answerLabel.ForeColor = $answerColor
  $answerLabel.Text = $answerText
  $answerLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $form.Controls.Add($iconBox)
  $form.Controls.Add($titleLabel)
  $form.Controls.Add($menuLabel)
  $form.Controls.Add($closeLabel)
  $form.Controls.Add($questionLabel)
  $form.Controls.Add($answerLabel)

  $timeoutTimer = New-Object System.Windows.Forms.Timer
  $timeoutTimer.Interval = [Math]::Max(1, $TimeoutSeconds) * 1000
  $timeoutTimer.Add_Tick({
    Write-NotifyDebug "toast timeout"
    $timeoutTimer.Stop()
    $form.Close()
  })

  $autoClickTimer = $null
  if ($AutoClickAfterMilliseconds -gt 0) {
    $autoClickTimer = New-Object System.Windows.Forms.Timer
    $autoClickTimer.Interval = [Math]::Max(1, $AutoClickAfterMilliseconds)
  }

  $activateAndClose = {
    if ($script:handlingClick) { return }
    $script:handlingClick = $true
    $script:notifyClicked = $true
    Write-NotifyDebug "toast click received targetHwnd=$($targetHwnd.ToInt64()) hasTargetWindow=$hasTargetWindow"
    try { $timeoutTimer.Stop() } catch { }
    if ($autoClickTimer) {
      try { $autoClickTimer.Stop() } catch { }
    }

    if ($hasTargetWindow) {
      # Keep the clicked tip window alive while requesting foreground access.
      # Hiding first can discard the user-click foreground permission on Windows.
      $script:notifyActivated = Invoke-ActivateTargetWindow $targetHwnd 1
      Write-NotifyDebug "Invoke-ActivateTargetWindow activated=$script:notifyActivated"
      if (-not $script:notifyActivated) {
        $script:notifyFlashed = [DC.DeepCodeNotify]::FlashTaskbar($targetHwnd)
        Write-NotifyDebug "FlashTaskbar flashed=$script:notifyFlashed"
      }
      $script:finalForeground = [DC.DeepCodeNotify]::GetForegroundWindow() -eq $targetHwnd
      Write-NotifyDebug "final foreground after click=$script:finalForeground"
    } else {
      Write-NotifyDebug "click ignored because no target window was resolved"
    }

    try {
      Invoke-ToastClickAnimation $form
      $form.Hide()
      [System.Windows.Forms.Application]::DoEvents()
    } catch { }
    $form.Close()
  }

  $form.Add_Click($activateAndClose)
  $form.Add_MouseUp($activateAndClose)
  $form.Add_ToastClickRequested($activateAndClose)
  $iconBox.Add_Click($activateAndClose)
  $iconBox.Add_MouseUp($activateAndClose)
  $titleLabel.Add_Click($activateAndClose)
  $titleLabel.Add_MouseUp($activateAndClose)
  $menuLabel.Add_Click($activateAndClose)
  $menuLabel.Add_MouseUp($activateAndClose)
  $questionLabel.Add_Click($activateAndClose)
  $questionLabel.Add_MouseUp($activateAndClose)
  $answerLabel.Add_Click($activateAndClose)
  $answerLabel.Add_MouseUp($activateAndClose)
  $closeLabel.Add_MouseEnter({ $closeLabel.BackColor = $chromeHoverColor })
  $closeLabel.Add_MouseLeave({ $closeLabel.BackColor = $backgroundColor })
  $closeLabel.Add_Click($closeOnly)
  $closeLabel.Add_MouseUp($closeOnly)

  if ($autoClickTimer) {
    $autoClickTimer.Add_Tick({
      Write-NotifyDebug "auto click timer fired"
      $autoClickTimer.Stop()
      & $activateAndClose
    })
  }

  $form.Add_Shown({
    Write-NotifyDebug "toast shown timeoutSeconds=$TimeoutSeconds title='$titleText'"
    Invoke-ToastShownSound
    if ($ReadyPath) {
      try {
        $readyDir = Split-Path -Parent $ReadyPath
        if ($readyDir) {
          New-Item -ItemType Directory -Path $readyDir -Force | Out-Null
        }
        @{
          ok = $true
          mode = "ready"
          hwnd = $form.Handle.ToInt64()
          left = $form.Left
          top = $form.Top
          width = $form.Width
          height = $form.Height
          centerX = $form.Left + [int]($form.Width / 2)
          centerY = $form.Top + [int]($form.Height / 2)
        } | ConvertTo-Json -Compress | Out-File -FilePath $ReadyPath -Encoding UTF8
      } catch {
        Write-NotifyDebug "ready write failed: $($_.Exception.Message)"
      }
    }
    $timeoutTimer.Start()
    if ($autoClickTimer) { $autoClickTimer.Start() }
  })

  try {
    [System.Windows.Forms.Application]::Run($form)
  } finally {
    try { $timeoutTimer.Stop(); $timeoutTimer.Dispose() } catch { }
    if ($autoClickTimer) {
      try { $autoClickTimer.Stop(); $autoClickTimer.Dispose() } catch { }
    }
    try { $form.Dispose() } catch { }
    if ($iconImage) {
      try { $iconImage.Dispose() } catch { }
    }
    if ($hasTargetWindow) {
      $script:finalForeground = [DC.DeepCodeNotify]::GetForegroundWindow() -eq $targetHwnd
    }
    Write-NotifyDebug "toast disposed clicked=$script:notifyClicked activated=$script:notifyActivated flashed=$script:notifyFlashed finalForeground=$script:finalForeground"
  }

  if ($ResultPath) {
    Write-TestResult @{
      ok = $script:notifyClicked -and $script:finalForeground
      mode = "toast"
      clicked = $script:notifyClicked
      activated = $script:notifyActivated
      flashed = $script:notifyFlashed
      finalForeground = $script:finalForeground
      targetHwnd = if ($hasTargetWindow) { $targetHwnd.ToInt64() } else { 0 }
      hasTargetWindow = $hasTargetWindow
    }
  }
} catch {
  Write-NotifyDebug ($_ | Out-String)
  if ($ValidateOnly -or $SelfTest -or $ResultPath) {
    Write-TestResult @{
      ok = $false
      mode = if ($SelfTest) { "selftest" } elseif ($ValidateOnly) { "validate" } else { "notify" }
      error = $_.Exception.Message
    }
  }
  exit 1
}
