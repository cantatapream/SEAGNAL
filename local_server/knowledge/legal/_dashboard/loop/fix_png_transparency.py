#!/usr/bin/env python3
# fix_png_transparency.py — 그림이 화면에서 안 보이게 만드는 잘못된 "투명 색" 설정을 떼어낸다.
# 역할(초보자용): 원문 그림(PNG) 중 일부가 "검은색은 투명하게 처리하라"는 설정을 달고 있다.
#   그런데 그 그림의 **글자와 선이 바로 그 검은색**이라, 흰 바탕 위에서 글자가 통째로 사라진다.
#   사람이 화면에서 그림을 눌러도 백지를 보게 된다. 이 도구는 그 설정만 떼어낸다 —
#   **픽셀은 한 점도 바꾸지 않는다**(바꿨는지 저장 뒤에 한 장씩 대조해 확인한다).
#
# 왜 생겼나: 수집할 때 원본 GIF 를 PNG 로 바꾸면서 GIF 의 "투명 색인"을 그대로 옮겨 적었다.
#   GIF 에서는 그 색인이 배경을 가리켰는데, 팔레트가 재배치되면서 글자색을 가리키게 된 것으로 보인다.
#
# [연계] 입력·출력 raw/**/_이미지/*.png (제자리 수정) · 고친 목록 _dashboard/touched/ (L-171)
# [로드 순서] 단독 실행. `--dry` 로 먼저 세어 보고 돌린다.
import os, sys, glob, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _touched import Touched
from PIL import Image

LEGAL = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DRY = '--dry' in sys.argv


def transparent_color(im):
    """이 그림이 '투명하게 처리하라'고 지정한 색을 RGB 로 돌려준다. 없으면 None."""
    tr = im.info.get('transparency')
    if tr is None:
        return None
    if isinstance(tr, tuple):
        return tr[:3]
    if isinstance(tr, int) and im.mode == 'P':
        pal = im.getpalette() or []
        if len(pal) > tr * 3 + 2:
            return tuple(pal[tr * 3:tr * 3 + 3])
    return None


def pixels(im):
    im = im.convert('RGB')
    return list(im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata())


def main():
    touched = Touched('fix_png_transparency')
    fixed = skipped = 0
    mismatch = []
    for p in sorted(glob.glob(os.path.join(LEGAL, 'raw', '**', '_이미지', '*.png'), recursive=True)):
        try:
            im = Image.open(p)
            c = transparent_color(im)
            if c is None or sum(c) >= 200:      # 투명 지정이 없거나 밝은 색이면 둔다
                continue
            rgb = im.convert('RGB')
            total = im.size[0] * im.size[1]
            n = sum(cnt for cnt, col in rgb.getcolors(maxcolors=2_000_000) if col == c)
            if n / total < 0.005:               # 그 색이 내용이 아니면 둔다(0.5% 미만)
                skipped += 1
                continue
            before = pixels(rgb)
            if DRY:
                fixed += 1
                continue
            out = Image.new('RGB', im.size)     # 새 그림에 픽셀만 옮긴다 — 투명 지정은 따라오지 않는다
            out.paste(rgb, (0, 0))
            out.save(p)
            chk = Image.open(p)
            if chk.info.get('transparency') is not None or pixels(chk) != before:
                mismatch.append(p)              # 설정이 남았거나 픽셀이 바뀌었으면 보고한다
            fixed += 1
            touched.add(p)
        except Exception as e:
            print(f'  ⚠열지 못함: {p} ({type(e).__name__})')
    print(f'{"세어만 봄" if DRY else "고침"}: {fixed}장 · 투명 지정은 있으나 내용이 아니라 그대로 둠: {skipped}장')
    if mismatch:
        print(f'★검증 실패 {len(mismatch)}장 — 픽셀이 바뀌었거나 설정이 남았다:')
        for p in mismatch[:10]:
            print('   ', p)
    else:
        print('검증: 고친 그림 전부 투명 지정이 사라졌고 픽셀은 그대로다.')
    if not DRY:
        touched.save()


if __name__ == '__main__':
    main()
