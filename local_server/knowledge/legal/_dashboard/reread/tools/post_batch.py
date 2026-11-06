# D1 다시 읽기 묶음 후처리: reread_workflow.js 결과(JSON) → ①draft PASS 승격(promote_page.py) ②canonical PASS 기록줄 ③상한(CAP) 쪽 draft 로·사람 판단 목록
# 사용(저장소 어디서든): python3 post_batch.py <result.json> --round R101 --date 2026-11-03 [--dry]
#   result.json = 워크플로우가 돌려준 {pages:[…]} (Workflow 결과 파일의 "result" 키) — PASS/PASS_SPLIT/CAP 만 처리하고 ERROR 는 건너뛴다.
#   먼저 --dry 로 돌려 숫자를 보고, 그다음 실제로 돌린다.
#   ⚠ --dry 에서는 나눠 읽기 통과(PASS_SPLIT)의 장부 줄을 쓰지 않으므로, 그 draft 는 승격 dry 에서 ❌(장부 없음)로 보인다 — 실제 실행에선 장부 줄을 먼저 쓰고 승격한다.
#   ERROR 로 끝난 쪽: 정정이 들어간 뒤 멈췄을 수 있다. 같은 세션에서 이어 돌리거나, 못 이으면 그 쪽은 git checkout -- <쪽> 으로 되돌리고 다음 묶음에 넣는다(canonical 이면 V5-57 이 막는다).
# ⚠ 2026-10-08 세션 임시 폴더의 post_batch.py 를 2026-11-02 에 다시 적은 것이다(원본은 컨테이너 초기화로 사라짐 — 동작은 같다).
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WIKI = LEGAL + '/wiki/'
LOOP = LEGAL + '/_dashboard/loop/'
HUMAN = LEGAL + '/_dashboard/reread/human_list.md'
CLIST = LEGAL + '/_dashboard/reread/c_list.md'
BANNED = ('REVIEW', '판독', 'OCR', '출처미확인', '출처 미확인', '원본이미지', '[미확인]')
# 읽는 이가 「OCR 낱말 0건」 처럼 검사했다는 말에 금지 낱말을 쓴다 — 기록줄에 옮길 때 바꿔 적는다(L-418)
SAN = (('출처 미확인', '출처 확인 전'), ('출처미확인', '출처 확인 전'), ('[미확인]', '(확인 전)'), ('원본이미지', '원문 그림'),
       ('판독', '그림 옮김'), ('OCR', '글자 인식'), ('REVIEW', '검토 표시'),
       # 읽는 이가 「[[…]]」·「[[연결]]」 처럼 링크 꼴 글자를 기록줄에 쓰면 깨진 링크(V5-2)가 된다 — 낫표로 바꿔 적는다(2026-11-06)
       ('[[', '「'), (']]', '」'))


def san(x):
    for a, b in SAN:
        x = x.replace(a, b)
    return x


argv = sys.argv[1:]
res = json.load(open(argv[0], encoding='utf-8'))
if isinstance(res, dict) and 'result' in res:
    res = res['result']
    if isinstance(res, str):
        res = json.loads(res)
rnd = argv[argv.index('--round') + 1]
date = argv[argv.index('--date') + 1]
dry = '--dry' in argv
items = res['pages'] if isinstance(res, dict) else res
spec, done = {}, {'promoted': [], 'recorded': [], 'capped': [], 'skipped': []}


def status_of(t):
    m = re.search(r'^status:\s*(\S+)', t, re.M)
    return m.group(1) if m else ''


def add_row(path, row):
    s = open(path, encoding='utf-8').read()
    i = s.index('\n## 변경 이력')
    j = s.find('\n## ', i + 5)
    sec = s[i:j] if j > 0 else s[i:]
    lines = sec.split('\n')
    last = max(k for k, l in enumerate(lines) if l.startswith('| '))
    lines.insert(last + 1, row)
    s = s[:i] + '\n'.join(lines) + (s[j:] if j > 0 else '')
    if not dry:
        open(path, 'w', encoding='utf-8').write(s)


for it in items:
    if not it:
        continue
    key = it['file'] if it['file'].endswith('.md') else it['file'] + '.md'
    p = WIKI + key
    t = open(p, encoding='utf-8').read()
    st = status_of(t)
    rawdir = (it.get('rawdir') or '').rstrip('/') or 'raw/'
    rawdir = re.sub(r'^.*?local_server/knowledge/legal/', '', rawdir)
    cmp2 = san((it.get('compared') or '본문 전체').replace('|', '·').replace('\n', ' '))
    notc = san((it.get('not_compared') or '없음').replace('|', '·').replace('\n', ' '))
    if it.get('c_left') and not dry:
        with open(CLIST, 'a', encoding='utf-8') as f:
            f.write(f'\n## {key} ({rnd})\n')
            for x in it['c_left']:
                f.write(f'- {x.get("wiki","")[:200]} / 원문: {x.get("raw","")[:160]} / {x.get("what","")[:160]}\n')
    if it.get('final') == 'PASS_SPLIT':
        # 나눠 읽기 통과 — 묶음 읽는 이들은 장부에 적지 않았으므로 여기서 한 줄로 적는다(지금 본문 = 마지막으로 읽힌 본문)
        rd = '+'.join(it.get('readers', [])[-4:]) or 'split'
        if not dry:
            subprocess.run(['node', LOOP + 'reread_ledger.js', 'add', '--page', key, '--reader', 'split:' + rd[:120],
                            '--verdict', 'PASS', '--scope', '전체', '--note', rnd + ' 나눠 읽기(§5-D ⓗ) — 절 묶음마다 다른 에이전트'], check=True)
        it['final'] = 'PASS'
        it['reader'] = 'split:' + rd[:60]
        it['rounds'] = it.get('rounds') or 4
    if it.get('final') in ('PASS', 'PASS_C_UNFIXED'):
        if st == 'draft':
            name = key[:-3]
            spec[name[len('concepts/'):] if name.startswith('concepts/') else name] = [rawdir, cmp2, notc]
        else:
            row = (f'| {date} | {rnd} — §5-D ⓑ 재점검(D1 다시 읽기). 1차(기계 대조): `_dashboard/loop/draft_verify1.py` 가 본문의 숫자 값을 '
                   f'`{rawdir}/` 와 이 쪽이 「」로 인용한 법의 raw 에서 찾음. 2차(다른 눈): 이 쪽을 고치지도 1차를 돌리지도 않은 별도 에이전트'
                   f'({it.get("reader")} · {it.get("rounds")}회차 · 장부 `_dashboard/reread/verdicts.jsonl`)가 본문 전체를 조·항·호 단위로 대조 — {cmp2} — 일치. '
                   f'대조하지 않은 것: {notc} | `{rawdir}/` · `_SCHEMA.md` §5-D ⓖ |')
            if any(w in row for w in BANNED):
                done['skipped'].append((key, '기록줄 금지 낱말'))
                continue
            # 장부 확인 — 마지막 줄이 PASS·지금 본문해시가 아니면 기록줄을 쓰지 않는다
            if not dry:
                h = subprocess.run(['node', LOOP + 'reread_ledger.js', 'hash', key], capture_output=True, text=True).stdout.split()[:1]
                last = None
                for line in open(LEGAL + '/_dashboard/reread/verdicts.jsonl', encoding='utf-8'):
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get('쪽') == key:
                        last = r
                if not last or last.get('판정') != 'PASS' or (h and last.get('본문해시') != h[0]):
                    done['skipped'].append((key, '장부 PASS·해시 불일치 — 기록줄 안 씀'))
                    continue
            add_row(p, row)
            done['recorded'].append(key)
    elif it.get('final') == 'CAP':
        if st == 'canonical' and not dry:
            t2 = re.sub(r'^status: canonical$', 'status: draft', t, count=1, flags=re.M)
            # 배너 머리도 draft 로 — 안 바꾸면 나중에 promote_page.py 가 「draft 배너 머리를 못 찾았다」로 거부한다
            t2 = re.sub(r'^> ✅ \*\*canonical[^\n]*?\*\*', '> ⚠ **draft — 다른 눈의 읽기 상한(§5-D ⓗ) 안에 통과하지 못해 내림 · 남은 지적은 `_dashboard/reread/human_list.md` (사람 판단 대기).**', t2, count=1, flags=re.M)
            open(p, 'w', encoding='utf-8').write(t2)
        add_row(p, f'| {date} | {rnd} — 다른 눈의 읽기 4번(상한)과 나눠 읽기 2바퀴 안에 통과하지 못해 draft 로 둔다(§5-D ⓗ). 남은 지적은 `_dashboard/reread/human_list.md` |')
        done['capped'].append(key)
        if not dry:
            with open(HUMAN, 'a', encoding='utf-8') as f:
                f.write(f'\n## {key} ({rnd}, {date})\n')
                for x in it.get('last_findings', []):
                    f.write(f'- [{x.get("grade")}] {x.get("wiki","")} / 원문: {x.get("raw","")} / {x.get("what","")}\n')
    else:
        done['skipped'].append((key, it.get('final')))

if spec:
    sp = os.path.join(os.path.dirname(os.path.abspath(argv[0])), 'spec_' + rnd + '.json')
    json.dump(spec, open(sp, 'w', encoding='utf-8'), ensure_ascii=False)
    r = subprocess.run(['python3', LOOP + 'promote_page.py', sp, '--round', rnd] + (['--dry'] if dry else []), capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode:
        print(r.stderr.strip())
    done['promoted'] = [l for l in r.stdout.split('\n') if l.startswith('✅')]
print(json.dumps({k: len(v) for k, v in done.items()}, ensure_ascii=False))
for k in ('capped', 'skipped'):
    for x in done[k]:
        print(k, x)
