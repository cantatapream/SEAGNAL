#!/usr/bin/env python3
"""파일을 고치는 스크립트가 "내가 고친 파일"을 한 곳에 남기게 하는 작은 도구.

왜 필요한가 (L-171·L-179):
  여러 에이전트가 동시에 도는 중에 오케스트레이터가 `git add -A` 로 남의 미완성 작업을
  커밋에 쓸어담았고(2회), `git checkout -- <디렉토리>` 로 남의 완성 작업을 지웠다(1회).
  둘 다 원인이 같다 — **되돌릴/담을 대상을 "디렉토리"로 잡았기 때문**이다.
  스크립트가 자기가 고친 파일을 정확히 남겨 두면, 그 목록만 골라 담거나 되돌릴 수 있다.

쓰는 법(스크립트 쪽):
    from _touched import Touched
    touched = Touched('admrul_recollect_stale')     # 이름은 아무거나(파일명에 들어간다)
    ...
    open(path, 'w').write(new)
    touched.add(path)
    ...
    touched.save()          # 끝날 때 한 번. 경로와 건수를 화면에도 찍는다.

쓰는 법(사람/오케스트레이터 쪽):
    python3 _touched.py --list                 최근 기록 보기
    python3 _touched.py --revert <기록파일>     그 기록의 파일들만 git checkout 으로 되돌린다
                                               (디렉토리째 되돌리지 않는다)

기록 위치: _dashboard/touched/<이름>_<타임스탬프>.json
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
OUTDIR = os.path.join(LEGAL, '_dashboard', 'touched')


class Touched:
    """고친 파일 경로를 모아 두었다가 파일로 남긴다."""

    def __init__(self, name, stamp=None):
        self.name = name
        self.stamp = stamp or _stamp()
        self.paths = []

    def add(self, path):
        p = os.path.abspath(path)
        if p not in self.paths:
            self.paths.append(p)

    def save(self):
        if not self.paths:
            print('[touched] 고친 파일 없음 — 기록을 남기지 않는다.')
            return None
        os.makedirs(OUTDIR, exist_ok=True)
        out = os.path.join(OUTDIR, '%s_%s.json' % (self.name, self.stamp))
        rel = [os.path.relpath(p, REPO) for p in self.paths]
        json.dump({'script': self.name, 'stamp': self.stamp, 'files': rel},
                  open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n[touched] 이 실행이 고친 파일 %d개 → %s' % (len(rel), os.path.relpath(out, REPO)))
        print('[touched] 되돌리려면: python3 %s --revert %s'
              % (os.path.relpath(__file__, REPO), os.path.relpath(out, REPO)))
        return out


def _stamp():
    """타임스탬프. 스크립트 안에서 Date/random 을 못 쓰는 환경도 있어 git 시각을 쓴다."""
    r = subprocess.run(['git', '-C', REPO, 'log', '-1', '--format=%cd', '--date=format:%Y%m%d-%H%M%S'],
                       capture_output=True, text=True)
    base = r.stdout.strip() or 'unknown'
    n = 0
    if os.path.isdir(OUTDIR):
        n = len([f for f in os.listdir(OUTDIR) if f.endswith('.json')])
    return '%s-%03d' % (base, n)


def main():
    if '--list' in sys.argv:
        if not os.path.isdir(OUTDIR):
            print('기록 없음'); return
        for f in sorted(os.listdir(OUTDIR)):
            d = json.load(open(os.path.join(OUTDIR, f), encoding='utf-8'))
            print('%-52s %s · 파일 %d개' % (f, d['script'], len(d['files'])))
        return
    if '--revert' in sys.argv:
        p = sys.argv[sys.argv.index('--revert') + 1]
        d = json.load(open(os.path.join(REPO, p) if not os.path.isabs(p) else p, encoding='utf-8'))
        files = d['files']
        print('되돌릴 파일 %d개 (이 목록 밖은 건드리지 않는다):' % len(files))
        for f in files:
            print('  ·', f)
        r = subprocess.run(['git', '-C', REPO, 'checkout', '--'] + files,
                           capture_output=True, text=True)
        print(r.stderr.strip() or '되돌림 완료')
        return
    print(__doc__)


if __name__ == '__main__':
    main()
