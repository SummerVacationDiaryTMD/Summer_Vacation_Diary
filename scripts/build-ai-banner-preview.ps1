Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot "..\public\picture-diary-frame-instagram.png"
$outputPath = Join-Path $PSScriptRoot "..\public\picture-diary-frame-ai-banner-preview.png"
$source = [System.Drawing.Image]::FromFile($sourcePath)
$canvas = New-Object System.Drawing.Bitmap $source.Width, $source.Height
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height)

  $text = -join @(
    [char]0x0041, [char]0x0049, [char]0x0020,
    [char]0xC0DD, [char]0xC131, [char]0x0020,
    [char]0xCF58, [char]0xD150, [char]0xCE20, [char]0x0020,
    [char]0xD3EC, [char]0xD568
  )
  $font = New-Object System.Drawing.Font "Malgun Gothic", 22, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $textSize = $graphics.MeasureString($text, $font)
  $paddingX = 20
  $height = 42
  $width = [int][Math]::Ceiling($textSize.Width) + $paddingX * 2
  $x = 1080 - 25 - $width
  $y = 90 + (55 - $height) / 2
  $radius = $height / 2

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, $radius * 2, $radius * 2, 90, 180)
  $path.AddArc($x + $width - $radius * 2, $y, $radius * 2, $radius * 2, 270, 180)
  $path.CloseFigure()

  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 255, 252, 245))
  $stroke = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(97, 176, 148, 108)), 2
  $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 139, 106, 62))

  try {
    $graphics.FillPath($fill, $path)
    $graphics.DrawPath($stroke, $path)
    $textY = $y + ($height - $textSize.Height) / 2
    $graphics.DrawString($text, $font, $textBrush, $x + $paddingX, $textY)
  }
  finally {
    $textBrush.Dispose()
    $stroke.Dispose()
    $fill.Dispose()
    $path.Dispose()
    $font.Dispose()
  }

  $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $canvas.Dispose()
  $source.Dispose()
}
