
$sourcePath = "assets/Untitled-1.png"
$destPath = "assets/dolhareubang_medium.png"
$scale = 0.85 # Scale up from 0.70 to 0.85 (slightly bigger but still padded)

Add-Type -AssemblyName System.Drawing

$srcImage = [System.Drawing.Image]::FromFile($sourcePath)
$width = $srcImage.Width
$height = $srcImage.Height

# Use the larger dimension to make a square canvas, ensuring aspect ratio is kept
$maxDim = [Math]::Max($width, $height)
$newBmp = New-Object System.Drawing.Bitmap($maxDim, $maxDim)
$graphics = [System.Drawing.Graphics]::FromImage($newBmp)

# High quality settings
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Clear with transparency
$graphics.Clear([System.Drawing.Color]::Transparent)

# Calculate new dimensions
$newWidth = $width * $scale
$newHeight = $height * $scale

# Center position
$x = ($maxDim - $newWidth) / 2
$y = ($maxDim - $newHeight) / 2

# Draw
$graphics.DrawImage($srcImage, $x, $y, $newWidth, $newHeight)

$newBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$newBmp.Dispose()
$srcImage.Dispose()

Write-Host "Created medium icon at $destPath"
