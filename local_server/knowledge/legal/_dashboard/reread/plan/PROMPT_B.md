# 보조 계정(B) 작업 절차 — 예약 작업(PROMPT_B_ROUTINE.md)이 매번 이 파일을 읽고 따른다

> 지금은 사장님이 이 글을 직접 붙여 넣지 않아도 된다 — `PROMPT_B_ROUTINE.md` 로 예약 작업을 만들면, 그 작업이 깨어날 때마다 이 파일을 읽는다.
> (아래는 처음 손으로 시작할 때의 꼴로 남겨 둔다.)

> 클로드 **앱**(데스크톱/모바일)으로 새 세션을 열고, 저장소 `cantatapream/SEAGNAL` 을 붙인 뒤,
> 권한 모드는 「묻지 않고 진행」 쪽으로 둔다. 그다음 아래 상자 안 글을 그대로 보낸다.

```
SEAGNAL 저장소에서 「위키 다른 눈의 다시 읽기(D1)」 canonical 묶음을 메인 계정과 나눠서 해줘. 너는 보조인 「계정 B」다.

[시작]
1. 브랜치 claude/intelligent-bell-b0puy2 를 받아서, 그 위에서 네 작업 브랜치를 만들어(main 이 아니다).
2. local_server/knowledge/legal/_dashboard/reread/HANDOFF_D1.md 를 처음부터 끝까지 읽어. 특히 §5 · §6 · §10(10-1~10-7) 을 그대로 따른다.
   CLAUDE.md 와 local_server/knowledge/legal/_SCHEMA.md §5-D, _LESSONS.md L-412~L-421 도 읽어.
3. 시작하자마자 네 브랜치로 draft PR 을 열어. base 는 main 이 아니라 claude/intelligent-bell-b0puy2,
   제목은 「[D1 계정 B] canonical 다시 읽기 R35~R65 홀수」. 이 PR 이 메인 계정과의 연락 통로다(§10-5).

[네 몫]
4. 홀수 묶음 D1-R35 · R37 · … · R65 (16묶음, local_server/knowledge/legal/_dashboard/reread/plan/D1-Rnn.json) 뿐이다.
   짝수 묶음과 R24·R29~R34 는 메인 계정 몫이라 그 쪽들은 고치지 마.
   메인 계정이 자기 몫을 먼저 끝내면 R65 부터 거꾸로 가져간다 — 묶음을 시작하기 직전에 claude/intelligent-bell-b0puy2 의 plan/progress_B.md 를 받아
   「A가 가져감」·「진행」·「끝」인 묶음은 건너뛰고, 시작하는 묶음은 네 브랜치 표에 「진행(B)」으로 적어 바로 커밋·푸시해(§10-8).
5. 묶음은 tools/make_wf.py 로 실행 파일을 만들어 Workflow 로 동시에 4~6개 돌려. 모델은 sonnet·medium(파일에 들어 있다).
6. 그림 안 글자를 읽어 위키에 옮겨 적지 마(Q-19). 그림은 「원문 그림에서 확인」 안내로 둔다. PDF·HWP 에서 글자로 뽑히는 원문은 글자로 써도 된다.

[묶음마다]
7. 묶음이 끝나면 post_batch → V5-57·V5-13 확인(저장소 루트에서) → 커밋·푸시. 커밋 직전에 claude/intelligent-bell-b0puy2 를 받아 합치고,
   장부(verdicts.jsonl)·c_list·human_list·HANDOFF 충돌은 양쪽 줄을 모두 남겨. 색인 파일은 다시 만든다.
8. 그 PR 에 묶음 결과 댓글을 달고 plan/progress_B.md 를 같은 커밋에서 고쳐(§10-5 꼴). 사용량 한도로 멈추면 그것도 댓글로.

[끝까지]
9. §10-6 완료 기준 1~6을 모두 마쳐: 16묶음 정리 · 게이트 통과 · 메인 브랜치 마지막 합치기 · 색인/규칙집/verify_all · HANDOFF 기록 · 「계정 B 완료」 댓글과 PR 검토 가능 전환.
10. 그 뒤에는 새 일을 스스로 시작하지 마. 내 지시를 기다려.

비용상한 없이 계속 진행하고, 보고는 한국어로 짧게. 추측 금지 — 확인한 것만 말해. main 머지는 메인 계정이 한다.
```
