# ============================================================================
# 파일명: scripts/hazard_rocks_ocr_stitch.py
# 역할: hazard_rocks_ocr_fetch.js 가 받은 KHOA 타일을 스티칭해, 조회 좌표가
#   정확히 중앙(빨간 크로스헤어)에 오도록 Mercator 픽셀 계산으로 크롭한다.
# ============================================================================
# 사용법: python3 hazard_rocks_ocr_stitch.py <label> <outDir>
# 산출물: <outDir>/<label>_centered.png (z16, 500m 창, 크로스헤어 중앙)
#         <outDir>/<label>_wide_marked.png (z12, ≈9.8km, 크로스헤어 표시)
# [연계] hazard_rocks_ocr_fetch.js(선행) / hazard_rocks_ocr_build_review.py(후속)
# ============================================================================
import sys
import json
import math
from PIL import Image, ImageDraw

label = sys.argv[1]
out_dir = sys.argv[2]
TILE_PX = 256

with open(f'{out_dir}/{label}_meta.json') as f:
    meta = json.load(f)

R = 6378137.0
ORIGIN_X = -math.pi * R
ORIGIN_Y = math.pi * R

# ── z16 3x3 스티치 + 중앙 정렬 크롭 ──
z16 = meta['z16']
grid_n = 3
stitched = Image.new('RGB', (grid_n * TILE_PX, grid_n * TILE_PX), (200, 200, 200))
for t in z16['tiles']:
    img = Image.open(t['fname']).convert('RGB')
    col = t['dtx'] + 1
    row = t['dty'] + 1
    stitched.paste(img, (col * TILE_PX, row * TILE_PX))

tile_size = z16['tileSize']
center_tile_min_x = ORIGIN_X + z16['cx'] * tile_size
center_tile_max_y = ORIGIN_Y - z16['cy'] * tile_size
stitch_min_x = center_tile_min_x - tile_size
stitch_max_y = center_tile_max_y + tile_size

px = (meta['x'] - stitch_min_x) / tile_size * TILE_PX
py = (stitch_max_y - meta['y']) / tile_size * TILE_PX

crop_size = 500
half = crop_size // 2
left = max(0, int(px - half))
top = max(0, int(py - half))
right = min(stitched.width, int(px + half))
bottom = min(stitched.height, int(py + half))
cropped = stitched.crop((left, top, right, bottom))

cpx, cpy = px - left, py - top
draw = ImageDraw.Draw(cropped)
r = 8
draw.ellipse([cpx - r, cpy - r, cpx + r, cpy + r], outline=(255, 0, 0), width=2)
draw.line([cpx - 16, cpy, cpx + 16, cpy], fill=(255, 0, 0), width=1)
draw.line([cpx, cpy - 16, cpx, cpy + 16], fill=(255, 0, 0), width=1)
centered_path = f'{out_dir}/{label}_centered.png'
cropped.save(centered_path)

# ── z12 넓은 뷰에 크로스헤어 표시 ──
wide_path = None
if meta['z12']['path']:
    wimg = Image.open(meta['z12']['path']).convert('RGB')
    ww, wh = wimg.size
    wb = meta['z12']['bbox']
    wpx = (meta['x'] - wb['minX']) / (wb['maxX'] - wb['minX']) * ww
    wpy = (wb['maxY'] - meta['y']) / (wb['maxY'] - wb['minY']) * wh
    wdraw = ImageDraw.Draw(wimg)
    wdraw.ellipse([wpx - r, wpy - r, wpx + r, wpy + r], outline=(255, 0, 0), width=2)
    wide_path = f'{out_dir}/{label}_wide_marked.png'
    wimg.save(wide_path)

print(json.dumps({'centered': centered_path, 'wide': wide_path}))
