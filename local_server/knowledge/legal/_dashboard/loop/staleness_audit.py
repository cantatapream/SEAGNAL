#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""raw 최신성 전수 재검증(읽기 전용) — 74개 핵심법의 법률/시행령/시행규칙 MST와
   위임고시(행정규칙) 목록이 law.go.kr 최신 상태와 일치하는지 대조만 한다.
   기존 raw/ 파일은 절대 건드리지 않고, 결과만 새 리포트 파일에 기록한다(⚠경합위험 없음
   — 공유 raw 파일을 쓰지 않으므로 CLAUDE.md 병렬 안전 규칙 대상 아님).
   계기: 2026-08-03 조문 팝업 작업 중 자연유산법 고시 하나가 구버전(2024-12-27)으로
   수집돼 있고 최신판(2026-05-17)이 존재함을 우연히 발견 → 전체 재검증 필요성 확인."""
import json, urllib.request, urllib.parse, time, os, glob, sys

OC = 'hyoo1431'
ROOT = '/home/user/SEAGNAL/local_server/knowledge/legal'
RAW_PATHS = json.load(open(os.path.join(ROOT, '_dashboard/law_raw_paths.json'), encoding='utf-8'))
STATUTES_DIR = os.path.join(ROOT, 'wiki/statutes')
REPORT = os.path.join(ROOT, f'_dashboard/staleness_audit_{time.strftime("%Y%m%d")}.json')

sys.path.insert(0, os.path.dirname(__file__))
from collect_admrul import api, delegated_admrul  # noqa: E402  (읽기용 헬퍼만 재사용, __main__ 실행 안 됨)


def core_law_names():
    return sorted(f[:-3] for f in os.listdir(STATUTES_DIR) if f.endswith('.md'))


def search_law_family(name_no_space):
    # law_raw_paths.json 키는 공백 제거 형태 -> _meta.json에서 원래 법령명(공백 포함)을 가져온다
    rel = RAW_PATHS.get(name_no_space)
    if not rel:
        return None, None
    meta_path = os.path.join('/home/user/SEAGNAL', rel, '_meta.json')
    if not os.path.exists(meta_path):
        return None, rel
    meta = json.load(open(meta_path, encoding='utf-8'))
    return meta, rel


def check_family_mst(meta):
    """법률/시행령/시행규칙 MST가 최신인지 lawSearch로 대조. mismatch 목록 반환."""
    name = meta.get('법령명', '')
    q = urllib.parse.quote(name)
    d = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=law&type=JSON&query={q}&display=20")
    issues = []
    if not d:
        return [{'family': '(검색실패)', 'issue': 'API 응답 없음'}]
    laws = d.get('LawSearch', {}).get('law', [])
    if isinstance(laws, dict):
        laws = [laws]
    fams = meta.get('families', {})
    for kind in ('법률', '시행령', '시행규칙'):
        stored = fams.get(kind)
        if not stored:
            continue
        # 이름 스킴: 기본법 이름 그대로=법률, "…시행령"/"…시행규칙"으로 끝나면 해당 계열
        want_suffix = '' if kind == '법률' else kind
        cand = None
        for l in laws:
            lname = l.get('법령명한글', '')
            if kind == '법률':
                if lname == name:
                    cand = l; break
            else:
                if lname == name + ' ' + want_suffix or lname.endswith(want_suffix) and name in lname:
                    cand = l; break
        if not cand:
            issues.append({'family': kind, 'issue': '현재 검색결과에서 못 찾음(폐지/명칭변경 가능성)'})
            continue
        cur_mst = str(cand.get('법령일련번호', ''))
        if cur_mst and cur_mst != str(stored.get('MST')):
            issues.append({'family': kind, 'issue': 'MST 불일치(최신본 존재 가능)',
                            'stored_MST': stored.get('MST'), 'current_MST': cur_mst,
                            'current_시행일자': cand.get('시행일자')})
    return issues


def check_admrul(meta, raw_rel):
    """위임고시 목록이 최신인지: 현재 위임고시 검색 결과 vs 저장된 _admrul.json 카탈로그."""
    fams = meta.get('families', {})
    fresh = {}
    for kind in ('법률', '시행령', '시행규칙'):
        f = fams.get(kind)
        if not f:
            continue
        for a in delegated_admrul(f['MST']):
            fresh[a['title']] = a['id']
        time.sleep(0.15)
    catalog_path = os.path.join('/home/user/SEAGNAL', raw_rel, '행정규칙', '_admrul.json')
    catalog = {}
    if os.path.exists(catalog_path):
        try:
            catalog = json.load(open(catalog_path, encoding='utf-8'))
        except Exception:
            pass
    # _admrul.json 카탈로그가 아예 없는 법(예: 표준 파이프라인 밖에서 별도 수집된 법)도 있어
    # 카탈로그만 보고 "미수집"이라 단정하면 오탐이 난다 — 폴더 안 실제 파일명과도 느슨하게 대조한다.
    admrul_dir = os.path.join('/home/user/SEAGNAL', raw_rel, '행정규칙')
    existing_files = os.listdir(admrul_dir) if os.path.isdir(admrul_dir) else []

    def norm(s):
        return ''.join(ch for ch in s if ch.isalnum())

    existing_norm = [norm(fn) for fn in existing_files]

    def file_exists_for(title):
        nt = norm(title)
        return any(nt in fn or fn in nt for fn in existing_norm if fn)

    issues = []
    for title, sid in fresh.items():
        stored = catalog.get(title)
        if not stored:
            if not file_exists_for(title):
                issues.append({'title': title, 'issue': '위임은 확인되나 미수집(신규)'})
            # 카탈로그엔 없지만 파일명은 비슷한 게 있음 -> 오탐 가능성 높아 보고 안 함(사람 확인 필요시 별도)
        elif str(stored.get('ID')) != str(sid):
            issues.append({'title': title, 'issue': 'ID 불일치(개정판 존재 가능)',
                            'stored_ID': stored.get('ID'), 'current_ID': sid})
    return issues, len(fresh)


def main():
    names = core_law_names()
    # 재개(resume): 컨테이너 재시작 등으로 중단됐을 때, 기존 리포트에 이미 있는 법은 다시 안 부른다.
    if os.path.exists(REPORT):
        try:
            report = json.load(open(REPORT, encoding='utf-8'))
            report.setdefault('법별결과', {})
        except Exception:
            report = {'생성': time.strftime('%Y-%m-%d %H:%M KST'), '대상법수': len(names), '법별결과': {}}
    else:
        report = {'생성': time.strftime('%Y-%m-%d %H:%M KST'), '대상법수': len(names), '법별결과': {}}
    done = set(report['법별결과'].keys())
    if done:
        print(f'재개: 이미 완료된 {len(done)}개 건너뜀', flush=True)
    stale_count = sum(1 for v in report['법별결과'].values()
                       if v.get('법률시행령시행규칙_이슈') or v.get('위임고시_이슈'))
    for i, name in enumerate(names):
        if name in done:
            continue
        meta, rel = search_law_family(name)
        if not meta:
            report['법별결과'][name] = {'오류': f'_meta.json 없음(경로: {rel})'}
            print(f'[{i+1}/{len(names)}] {name[:24]:24s} SKIP(meta없음)', flush=True)
            continue
        try:
            fam_issues = check_family_mst(meta)
            adm_issues, adm_total = check_admrul(meta, rel)
        except Exception as e:
            report['법별결과'][name] = {'오류': str(e)[:200]}
            print(f'[{i+1}/{len(names)}] {name[:24]:24s} 오류: {str(e)[:60]}', flush=True)
            time.sleep(0.3)
            continue
        entry = {'법률시행령시행규칙_이슈': fam_issues, '위임고시_총': adm_total, '위임고시_이슈': adm_issues}
        report['법별결과'][name] = entry
        n_issue = len(fam_issues) + len(adm_issues)
        if n_issue:
            stale_count += 1
        mark = '⚠' if n_issue else '✓'
        print(f'[{i+1}/{len(names)}] {name[:24]:24s} {mark} 이슈 {n_issue}건(법령{len(fam_issues)}+고시{len(adm_issues)})', flush=True)
        json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)  # 중간저장(중단 대비)
        time.sleep(0.3)
    report['이슈있는법수'] = stale_count
    json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'=== 완료: {len(names)}법 중 {stale_count}법에서 이슈 발견 → {REPORT} ===', flush=True)


if __name__ == '__main__':
    main()
