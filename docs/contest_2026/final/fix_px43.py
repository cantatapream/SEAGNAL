"""NotebookLM 그림의 작은 글자 오류 고치기 — px43/sNN.png → px43fix/sNN.png
erase: 그 칸을 좌우 이웃 픽셀로 줄마다 메움 / redraw: 지운 자리에 Pretendard 로 바른 글을 다시 씀(원래 잉크 폭에 맞춰 크기 결정)."""
import os, numpy as np
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__))
FD = os.path.join(os.path.dirname(D), 'fonts/package/dist/public/static/')
os.makedirs(D + '/px43fix', exist_ok=True)


def erase(im, box, left_only=False):
    a = np.asarray(im).astype(float)
    x0, y0, x1, y1 = box
    L = a[y0:y1, x0 - 2]; R = a[y0:y1, x1 + 1] if not left_only else a[y0:y1, x0 - 2]
    t = np.linspace(0, 1, x1 - x0)[None, :, None]
    a[y0:y1, x0:x1] = L[:, None, :] * (1 - t) + R[:, None, :] * t
    return Image.fromarray(a.clip(0, 255).astype('uint8'))


def erase_vert(im, box):
    """세로로 메움: 각 열을 칸 위·아래 이웃 픽셀 사이로 잇는다(띠 안의 위아래 그라데이션 보존)."""
    a = np.asarray(im).astype(float)
    x0, y0, x1, y1 = box
    T = a[y0 - 1, x0:x1]; B = a[y1, x0:x1]
    t = np.linspace(0, 1, y1 - y0)[:, None, None]
    a[y0:y1, x0:x1] = T[None] * (1 - t) + B[None] * t
    return Image.fromarray(a.clip(0, 255).astype('uint8'))


def erase_cols(im, box, ref_y):
    """세로로 메움: 각 열을 ref_y 줄의 색으로(위쪽 장식 지우기)."""
    a = np.asarray(im).copy()
    x0, y0, x1, y1 = box
    a[y0:y1, x0:x1] = a[ref_y, x0:x1][None, :, :]
    return Image.fromarray(a)


def redraw(im, box, ink, text, color, weight='Medium', align='left', left_only=False):
    """box: 지울 칸 / ink: 원래 글의 잉크 상자(x0,y0,x1,y1) — 새 글을 같은 폭·같은 세로 가운데로."""
    im = erase(im, box, left_only)
    x0, y0, x1, y1 = ink
    tw = x1 - x0 + 1
    f = None
    for s in [x / 4 for x in range(32, 160)]:
        ft = ImageFont.truetype(FD + f'Pretendard-{weight}.otf', round(s))
        bb = ft.getbbox(text)
        if bb[2] - bb[0] > tw:
            break
        f, fb = ft, bb
    d = ImageDraw.Draw(im)
    cy = (y0 + y1) / 2
    w = fb[2] - fb[0]
    x = x0 if align == 'left' else (x0 + x1 - w) / 2
    # 한글 잉크 세로 가운데 맞춤
    hb = f.getbbox('한')
    y = cy - (hb[1] + hb[3]) / 2
    d.text((x - fb[0], y), text, font=f, fill=color)
    return im


FIX = {
    9: [('redraw', (714, 236, 819, 257), (716, 238, 805, 255), '어업종사자 5.9%', (244, 252, 255), 'Medium', 'left', True)],
    10: [('erase', (1062, 736, 1266, 762))],
    12: [('cols', (300, 0, 1076, 60), 64)],
    14: [('redraw', (92, 730, 326, 750), (95, 733, 320, 746), '2026. 1. 1. ~ 10. 19. 기능 사용 횟수 기준', (156, 167, 184), 'Regular')],
    30: [('erase', (611, 196, 628, 652)), ('erase', (1287, 196, 1304, 652)), ('vert', (611, 196, 1304, 211)), ('vert', (611, 636, 1304, 652)),
         ('redraw', (578, 736, 796, 757), (585, 740, 789, 753), '출처: 해양경찰청 유튜브(2026. 7. 16.)', (127, 142, 161), 'Regular', 'center')],
    34: [('redraw', (35, 723, 330, 742), (37, 726, 326, 739), '출처: 기상청, 해양수산부, 해양교통안전공단, 해양경찰청', (110, 136, 156), 'Regular')],
    39: [('redraw', (39, 741, 596, 760), (42, 744, 591, 757), '공공데이터 75종 = 공공 API 43 · 공공데이터 파일 23 · 통보문·CCTV 영상 9 (2026. 10. 19. 앱 코드 기준)', (127, 142, 162), 'Regular')],
    40: [('vert', (333, 699, 361, 732))],
    41: [('vert', (1138, 262, 1154, 293)), ('vert', (1269, 262, 1292, 293)), ('vert', (1061, 293, 1069, 323))],
}

for n in range(1, 44):
    im = Image.open(f'{D}/px43/s{n:02d}.png').convert('RGB')
    for op in FIX.get(n, []):
        if op[0] == 'erase':
            im = erase(im, op[1])
        elif op[0] == 'vert':
            im = erase_vert(im, op[1])
        elif op[0] == 'cols':
            im = erase_cols(im, op[1], op[2])
        else:
            im = redraw(im, *op[1:])
    im.save(f'{D}/px43fix/s{n:02d}.png')
print('ok')
