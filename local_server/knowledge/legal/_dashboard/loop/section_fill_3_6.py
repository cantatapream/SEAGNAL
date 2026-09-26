#!/usr/bin/env python3
"""3-6ⓐ — 표준 절 51자리를 채운다. **기계가 법 내용을 쓰지 않는다**(G-34).

[무엇] `_dashboard/section_fill_3_6.json` 의 선언을 읽어 네 가지 일만 한다.
  ① 이름만 고친다   — 내용은 이미 있고 절 이름이 규약과 다른 17자리(`## ★ 적용범위 (…)` 등).
                      ★여기에 원문을 새로 넣으면 **적용범위 절이 두 개**가 된다. 그래서 이름만 맞춘다.
  ② 원문을 옮긴다   — 법률 raw 의 그 조를 **운영 파서**(`article_text.extractArticleBlock`)로 꺼내
                      한 글자도 고치지 않고 코드블록에 넣는다. 16자리.
  ③ 없다고 적는다   — 그 법 본문에 적용범위 조가 **0건**인 6자리. 없는 조문을 지어내지 않는다.
  ④ 위임근거를 옮긴다 — 고시 머리줄 `위임근거:` 와 제1조(목적)이 가리키는 법·조를 표로 적는다. 12자리.

[왜 고시 조문을 원문 인용하지 않았나 — 2026-09-26 실측]
  고시 raw 12개 중 **7개가 PDF 전사**라 줄이 **낱말 중간에서 끊겨** 있다
  (`보통모양의 선` / `형 및 …` — 강선·FRP·선박만재흘수선·선박전기설비·알루미늄선·어선구조·어선복원성).
  줄을 기계로 이으면 「선 형」 이 되고, 안 이으면 낱말이 갈라진 채 남는다. **어느 쪽도 원문이 아니다.**
  그래서 고시 쪽은 **법·조 참조(표)** 만 옮긴다. 법률 raw 13개는 전부 정상폭이라(한낱말줄 ≤0.5%)
  원문 인용이 안전하다 — 그래서 ②는 법률에서만 한다.

[자리] 절 순서는 관행을 따른다 — 적용범위·제외 → 근거 조문 → 타법 연결 → 관련 개념 → 변경 이력
        (표준 절 4개 이상 가진 943쪽 중 905쪽이 이 순서다. 내가 정한 것이 아니다.)

[쓰는 법] python3 _dashboard/loop/section_fill_3_6.py            # 마른 실행(아무것도 안 쓴다)
          python3 _dashboard/loop/section_fill_3_6.py --apply    # 실제로 쓴다
          python3 _dashboard/loop/section_fill_3_6.py --check    # ★게이트가 부른다 — 옮긴 것이 아직 그대로인가

[--check 가 무엇을 보나] ★**옮긴 원문이 raw 와 한 글자도 다른지**를 본다. 자를 새로 만들지 않고
  **채울 때 쓴 것과 같은 길**(`extractArticleBlock`)로 다시 꺼내 위키 본문에 그 글자가 있는지 본다.
  그래서 raw 가 재수집돼 조문이 바뀌면 **빨간불**이 된다 — 위키가 낡은 원문을 「원문 그대로」라고
  말하고 있는 것이 드러난다. 이름만 고친 17자리는 옛 이름이 되살아났는지도 본다.
[연계] 선언 ← `_dashboard/section_fill_3_6.json` · 세는 자 → `_dashboard/loop/section_ready.js --list --all`
"""
import json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))   # …/legal
WIKI = os.path.join(ROOT, 'wiki')
RAW = os.path.join(ROOT, 'raw')
DECL = os.path.join(ROOT, '_dashboard', 'section_fill_3_6.json')
APPLY = '--apply' in sys.argv
CHECK = '--check' in sys.argv

# 절 순서(관행) — 새 절을 어디에 끼울지 정한다
ORDER = ['## 적용범위·제외', '## 근거 조문', '## 타법 연결', '## 관련 개념', '## 변경 이력']


def 법률파일(법):
    for g in sorted(os.listdir(RAW)):
        p = os.path.join(RAW, g, 법, '법률.txt')
        if os.path.exists(p):
            return p
    return None


def 고시파일들(고시):
    """★같은 고시가 **여러 법 폴더에 각각** 있다 (2026-09-26 실측).
    `선박구명설비기준` 은 선박안전법·유선및도선사업법 두 폴더에 있고 **고시 ID가 같다**
    (2100000271242) — 하나의 고시가 **두 법의 위임을 함께** 받고, 폴더마다 그 법의
    위임근거를 적어 둔 것이다(선박안전법 법률 제26조 / 유선및도선사업법 시행령 제17조제3항).
    ⚠먼저 만난 사본만 집으면 **상위법이 바뀌어 엉뚱한 법이 표에 적힌다** — 처음에 그렇게 틀렸다.
    그래서 사본을 **전부** 돌려준다. 표에는 사본마다 한 줄씩 적는다."""
    out = []
    for r, _d, fs in os.walk(RAW):
        if '행정규칙' not in r:
            continue
        if 고시 + '.txt' in fs:
            out.append(os.path.join(r, 고시 + '.txt'))
    return sorted(out)


def 조꺼내기(법, 조):
    """운영 파서를 부른다 — 자를 새로 만들지 않는다(L-136)."""
    f = 법률파일(법)
    if not f:
        return None, None
    js = json.dumps({'file': f, 'jo': 조}, ensure_ascii=False)
    code = (
        "const fs=require('fs');const at=require(process.argv[1]);"
        "const a=JSON.parse(process.argv[2]);"
        "const b=at.extractArticleBlock(fs.readFileSync(a.file,'utf8'),a.jo,'law');"
        "process.stdout.write(JSON.stringify(b||null));"
    )
    at = os.path.join(ROOT, '..', '..', 'services', 'article_text.js')
    out = subprocess.run(['node', '-e', code, os.path.abspath(at), js],
                         capture_output=True, text=True, cwd=os.path.join(ROOT, '..', '..', '..'))
    s = out.stdout.strip()
    i = s.rfind('{')
    if i < 0:
        return None, f
    try:
        return json.loads(s[i:]), f
    except Exception:
        return None, f


def 상대(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')


def 절끼우기(줄들, 절이름, 몸통):
    """관행 순서대로 절을 끼운다. 이미 있으면 건드리지 않는다."""
    heads = [(i, l.rstrip()) for i, l in enumerate(줄들) if l.startswith('## ')]
    for _i, h in heads:
        if h.startswith(절이름):
            return None
    k = ORDER.index(절이름)
    for 뒤 in ORDER[k + 1:]:
        for i, h in heads:
            if h.startswith(뒤):
                return i
    return len(줄들)


def main():
    d = json.load(open(DECL, encoding='utf-8'))
    if CHECK:
        나쁜것 = []
        for it in d['이름만_고친다']:
            t = open(os.path.join(WIKI, it['쪽']), encoding='utf-8').read()
            if it['새머리'] + '\n' not in t:
                나쁜것.append(f"①표준 이름이 없다 — {it['쪽']} · {it['새머리']}")
            if it['옛머리'] in t:
                나쁜것.append(f"①옛 이름이 되살아났다 — {it['쪽']} · {it['옛머리'][:36]}")
        for it in d['원문을_옮긴다']:
            t = open(os.path.join(WIKI, it['쪽']), encoding='utf-8').read()
            for 조 in it['조']:
                b, _f = 조꺼내기(it['법'], 조)
                if not b or not b.get('body'):
                    나쁜것.append(f"②raw 에서 그 조를 못 꺼낸다 — {it['법']} {조}")
                    continue
                if b['body'].rstrip() not in t:
                    나쁜것.append(f"②옮긴 원문이 raw 와 다르다 — {it['쪽']} · {it['법']} {조}")
        for it in d['없다고_적는다'] + d['위임근거를_옮긴다']:
            t = open(os.path.join(WIKI, it['쪽']), encoding='utf-8').read()
            if it['절'] + '\n' not in t:
                나쁜것.append(f"③④그 절이 없다 — {it['쪽']} · {it['절']}")
        print(f"  3-6 으로 채운 51자리 — 어긋남 {len(나쁜것)}")
        if 나쁜것:
            print("  ⚠하나도 빠짐없이 적는다(L-196)")
            for x in 나쁜것:
                print(f"     · {x}")
        return 1 if 나쁜것 else 0
    한것 = {'이름': 0, '원문': 0, '없다': 0, '위임': 0}
    막힌것 = []
    # 쪽마다 모아서 한 번에 쓴다(한 쪽에 두 자리가 있는 경우가 있다)
    바뀐쪽 = {}

    def 읽기(쪽):
        p = os.path.join(WIKI, 쪽)
        if 쪽 not in 바뀐쪽:
            바뀐쪽[쪽] = open(p, encoding='utf-8').read().split('\n')
        return 바뀐쪽[쪽]

    # ① 이름만 고친다
    for it in d['이름만_고친다']:
        L = 읽기(it['쪽'])
        try:
            i = next(n for n, l in enumerate(L) if l.rstrip() == it['옛머리'])
        except StopIteration:
            막힌것.append(f"① 옛머리를 못 찾았다 — {it['쪽']} · {it['옛머리'][:40]}")
            continue
        L[i:i + 1] = [it['새머리'], '', it['리드']]
        한것['이름'] += 1

    # ② 원문을 옮긴다
    for it in d['원문을_옮긴다']:
        L = 읽기(it['쪽'])
        at = 절끼우기(L, it['절'], None)
        if at is None:
            막힌것.append(f"② 그 절이 이미 있다 — {it['쪽']} · {it['절']}")
            continue
        몸통, 출처들, 막혔나 = [], [], False
        for 조 in it['조']:
            b, f = 조꺼내기(it['법'], 조)
            if not b or not b.get('body'):
                막힌것.append(f"② 조를 못 꺼냈다 — {it['법']} {조}")
                막혔나 = True
                break
            출처들.append(f"`{상대(f)}`")
            몸통 += [f"**{조}({b['title']})** — 원문 그대로"
                     + (f" (시행 {b['effectiveDate']})" if b.get('effectiveDate') else ''), '',
                     '```', b['body'].rstrip(), '```', '']
        if 막혔나:
            continue
        머리 = (f"> **원문 그대로 인용** — 아래는 「{it['법']}」 "
                + ' · '.join(it['조']) + "의 raw 원문을 한 글자도 고치지 않고 옮긴 것이다. "
                + f"출처: {' , '.join(sorted(set(출처들)))}")
        덩이 = [it['절'], '', 머리, ''] + 몸통
        if it.get('참고'):
            덩이 += [f"> ⚠**참고** — {it['참고']}", '']
        L[at:at] = 덩이
        한것['원문'] += 1

    # ③ 없다고 적는다
    for it in d['없다고_적는다']:
        L = 읽기(it['쪽'])
        at = 절끼우기(L, it['절'], None)
        if at is None:
            막힌것.append(f"③ 그 절이 이미 있다 — {it['쪽']} · {it['절']}")
            continue
        f = 법률파일(it['법'])
        L[at:at] = [it['절'], '',
                    f"> **이 법에는 적용범위 조가 없다** — 「{it['법']}」 법률 본문(부칙 제외) 전수에서 "
                    f"`적용범위`·`적용대상`·`적용제외` 를 제목에 담은 조를 찾았으나 **0건**이다 "
                    f"(2026-09-26 실측 · `{상대(f) if f else '법률.txt 없음'}`). "
                    f"**없는 조문을 지어내지 않는다.** 적용 여부는 이 쪽의 `## 근거 조문` 과 정의 조로 갈린다.", '']
        한것['없다'] += 1

    # ④ 위임근거를 옮긴다
    for it in d['위임근거를_옮긴다']:
        L = 읽기(it['쪽'])
        at = 절끼우기(L, it['절'], None)
        if at is None:
            막힌것.append(f"④ 그 절이 이미 있다 — {it['쪽']} · {it['절']}")
            continue
        파일들 = 고시파일들(it['고시'])
        if not 파일들:
            막힌것.append(f"④ 고시 raw 가 없다 — {it['고시']}")
            continue
        행들, 출처들, 어디서들 = [], [], []
        for f in 파일들:
            t = open(f, encoding='utf-8').read()
            상위법 = os.path.basename(os.path.dirname(os.path.dirname(f)))
            m = re.search(r'위임근거:\s*([^\n]+)', t)
            묶음 = {}          # (법, 계층) → [조]
            if m:
                for 칸 in m.group(1).split(';'):
                    # ★한 칸 안에 조가 둘 들어 있다 — `법률 제5조(제5조의2제1항)` 은 제5조와 제5조의2
                    #   둘을 가리킨다. 첫 것만 집으면 제5조의2 가 사라진다(어선설비기준에서 실측:
                    #   그 쪽 머리글은 스스로 「제3조·제5조·제5조의2 위임」 이라고 적고 있었다).
                    계층 = next((x for x in ('시행규칙', '시행령', '법률') if x in 칸), '법률')
                    for mm in re.finditer(r'제\d+조(?:의\d+)?', 칸):
                        묶음.setdefault((상위법, 계층), [])
                        if mm.group(0) not in 묶음[(상위법, 계층)]:
                            묶음[(상위법, 계층)].append(mm.group(0))
                어디서들.append('머리줄 `위임근거:`')
            if not 묶음:
                # ★머리줄에 `위임근거:` 가 없는 고시가 있다(어선구조기준 — 실측).
                #   그럴 때는 **제1조(목적)** 이 그것을 그대로 적고 있다: 「어선법」 제3조에 따른 …
                #   자를 넓히지 않고 **다른 자리를 본다** — 없는 것을 지어내지 않는다.
                m1 = re.search(r'제1조\s*\(목적\)([\s\S]{0,400})', t)
                if m1:
                    for mm in re.finditer(r'「([^」\n]{2,30})」\s*제(\d+)조(?:의(\d+))?', m1.group(1)):
                        조 = f"제{mm.group(2)}조" + (f"의{mm.group(3)}" if mm.group(3) else '')
                        k = (mm.group(1), '법률')
                        묶음.setdefault(k, [])
                        if 조 not in 묶음[k]:
                            묶음[k].append(조)
                    어디서들.append('제1조(목적) — 머리줄에 `위임근거:` 가 없는 고시다')
            if not 묶음:
                continue
            출처들.append(f"`{상대(f)}`")
            for (법, 계층), 조들 in 묶음.items():
                계층말 = '' if 계층 == '법률' else f" {계층}"
                행들.append(f"| 「{법}」{계층말} | {', '.join(조들)} | 이 고시의 **위임 근거** |")
        if not 행들:
            막힌것.append(f"④ 머리줄에도 제1조에도 위임근거 조가 없다 — {it['고시']}")
            continue
        여럿 = (' ★이 고시는 **법 폴더 두 곳에 같은 ID로** 있다 — 한 고시가 여러 법의 위임을 함께 받는다. 그래서 줄이 여럿이다.'
                if len(파일들) > 1 else '')
        L[at:at] = [it['절'], '',
                    f"> **위임 근거 — 원문에서 그대로 읽었다.** 이 고시는 아래 법 조문의 위임으로 만들어졌다. "
                    f"출처: {' , '.join(출처들)} 의 {' · '.join(sorted(set(어디서들)))} 줄.{여럿}", '',
                    '| 어느 법 | 어느 조 | 무엇으로 |', '|---|---|---|'] + 행들 + ['']
        한것['위임'] += 1

    print(f"  선언 51자리 — ①이름 {한것['이름']} · ②원문 {한것['원문']} · ③없다 {한것['없다']} · ④위임근거 {한것['위임']}"
          f"  = {sum(한것.values())}")
    if 막힌것:
        print(f"  ⚠막힌 것 {len(막힌것)}건 — 하나도 빠짐없이 적는다(L-196)")
        for x in 막힌것:
            print(f"     · {x}")
    if APPLY:
        for 쪽, L in 바뀐쪽.items():
            open(os.path.join(WIKI, 쪽), 'w', encoding='utf-8').write('\n'.join(L))
        print(f"  ✅ {len(바뀐쪽)}쪽에 썼다")
    else:
        print(f"  (마른 실행 — {len(바뀐쪽)}쪽을 고칠 것이다. 실제로 쓰려면 --apply)")
    return 1 if 막힌것 else 0


if __name__ == '__main__':
    sys.exit(main())
