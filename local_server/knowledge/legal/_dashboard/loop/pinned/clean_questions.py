#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""고정 문항에서 **감사 내부 표기만** 벗겨 `question_clean` 을 만든다(원문 `question` 은 그대로 둔다).

왜: 라이브 검증은 이 문장을 실제 챗봇에 그대로 던진다. 그런데 65건 중 36건에
`R22-L11(T7, full):` · `(18R P2, full 4라운드 연속 유지)` · `위키만 보고` 처럼
**사용자가 절대 쓰지 않는 우리 표기**가 섞여 있어, 그 부분이 검색어로 들어가 점수를 흐린다
(2026-08-19 실측: 공유수면법 점용료 문항은 표기 탓에 4위였고, 사용자 말투로 바꾸면 1~2위).

원문을 고치지 않는 이유: 라운드 간 비교가 목적이라 문장을 바꾸면 그 문항이 비교에서 빠진다.
그래서 **원문 유지 + 정제판 병기**로 둘 다 잴 수 있게 한다.
"""
import json, re, io, sys

P = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/r22_questions.json'

# 앞머리 문항번호: `R22-L11(T7, full):` `Q22-12:` `B31 —` `#996 -`
LEAD = re.compile(r'^\s*(?:[A-Z]{1,4}\d{0,2}[-–]?[A-Z]?\d*(?:\([^)]*\))?|#\d+)\s*[:：—–-]\s*')
# 괄호 안이 통째로 감사 표기인 것만 제거(내용이 든 괄호는 건드리지 않는다)
PAREN = re.compile(r'\s*[(（][^)）]*?(?:감사|판정|\bfull\b|\bthin\b|\bmissing\b|[Rr]\d{1,2}\b|\d{1,2}R\b|문항|라운드|연속)[^)）]*[)）]')
# 감사 전용 표현
PHRASE = re.compile(r'\s*위키(?:만|에서)?\s*(?:보고|확인해서|확인)\s*')
QUOTE = re.compile(r'^["“”\'`]+|["“”\'`]+$')

def clean(q):
    s = q.strip()
    for _ in range(3):
        s2 = LEAD.sub('', s)
        s2 = PAREN.sub('', s2)
        s2 = PHRASE.sub(' ', s2)
        s2 = QUOTE.sub('', s2.strip())
        if s2 == s: break
        s = s2
    return re.sub(r'\s{2,}', ' ', s).strip()

def main():
    d = json.load(io.open(P, encoding='utf-8'))
    n = 0
    for x in d:
        c = clean(x['question'])
        if c and c != x['question']:
            x['question_clean'] = c; n += 1
        else:
            x.pop('question_clean', None)
    if '--apply' in sys.argv:
        json.dump(d, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('저장 완료 —', n, '건에 question_clean 추가')
    else:
        print('미리보기 —', n, '건이 달라짐 (파일 안 고침)\n')
        k = 0
        for x in d:
            if 'question_clean' in x and k < 8:
                k += 1
                print(' 전:', x['question'][:110])
                print(' 후:', x['question_clean'][:110], '\n')

main()
