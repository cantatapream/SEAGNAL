#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""staleness_audit.py 가 찾은 시행규칙 MST 불일치 2건(무인도서법·선박안전법)만 재수집한다.
   조문 텍스트 생성 로직은 recollect_jomun.py 의 build_text() 를 그대로 재사용(전체 74법을
   다시 돌리지 않고 이 2건만 targeted 로 처리)."""
import json, sys, os, time

sys.path.insert(0, os.path.dirname(__file__))
from recollect_jomun import api, build_text  # noqa: E402
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294·L-295)

# ★2026-09-23 (3-39) — 그 컴퓨터 이름을 박지 않는다(G-31).
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', '..'))
def R(rel):
    return os.path.join(REPO, rel)

TARGETS = [
    {'meta': R("local_server/knowledge/legal/raw/08_섬영토/무인도서의보전및관리에관한법률/_meta.json"),
     'new_MST': '288415', 'new_시행일자': '20260727'},
    {'meta': R("local_server/knowledge/legal/raw/04_선박해운/선박안전법/_meta.json"),
     'new_MST': '288417', 'new_시행일자': '20260727'},
]

OC = 'hyoo1431'


def main():
    for t in TARGETS:
        meta = json.load(open(t['meta'], encoding='utf-8'))
        name = meta.get('법령명', '?')
        old_mst = meta['families']['시행규칙']['MST']
        # ★`eflaw` 를 efYd 없이 부르던 자리다 (2026-09-21 수정).
        #   [무엇이 잘못이었나] `lawService.do?target=eflaw` 는 **efYd 가 없으면** HTTP **200** 과 함께
        #   *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다. api() 가 그것을 네트워크 오류처럼
        #   삼켰으므로 이 호출은 **조용히 아무것도 안 주고 있었다.**
        #   ⚠**권한 문제가 아니다.** 신청은 처음부터 다 돼 있었고, 맞는 efYd 를 주면 JSON 이 온다.
        #     나는 저 문구를 하루에 두 번 오진했다 — "호스트 불통"(L-294), "eflaw 미신청"(L-295).
        #   [왜 그냥 target=law 로 안 바꿨나] 한 MST 가 시행일 판을 둘 이상 가지면 `target=law&MST=`
        #   는 **옛 판이나 시행예정 판**을 준다 — 287955→20260701(현행은 20260828),
        #   288973→**20270101 시행예정**(현행은 20260825). 아직 시행도 안 된 법문을 현행인 양 저장한다.
        #   [그래서] 현행 시행일자를 조회해 `efYd` 로 못 박는 공용 함수를 쓴다.
        #   근거와 실측표는 law_api_guard.py 머리말 · fetch_law_body() 참조.
        body = law_api_guard.fetch_law_body(api, OC, t['new_MST'])
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
