Add-Type -AssemblyName System.Drawing

function Draw-SketchLine {
  param(
    [System.Drawing.Graphics]$Target,
    [System.Drawing.Pen]$Stroke,
    [double]$X1,
    [double]$Y1,
    [double]$X2,
    [double]$Y2,
    [double]$Phase
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  try {
    $steps = 28
    $dx = $X2 - $X1
    $dy = $Y2 - $Y1
    $length = [Math]::Max(1.0, [Math]::Sqrt($dx * $dx + $dy * $dy))
    $normalX = -$dy / $length
    $normalY = $dx / $length
    $points = New-Object 'System.Drawing.PointF[]' ($steps + 1)
    for ($index = 0; $index -le $steps; $index++) {
      $progress = $index / [double]$steps
      # Sub-pixel wobble keeps the geometry usable while giving the line
      # a lightly hand-inked comic feel.
      $wobble = [Math]::Sin($progress * 17.0 + $Phase) * 0.55 +
        [Math]::Sin($progress * 41.0 + $Phase * 0.7) * 0.22
      $points[$index] = [System.Drawing.PointF]::new(
        [single]($X1 + $dx * $progress + $normalX * $wobble),
        [single]($Y1 + $dy * $progress + $normalY * $wobble)
      )
    }
    $path.AddLines($points)
    $Target.DrawPath($Stroke, $path)
  }
  finally {
    $path.Dispose()
  }
}

$sourcePath = "C:\Users\JUN\.codex\generated_images\019f9492-0c74-7d01-991f-67c3e9a51703\call_Y79BgghqYydC6ssE1rTtew6R.png"
$outputPath = Join-Path $PSScriptRoot "..\public\picture-diary-frame-instagram.png"

$source = [System.Drawing.Image]::FromFile($sourcePath)
$canvas = New-Object System.Drawing.Bitmap 1080, 1350
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Preserve the generated paper texture and compact handwritten header.
  $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1080, 1350))

  # Rebuild the compact header/title rows and everything below them over a
  # clean piece of the same paper.
  $cleanArea = [System.Drawing.Rectangle]::new(250, 250, 500, 500)
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(22, 20, 1036, 1310),
    $cleanArea,
    [System.Drawing.GraphicsUnit]::Pixel
  )

  # Restore and reposition the original handwritten labels. The reserved
  # spaces before 년/월/일 fit 4/2/2 digits; the weather area fits icon + text.
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(190, 38, 42, 42),
    [System.Drawing.Rectangle]::new(126, 36, 46, 46),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(345, 38, 42, 42),
    [System.Drawing.Rectangle]::new(253, 36, 46, 46),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(470, 38, 42, 42),
    [System.Drawing.Rectangle]::new(388, 36, 46, 46),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(680, 34, 100, 48),
    [System.Drawing.Rectangle]::new(694, 34, 112, 50),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawImage(
    $source,
    [System.Drawing.Rectangle]::new(35, 88, 130, 48),
    [System.Drawing.Rectangle]::new(30, 105, 140, 55),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $lineColor = [System.Drawing.Color]::FromArgb(185, 88, 70, 58)
  $pen = New-Object System.Drawing.Pen $lineColor, 2.35

  try {
    # Outer notebook border and section dividers.
    Draw-SketchLine $graphics $pen 20 20 1059 20 0.2
    Draw-SketchLine $graphics $pen 1059 20 1059 1329 1.1
    Draw-SketchLine $graphics $pen 1059 1329 20 1329 2.2
    Draw-SketchLine $graphics $pen 20 1329 20 20 3.3
    Draw-SketchLine $graphics $pen 20 90 1059 90 4.1
    Draw-SketchLine $graphics $pen 20 145 1059 145 5.2

    # Picture opening: inner size is exactly 990 x 660 = 3:2.
    $photoPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $photoPath.AddArc(44, 154, 16, 16, 180, 90)
    $photoPath.AddArc(1018, 154, 16, 16, 270, 90)
    $photoPath.AddArc(1018, 798, 16, 16, 0, 90)
    $photoPath.AddArc(44, 798, 16, 16, 90, 90)
    $photoPath.CloseFigure()
    $graphics.DrawPath($pen, $photoPath)
    $photoPath.Dispose()

    # Manuscript grid: exactly 13 columns x 5 rows.
    $gridX = 45.0
    $gridY = 835.0
    $gridWidth = 990.0
    $gridHeight = 380.0
    for ($column = 0; $column -le 13; $column++) {
      $x = $gridX + ($gridWidth * $column / 13.0)
      Draw-SketchLine $graphics $pen $x $gridY $x ($gridY + $gridHeight) (6.0 + $column)
    }
    for ($row = 0; $row -le 5; $row++) {
      $y = $gridY + ($gridHeight * $row / 5.0)
      Draw-SketchLine $graphics $pen $gridX $y ($gridX + $gridWidth) $y (20.0 + $row)
    }

    # Teacher's one-line comment box.
    $commentPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $commentPath.AddArc(44, 1215, 18, 18, 180, 90)
    $commentPath.AddArc(1017, 1215, 18, 18, 270, 90)
    $commentPath.AddArc(1017, 1307, 18, 18, 0, 90)
    $commentPath.AddArc(44, 1307, 18, 18, 90, 90)
    $commentPath.CloseFigure()
    $graphics.DrawPath($pen, $commentPath)
    $commentPath.Dispose()
  }
  finally {
    $pen.Dispose()
  }

  $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $canvas.Dispose()
  $source.Dispose()
}
