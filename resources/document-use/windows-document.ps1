$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { [Console]::Error.WriteLine($Message); exit 1 }
function Output($Value) { $Value | ConvertTo-Json -Depth 12 -Compress; exit 0 }
function Get-RequiredParam($Name) { $value = $request.params.$Name; if ($null -eq $value) { Fail "Missing document parameter: $Name" }; return $value }
function Get-OptionalParam($Name) { return $request.params.$Name }
function Run-External([string]$Name, [string[]]$Arguments) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) { Fail "The document backend requires '$Name', which is not installed or not on PATH." }
  $output = & $command.Source @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { Fail (($output | Out-String).Trim()) }
  return ($output | Out-String).Trim()
}
function Assert-Extension([string]$DocumentPath, [string]$Format) {
  $extension = [IO.Path]::GetExtension($DocumentPath).ToLowerInvariant()
  $allowed = @{ pdf = @('.pdf'); pptx = @('.pptx'); excel = @('.xlsx', '.xls', '.csv'); docs = @('.docx', '.doc', '.txt', '.rtf') }[$Format]
  if ($allowed -notcontains $extension) { Fail "The path extension does not match the $Format document plugin." }
}
function Release-Com([object]$Value) { if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) | Out-Null } }
function New-Pdf([string]$Target, [string]$Title) {
  $safeTitle = $Title -replace '[()]', ''
  $objects = @('<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', "<< /Length $($safeTitle.Length + 38) >>`nstream`nBT /F1 18 Tf 72 720 Td ($safeTitle) Tj ET`nendstream", '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  $text = New-Object Text.StringBuilder; [void]$text.AppendLine('%PDF-1.4'); $offsets = @();
  for ($index = 0; $index -lt $objects.Count; $index++) { $objectNumber = $index + 1; $offsets += $text.Length; [void]$text.AppendLine("$objectNumber 0 obj"); [void]$text.AppendLine($objects[$index]); [void]$text.AppendLine('endobj') }
  $xref = $text.Length; [void]$text.AppendLine('xref'); [void]$text.AppendLine("0 $($objects.Count)"); [void]$text.AppendLine('0000000000 65535 f '); foreach ($offset in $offsets) { [void]$text.AppendLine(('{0:D10} 00000 n ' -f $offset)) }; [void]$text.AppendLine('trailer'); [void]$text.AppendLine("<< /Size $($objects.Count) /Root 1 0 R >>"); [void]$text.AppendLine('startxref'); [void]$text.AppendLine([string]$xref); [void]$text.AppendLine('%%EOF'); [IO.File]::WriteAllText($Target, $text.ToString(), [Text.Encoding]::ASCII)
}
function Office-App([string]$Format) { if ($Format -eq 'docs') { return New-Object -ComObject Word.Application }; if ($Format -eq 'excel') { return New-Object -ComObject Excel.Application }; return New-Object -ComObject PowerPoint.Application }
function Office-Open([string]$Format, [string]$DocumentPath, [object]$App) {
  if ($Format -eq 'docs') { return $App.Documents.Open($DocumentPath, $false, $false) }
  if ($Format -eq 'excel') { return $App.Workbooks.Open($DocumentPath) }
  return $App.Presentations.Open($DocumentPath, $true, $false, $false)
}
function Office-Close([string]$Format, [object]$Document, [object]$App) {
  if ($null -ne $Document) { if ($Format -eq 'docs') { $Document.Close($false) } elseif ($Format -eq 'excel') { $Document.Close($false) } else { $Document.Close() } }
  if ($null -ne $App) { $App.Quit() }; Release-Com $Document; Release-Com $App
}
function Read-Office([string]$Format, [string]$DocumentPath, [string]$Operation) {
  $app = $null; $document = $null
  try {
    $app = Office-App $Format; $app.Visible = $false; $document = Office-Open $Format $DocumentPath $app
    if ($Format -eq 'docs' -and $Operation -eq 'readContent') { Output @{ content = [string]$document.Content.Text; format = 'docs' } }
    if ($Format -eq 'excel' -and $Operation -eq 'readRange') { $sheet = if ($null -eq (Get-OptionalParam 'sheet')) { $document.Worksheets.Item(1) } else { $document.Worksheets.Item([string](Get-OptionalParam 'sheet')) }; $range = $sheet.Range([string](Get-RequiredParam 'range')); Output @{ sheet = $sheet.Name; range = $range.Address(); values = $range.Value2 } }
    if ($Format -eq 'pptx' -and $Operation -eq 'readSlide') { $slide = $document.Slides.Item(([int](Get-RequiredParam 'slide')) + 1); $items = @(); foreach ($shape in $slide.Shapes) { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $items += @{ name = $shape.Name; text = [string]$shape.TextFrame.TextRange.Text } } }; Output @{ slide = ([int](Get-RequiredParam 'slide')); elements = $items } }
    Fail "The $Format read operation '$Operation' is not supported by the installed Office backend."
  } finally { Office-Close $Format $document $app }
}
function Write-Office([string]$Format, [string]$DocumentPath, [string]$Operation) {
  $app = $null; $document = $null
  try {
    $app = Office-App $Format; $app.Visible = $false; $document = Office-Open $Format $DocumentPath $app
    if ($Format -eq 'docs') {
      $content = $document.Content
      if ($Operation -eq 'insertContent') { $content.InsertAfter([string](Get-RequiredParam 'content')) }
      elseif ($Operation -eq 'updateContent' -or $Operation -eq 'deleteContent') { $start = [int](Get-RequiredParam 'start'); $end = [int](Get-RequiredParam 'end'); $range = $document.Range($start, $end); $range.Text = if ($Operation -eq 'deleteContent') { '' } else { [string](Get-RequiredParam 'content') } }
      elseif ($Operation -eq 'findReplace') { $find = $content.Find; $find.Text = [string](Get-RequiredParam 'find'); $find.Replacement.Text = [string](Get-RequiredParam 'replace'); $find.Execute($null, $false, $false, $false, $false, $false, $true, 1, $false, [string](Get-RequiredParam 'replace'), 2) | Out-Null }
      elseif ($Operation -eq 'setStyles') { $content.Style = [string](Get-RequiredParam 'style') }
      elseif ($Operation -eq 'setHeaderFooter') { $section = $document.Sections.Item(1); $section.Headers.Item(1).Range.Text = [string](Get-RequiredParam 'content') }
      else { Fail "The docs write operation '$Operation' requires a supported Word backend operation." }
      $document.Save(); Output @{ saved = $true; operation = $Operation }
    }
    if ($Format -eq 'excel') {
      if ($Operation -eq 'addSheet') { $name = [string](Get-RequiredParam 'sheetName'); $newSheet = $document.Worksheets.Add(); $newSheet.Name = $name; $document.Save(); Output @{ saved = $true; sheet = $name } }
      if ($Operation -eq 'deleteSheet') { $sheetName = [string](Get-RequiredParam 'sheet'); $document.Worksheets.Item($sheetName).Delete(); $document.Save(); Output @{ saved = $true; sheet = $sheetName } }
      $sheet = if ($null -eq (Get-OptionalParam 'sheet')) { $document.Worksheets.Item(1) } else { $document.Worksheets.Item([string](Get-OptionalParam 'sheet')) }; $range = $sheet.Range([string](Get-RequiredParam 'range'))
      if ($Operation -eq 'clearRange') { $range.Clear() | Out-Null } elseif ($Operation -eq 'writeRange') { $value = Get-OptionalParam 'values'; if ($null -eq $value) { $value = Get-RequiredParam 'content' }; $range.Value2 = $value } elseif ($Operation -eq 'recalculate') { $document.RefreshAll(); $app.CalculateFull() } else { Fail "The excel write operation '$Operation' requires a supported Excel backend operation." }
      $document.Save(); Output @{ saved = $true; operation = $Operation }
    }
    if ($Format -eq 'pptx') {
      if ($Operation -eq 'addSlide') { $layout = if ($null -eq (Get-OptionalParam 'options')) { 12 } else { [int](Get-OptionalParam 'options').layout }; $slide = $document.Slides.Add($document.Slides.Count + 1, $layout); $document.Save(); Output @{ saved = $true; slide = $slide.SlideIndex - 1 } }
      if ($Operation -eq 'deleteSlide') { $document.Slides.Item(([int](Get-RequiredParam 'slide')) + 1).Delete(); $document.Save(); Output @{ saved = $true } }
      if ($Operation -eq 'setNotes') { $slide = $document.Slides.Item(([int](Get-RequiredParam 'slide')) + 1); $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = [string](Get-RequiredParam 'content'); $document.Save(); Output @{ saved = $true } }
      if ($Operation -eq 'exportPdf') { $output = [string](Get-RequiredParam 'outputPath'); $document.SaveAs($output, 32); Output @{ path = $output; exported = $true } }
      Fail "The pptx write operation '$Operation' requires a supported PowerPoint backend operation."
    }
  } finally { Office-Close $Format $document $app }
}

try { $request = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { Fail 'The document backend received invalid JSON.' }
$action = [string]$request.action; $parts = $action.Split('.', 2); $format = $parts[0]; $operation = $parts[1]; $path = [string]$request.path
if ($format -notin @('pdf', 'pptx', 'excel', 'docs') -or [string]::IsNullOrWhiteSpace($operation)) { Fail 'The document backend received an invalid action.' }
Assert-Extension $path $format

if ($operation -eq 'create') { if ($format -eq 'pdf') { New-Pdf $path ([string](Get-OptionalParam 'title')); Output @{ created = $true; format = $format } }; Fail "Creating $format documents requires the corresponding Office application." }
if ($operation -eq 'validate') { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail 'The document does not exist.' }; $bytes = [IO.File]::ReadAllBytes($path); $valid = if ($format -eq 'pdf') { [Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(5, $bytes.Length)) -eq '%PDF-' } else { $bytes.Length -ge 2 -and $bytes[0] -eq 80 -and $bytes[1] -eq 75 }; if (-not $valid) { Fail 'The document signature is invalid.' }; Output @{ valid = $true; format = $format } }
if ($format -eq 'docs' -and $operation -eq 'readContent' -and [IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.txt') { Output @{ format = 'docs'; content = [IO.File]::ReadAllText($path) } }
if ($format -eq 'pdf' -and $operation -eq 'inspect') { $info = Run-External 'pdfinfo' @($path); Output @{ format = 'pdf'; path = $path; info = $info } }
if ($format -eq 'pdf' -and ($operation -eq 'readText' -or $operation -eq 'extractTables')) { $text = Run-External 'pdftotext' @('-layout', $path, '-'); Output @{ format = 'pdf'; text = $text; operation = $operation } }
if ($format -eq 'pdf' -and $operation -eq 'render') { $outputPath = [string](Get-OptionalParam 'outputPath'); if ([string]::IsNullOrWhiteSpace($outputPath)) { $outputPath = "$path.png" }; $prefix = [IO.Path]::ChangeExtension($outputPath, $null); Run-External 'pdftoppm' @('-png', '-singlefile', $path, $prefix) | Out-Null; Output @{ format = 'pdf'; path = "$prefix.png" } }
if ($format -eq 'pdf' -and $operation -eq 'merge') { $inputs = $request.params.paths; if ($null -eq $inputs -or $inputs.Count -lt 1) { Fail 'pdf.merge requires at least one input document.' }; Run-External 'pdfunite' ([string[]]$inputs + @($path)) | Out-Null; Output @{ format = 'pdf'; path = $path; merged = $inputs.Count } }
if ($operation -eq 'inspect') { $item = Get-Item -LiteralPath $path; Output @{ format = $format; path = $path; sizeBytes = $item.Length; lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o') } }
if ($operation -eq 'readContent' -or $operation -eq 'readRange' -or $operation -eq 'readSlide') { Read-Office $format $path $operation }
if ($operation -in @('insertContent', 'updateContent', 'deleteContent', 'findReplace', 'setStyles', 'setHeaderFooter', 'writeRange', 'clearRange', 'recalculate', 'addSheet', 'deleteSheet', 'addSlide', 'deleteSlide', 'setNotes', 'exportPdf')) { Write-Office $format $path $operation }
if ($operation -eq 'save') { Output @{ saved = $true; path = $path } }
Fail "The document operation '$operation' is not supported by the configured Windows backend."
