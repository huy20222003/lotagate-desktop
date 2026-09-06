function Invoke-WinRt([object]$operation) {
  try { Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue; return [System.WindowsRuntimeSystemExtensions]::AsTask($operation).GetAwaiter().GetResult() }
  catch { throw 'Windows OCR is unavailable in this Desktop runtime.' }
}

function Recognize-ImageText([byte[]]$png, [string]$language) {
  $engine = if ([string]::IsNullOrWhiteSpace($language)) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() } else { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($language)) }
  if ($null -eq $engine) { throw 'No compatible Windows OCR language is installed.' }
  $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new(); $writer = [Windows.Storage.Streams.DataWriter]::new($stream)
  $writer.WriteBytes($png); [void](Invoke-WinRt $writer.StoreAsync()); $writer.DetachStream(); $stream.Seek(0)
  $decoder = Invoke-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)); $bitmap = Invoke-WinRt $decoder.GetSoftwareBitmapAsync(); $ocr = Invoke-WinRt $engine.RecognizeAsync($bitmap)
  $lines = @($ocr.Lines | ForEach-Object { $rect = $_.BoundingRect; [ordered]@{ text = [string]$_.Text; bounds = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } } })
  $text = [string]$ocr.Text; if ($text.Length -gt 100000) { $text = $text.Substring(0, 100000) + "`n[truncated]" }
  return [ordered]@{ text = $text; language = [string]$engine.RecognizerLanguage.LanguageTag; lines = $lines }
}
