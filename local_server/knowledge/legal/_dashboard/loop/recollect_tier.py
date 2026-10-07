#!/usr/bin/env python3
"""law_fresh.py 가 '구버전'으로 판정한 법률·시행령·시행규칙 층을 현행 판(MST)으로 다시 받아 raw 를 갱신한다.

[왜 있나 — 2026-09-10, 트랙 D]
행정규칙에는 `admrul_recollect_stale.py` 가 있는데 법률·시행령·시행규칙에는 "층 하나를 현행 MST 로
통째로 다시 받는" 도구가 없었다. 있는 것은 74법 전체를 다시 받는 `recollect_jomun.py`(조문만)·
`recollect_byl.py`(별표만)와 2건만 손으로 적어 둔 `recollect_stale_2.py` 뿐이다.
이 스크립트는 그 도구들의 변환 함수를 **import 해 그대로 재사용**하고(같은 파일 형식이 나오게),
조문 + 부칙 + 별표를 한 번에, 안전장치를 걸고, 고친 파일 목록을 남긴다.

[무엇을 하나 — 층 하나마다]
  ① law.go.kr `lawService.do?target=eflaw&MST=<현행>&efYd=<시행일자>` 로 **그 시행일자 기준** 전문 JSON 을 받는다.
     ★efYd 를 꼭 붙인다(2026-09-10 실측 두 가지):
       · efYd 없이 `target=eflaw` 로 **본문**을 부르면 HTTP **200** 과 함께
         "미신청된 목록/본문에 대한 접근입니다" HTML 이 온다. ⚠**권한 문제가 아니다** —
         efYd 가 빠졌거나 그 MST 의 실제 시행일자가 아니라는 뜻인데 문구가 그렇게 나올 뿐이다
         (2026-09-21 실측 확정. 맞는 efYd 를 주면 그 자리에서 JSON 이 온다). 이 문구를 보고
         "신청이 안 됐다"고 판단하면 안 된다 — 내가 두 번 그렇게 오진했다(L-294·L-295).
       · `target=law&MST=` 는 응답은 하지만 **시행일자를 못 고른다.** 한 MST 가 시행일 둘을 가질 때
         (해양환경관리법 시행규칙 287955 = 20260701 판 + 20260828 판 / 농수산물품질관리법 시행령 288973 =
         20260825 판 + 20270101 판) 옛 판이나 **시행예정 판**이 온다. 287955 를 law 로 받으면 부칙이 52개
         (2026.7.13 타법개정 부칙 없음), eflaw+efYd=20260828 로 받으면 53개다 — 후자가 현행이다.
       · law_fresh.py 가 준 `current.issued` 가 그 efYd 다. 응답의 `기본정보.시행일자` 가 efYd 와 다르면 중단.
     `조문제개정유형` 이 응답에 없으면(target=law 형식) 법 단위 `기본정보.제개정구분` 을 조마다 넣어 머리 형식을 지킨다.
  ② 조문 텍스트 = `recollect_jomun.build_text` · 부칙 = `recollect_budchik.format_budchik` 을 뒤에 붙인다.
     (부칙 저장 누락 사고 L-218·HANDOFF 2026-08-31 — 부칙이 응답에 있는데 파일에 없으면 실패로 친다.)
  ③ 별표 = `recollect_byl.extract_layer` 로 그 층 접두어(`시행규칙_별표N.txt`)만 다시 뽑고,
     `별표/_links.json` 은 그 층 키만 갈아끼운다(다른 층·사람이 넣은 키는 그대로).
  ④ 옛 판은 `_legacy/<법>/<옛시행일>/` 에 그대로 보관한다(조문 파일 + 그 층 별표 파일).
  ⑤ `_meta.json` 은 `families.<층>.MST` 와(법률이면) `시행일`·`별표수` 만 갱신하고 나머지 칸·순서·들여쓰기는 그대로.

[안전장치 — admrul_recollect_stale.py 와 같은 두 겹 + 하나]
  · 새 본문이 옛 본문의 70% 미만이면 보류(스텁 응답 방지, L-39).
  · 옛 파일에만 있는 사람 손의 흔적(【이미지판독】·⚠REVIEW·첨부파일 전사·판독불가)이 새 본문에 없으면 보류(L-176).
    ⚠법률 계열의 ⚠REVIEW 는 대개 "부칙 보완수집" 표시라 사람 전사가 아니다 — 눈으로 확인한 뒤
      `--allow-marks <법>/<층>` 으로 그 층만 풀어 준다. 자동으로 풀지 않는다.
  · 응답의 `기본정보.법령ID` 가 우리 `_meta.json` 의 법령ID 와 다르거나, `시행일자` 가 오늘보다 뒤면 중단(시행예정 판 방지).

[쓰는 법]
  python3 recollect_tier.py --report <law_fresh 결과 JSON> [--dry] [--only <법>/<층> ...] [--allow-marks <법>/<층> ...]
  python3 recollect_tier.py --one <법slug> <층> <현행MST> <시행일자> [--other]  # 보고서 없이 한 층만(--other = 15_관련타부처 폴더)

[연계] ← _dashboard/law_fresh_report.json(또는 --report) · raw/*/<법>/_meta.json
       → raw/*/<법>/<층>.txt · raw/*/<법>/별표/<층>_*.txt · 별표/_links.json · _meta.json
       → _legacy/<법>/<옛시행일>/ (옛 판 보관) · _dashboard/recollect_tier_report.json
       → _dashboard/touched/recollect_tier_<시각>.json (되돌릴 때 이 목록만)
"""
import glob, json, os, re, shutil, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                      # noqa: E402
from recollect_jomun import build_text            # noqa: E402
from recollect_budchik import format_budchik      # noqa: E402
from recollect_byl import extract_layer           # noqa: E402
import law_api_guard                 # law.go.kr 이 본문 대신 오류쪽을 줬는지 가린다(L-294)

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
LEGACY = os.path.join(LEGAL, '_legacy')
OUT = os.path.join(LEGAL, '_dashboard', 'recollect_tier_report.json')
OC = 'hyoo1431'
KST = timezone(timedelta(hours=9))
TIERS = ('법률', '시행령', '시행규칙')
HUMAN_MARKS = ['【이미지판독', '⚠REVIEW', '첨부파일 전사', '판독불가']


def api(url, tries=6):
    """DRF 를 부른다. 못 받으면 None. (프록시가 가끔 연결을 끊어 재시도가 필요하다 — 2026-09-10 실측)"""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    # ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속).
    #   종전에는 오류쪽 HTML 도 네트워크 오류와 똑같이 삼켜서
    #   **"권한 없음"이 "모르겠다"로 바뀌어** 나왔다.
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode('utf-8', 'replace')
            if body.lstrip()[:1] in '{[':
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None          # 재시도로 안 풀린다
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return None


def fetch_law(mst, efyd):
    """현행 MST 의 efYd(시행일자) 기준 전문. 예: fetch_law('287955', '20260828') → {'기본정보':…, '조문':…, '부칙':…, '별표':…}"""
    # ★`efYd` 는 **선택이 아니라 필수**다 (2026-09-21 실측으로 확정).
    #   `lawService.do?target=eflaw` 는 efYd 가 **없거나 그 MST 의 실제 시행일자가 아니면**
    #   HTTP **200** 과 함께 *"미신청된 목록/본문에 대한 접근입니다."* HTML 을 준다.
    #   ⚠**이 문구를 권한 문제로 읽으면 안 된다.** 같은 MST 에 맞는 efYd 를 주면 그 자리에서
    #     JSON 이 온다 — 선박안전법 246611+20230628 → 177,917 B, 항만법 283707+20260227 → 198,849 B.
    #     즉 **신청은 돼 있다.** law.go.kr 이 "인자가 틀렸다"를 "미신청"이라고 말할 뿐이다.
    #   (내가 이 문구를 두 번 오진했다 — 처음엔 "호스트 불통", 다음엔 "eflaw 미신청". L-294·L-295)
    d = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=eflaw&type=JSON&MST=%s&efYd=%s' % (OC, mst, efyd))
    return (d or {}).get('법령')


def find_raw_dir(slug, other=False):
    """법 폴더. 기본은 15_관련타부처(발췌 위주 폴더)를 뺀다 — law_fresh.py 와 같은 범위.
    other=True 면 15_관련타부처 안의 폴더를 쓴다(전문을 받아 둔 타법을 --one 으로 갱신할 때만)."""
    hits = [os.path.dirname(p) for p in glob.glob(os.path.join(RAW, '*', slug, '_meta.json'))
            if ('15_관련타부처' in p) == other]
    return hits[0] if len(hits) == 1 else None


def old_effective_date(text, fallback):
    m = re.search(r'\(시행 (\d{8})', text)
    return m.group(1) if m else fallback


def detect_indent(raw):
    for ln in raw.split('\n')[1:3]:
        n = len(ln) - len(ln.lstrip(' '))
        if n:
            return n
    return 2


def make_text(law):
    """조문 + 부칙. 기존 파일 형식(recollect_jomun + recollect_budchik)과 같다."""
    info = law.get('기본정보') or {}
    kind = str(info.get('제개정구분') or '')
    units = law.get('조문', {}).get('조문단위')
    units = units if isinstance(units, list) else ([units] if units else [])
    for a in units:
        if isinstance(a, dict) and not a.get('조문제개정유형') and kind:
            a['조문제개정유형'] = kind
    txt = build_text({'법령': {'조문': {'조문단위': units}}})
    if not txt:
        return None, False
    bu = law.get('부칙') or {}
    budchik = format_budchik(bu) if bu else None
    if budchik:
        txt = txt.rstrip('\n') + '\n\n' + budchik
    return txt, bool(bu and (bu.get('부칙단위')))


def do_one(slug, tier, new_mst, efyd, touched, dry, allow_marks, held_mst=None, other=False, byl=True, force=False):
    base = find_raw_dir(slug, other)
    if not base:
        return {'slug': slug, 'tier': tier, 'status': '폴더없음'}
    mp = os.path.join(base, '_meta.json')
    meta_raw = open(mp, encoding='utf-8').read()
    meta = json.loads(meta_raw)
    fam = (meta.get('families') or {}).get(tier)
    if not isinstance(fam, dict):
        return {'slug': slug, 'tier': tier, 'status': 'families에 층 없음'}
    old_mst = str(fam.get('MST') or '')
    if held_mst and old_mst != str(held_mst):
        return {'slug': slug, 'tier': tier, 'status': '보류(meta MST %s ≠ 보고서 %s)' % (old_mst, held_mst)}
    # ★MST 가 같아도 같은 판이 아닐 수 있다 (2026-09-10 실측, 해양환경관리법 시행령).
    #   한 MST 가 시행일 여러 개로 등재되는 경우가 있다 — MST 287499 는 20260630·20260701·20260828
    #   세 시행일을 갖고, 우리 파일은 20260701 판이었는데 현행은 20260828 판이다(제89조⑥ 삭제 등).
    #   MST 만 비교하면 '이미 현행'으로 지나쳐 개정이 영원히 안 잡힌다. 파일 안의 시행일도 본다.
    _path = os.path.join(base, tier + '.txt')
    _old_txt = open(_path, encoding='utf-8').read() if os.path.exists(_path) else ''
    _old_eff = old_effective_date(_old_txt, meta.get('시행일'))
    # force=True 면 같은 판이라도 다시 받는다 (2026-10-07, 3-85) — 판은 맞는데 **옛 수집 형식이라 목·조가 빠진** 파일
    #   (지방행정제재법 시행령: 목 4/7 · 조 37/42). 안전장치(70%·사람손)는 그대로 건다.
    if old_mst == str(new_mst) and str(_old_eff or '') == str(efyd) and not force:
        return {'slug': slug, 'tier': tier, 'status': '이미 현행'}

    law = fetch_law(new_mst, efyd)
    if not law:
        return {'slug': slug, 'tier': tier, 'status': '응답없음', 'new_mst': new_mst}
    info = law.get('기본정보') or {}
    today = datetime.now(KST).strftime('%Y%m%d')
    if str(info.get('법령ID') or '') != str(fam.get('법령ID') or ''):
        return {'slug': slug, 'tier': tier, 'status': '중단(법령ID 불일치 %s≠%s)' % (info.get('법령ID'), fam.get('법령ID'))}
    eff = str(info.get('시행일자') or '')
    if eff != str(efyd):
        return {'slug': slug, 'tier': tier, 'status': '중단(응답 시행일자 %s ≠ 요청 efYd %s)' % (eff, efyd)}
    if eff > today:
        return {'slug': slug, 'tier': tier, 'status': '중단(시행예정 판 %s)' % eff}

    new_txt, api_has_budchik = make_text(law)
    if not new_txt:
        return {'slug': slug, 'tier': tier, 'status': '조문 파싱 실패'}
    if api_has_budchik and '\n부칙\n' not in new_txt:
        return {'slug': slug, 'tier': tier, 'status': '중단(부칙이 응답에 있는데 본문에 안 붙음)'}

    path = os.path.join(base, tier + '.txt')
    old_txt = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    rec = {'slug': slug, 'tier': tier, 'old_mst': old_mst, 'new_mst': str(new_mst),
           'old_eff': old_effective_date(old_txt, meta.get('시행일')), 'new_eff': eff,
           'old_chars': len(old_txt), 'new_chars': len(new_txt),
           'old_has_budchik': '\n부칙\n' in old_txt, 'new_has_budchik': '\n부칙\n' in new_txt}
    if old_txt and len(new_txt) < len(old_txt) * 0.7:
        rec['status'] = '보류(본문축소)'
        return rec
    lost = [m for m in HUMAN_MARKS if m in old_txt and m not in new_txt]
    key = '%s/%s' % (slug, tier)
    if lost and key not in allow_marks:
        rec['status'] = '보류(사람작업 소실)'
        rec['lost_marks'] = lost
        return rec
    if lost:
        rec['allowed_marks'] = lost

    # 별표 — 이 층 접두어 파일만
    bdir = os.path.join(base, '별표')
    old_byl = sorted(f for f in (os.listdir(bdir) if os.path.isdir(bdir) else [])
                     if f.startswith(tier + '_') and f.endswith('.txt'))
    byl_units = (law.get('별표') or {}).get('별표단위') if isinstance(law.get('별표'), dict) else None
    byl_marks = [f for f in old_byl
                 if any(m in open(os.path.join(bdir, f), encoding='utf-8', errors='replace').read() for m in HUMAN_MARKS)]
    if byl_marks and key not in allow_marks:
        rec['status'] = '보류(별표에 사람작업)'
        rec['byl_marks'] = byl_marks
        return rec
    rec['old_byl'] = len(old_byl)

    # 옛 판 보관
    legacy_dir = os.path.join(LEGACY, slug, rec['old_eff'] or 'unknown')
    rec['legacy'] = os.path.relpath(legacy_dir, LEGAL)
    if not dry:
        os.makedirs(legacy_dir, exist_ok=True)
        if old_txt:
            shutil.copy2(path, os.path.join(legacy_dir, tier + '.txt'))
            touched.add(os.path.join(legacy_dir, tier + '.txt'))
        if byl and old_byl:                       # 별표를 안 바꾸면(byl=False) 옛 별표를 따로 보관할 까닭이 없다
            os.makedirs(os.path.join(legacy_dir, '별표'), exist_ok=True)
            for f in old_byl:
                shutil.copy2(os.path.join(bdir, f), os.path.join(legacy_dir, '별표', f))
                touched.add(os.path.join(legacy_dir, '별표', f))
        # 조문+부칙
        open(path, 'w', encoding='utf-8').write(new_txt)
        touched.add(path)
        # 별표
        # ★byl=False 면 별표는 손대지 않는다 (2026-10-07, 3-85). 원문결손(목 누락) 7건을 고칠 때 쓴다 —
        #   `15_관련타부처` 의 타법 폴더에 그 층 별표를 통째로 새로 들이면 일이 「목 되찾기」 를 넘어선다.
        if byl and byl_units:
            for f in old_byl:
                os.remove(os.path.join(bdir, f))
                touched.add(os.path.join(bdir, f))
            lp = os.path.join(bdir, '_links.json')
            links = json.load(open(lp, encoding='utf-8')) if os.path.exists(lp) else {}
            links = {k: v for k, v in links.items() if not k.startswith(tier + ' ')}
            n = extract_layer({'법령': law}, tier, bdir, links)
            json.dump(links, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            touched.add(lp)
            for f in os.listdir(bdir):
                if f.startswith(tier + '_') and f.endswith('.txt'):
                    touched.add(os.path.join(bdir, f))
            rec['new_byl'] = n
            # ★같은 별표를 **계층 접두 없이** 들고 있는 폴더가 있다(`별표19.txt`). 이 도구는
            #   `<계층>_별표N.txt` 만 세고 쓰므로, 그런 폴더에서는 "별표가 3개뿐"으로 잘못 세고
            #   나머지를 **중복으로 새로 쓴다**(2026-09-10 해양환경관리법 시행령에서 17쌍이 그랬다).
            #   읽는 쪽(services/article_text.js)은 접두 파일을 먼저 보므로 동작에는 문제가 없지만,
            #   증감 숫자를 그대로 "새로 확보"라고 읽으면 틀린다. 지우지 않고 **사실만 남긴다.**
            twins_same, twins_diff = [], []
            for f in sorted(os.listdir(bdir)):
                if not (f.startswith(tier + '_별표') and f.endswith('.txt')):
                    continue
                bare = os.path.join(bdir, f[len(tier) + 1:])
                if not os.path.exists(bare):
                    continue
                def _body(q):
                    return '\n'.join(open(q, encoding='utf-8', errors='replace').read().split('\n')[2:]).strip()
                (twins_same if _body(os.path.join(bdir, f)) == _body(bare) else twins_diff).append(f)
            if twins_same or twins_diff:
                rec['bare_twins'] = {'same': twins_same, 'diff': twins_diff}
                rec['byl_note'] = ('접두 없는 같은 이름 별표 파일이 %d개 있다(본문 같음 %d · 다름 %d) — '
                                   'new_byl 증가분을 "새로 확보"로 읽지 말 것. 정리는 사람 판단.'
                                   % (len(twins_same) + len(twins_diff), len(twins_same), len(twins_diff)))
        elif old_byl:
            rec['new_byl'] = None
            rec['byl_note'] = '응답에 별표가 없어 옛 별표 파일 %d개를 그대로 두었다(사람 확인 필요)' % len(old_byl)
        # meta
        fam['MST'] = str(new_mst)
        if tier == '법률':
            meta['시행일'] = eff
        if byl_units:
            cnt = len([f for f in os.listdir(bdir) if f.endswith('.txt') and re.match(r'^(법률|시행령|시행규칙)_', f)])
            meta['별표수'] = cnt
        note_key = '신선도재수집'
        note = '%s %s MST %s→%s(시행 %s→%s) recollect_tier.py' % (
            datetime.now(KST).strftime('%Y-%m-%d'), tier, old_mst, new_mst, rec['old_eff'], eff)
        meta[note_key] = (meta[note_key] + ' / ' + note) if meta.get(note_key) else note
        open(mp, 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False, indent=detect_indent(meta_raw)))
        touched.add(mp)
    rec['status'] = '갱신' if not dry else '갱신(dry)'
    return rec


def main():
    argv = sys.argv[1:]
    dry = '--dry' in argv
    def vals_after(flag):
        out = []
        if flag in argv:
            for x in argv[argv.index(flag) + 1:]:
                if x.startswith('--'):
                    break
                out.append(x)
        return out
    allow = set(vals_after('--allow-marks'))
    only = set(vals_after('--only'))
    jobs = []
    if '--one' in argv:
        i = argv.index('--one')
        jobs.append((argv[i + 1], argv[i + 2], argv[i + 3], argv[i + 4], None))
    else:
        rp = argv[argv.index('--report') + 1] if '--report' in argv else os.path.join(LEGAL, '_dashboard', 'law_fresh_report.json')
        rep = json.load(open(rp, encoding='utf-8'))
        for r in rep['rows']:
            if r.get('verdict') != '구버전':
                continue
            key = '%s/%s' % (r['slug'], r['tier'])
            if only and key not in only:
                continue
            jobs.append((r['slug'], r['tier'], r['current']['serial'], r['current']['issued'], (r.get('held_ids') or [None])[0]))
    touched = Touched('recollect_tier')
    results = []
    print('대상 %d층 (dry=%s)' % (len(jobs), dry))
    for slug, tier, mst, efyd, held in jobs:
        rec = do_one(slug, tier, mst, efyd, touched, dry, allow, held, other='--other' in argv)
        results.append(rec)
        print(' · %-40s %-5s %s' % (slug[:40], tier, rec['status']), flush=True)
        time.sleep(0.3)
    if not dry:
        prev = []
        if os.path.exists(OUT):
            try:
                prev = json.load(open(OUT, encoding='utf-8')).get('runs', [])
            except Exception:
                prev = []
        prev.append({'ran_at': datetime.now(KST).strftime('%Y-%m-%d %H:%M KST'), 'results': results})
        json.dump({'runs': prev}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    touched.save()
    from collections import Counter
    print(Counter(r['status'] for r in results))


if __name__ == '__main__':
    main()
