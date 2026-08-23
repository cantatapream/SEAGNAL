#!/usr/bin/env python3
"""HWPX 첨부파일에서 본문과 표를 구조 그대로 뽑아낸다.

왜 필요한가:
  일부 고시(해양경찰서 금지구역 고시 등)는 법령정보센터 API가 본문을 주지 않고
  첨부파일(HWPX/PDF)로만 제공한다. 첨부를 통째로 텍스트화하면 표의 칸이 한 줄씩
  흩어져 나와 어느 칸이 어느 행인지 알 수 없다.
  HWPX는 zip 안의 XML이고 표가 <hp:tbl>/<hp:tr>/<hp:tc> 로 구조가 명시돼 있으니,
  그 구조를 그대로 읽으면 행·열을 추측 없이 복원할 수 있다.
  (같은 취지의 선례: _LESSONS.md L-173 — 큰 표는 폭을 추측하지 말고 구조 파서를 쓴다.)

[연계]
  - 입력: law.go.kr 첨부파일 링크로 받은 .hwpx
  - 출력: 표는 파이프 표(| a | b |)로, 나머지 문단은 그대로 이어 붙인 텍스트
사용법: python3 hwpx_table.py <파일.hwpx> [> 출력.txt]
"""
import re, sys, zipfile
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit('}', 1)[-1]


def text_of(el):
    """이 요소 아래의 모든 글자를 순서대로 모은다(문단 사이는 공백)."""
    out = []
    for e in el.iter():
        if local(e.tag) == 't' and e.text:
            out.append(e.text)
    return re.sub(r'\s+', ' ', ''.join(out)).strip()


def render(sec):
    """섹션 XML을 훑어 문단은 줄로, 표는 파이프 표로 바꾼다."""
    lines = []
    root = ET.fromstring(sec)

    def walk(el, in_tbl=False):
        t = local(el.tag)
        if t == 'tbl':
            rows = [c for c in el.iter() if local(c.tag) == 'tr']
            for tr in rows:
                cells = [text_of(tc) for tc in tr if local(tc.tag) == 'tc']
                if not cells:
                    cells = [text_of(tc) for tc in tr.iter() if local(tc.tag) == 'tc']
                lines.append('| ' + ' | '.join(cells) + ' |')
            lines.append('')
            return
        if t == 'p' and not in_tbl:
            # 표를 품은 문단은 표 처리로 넘긴다
            if any(local(c.tag) == 'tbl' for c in el.iter()):
                for c in el.iter():
                    if local(c.tag) == 'tbl':
                        walk(c)
                return
            s = text_of(el)
            if s:
                lines.append(s)
            return
        for c in el:
            walk(c, in_tbl)

    walk(root)
    return '\n'.join(lines)


def main():
    z = zipfile.ZipFile(sys.argv[1])
    secs = sorted(n for n in z.namelist() if re.search(r'section\d+\.xml$', n))
    out = []
    for n in secs:
        out.append(render(z.read(n).decode('utf-8', 'replace')))
    txt = re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()
    sys.stdout.write(txt + '\n')


if __name__ == '__main__':
    main()
