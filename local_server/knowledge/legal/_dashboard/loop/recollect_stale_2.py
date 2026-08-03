#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""staleness_audit.py 가 찾은 시행규칙 MST 불일치 2건(무인도서법·선박안전법)만 재수집한다.
   조문 텍스트 생성 로직은 recollect_jomun.py 의 build_text() 를 그대로 재사용(전체 74법을
   다시 돌리지 않고 이 2건만 targeted 로 처리)."""
import json, sys, os, time

sys.path.insert(0, os.path.dirname(__file__))
from recollect_jomun import api, build_text  # noqa: E402

TARGETS = [
    {'meta': '/home/user/SEAGNAL/local_server/knowledge/legal/raw/08_섬영토/무인도서의보전및관리에관한법률/_meta.json',
     'new_MST': '288415', 'new_시행일자': '20260727'},
    {'meta': '/home/user/SEAGNAL/local_server/knowledge/legal/raw/04_선박해운/선박안전법/_meta.json',
     'new_MST': '288417', 'new_시행일자': '20260727'},
]

OC = 'hyoo1431'


def main():
    for t in TARGETS:
        meta = json.load(open(t['meta'], encoding='utf-8'))
        name = meta.get('법령명', '?')
        old_mst = meta['families']['시행규칙']['MST']
        body = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON&MST={t['new_MST']}")
        if not body:
            print(f'✗ {name}: API 응답 없음(MST={t["new_MST"]})')
            continue
        txt = build_text(body)
        if not txt:
            print(f'✗ {name}: 조문 파싱 실패')
            continue
        base = os.path.dirname(t['meta'])
        out_path = os.path.join(base, '시행규칙.txt')
        old_size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(txt)
        meta['families']['시행규칙']['MST'] = t['new_MST']
        meta['시행규칙_재수집'] = f'2026-08-03(staleness_audit 발견 — MST {old_mst}→{t["new_MST"]}, 시행일자 {t["new_시행일자"]})'
        json.dump(meta, open(t['meta'], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'✓ {name}: 시행규칙.txt 갱신({old_size}→{len(txt.encode("utf-8"))} bytes), MST {old_mst}→{t["new_MST"]}')
        time.sleep(0.3)


if __name__ == '__main__':
    main()
