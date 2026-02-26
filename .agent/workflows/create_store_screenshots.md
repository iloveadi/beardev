---
description: Chrome Web Store 등록용 스크린샷 및 프로모션 이미지 생성
---

## 스토어 스크린샷 생성 방법

사용자가 스크린샷 이미지를 제공하면, 아래 방식으로 Chrome Web Store 등록에 필요한 모든 크기의 이미지를 생성한다.

### 규칙
- 원본 이미지의 **비율을 유지**하며 캔버스 안에 **최대 크기**로 배치
- 캔버스의 빈 여백은 앱 배경색 `#0f1115` (RGB: 15, 17, 21)로 채움
- 이미지는 캔버스 **정중앙**에 배치
- 출력 폴더: `store_assets\`

### 생성 크기
| 파일명 | 크기 | 용도 |
|---|---|---|
| `screenshot_1280x800.png` | 1280x800 | 스크린샷 (필수) |
| `screenshot_640x400.png` | 640x400 | 스크린샷 소형 |
| `promo_small_440x280.png` | 440x280 | 소형 프로모션 타일 |
| `promo_marquee_1400x560.png` | 1400x560 | 마퀴 배너 (선택) |

### PowerShell 스크립트

아래 스크립트에서 `$srcPath`를 사용자가 제공한 이미지 경로로 교체하여 실행한다.

// turbo
```powershell
Add-Type -AssemblyName System.Drawing

$srcPath = "REPLACE_WITH_IMAGE_PATH"
$src     = [System.Drawing.Image]::FromFile($srcPath)
$outDir  = "c:\@app-dev\auto-visualizer\store_assets"
$bgColor = [System.Drawing.Color]::FromArgb(15, 17, 21)

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function MakeFit($targetW, $targetH, $name) {
    $canvas = New-Object System.Drawing.Bitmap($targetW, $targetH)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear($bgColor)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $scale = [Math]::Min([double]$targetW / $src.Width, [double]$targetH / $src.Height)
    $newW  = [int]([Math]::Floor($src.Width  * $scale))
    $newH  = [int]([Math]::Floor($src.Height * $scale))
    $x     = [int](($targetW - $newW) / 2)
    $y     = [int](($targetH - $newH) / 2)

    $destRect = New-Object System.Drawing.Rectangle($x, $y, $newW, $newH)
    $g.DrawImage($src, $destRect)
    $g.Dispose()

    $out = Join-Path $outDir $name
    $canvas.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Host "저장: $name | 캔버스 ${targetW}x${targetH} | 이미지 ${newW}x${newH}"
}

MakeFit 1280 800  "screenshot_1280x800.png"
MakeFit 640  400  "screenshot_640x400.png"
MakeFit 440  280  "promo_small_440x280.png"
MakeFit 1400 560  "promo_marquee_1400x560.png"

$src.Dispose()
Write-Host "완료!"
```
