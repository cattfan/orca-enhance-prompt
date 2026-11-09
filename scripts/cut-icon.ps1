# Cuts the logo tile out of the generated picture (assets/art/logo-source.jpg, gpt-image-2.5-sunburst,
# on white) with a transparent outside, at a given size. -Ring "#6B6B70" adds the thin light edge that
# keeps the dark tile visible on dark backgrounds (assets/icon.png). Windows only:
#   powershell -File scripts/cut-icon.ps1 -In assets/art/logo-source.jpg -Out assets/icon.png -Size 256 -Ring "#6B6B70"
#   powershell -File scripts/cut-icon.ps1 -In assets/art/logo-source.jpg -Out assets/art/logo-64.png -Size 64
param([string]$In, [string]$Out, [int]$Size = 256, [string]$Ring = "")
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Collections.Generic;
public static class Cut {
  // Makes the light background around the tile transparent (flood fill from the edges), crops to the tile.
  public static Bitmap Run(Bitmap src) {
    int w = src.Width, h = src.Height;
    var bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
    var seen = new bool[w, h]; var q = new Queue<Point>();
    for (int x = 0; x < w; x++) { q.Enqueue(new Point(x, 0)); q.Enqueue(new Point(x, h - 1)); }
    for (int y = 0; y < h; y++) { q.Enqueue(new Point(0, y)); q.Enqueue(new Point(w - 1, y)); }
    while (q.Count > 0) {
      var p = q.Dequeue(); if (p.X < 0 || p.Y < 0 || p.X >= w || p.Y >= h || seen[p.X, p.Y]) continue;
      var c = bmp.GetPixel(p.X, p.Y); int lum = (c.R + c.G + c.B) / 3;
      if (lum < 128) continue;
      seen[p.X, p.Y] = true;
      // Anti-aliased edge: keep darkness as alpha.
      bmp.SetPixel(p.X, p.Y, lum > 245 ? Color.FromArgb(0, 0, 0, 0) : Color.FromArgb(255 - lum, 10, 10, 10));
      q.Enqueue(new Point(p.X + 1, p.Y)); q.Enqueue(new Point(p.X - 1, p.Y)); q.Enqueue(new Point(p.X, p.Y + 1)); q.Enqueue(new Point(p.X, p.Y - 1));
    }
    int minX = w, minY = h, maxX = 0, maxY = 0;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (bmp.GetPixel(x, y).A > 200) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    int side = Math.Max(maxX - minX, maxY - minY) + 1, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var crop = new Bitmap(side, side, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(crop)) g.DrawImage(bmp, new Rectangle(0, 0, side, side), new Rectangle(cx - side / 2, cy - side / 2, side, side), GraphicsUnit.Pixel);
    return crop;
  }
}
"@
$src = [Drawing.Bitmap]::FromFile($In)
$cut = [Cut]::Run($src)
$outBmp = New-Object Drawing.Bitmap $Size, $Size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [Drawing.Graphics]::FromImage($outBmp)
$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
$pad = [int]($Size * 0.04)
$g.DrawImage($cut, $pad, $pad, $Size - 2 * $pad, $Size - 2 * $pad)
if ($Ring) {
  # A thin light ring on the tile's edge, so the dark tile stands out on dark backgrounds.
  $w = [Math]::Max(1.5, $Size * 0.014)
  $side = $Size - 2 * $pad - $w
  $r = $side * 0.235
  $x = $pad + $w / 2; $y = $x
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90); $path.AddArc($x + $side - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($x + $side - 2 * $r, $y + $side - 2 * $r, 2 * $r, 2 * $r, 0, 90); $path.AddArc($x, $y + $side - 2 * $r, 2 * $r, 2 * $r, 90, 90); $path.CloseFigure()
  $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml($Ring)), $w
  $g.DrawPath($pen, $path)
}
$outBmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
"saved $Out"
