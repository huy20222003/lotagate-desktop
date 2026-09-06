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
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] private static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
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
  public static bool Visible(IntPtr hWnd) { return IsWindowVisible(hWnd); }
  public static bool Minimized(IntPtr hWnd) { return IsIconic(hWnd); }
  public static bool Foreground(IntPtr hWnd) { return GetForegroundWindow() == hWnd; }
  public static bool SetState(IntPtr hWnd, int command) { if (!IsWindow(hWnd)) throw new InvalidOperationException("The target window no longer exists."); return ShowWindow(hWnd, command); }
  public static bool SetBounds(IntPtr hWnd, int x, int y, int width, int height) { if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException("Window bounds must be positive."); return SetWindowPos(hWnd, IntPtr.Zero, x, y, width, height, 0x0014u); }
  public static bool Close(IntPtr hWnd) { if (!IsWindow(hWnd)) throw new InvalidOperationException("The target window no longer exists."); return PostMessage(hWnd, 0x0010u, IntPtr.Zero, IntPtr.Zero); }
  public static uint IdleMilliseconds() { var info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)); if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("Unable to read Windows input state."); return unchecked((uint)Environment.TickCount) - info.dwTime; }
  public static int SystemDpi() { return (int)GetDpiForSystem(); }
  public static int[] Bounds(IntPtr hWnd) { RECT rect; if (!GetWindowRect(hWnd, out rect)) throw new InvalidOperationException("Unable to read target window bounds."); return new[] { rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top }; }
  public static void Focus(IntPtr hWnd) { if (!IsWindow(hWnd)) throw new InvalidOperationException("The target window no longer exists."); ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click(int x, int y, uint down, uint up, int count) { SetCursorPos(x, y); for (int i = 0; i < count; i++) { mouse_event(down, (uint)x, (uint)y, 0, UIntPtr.Zero); mouse_event(up, (uint)x, (uint)y, 0, UIntPtr.Zero); } }
  public static void Scroll(int amount, bool horizontal) { mouse_event(horizontal ? 0x1000u : 0x0800u, 0, 0, amount, UIntPtr.Zero); }
  public static void Key(ushort key, bool down) { keybd_event((byte)key, 0, down ? 0u : 0x0002u, UIntPtr.Zero); }
  public static void Unicode(string text) { foreach (char character in text) { keybd_event(0, (byte)character, 0x0004u, UIntPtr.Zero); keybd_event(0, (byte)character, 0x0006u, UIntPtr.Zero); } }
  public static void Button(int x, int y, bool down, bool right) { SetCursorPos(x, y); uint flag = right ? (down ? 8u : 16u) : (down ? 2u : 4u); mouse_event(flag, (uint)x, (uint)y, 0, UIntPtr.Zero); }
  public static byte[] CropPng(byte[] png, int x, int y, int width, int height) { using (var input = new MemoryStream(png)) using (var source = Image.FromStream(input)) using (var bitmap = new Bitmap(source)) using (var cropped = bitmap.Clone(new Rectangle(x, y, width, height), PixelFormat.Format32bppArgb)) using (var output = new MemoryStream()) { cropped.Save(output, ImageFormat.Png); return output.ToArray(); } }
  public static byte[] CapturePng(IntPtr hWnd) { var bounds = Bounds(hWnd); var windowDc = GetWindowDC(hWnd); if (windowDc == IntPtr.Zero) throw new InvalidOperationException("Unable to open target window for capture."); var memoryDc = CreateCompatibleDC(windowDc); var bitmapHandle = CreateCompatibleBitmap(windowDc, bounds[2], bounds[3]); var previous = SelectObject(memoryDc, bitmapHandle); try { if (!PrintWindow(hWnd, memoryDc, 2)) throw new InvalidOperationException("Windows refused to capture target window."); using (var bitmap = Image.FromHbitmap(bitmapHandle)) using (var stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Png); return stream.ToArray(); } } finally { SelectObject(memoryDc, previous); DeleteObject(bitmapHandle); DeleteDC(memoryDc); ReleaseDC(hWnd, windowDc); } }
}
'@

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
. (Join-Path $PSScriptRoot '..\\document-use\\windows-ocr.ps1')
Add-Type -AssemblyName System.Windows.Forms

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
function Encode-ElementId([string]$observationId, [string]$runtimeId, [string]$type, [string]$automationId, [string]$name) {
  $payload = [ordered]@{ observationId = $observationId; runtimeId = $runtimeId; type = $type; automationId = $automationId; name = $name } | ConvertTo-Json -Compress
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
}
function Decode-ElementId([string]$elementId) {
  try { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($elementId)) | ConvertFrom-Json }
  catch { throw 'The inspected UI element id is invalid.' }
}
function Runtime-Id([System.Windows.Automation.AutomationElement]$element) {
  try { return (@($element.GetRuntimeId()) -join '.') } catch { return '' }
}
function Find-Element([IntPtr]$handle, [string]$elementId) {
  $identity = Decode-ElementId $elementId
  if ([string]::IsNullOrWhiteSpace([string]$identity.runtimeId)) { throw 'The inspected UI element id has no runtime identity.' }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $current = $element.Current
    if ((Runtime-Id $element) -eq [string]$identity.runtimeId -and $current.ControlType.ProgrammaticName -eq [string]$identity.type -and [string]$current.AutomationId -eq [string]$identity.automationId -and [string]$current.Name -eq [string]$identity.name) { return $element }
  }
  throw 'The inspected UI element is no longer available.'
}
function Assert-PointInWindow([IntPtr]$handle, [hashtable]$point) {
  $bounds = Window-Bounds $handle
  if ($point.x -lt $bounds.x -or $point.y -lt $bounds.y -or $point.x -ge ($bounds.x + $bounds.width) -or $point.y -ge ($bounds.y + $bounds.height)) { throw 'The target point is outside the target window.' }
}
function Target-Point([IntPtr]$handle, [object]$target) {
  if ($null -ne $target -and $null -ne $target.elementId) {
    $element = Find-Element $handle ([string]$target.elementId)
    try { $point = $element.GetClickablePoint(); $result = @{ x = [int]$point.X; y = [int]$point.Y } } catch { $rect = $element.Current.BoundingRectangle; $result = @{ x = [int]($rect.X + $rect.Width / 2); y = [int]($rect.Y + $rect.Height / 2) } }
    Assert-PointInWindow $handle $result
    return $result
  }
  if ($null -ne $target -and $null -ne $target.x -and $null -ne $target.y) { $bounds = Window-Bounds $handle; $result = @{ x = $bounds.x + [int]$target.x; y = $bounds.y + [int]$target.y }; Assert-PointInWindow $handle $result; return $result }
  throw 'A target element or point is required.'
}
function Move-Pointer([hashtable]$point, [int]$durationMs) {
  $duration = [Math]::Min([Math]::Max($durationMs, 0), 5000)
  $steps = [Math]::Max([int]($duration / 25), 1)
  for ($i = 1; $i -le $steps; $i++) { [LotaGateComputerNative]::Move($point.x, $point.y); if ($duration -gt 0) { Start-Sleep -Milliseconds ([Math]::Max([int]($duration / $steps), 1)) } }
}
function Query-Matches([object]$current, [object]$query) {
  if ($null -eq $query) { return $true }
  if ($null -ne $query.role -and [string]$current.ControlType.ProgrammaticName -ine [string]$query.role) { return $false }
  $name = [string]$current.Name
  if ($null -ne $query.name -and $name.IndexOf([string]$query.name, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  $helpText = [string]$current.HelpText
  if ($null -ne $query.text -and $name.IndexOf([string]$query.text, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -and $helpText.IndexOf([string]$query.text, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  return $true
}
function Element-Depth([System.Windows.Automation.AutomationElement]$element) {
  $depth = 1
  $current = $element
  while ($null -ne $current -and $depth -le 64) { $current = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($current); if ($null -ne $current) { $depth += 1 } }
  return $depth
}
function Get-Pattern([System.Windows.Automation.AutomationElement]$element, [object]$pattern) {
  try { return $element.GetCurrentPattern($pattern) } catch { return $null }
}
function Get-SupportedPatterns([System.Windows.Automation.AutomationElement]$element) {
  $patterns = @(
    @{ name = 'Invoke'; pattern = [System.Windows.Automation.InvokePattern]::Pattern },
    @{ name = 'Value'; pattern = [System.Windows.Automation.ValuePattern]::Pattern },
    @{ name = 'RangeValue'; pattern = [System.Windows.Automation.RangeValuePattern]::Pattern },
    @{ name = 'SelectionItem'; pattern = [System.Windows.Automation.SelectionItemPattern]::Pattern },
    @{ name = 'Toggle'; pattern = [System.Windows.Automation.TogglePattern]::Pattern },
    @{ name = 'ExpandCollapse'; pattern = [System.Windows.Automation.ExpandCollapsePattern]::Pattern },
    @{ name = 'ScrollItem'; pattern = [System.Windows.Automation.ScrollItemPattern]::Pattern },
    @{ name = 'Text'; pattern = [System.Windows.Automation.TextPattern]::Pattern },
    @{ name = 'Window'; pattern = [System.Windows.Automation.WindowPattern]::Pattern }
  )
  return @($patterns | Where-Object { $null -ne (Get-Pattern $element $_.pattern) } | ForEach-Object { $_.name })
}
function Require-Enabled([System.Windows.Automation.AutomationElement]$element) {
  if (-not [bool]$element.Current.IsEnabled) { throw 'The target UI element is disabled.' }
}
function Bound-Text([string]$value) {
  if ($value.Length -le 100000) { return $value }
  return $value.Substring(0, 100000) + "`n[truncated]"
}
function Read-ElementText([System.Windows.Automation.AutomationElement]$element, [string]$scope) {
  if ([bool]$element.Current.IsPassword) { throw 'Reading password controls is not permitted.' }
  $readScope = if ([string]::IsNullOrWhiteSpace($scope)) { 'value' } else { $scope }
  if ($readScope -eq 'value') {
    $value = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -eq $value) { $value = Get-Pattern $element ([System.Windows.Automation.RangeValuePattern]::Pattern) }
    if ($null -eq $value) { throw 'The UI element does not expose a readable value.' }
    return [string]$value.Current.Value
  }
  $text = Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern)
  if ($null -eq $text) { throw 'The UI element does not expose the Text pattern.' }
  if ($readScope -eq 'selection') { return [string]::Join("`n", @($text.GetSelection() | ForEach-Object { $_.GetText(-1) })) }
  if ($readScope -eq 'document') { return [string]$text.DocumentRange.GetText(-1) }
  throw "Unsupported text scope '$readScope'."
}
function Read-Selection([System.Windows.Automation.AutomationElement]$element) {
  $items = @(); $container = Get-Pattern $element ([System.Windows.Automation.SelectionPattern]::Pattern)
  if ($null -ne $container) { $items = @($container.Current.GetSelection()) } else { $items = @($element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $pattern = Get-Pattern $_ ([System.Windows.Automation.SelectionItemPattern]::Pattern); $null -ne $pattern -and [bool]$pattern.Current.IsSelected }) }
  return @($items | Select-Object -First 500 | ForEach-Object { $current = $_.Current; $value = Get-Pattern $_ ([System.Windows.Automation.ValuePattern]::Pattern); [ordered]@{ name = Bound-Text ([string]$current.Name); role = [string]$current.ControlType.ProgrammaticName; selected = $true; value = if ($null -eq $value) { $null } else { Bound-Text ([string]$value.Current.Value) } } })
}
function Read-Grid([System.Windows.Automation.AutomationElement]$element) {
  $pattern = Get-Pattern $element ([System.Windows.Automation.GridPattern]::Pattern)
  if ($null -eq $pattern) { throw 'The UI element does not expose the Grid pattern.' }
  $grid = $pattern.Current; $rowStart = if ($null -eq $params.rowStart) { 0 } else { [int]$params.rowStart }; $columnStart = if ($null -eq $params.columnStart) { 0 } else { [int]$params.columnStart }; $rowCount = if ($null -eq $params.rowCount) { $grid.RowCount } else { [int]$params.rowCount }; $columnCount = if ($null -eq $params.columnCount) { $grid.ColumnCount } else { [int]$params.columnCount }
  if ($rowStart -lt 0 -or $columnStart -lt 0 -or $rowCount -lt 1 -or $columnCount -lt 1 -or $rowCount -gt 100 -or $columnCount -gt 100 -or $rowStart + $rowCount -gt $grid.RowCount -or $columnStart + $columnCount -gt $grid.ColumnCount) { throw 'The requested grid range is invalid or exceeds the 100 by 100 limit.' }
  $rows = @(); for ($row = $rowStart; $row -lt $rowStart + $rowCount; $row++) { $cells = @(); for ($column = $columnStart; $column -lt $columnStart + $columnCount; $column++) { $cell = $grid.GetItem($row, $column); $current = $cell.Current; $value = Get-Pattern $cell ([System.Windows.Automation.ValuePattern]::Pattern); $cells += [ordered]@{ row = $row; column = $column; name = Bound-Text ([string]$current.Name); value = if ($null -eq $value) { $null } else { Bound-Text ([string]$value.Current.Value) } } }; $rows += ,$cells }
  return [ordered]@{ rowStart = $rowStart; columnStart = $columnStart; rowCount = $rowCount; columnCount = $columnCount; rows = $rows }
}
function Select-Text([System.Windows.Automation.AutomationElement]$element, [string]$text, [int]$occurrence) {
  if ([bool]$element.Current.IsPassword) { throw 'Selecting text in password controls is not permitted.' }
  if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 4096) { throw 'The text selection query is invalid.' }
  $pattern = Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern); if ($null -eq $pattern) { throw 'The UI element does not expose the Text pattern.' }
  $targetOccurrence = [Math]::Max($occurrence, 1); $cursor = $pattern.DocumentRange; $found = $null
  for ($index = 1; $index -le $targetOccurrence; $index++) { $found = $cursor.FindText($text, $false, $true); if ($null -eq $found) { throw "Text occurrence $targetOccurrence was not found." }; if ($index -lt $targetOccurrence) { $cursor = $found.Clone(); $moved = 0; [void]$cursor.Move([System.Windows.Automation.TextUnit]::Character, 1, [ref]$moved) } }
  $found.Select(); return [ordered]@{ selected = $true; text = Bound-Text ($found.GetText(4096)); occurrence = $targetOccurrence; elementId = [string]$params.elementId }
}
function Set-ElementValue([System.Windows.Automation.AutomationElement]$element, [string]$value) {
  Require-Enabled $element
  $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -ne $valuePattern) {
    if ([bool]$valuePattern.Current.IsReadOnly) { throw 'The UI element is read-only.' }
    $valuePattern.SetValue($value)
    return [string]$valuePattern.Current.Value
  }
  $rangePattern = Get-Pattern $element ([System.Windows.Automation.RangeValuePattern]::Pattern)
  if ($null -eq $rangePattern) { throw 'The UI element does not expose a writable Value or RangeValue pattern.' }
  if ([bool]$rangePattern.Current.IsReadOnly) { throw 'The UI element is read-only.' }
  try { $number = [double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture) } catch { throw "The range value is invalid: $value." }
  if ($number -lt $rangePattern.Current.Minimum -or $number -gt $rangePattern.Current.Maximum) { throw 'The range value is outside the control limits.' }
  $rangePattern.SetValue($number)
  return [string]$rangePattern.Current.Value
}
function Desired-ToggleState([string]$value) {
  if ($value -eq 'on') { return [System.Windows.Automation.ToggleState]::On }
  if ($value -eq 'off') { return [System.Windows.Automation.ToggleState]::Off }
  if ($value -eq 'indeterminate') { return [System.Windows.Automation.ToggleState]::Indeterminate }
  throw "Unsupported toggle state '$value'."
}
function Set-ToggleState([System.Windows.Automation.AutomationElement]$element, [string]$desired) {
  Require-Enabled $element
  $pattern = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($null -eq $pattern) { throw 'The UI element does not expose the Toggle pattern.' }
  $target = Desired-ToggleState $desired
  for ($attempt = 0; $attempt -lt 3 -and $pattern.Current.ToggleState -ne $target; $attempt++) { $pattern.Toggle() }
  if ($pattern.Current.ToggleState -ne $target) { throw 'The UI element did not reach the requested toggle state.' }
  return $pattern.Current.ToggleState.ToString().ToLowerInvariant()
}
function Get-TargetElement([IntPtr]$handle) {
  $elementId = Require-String 'elementId'
  return Find-Element $handle $elementId
}
function Capture-WindowImage([IntPtr]$handle, [object]$region) {
  $windowBounds = Window-Bounds $handle
  $bytes = [LotaGateComputerNative]::CapturePng($handle)
  $resultBounds = $windowBounds
  if ($null -ne $region) {
    $x = [int]$region.x; $y = [int]$region.y; $width = [int]$region.width; $height = [int]$region.height
    if ($x -lt 0 -or $y -lt 0 -or $width -le 0 -or $height -le 0 -or $x + $width -gt $windowBounds.width -or $y + $height -gt $windowBounds.height) { throw 'The screenshot region is outside the target window.' }
    $bytes = [LotaGateComputerNative]::CropPng($bytes, $x, $y, $width, $height)
    $resultBounds = @{ x = $windowBounds.x + $x; y = $windowBounds.y + $y; width = $width; height = $height }
  }
  return @{ bytes = $bytes; bounds = $resultBounds }
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
function Read-ClipboardText { if (-not [System.Windows.Forms.Clipboard]::ContainsText()) { return '' }; return Bound-Text ([System.Windows.Forms.Clipboard]::GetText()) }
function Write-ClipboardText([string]$text) { if ($text.Length -gt 1MB) { throw 'Clipboard text exceeds the 1 MB limit.' }; [System.Windows.Forms.Clipboard]::SetText($text); return @{ written = $true; characterCount = $text.Length } }
function Find-DialogControl([IntPtr]$handle, [string[]]$controlTypes, [string[]]$names) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $current = $element.Current
    if ($controlTypes -notcontains ([string]$current.ControlType.ProgrammaticName)) { continue }
    if ($names.Count -gt 0 -and $names -notcontains ([string]$current.Name)) { continue }
    return $element
  }
  return $null
}
function Manage-FileDialog([IntPtr]$handle, [string]$mode, [string]$path) {
  Assert-Window $handle
  if ($mode -eq 'setPath' -or $mode -eq 'confirm') {
    if ([string]::IsNullOrWhiteSpace($path) -or $path.Length -gt 4096) { throw 'A valid file dialog path is required.' }
    $edit = Find-DialogControl $handle @('ControlType.Edit') @()
    if ($null -eq $edit) { throw 'The file dialog path field was not found.' }
    $value = Get-Pattern $edit ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -eq $value -or [bool]$value.Current.IsReadOnly) { throw 'The file dialog path field is not writable.' }
    $value.SetValue($path)
  }
  if ($mode -eq 'setPath') { return @{ action = $mode; path = $path; updated = $true } }
  $buttonNames = if ($mode -eq 'confirm') { @('Open', 'Save', 'Select Folder', 'Choose', 'OK') } else { @('Cancel') }
  $button = Find-DialogControl $handle @('ControlType.Button') $buttonNames
  if ($null -eq $button) { throw "The file dialog '$mode' button was not found." }
  $invoke = Get-Pattern $button ([System.Windows.Automation.InvokePattern]::Pattern)
  if ($null -eq $invoke) { throw 'The file dialog button does not expose Invoke.' }
  $invoke.Invoke()
  return @{ action = $mode; path = if ($null -eq $path) { $null } else { $path }; submitted = $true }
}
function Read-StateValue([System.Windows.Automation.AutomationElement]$element, [string]$property) {
  $current = $element.Current
  if ($property -eq 'name') { return [string]$current.Name }
  if ($property -eq 'value') { $value = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern); if ($null -eq $value) { throw 'The element does not expose Value.' }; return [string]$value.Current.Value }
  if ($property -eq 'isEnabled') { return [string][bool]$current.IsEnabled }
  if ($property -eq 'isOffscreen') { return [string][bool]$current.IsOffscreen }
  if ($property -eq 'toggleState') { $value = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern); if ($null -eq $value) { throw 'The element does not expose Toggle.' }; return $value.Current.ToggleState.ToString().ToLowerInvariant() }
  if ($property -eq 'expandCollapseState') { $value = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern); if ($null -eq $value) { throw 'The element does not expose ExpandCollapse.' }; return $value.Current.ExpandCollapseState.ToString().ToLowerInvariant() }
  if ($property -eq 'selectionState') { $value = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern); if ($null -eq $value) { throw 'The element does not expose SelectionItem.' }; return [string][bool]$value.Current.IsSelected }
  throw "Unsupported state property '$property'."
}
function Wait-ForState([IntPtr]$handle) {
  $timeout = [Math]::Min([Math]::Max([int]$params.timeoutMs, 100), 120000)
  $interval = if ($null -eq $params.intervalMs) { 150 } else { [Math]::Min([Math]::Max([int]$params.intervalMs, 50), 2000) }
  $property = Require-String 'property'; $expected = Require-String 'expected'; $watch = [Diagnostics.Stopwatch]::StartNew(); $last = $null
  do {
    try { $element = Find-Element $handle (Require-String 'elementId'); $last = Read-StateValue $element $property; if ($last -eq $expected) { return @{ condition = 'state'; satisfied = $true; property = $property; value = $last } } } catch { $last = $null }
    Start-Sleep -Milliseconds $interval
  } while ($watch.ElapsedMilliseconds -lt $timeout)
  throw "The UI state wait timed out for property '$property'."
}

try {
  switch ($action) {
    'computer.listWindows' { $includeMinimized = [bool]$params.includeMinimized; $items = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ([string]$_.MainWindowTitle).Trim().Length -gt 0 -and [LotaGateComputerNative]::Visible([IntPtr]$_.MainWindowHandle) -and ($includeMinimized -or -not [LotaGateComputerNative]::Minimized([IntPtr]$_.MainWindowHandle)) } | ForEach-Object { $handle = [IntPtr]$_.MainWindowHandle; $bounds = Window-Bounds $handle; [ordered]@{ windowId = $handle.ToString(); appId = $_.ProcessName.ToLowerInvariant(); processName = $_.ProcessName; title = $_.MainWindowTitle; bounds = $bounds; state = if ([LotaGateComputerNative]::Minimized($handle)) { 'minimized' } else { 'active' }; isForeground = [LotaGateComputerNative]::Foreground($handle) } }); Write-Result $items; break }
    'computer.inspect' { $handle = Window-Handle; Assert-Window $handle; $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle); $observationId = [guid]::NewGuid().ToString(); $maxDepth = if ($null -eq $params.maxDepth) { 8 } else { [Math]::Min([Math]::Max([int]$params.maxDepth, 1), 32) }; $elements = @(); foreach ($element in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { if ($elements.Count -ge 300) { break }; if ((Element-Depth $element) -gt $maxDepth) { continue }; $current = $element.Current; if (-not (Query-Matches $current $params.query)) { continue }; $rect = $current.BoundingRectangle; $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern); $rangePattern = Get-Pattern $element ([System.Windows.Automation.RangeValuePattern]::Pattern); $selectionPattern = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern); $togglePattern = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern); $expandPattern = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $details = [ordered]@{ elementId = Encode-ElementId $observationId (Runtime-Id $element) $current.ControlType.ProgrammaticName ([string]$current.AutomationId) ([string]$current.Name); role = $current.ControlType.ProgrammaticName; name = [string]$current.Name; enabled = [bool]$current.IsEnabled; visible = -not [bool]$current.IsOffscreen -and [LotaGateComputerNative]::Visible($handle); isPassword = [bool]$current.IsPassword; supportedPatterns = Get-SupportedPatterns $element; bounds = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } }; if ($null -ne $valuePattern -and -not [bool]$current.IsPassword) { $details['value'] = [string]$valuePattern.Current.Value; $details['readOnly'] = [bool]$valuePattern.Current.IsReadOnly }; if ($null -ne $rangePattern) { $details['range'] = @{ value = $rangePattern.Current.Value; minimum = $rangePattern.Current.Minimum; maximum = $rangePattern.Current.Maximum; readOnly = [bool]$rangePattern.Current.IsReadOnly } }; if ($null -ne $selectionPattern) { $details['selected'] = [bool]$selectionPattern.Current.IsSelected }; if ($null -ne $togglePattern) { $details['toggleState'] = $togglePattern.Current.ToggleState.ToString().ToLowerInvariant() }; if ($null -ne $expandPattern) { $details['expandedState'] = $expandPattern.Current.ExpandCollapseState.ToString().ToLowerInvariant() }; $elements += $details }; Write-Result ([ordered]@{ observationId = $observationId; windowId = $handle.ToString(); bounds = Window-Bounds $handle; elements = $elements }); break }
    'computer.screenshot' { $handle = Window-Handle; Assert-Window $handle; $image = Capture-WindowImage $handle $params.region; $bounds = $image.bounds; Write-Result ([ordered]@{ mimeType = 'image/png'; width = $bounds.width; height = $bounds.height; dataBase64 = [Convert]::ToBase64String($image.bytes) }); break }
    'computer.readText' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; $scope = if ($null -eq $params.scope) { 'value' } else { [string]$params.scope }; Write-Result ([ordered]@{ elementId = [string]$params.elementId; scope = $scope; text = Bound-Text (Read-ElementText $element $scope) }); break }
    'computer.readSelection' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; Write-Result ([ordered]@{ elementId = [string]$params.elementId; items = Read-Selection $element }); break }
    'computer.readGrid' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; Write-Result ([ordered]@{ elementId = [string]$params.elementId; grid = Read-Grid $element }); break }
    'computer.recognizeText' { $handle = Window-Handle; Assert-Window $handle; $image = Capture-WindowImage $handle $params.region; $result = Recognize-ImageText $image.bytes ([string]$params.language); $result['bounds'] = $image.bounds; Write-Result $result; break }
    'computer.selectText' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; $occurrence = if ($null -eq $params.occurrence) { 1 } else { [int]$params.occurrence }; Write-Result (Select-Text $element (Require-String 'text') $occurrence); break }
    'computer.listDisplays' { $dpi = [LotaGateComputerNative]::SystemDpi(); $items = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [ordered]@{ deviceName = $_.DeviceName; bounds = @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height }; workArea = @{ x = $_.WorkingArea.X; y = $_.WorkingArea.Y; width = $_.WorkingArea.Width; height = $_.WorkingArea.Height }; primary = [bool]$_.Primary; dpi = @{ x = $dpi; y = $dpi; source = 'system' } } }); Write-Result $items; break }
    'computer.focus' { $handle = Window-Handle; Assert-Window $handle; if ($null -ne $params.elementId) { $element = Find-Element $handle ([string]$params.elementId); $element.SetFocus() } else { [LotaGateComputerNative]::Focus($handle) }; Write-Result @{ focused = $true; windowId = $handle.ToString() }; break }
    'computer.click' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $target = if ($null -ne $params.elementId) { $params } else { $params.point }; $point = Target-Point $handle $target; $button = if ($null -eq $params.button) { 'left' } else { [string]$params.button }; $down = if ($button -eq 'right') { 8 } elseif ($button -eq 'middle') { 32 } else { 2 }; $count = if ($null -eq $params.clickCount) { 1 } else { [Math]::Min([Math]::Max([int]$params.clickCount, 1), 2) }; [LotaGateComputerNative]::Click($point.x, $point.y, [uint32]$down, [uint32]($down * 2), $count); Write-Result @{ clicked = $true; point = $point }; break }
    'computer.type' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $text = [string]$params.text; if ($text.Length -gt 32000) { throw 'The text input is too large.' }; if ($null -ne $params.elementId) { $element = Find-Element $handle ([string]$params.elementId); $element.SetFocus() }; [LotaGateComputerNative]::Unicode($text); Write-Result @{ typed = $true; characterCount = $text.Length }; break }
    'computer.keypress' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $modifiers = [System.Collections.Generic.List[string]]::new(); if ($null -ne $params.modifiers) { if ($params.modifiers -is [Array]) { foreach ($modifierValue in $params.modifiers) { $modifiers.Add([string]$modifierValue) } } else { $modifiers.Add([string]$params.modifiers) } }; foreach ($modifier in $modifiers) { Apply-Modifier $modifier $true }; $code = Key-Code ([string]$params.key); [LotaGateComputerNative]::Key($code, $true); [LotaGateComputerNative]::Key($code, $false); for ($modifierIndex = $modifiers.Count - 1; $modifierIndex -ge 0; $modifierIndex--) { Apply-Modifier $modifiers[$modifierIndex] $false }; Write-Result @{ pressed = $true; key = [string]$params.key }; break }
    'computer.scroll' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); if ($null -ne $params.point) { $point = Target-Point $handle $params.point; [LotaGateComputerNative]::Move($point.x, $point.y) }; if ($null -ne $params.deltaY) { [LotaGateComputerNative]::Scroll([int]$params.deltaY, $false) }; if ($null -ne $params.deltaX) { [LotaGateComputerNative]::Scroll([int]$params.deltaX, $true) }; Write-Result @{ scrolled = $true }; break }
    'computer.move' { $handle = Window-Handle; Assert-Window $handle; $target = if ($null -ne $params.elementId) { $params } else { $params.point }; $point = Target-Point $handle $target; $duration = if ($null -eq $params.durationMs) { 0 } else { [int]$params.durationMs }; Move-Pointer $point $duration; Write-Result @{ moved = $true; point = $point; durationMs = [Math]::Min([Math]::Max($duration, 0), 5000) }; break }
    'computer.setValue' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; $value = Require-String 'value'; $actual = Set-ElementValue $element $value; Write-Result @{ set = $true; elementId = [string]$params.elementId; value = $actual }; break }
    'computer.invoke' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; Require-Enabled $element; $pattern = Get-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern); if ($null -eq $pattern) { throw 'The UI element does not expose the Invoke pattern.' }; $pattern.Invoke(); Write-Result @{ invoked = $true; elementId = [string]$params.elementId }; break }
    'computer.select' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; Require-Enabled $element; $pattern = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern); if ($null -eq $pattern) { throw 'The UI element does not expose the SelectionItem pattern.' }; $mode = if ($null -eq $params.mode) { 'replace' } else { [string]$params.mode }; if ($mode -eq 'replace') { $pattern.Select() } elseif ($mode -eq 'add') { $pattern.AddToSelection() } elseif ($mode -eq 'remove') { $pattern.RemoveFromSelection() } else { throw "Unsupported selection mode '$mode'." }; Write-Result @{ selected = [bool]$pattern.Current.IsSelected; mode = $mode; elementId = [string]$params.elementId }; break }
    'computer.setToggleState' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; $state = if ($null -eq $params.state) { '' } else { [string]$params.state }; Write-Result @{ toggleState = Set-ToggleState $element $state; elementId = [string]$params.elementId }; break }
    'computer.setExpandedState' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; Require-Enabled $element; $pattern = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern); if ($null -eq $pattern) { throw 'The UI element does not expose the ExpandCollapse pattern.' }; $expanded = [bool]$params.expanded; if ($expanded) { $pattern.Expand() } else { $pattern.Collapse() }; Write-Result @{ expanded = $pattern.Current.ExpandCollapseState.ToString().ToLowerInvariant(); elementId = [string]$params.elementId }; break }
    'computer.scrollIntoView' { $handle = Window-Handle; Assert-Window $handle; $element = Get-TargetElement $handle; $pattern = Get-Pattern $element ([System.Windows.Automation.ScrollItemPattern]::Pattern); if ($null -eq $pattern) { throw 'The UI element does not expose the ScrollItem pattern.' }; $pattern.ScrollIntoView(); Write-Result @{ scrolledIntoView = $true; elementId = [string]$params.elementId }; break }
    'computer.setWindowState' { $handle = Window-Handle; Assert-Window $handle; $state = [string]$params.state; $command = if ($state -eq 'normal') { 9 } elseif ($state -eq 'minimized') { 6 } elseif ($state -eq 'maximized') { 3 } else { throw "Unsupported window state '$state'." }; [void][LotaGateComputerNative]::SetState($handle, $command); if ($null -ne $params.bounds) { $bounds = $params.bounds; [void][LotaGateComputerNative]::SetBounds($handle, [int]$bounds.x, [int]$bounds.y, [int]$bounds.width, [int]$bounds.height) }; Write-Result @{ state = $state; bounds = Window-Bounds $handle; isForeground = [LotaGateComputerNative]::Foreground($handle) }; break }
    'computer.closeWindow' { $handle = Window-Handle; Assert-Window $handle; [void][LotaGateComputerNative]::Close($handle); Start-Sleep -Milliseconds 150; $closed = -not [LotaGateComputerNative]::Exists($handle); Write-Result @{ closeRequested = $true; closed = $closed; blockedByDialog = -not $closed; windowId = $handle.ToString() }; break }
    'computer.readClipboard' { Write-Result @{ text = Read-ClipboardText; available = [System.Windows.Forms.Clipboard]::ContainsText() }; break }
    'computer.writeClipboard' { $text = Require-String 'text'; Write-Result (Write-ClipboardText $text); break }
    'computer.waitForState' { $handle = Window-Handle; Assert-Window $handle; Write-Result (Wait-ForState $handle); break }
    'computer.manageFileDialog' { $handle = Window-Handle; $mode = Require-String 'action'; $path = if ($null -eq $params.path) { $null } else { [string]$params.path }; Write-Result (Manage-FileDialog $handle $mode $path); break }
    'computer.drag' { $handle = Window-Handle; Assert-Window $handle; [LotaGateComputerNative]::Focus($handle); $from = Target-Point $handle $params.from; $to = Target-Point $handle $params.to; $duration = if ($null -eq $params.durationMs) { 300 } else { [Math]::Min([Math]::Max([int]$params.durationMs, 50), 5000) }; [LotaGateComputerNative]::Move($from.x, $from.y); [LotaGateComputerNative]::Button($from.x, $from.y, $true, $false); $steps = [Math]::Max([int]($duration / 25), 1); for ($i = 1; $i -le $steps; $i++) { $ratio = $i / $steps; [LotaGateComputerNative]::Move([int]($from.x + ($to.x - $from.x) * $ratio), [int]($from.y + ($to.y - $from.y) * $ratio)); Start-Sleep -Milliseconds 25 }; [LotaGateComputerNative]::Button($to.x, $to.y, $false, $false); Write-Result @{ dragged = $true; from = $from; to = $to }; break }
    'computer.launch' { $appId = (Require-String 'appId').Trim(); if (-not (Is-ApplicationAllowed $appId)) { throw "Application '$appId' is not allowlisted." }; $process = Start-Process -FilePath $appId -PassThru; Write-Result @{ launched = $true; appId = $appId; processId = $process.Id }; break }
    'computer.wait' {
      $timeout = [Math]::Min([Math]::Max([int]$params.timeoutMs, 100), 120000)
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $satisfied = $false
      do {
        if ($params.condition -eq 'idle') {
          $minimumIdle = if ($null -eq $params.idleMs) { 250 } else { [Math]::Min([Math]::Max([int]$params.idleMs, 250), 120000) }
          $satisfied = [LotaGateComputerNative]::IdleMilliseconds() -ge $minimumIdle
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
