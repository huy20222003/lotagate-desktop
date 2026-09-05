$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
$drawingAssembly = [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing').Location

Add-Type -ReferencedAssemblies $drawingAssembly -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class LotaGateComputerNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
  [DllImport("user32.dll")] private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowDC(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
  [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);
  [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr objectHandle);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr objectHandle);
  [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
  public static bool Exists(IntPtr hWnd) { return IsWindow(hWnd); }
  public static int[] Bounds(IntPtr hWnd) { RECT rect; if (!GetWindowRect(hWnd, out rect)) throw new InvalidOperationException("Unable to read target window bounds."); return new[] { rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top }; }
  public static void Focus(IntPtr hWnd) { if (!IsWindow(hWnd)) throw new InvalidOperationException("The target window no longer exists."); ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click(int x, int y, uint down, uint up, int count) { SetCursorPos(x, y); for (int i = 0; i < count; i++) { mouse_event(down, (uint)x, (uint)y, 0, UIntPtr.Zero); mouse_event(up, (uint)x, (uint)y, 0, UIntPtr.Zero); } }
  public static void Scroll(int amount, bool horizontal) { mouse_event(horizontal ? 0x1000u : 0x0800u, 0, 0, amount, UIntPtr.Zero); }
  public static void Key(ushort key, bool down) { keybd_event((byte)key, 0, down ? 0u : 0x0002u, UIntPtr.Zero); }
  public static void Unicode(string text) { foreach (char character in text) { keybd_event(0, (byte)character, 0x0004u, UIntPtr.Zero); keybd_event(0, (byte)character, 0x0006u, UIntPtr.Zero); } }
  public static void Button(int x, int y, bool down, bool right) { SetCursorPos(x, y); uint flag = right ? (down ? 8u : 16u) : (down ? 2u : 4u); mouse_event(flag, (uint)x, (uint)y, 0, UIntPtr.Zero); }
  public static byte[] CapturePng(IntPtr hWnd) { var bounds = Bounds(hWnd); var windowDc = GetWindowDC(hWnd); if (windowDc == IntPtr.Zero) throw new InvalidOperationException("Unable to open target window for capture."); var memoryDc = CreateCompatibleDC(windowDc); var bitmapHandle = CreateCompatibleBitmap(windowDc, bounds[2], bounds[3]); var previous = SelectObject(memoryDc, bitmapHandle); try { if (!PrintWindow(hWnd, memoryDc, 2)) throw new InvalidOperationException("Windows refused to capture target window."); using (var bitmap = Image.FromHbitmap(bitmapHandle)) using (var stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Png); return stream.ToArray(); } } finally { SelectObject(memoryDc, previous); DeleteObject(bitmapHandle); DeleteDC(memoryDc); ReleaseDC(hWnd, windowDc); } }
}
'@

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$action = [string]$request.action
$params = $request.params
$allowedApplications = @($request.allowedApplications | ForEach-Object { [string]$_ })

function Write-Result([object]$value) { @{ ok = $true; result = $value } | ConvertTo-Json -Depth 10 -Compress }
function Fail([string]$message) { @{ ok = $false; error = $message } | ConvertTo-Json -Depth 5 -Compress; exit 1 }
function Require-String([string]$name) { $value = $params.$name; if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { throw "Computer parameter '$name' is required." }; return [string]$value }
function Window-Handle { return [IntPtr]::new([int64](Require-String 'windowId')) }
function Window-Bounds([IntPtr]$handle) { $bounds = [LotaGateComputerNative]::Bounds($handle); return @{ x = $bounds[0]; y = $bounds[1]; width = $bounds[2]; height = $bounds[3] } }
function Assert-Window([IntPtr]$handle) { if (-not [LotaGateComputerNative]::Exists($handle)) { throw 'The target window no longer exists.' } }
function Encode-ElementId([string]$type, [string]$automationId, [string]$name) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$type|$automationId|$name")) }
function Decode-ElementId([string]$elementId) { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($elementId)).Split('|', 3) }
function Find-Element([IntPtr]$handle, [string]$elementId) {
  $parts = Decode-ElementId $elementId
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $current = $element.Current
    if ($current.ControlType.ProgrammaticName -eq $parts[0] -and $current.AutomationId -eq $parts[1] -and $current.Name -eq $parts[2]) { return $element }
  }
  throw 'The inspected UI element is no longer available.'
}
function Target-Point([IntPtr]$handle, [object]$target) {
  if ($null -ne $target -and $null -ne $target.elementId) {
    $element = Find-Element $handle ([string]$target.elementId)
    try { $point = $element.GetClickablePoint(); return @{ x = [int]$point.X; y = [int]$point.Y } } catch { $rect = $element.Current.BoundingRectangle; return @{ x = [int]($rect.X + $rect.Width / 2); y = [int]($rect.Y + $rect.Height / 2) } }
  }
  if ($null -ne $target -and $null -ne $target.x -and $null -ne $target.y) { $bounds = Window-Bounds $handle; return @{ x = $bounds.x + [int]$target.x; y = $bounds.y + [int]$target.y } }
  throw 'A target element or point is required.'
}
function Key-Code([string]$key) {
  $map = @{ Enter = 13; Tab = 9; Escape = 27; Backspace = 8; Delete = 46; Insert = 45; Home = 36; End = 35; PageUp = 33; PageDown = 34; Left = 37; Right = 39; Up = 38; Down = 40; Space = 32; F1 = 112; F2 = 113; F3 = 114; F4 = 115; F5 = 116; F6 = 117; F7 = 118; F8 = 119; F9 = 120; F10 = 121; F11 = 122; F12 = 123 }
  if ($map.ContainsKey($key)) { return [uint16]$map[$key] }
  if ($key.Length -eq 1) { return [uint16][int][char]$key.ToUpperInvariant() }
  throw "Unsupported key '$key'."
}
function Apply-Modifier([string]$modifier, [bool]$down) { $code = if ($modifier -eq 'Alt') { 18 } elseif ($modifier -eq 'Control') { 17 } elseif ($modifier -eq 'Shift') { 16 } elseif ($modifier -eq 'Meta') { 91 } else { throw "Unsupported modifier '$modifier'." }; [LotaGateComputerNative]::Key([uint16]$code, $down) }
function Text-Exists([IntPtr]$handle, [string]$text) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle); foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { if ([string]$element.Current.Name -like "*$text*") { return $true } }; return $false }
function Application-Key([string]$value) { return $value.Trim().ToLowerInvariant() -replace '\.exe$', '' }
function Is-ApplicationAllowed([string]$value) { $key = Application-Key $value; if ([string]::IsNullOrWhiteSpace($key)) { return $false }; foreach ($allowed in $allowedApplications) { if ($key -eq (Application-Key ([string]$allowed))) { return $true } }; return $false }

try {
  switch ($action) {
    'computer.listWindows' { $items = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ([string]$_.MainWindowTitle).Trim().Length -gt 0 } | ForEach-Object { $handle = $_.MainWindowHandle; $bounds = Window-Bounds $handle; [ordered]@{ windowId = $handle.ToString(); appId = $_.ProcessName.ToLowerInvariant(); processName = $_.ProcessName; title = $_.MainWindowTitle; bounds = $bounds; state = 'active'; isForeground = $false } }); Write-Result $items; break }
    'computer.inspect' { $handle = Window-Handle; Assert-Window $handle; $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle); $elements = @(); foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { if ($elements.Count -ge 300) { break }; $current = $element.Current; $elements += [ordered]@{ elementId = Encode-ElementId $current.ControlType.ProgrammaticName ([string]$current.AutomationId) ([string]$current.Name); role = $current.ControlType.ProgrammaticName; name = [string]$current.Name; enabled = [bool]$current.IsEnabled; visible = $true; bounds = @{ x = [int]$current.BoundingRectangle.X; y = [int]$current.BoundingRectangle.Y; width = [int]$current.BoundingRectangle.Width; height = [int]$current.BoundingRectangle.Height } } }; Write-Result ([ordered]@{ observationId = [guid]::NewGuid().ToString(); windowId = $handle.ToString(); bounds = Window-Bounds $handle; elements = $elements }); break }
    'computer.screenshot' { $handle = Window-Handle; Assert-Window $handle; $bounds = Window-Bounds $handle; $bytes = [LotaGateComputerNative]::CapturePng($handle); Write-Result ([ordered]@{ mimeType = 'image/png'; width = $bounds.width; height = $bounds.height; dataBase64 = [Convert]::ToBase64String($bytes) }); break }
    'computer.focus' { $handle = Window-Handle; Assert-Window $handle; if ($null -ne $params.elementId) { $element = Find-Element $handle ([string]$params.elementId); $element.SetFocus() } else { [LotaGateComputerNative]::Focus($handle) }; Write-Result @{ focused = $true; windowId = $handle.ToString() }; break }
    'computer.click' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $point = Target-Point $handle $params; $button = if ($null -eq $params.button) { 'left' } else { [string]$params.button }; $down = if ($button -eq 'right') { 8 } elseif ($button -eq 'middle') { 32 } else { 2 }; $count = if ($null -eq $params.clickCount) { 1 } else { [Math]::Min([Math]::Max([int]$params.clickCount, 1), 2) }; [LotaGateComputerNative]::Click($point.x, $point.y, [uint32]$down, [uint32]($down * 2), $count); Write-Result @{ clicked = $true; point = $point }; break }
    'computer.type' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $text = [string]$params.text; if ($text.Length -gt 32000) { throw 'The text input is too large.' }; if ($null -ne $params.elementId) { $element = Find-Element $handle ([string]$params.elementId); $element.SetFocus() }; [LotaGateComputerNative]::Unicode($text); Write-Result @{ typed = $true; characterCount = $text.Length }; break }
    'computer.keypress' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $modifiers = [System.Collections.Generic.List[string]]::new(); if ($null -ne $params.modifiers) { if ($params.modifiers -is [Array]) { foreach ($modifierValue in $params.modifiers) { $modifiers.Add([string]$modifierValue) } } else { $modifiers.Add([string]$params.modifiers) } }; foreach ($modifier in $modifiers) { Apply-Modifier $modifier $true }; $code = Key-Code ([string]$params.key); [LotaGateComputerNative]::Key($code, $true); [LotaGateComputerNative]::Key($code, $false); for ($modifierIndex = $modifiers.Count - 1; $modifierIndex -ge 0; $modifierIndex--) { Apply-Modifier $modifiers[$modifierIndex] $false }; Write-Result @{ pressed = $true; key = [string]$params.key }; break }
    'computer.scroll' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); if ($null -ne $params.point) { $point = Target-Point $handle $params.point; [LotaGateComputerNative]::Move($point.x, $point.y) }; if ($null -ne $params.deltaY) { [LotaGateComputerNative]::Scroll([int]$params.deltaY, $false) }; if ($null -ne $params.deltaX) { [LotaGateComputerNative]::Scroll([int]$params.deltaX, $true) }; Write-Result @{ scrolled = $true }; break }
    'computer.move' { $handle = Window-Handle; Assert-Window $handle; $point = Target-Point $handle $params; [LotaGateComputerNative]::Move($point.x, $point.y); Write-Result @{ moved = $true; point = $point }; break }
    'computer.drag' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $from = Target-Point $handle $params.from; $to = Target-Point $handle $params.to; $duration = if ($null -eq $params.durationMs) { 300 } else { [Math]::Min([Math]::Max([int]$params.durationMs, 50), 5000) }; [LotaGateComputerNative]::Move($from.x, $from.y); [LotaGateComputerNative]::Button($from.x, $from.y, $true, $false); $steps = [Math]::Max([int]($duration / 25), 1); for ($i = 1; $i -le $steps; $i++) { $ratio = $i / $steps; [LotaGateComputerNative]::Move([int]($from.x + ($to.x - $from.x) * $ratio), [int]($from.y + ($to.y - $from.y) * $ratio)); Start-Sleep -Milliseconds 25 }; [LotaGateComputerNative]::Button($to.x, $to.y, $false, $false); Write-Result @{ dragged = $true; from = $from; to = $to }; break }
    'computer.launch' { $appId = (Require-String 'appId').Trim(); if (-not (Is-ApplicationAllowed $appId)) { throw "Application '$appId' is not allowlisted." }; $process = Start-Process -FilePath $appId -PassThru; Write-Result @{ launched = $true; appId = $appId; processId = $process.Id }; break }
    'computer.wait' {
      $timeout = [Math]::Min([Math]::Max([int]$params.timeoutMs, 100), 120000)
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $satisfied = $false
      do {
        if ($params.condition -eq 'idle') {
          Start-Sleep -Milliseconds 250
          $satisfied = $true
        } elseif ($null -ne $params.windowId) {
          try {
            $handle = Window-Handle
            if ([LotaGateComputerNative]::Exists($handle)) {
              if ($params.condition -eq 'window') { $satisfied = $true }
              elseif ($params.condition -eq 'element' -and $null -ne $params.elementId) { $null = Find-Element $handle ([string]$params.elementId); $satisfied = $true }
              elseif ($params.condition -eq 'text' -and $null -ne $params.text) { $satisfied = Text-Exists $handle ([string]$params.text) }
            }
          } catch { }
        }
        if ($satisfied) { Write-Result @{ condition = [string]$params.condition; satisfied = $true }; break }
        Start-Sleep -Milliseconds 150
      } while ($watch.ElapsedMilliseconds -lt $timeout)
      if (-not $satisfied) { throw 'The Computer wait condition timed out.' }
      break
    }
    default { throw "Unsupported Computer action '$action'." }
  }
} catch { Fail $_.Exception.Message }
