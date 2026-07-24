Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot "..\public\picture-diary-frame.png"
$outputPath = Join-Path $PSScriptRoot "..\public\picture-diary-frame-instagram.png"
$source = [System.Drawing.Image]::FromFile($sourcePath)
$canvas = New-Object System.Drawing.Bitmap 1058, 1323
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

try {
  $graphics.Clear([System.Drawing.Color]::FromArgb(255, 253, 248))
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(0, 0, 1058, 393),
    [System.Drawing.Rectangle]::new(0, 0, 1058, 393),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(0, 393, 1058, 358),
    [System.Drawing.Rectangle]::new(0, 393, 1058, 564),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $gridX = 48.0
  $gridY = 785.0
  $gridWidth = 959.0
  $cellSize = $gridWidth / 13.0
  $gridHeight = $cellSize * 5.0

  # Reuse strips of the original hand-drawn grid so the new grid keeps
  # the same pencil texture, color, and slightly irregular edges.
  for ($column = 0; $column -le 13; $column++) {
    $x = [int][Math]::Round($gridX + $column * $cellSize) - 1
    $graphics.DrawImage(
      $source,
      [System.Drawing.Rectangle]::new($x, [int]$gridY, 3, [int][Math]::Round($gridHeight)),
      [System.Drawing.Rectangle]::new(47, 991, 3, 328),
      [System.Drawing.GraphicsUnit]::Pixel
    )
  }
  for ($row = 0; $row -le 5; $row++) {
    $y = [int][Math]::Round($gridY + $row * $cellSize) - 1
    $graphics.DrawImage(
      $source,
      [System.Drawing.Rectangle]::new([int]$gridX, $y, [int]$gridWidth, 3),
      [System.Drawing.Rectangle]::new(48, 990, 959, 3),
      [System.Drawing.GraphicsUnit]::Pixel
    )
  }

  # Continue the notebook's hand-drawn outer border through the rebuilt
  # manuscript section.
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(20, 751, 10, 403),
    [System.Drawing.Rectangle]::new(20, 957, 10, 362),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(1028, 751, 10, 403),
    [System.Drawing.Rectangle]::new(1028, 957, 10, 362),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(0, 1154, 1058, 169),
    [System.Drawing.Rectangle]::new(0, 1318, 1058, 169),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $canvas.Dispose()
  $source.Dispose()
}
