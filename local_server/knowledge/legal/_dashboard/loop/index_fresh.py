#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5-0 계기판 최신성 — **내용으로 잰다** (2026-09-23 고쳐 세움, G-19)

[왜 다시 세웠나]
  옛 V5-0 은 `find wiki -newer index.json` 즉 **파일 수정시각(mtime)** 으로 쟀다.
  그런데 git 은 mtime 을 보존하지 않는다. 새 체크아웃에서는 모든 파일이 체크아웃
  시각을 갖고 누가 먼저 쓰였느냐는 순전히 쓰기 순서다 — CI run #3 에서
  "위키 1,287장이 색인보다 새롭다"가 나왔고 색인은 멀쩡했다.
  그래서 **CI 에서는 이 검사를 통째로 건너뛰고 있었다.**

  건너뛴 자리는 비어 있지 않았다. `legal-index-sync.yml` 이 대신 지킨다. 실제로
  지금까지 **26번** 색인을 다시 만들어 커밋했다 — 낡는 일은 정말 일어난다.
  ⚠그러나 그 워크플로는 게이트와 **같은 푸시에서 나란히** 돈다. 즉 그 푸시의
  게이트 실행은 **낡은 색인을 읽은 채** V5-7·V5-8·V5-10 을 재고 초록불을 낸다.
  고쳐지는 것은 그 다음 커밋이다. "변화 없음"이 **안 보고 있음**인 그 병(L-209)이
  CI 에서만 살아 있었던 셈이다.

[무엇으로 바꿨나]
  **다시 만들어 보고 저장된 것과 같은지 본다.** 재생성은 결정적이고 값싸다
  (실측: lint_index 1.05초 · lint_build 1.61초 · 다섯 생성물 모두 바이트 동일).
  mtime 과 달리 **CI 와 로컬이 같은 답**을 준다 — 자가 하나다(뿌리 사슬 ⑥).

[트리를 바꾸지 않는다]
  생성물 다섯 개를 먼저 옆에 치워 두고, 다시 만들고, 비교한 뒤, **결과와 무관하게
  원래대로 되돌린다.** 중간에 죽어도 되돌아가도록 finally 에 넣었다.
  검증이 트리를 바꾸면 안 된다 — 이 규칙은 옛 V5-0 이 세운 것이고 그대로 지킨다.
"""
import os, shutil, subprocess, sys, tempfile

LEGAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
LEGAL = os.path.abspath(LEGAL)
DASH  = os.path.join(LEGAL, '_dashboard')
WIKI  = os.path.join(LEGAL, 'wiki')
LOOP  = os.path.join(DASH, 'loop')

# `legal-index-sync.yml` 이 커밋하는 것과 **같은 목록**이어야 한다.
# 여기서 갈라지면 워크플로가 고치는 것과 게이트가 재는 것이 달라진다.
GENERATED = [
    os.path.join(DASH, 'index.json'),
    os.path.join(DASH, 'lint_report.json'),
    os.path.join(WIKI, 'graph.json'),
    os.path.join(WIKI, '_backbone.md'),
    os.path.join(DASH, 'build_index.md'),
]
MAKERS = [os.path.join(LOOP, 'lint_index.py'), os.path.join(LOOP, 'lint_build.py')]


def check():
    """되돌려 놓은 뒤 (달라진 생성물, 재생성 실패 메시지) 를 돌려준다."""
    tmp = tempfile.mkdtemp(prefix='v5_0_')
    saved = {}
    try:
        for f in GENERATED:
            if os.path.exists(f):
                d = os.path.join(tmp, os.path.basename(f))
                shutil.copy2(f, d)
                saved[f] = d
        for m in MAKERS:
            r = subprocess.run([sys.executable, m], capture_output=True, text=True, cwd=LEGAL)
            if r.returncode != 0:
                return [], f'{os.path.basename(m)} 가 실패했다 (종료코드 {r.returncode})\n{r.stderr[-800:]}'
        stale = []
        for f in GENERATED:
            old = saved.get(f)
            if old is None:
                # 저장소에 없던 것이 새로 생겼다 = 색인을 아예 안 담았다
                if os.path.exists(f):
                    stale.append((f, '저장소에 없다'))
                continue
            if open(old, 'rb').read() != open(f, 'rb').read():
                a, b = os.path.getsize(old), os.path.getsize(f)
                stale.append((f, f'{a:,}바이트 → 다시 만드니 {b:,}바이트'))
        return stale, None
    finally:
        # ★결과와 무관하게 되돌린다. 검증이 트리를 바꾸면 안 된다.
        for f, d in saved.items():
            shutil.copy2(d, f)
        for f in GENERATED:
            if f not in saved and os.path.exists(f):
                os.remove(f)
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    stale, err = check()
    if err:
        print(f'  ❌ 색인을 다시 만들어 볼 수 없었다 — {err}')
        return 1
    if not stale:
        print(f'  ✅ 색인이 위키와 맞다 — 생성물 {len(GENERATED)}개를 다시 만들어 대조했다(내용 기준)')
        print('     아래 V5-7·V5-8·V5-10 은 현재 상태를 재고 있다')
        return 0
    print(f'  ❌ 색인이 위키보다 낡았다 — 다시 만드니 {len(stale)}개가 달라진다')
    for f, why in stale:
        print(f'     · {os.path.relpath(f, LEGAL)}  ({why})')
    print('     ⚠이 상태에서는 V5-7(골든체인)·V5-8(링크 도달성)·V5-10(한쪽만 걸린 링크)이')
    print('       **낡은 자료를 재고 있어 숫자를 믿을 수 없다.**')
    print('     고치려면: python3 local_server/knowledge/legal/_dashboard/loop/lint_index.py \\')
    print('            && python3 local_server/knowledge/legal/_dashboard/loop/lint_build.py')
    print('     그리고 다시 만든 생성물을 **소스와 같은 커밋에 담는다**(L-209).')
    return 1


if __name__ == '__main__':
    sys.exit(main())
