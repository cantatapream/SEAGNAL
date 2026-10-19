"""33장 막대그래프 — 「위험구역 6곳 이상 3.34배」(10-15 이전 방식)를 지금 앱 기준 「위험구역 한 종류 3곳 이상 1.84배(84% 높음)」로.
px43fix/s33.png 를 고쳐 덮어쓴다. 줄 순서는 큰 값부터: 주말 행사 약 2.1 · 사람 2배 1.96 · 위험구역 1.84 · 8월 1.67.
근거: client/js/marine-life/risk-forecast/risk_basis_content.js:82-85 (origin/main 0137b1287)."""
import os, numpy as np
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__))
FD = os.path.join(os.path.dirname(D), 'fonts/package/dist/public/static/')
src = Image.open(f'{D}/px43/s33.png').convert('RGB')     # 원본(줄 이동 기준)
cur = Image.open(f'{D}/px43fix/s33.png').convert('RGB')  # fix43 를 거친 판(33장은 고친 것 없음 — 같은 그림)
a = np.asarray(src).copy()
X0, X1 = 66, 990
out = np.asarray(cur).copy()
out[238:300, X0:X1] = a[300:362, X0:X1]   # 1칸 ← 주말 행사(원래 2칸)
out[300:362, X0:X1] = a[362:424, X0:X1]   # 2칸 ← 사람 2배(원래 3칸)
row = a[362:424, X0:X1].astype(float).copy()  # 3칸 = 사람 2배 줄을 고쳐 위험구역 줄로


def fill_h(r, x0, x1):
    """r(줄 조각)의 [x0,x1) 를 좌우 이웃으로 줄마다 메움(조각 좌표)."""
    L = r[:, x0 - 2]; R = r[:, x1 + 1]
    t = np.linspace(0, 1, x1 - x0)[None, :, None]
    r[:, x0:x1] = L[:, None, :] * (1 - t) + R[:, None, :] * t


ox = X0
# ① 값 글자(1.96배) 지움 — 원래 672~743
fill_h(row, 668 - ox, 750 - ox)
# ② 막대 끝을 14px 왼쪽으로(660 → 646): 끝 모양(630~668)을 옮기고 빈 곳은 배경으로
d = 14
cap = row[:, 630 - ox:668 - ox].copy()
row[:, 630 - d - ox:668 - d - ox] = cap
fill_h(row, 668 - d - ox, 668 - ox + 1)
# ③ 이름표 지움 — 원래 178~404
fill_h(row, 170 - ox, 410 - ox)
img = Image.fromarray(out)
img.paste(Image.fromarray(row.clip(0, 255).astype('uint8')), (X0, 362))
dr = ImageDraw.Draw(img)


def fit(text, width, weight):
    f = None
    for s in range(10, 60):
        ft = ImageFont.truetype(FD + f'Pretendard-{weight}.otf', s)
        bb = ft.getbbox(text)
        if bb[2] - bb[0] > width:
            break
        f = ft
    return f


def put(text, f, x, cy, color, align='left'):
    bb = f.getbbox(text); hb = f.getbbox('한')
    y = cy - (hb[1] + hb[3]) / 2
    if align == 'right':
        x = x - (bb[2] - bb[0])
    dr.text((x - bb[0], y), text, font=f, fill=color)


# 이름표: 원래 글(사람이 평소의 2배 붐빌 때)과 같은 크기로, 오른쪽 끝 404 에 맞춤
fl = fit('사람이 평소의 2배 붐빌 때', 404 - 178 + 1, 'Medium')
put('위험구역 한 종류 3곳 이상', fl, 404, 362 + (382 + 403) / 2 - 362, (247, 254, 255), 'right')
# 값: 원래 「1.96배」와 같은 크기·색, 막대 끝 + 12
fv = fit('1.96배', 743 - 672 + 1, 'Bold')
put('1.84배', fv, 672 - d, (380 + 404) / 2, (101, 223, 225))
img.save(f'{D}/px43fix/s33.png')
print('ok', fl.size, fv.size)
