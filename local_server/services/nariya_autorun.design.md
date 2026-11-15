# 나리야 자동 반영(autorun) 설계안 — 개정검토·원문신선도를 클라우드 세션에 자동으로 맡기기

작성 2026-11-15 계정 A. 구현: `services/nariya_autorun.js` · 라우트 `routes/legal.js` · 시험 `scripts/test_nariya_autorun.js`.

## 0. 사용자 확정 사항 (원문 인용)

- *"우리 앱은 지금 위키 업데이트 등을 내가 md 파일을 세션에 제공하여야만 진행할 수 있는데 자동화하여 진행할 수 있는 방법이 없을까? 자동으로 세션에 던져준다던지 하는방법말야"*
- *"새롭개 개정되는 등 변경되고, 원문신선도가 낡은 것도 자동으로 처리 가능하다는거니 ?"*
- *"a+b로 진행하고 그 개정, 원문신선도 등 변경되었을 때 푸시알림오잖아 ? 그리고 세션에 전달이 정상적으로 되면 또 푸시알림. 완료가 되면 또 푸시알림 오도록도 할 수 있니 ?"*
- *"3-가, 나로 하고자 해."* — 완료 알림은 ⓐ Claude 앱 알림(예약 작업 설정) ⓑ 우리 앱 관리자 푸시 **둘 다**.
- (이전부터 유지) 개정검토 **승인**과 **머지·배포**는 사장님이 한다. 자동 세션은 PR 까지만 만들고 멈춘다.

## 1. 흐름

```
[서버 점검이 변경 감지] ── 푸시① (기존: 「법령 개정 N건 감지」·「원문 신선도 — 구버전 N건 발견」)
        │
 (개정검토는 사장님 승인 / 원문신선도는 승인 없음)
        ▼
 nariya_autorun.requestRun(kind)  ← 승인 버튼(decide·decide-all approved) · 원문신선도 점검(구버전>0)
        │ 10분 동안 새 요청이 없으면(요청마다 타이머 다시 시작)
        ▼
 fire(): POST 예약 작업 API 트리거  ── 성공: 푸시② 「세션 시작」(세션 링크) / 실패: 푸시② 「세션 전달 실패」
        ▼
 [클라우드 세션] claim → 서버에서 지시문·원문신선도 목록을 꺼냄 → 수집·위키·다른 눈 읽기·검사·PR → done
        ▼
 POST /api/legal/autorun/done ── 푸시③ 「완료」(PR 링크·결정 필요 N건) + Claude 앱 알림(예약 작업 설정)
```

방법 B(매일 정해진 시각)는 같은 예약 작업의 cron 으로 돈다 — 서버가 깨우지 않으므로 세션이 스스로 claim 한다.

## 2. 서버 구성 (환경 변수 — 셋 다 Fly.io secrets)

| 이름 | 뜻 | 없으면 |
|---|---|---|
| `NARIYA_ROUTINE_FIRE_URL` | 예약 작업 API 트리거 주소 `https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire` | 깨우지 않는다(콘솔 한 줄, 푸시 없음) |
| `NARIYA_ROUTINE_TOKEN` | 그 작업 전용 토큰(Bearer) | 위와 같음 |
| `NARIYA_AUTOMATION_TOKEN` | 세션이 서버를 부를 때 쓰는 **읽기·보고 전용** 열쇠(헤더 `X-Automation-Token`) | 자동화 경로 전부 401 |

- 발사(fire)는 **운영(FLY_ALLOC_ID 있음)** 에서만 한다(collect_fail_alert 와 같은 규칙). 개발은 콘솔 한 줄.
- fire 요청 헤더: `Authorization: Bearer <토큰>` · `anthropic-version: 2023-06-01` · `anthropic-beta: experimental-cc-routine-2026-04-01` · `Content-Type: application/json`. 본문 `{"text": "<짧은 신호>"}`.
  **지시문 전문은 싣지 않는다** — 크기 한도를 문서에서 확인하지 못했다. 신호에는 run_id·사유(kind별 건수)만 싣고, 세션이 서버에서 꺼내 간다.
- 응답 `claude_code_session_url` 을 푸시② data 에 싣는다.

## 3. 자동화 열쇠로 열리는 경로 (그 밖은 전부 기존대로 관리자 토큰만)

| 경로 | 하는 일 |
|---|---|
| `GET /api/legal/amendments/wiki-brief-all` | 기존 — 미반영 승인분 지시문(자동화 열쇠도 허용) |
| `GET /api/legal/freshness` | 기존 — 원문신선도 카드(자동화 열쇠도 허용, 읽기만) |
| `POST /api/legal/autorun/claim` | 신규 — 세션이 일을 시작한다고 알림. 다른 run 이 잡고 있으면 `{busy:true}` |
| `POST /api/legal/autorun/done` | 신규 — 결과 보고 → 푸시③. 본문 `{run_id, outcome: 'pr'|'nothing'|'failed', pr_url?, needs_decision?: [문장…], summary?}` |
| `GET /api/legal/autorun/status` | 신규 — 잠금·대기·마지막 실행 상태 |

열쇠 비교는 `crypto.timingSafeEqual`(길이 먼저). 자동화 열쇠로는 **승인(decide)·카드 처리·설정 변경을 못 한다.**

## 4. 잠금 (동시에 두 세션이 같은 일을 하지 않게)

- 잠금 `{run_id, since, source:'fire'|'claim'}` 을 `DATA_DIR/nariya_autorun_state.json` 에 둔다(재시작에도 남게).
- fire 성공 → 잠금(run_id = 신호에 실은 값). claim(run_id 같음) → 통과, claim(run_id 다름·없음) + 잠금 유효 → busy.
- done(run_id 같음) → 잠금 해제. 잠금 **유효시간 3시간**.
  - 이 시간이 없으면: 세션이 done 을 못 보내고 죽었을 때 잠금이 영원히 남아 A·B 가 다시는 안 돈다(→ 상한 필요, CLAUDE.md 「없으면 뭐가 잘못되나」).
  - 3시간 근거: 지금까지 한 회차(수집~PR)가 1~2시간이었다.
- 잠금 중에 requestRun 이 오면 **대기(pending)로 남기고**, done 이 오면 그때 10분 타이머를 다시 건다.

## 5. 대기 중 상태 변화 표 (각 행 = 시험 1개)

| # | 대기 중 일어난 일 | 동작 |
|---|---|---|
| 1 | 10분 안에 또 승인 | 타이머 다시 시작, 사유 합침(건수 누적) — fire 1번 |
| 2 | 10분 안에 원문신선도 구버전도 발견 | 사유 둘 다 실어 fire 1번 |
| 3 | 서버 재시작(타이머 유실) | pending 은 파일에 남는다 → 시작 시 pending 있으면 10분 타이머 다시 건다 |
| 4 | 잠금 중(세션 진행 중) 새 승인 | pending 에 쌓고 fire 안 함. done 오면 10분 뒤 fire |
| 5 | 잠금 3시간 지남(done 안 옴) | 잠금 무효. pending 있으면 fire. 푸시 「이전 세션 응답 없음」 한 줄 |
| 6 | fire 실패(HTTP 오류·망 오류·환경변수 없음) | 푸시② 실패(운영만, 환경변수 없음은 푸시 안 함). pending 유지 — 다음 요청이나 매일 B 가 줍는다. 자동 재시도 없음 |
| 7 | done 의 run_id 가 잠금과 다름 | 잠금 유지, 푸시③ 은 보냄(결과는 알린다) + 「잠금과 다른 run」 표시 |
| 8 | 매일 B 세션이 claim 했는데 A 잠금 유효 | busy → B 세션은 「다른 자동 세션 진행 중」만 남기고 끝 |
| 9 | 개발 서버(FLY_ALLOC_ID 없음) | fire·푸시 안 함, 콘솔 한 줄 |

## 6. 세션 쪽 (예약 작업 지침 — 서버 배포 뒤 update_trigger 로 넣는다)

claim → 지시문(`wiki-brief-all`)·원문신선도(`freshness?status=pending`) 꺼냄 → HANDOFF 착수 → 지금까지의 표준 순서
(collect_approved / recollect / 위키 Workflow + 다른 눈 읽기 / 검사 / amend_applied / PR) → done.
**스스로 정하지 않고 멈출 것**: 관련 법 여럿인 새 고시 폴더 · 이름 바뀐 고시의 동일성 · 사람 판독 블록 · 승격(fold_effective) · 지시문에 없는 별표 개정 — PR 본문과 done 의 needs_decision 에 적는다.

## 7. 확인 안 한 것

- 예약 작업 신호 본문 크기 한도(그래서 전문을 싣지 않는다).
- fire 응답·오류 코드 전체(API 레퍼런스 페이지 미열람) — 2xx 가 아니면 실패로 본다.
- 예약 작업 세션의 커넥터(GitHub PR 도구) 유무 — 시험 실행에서 확인.
