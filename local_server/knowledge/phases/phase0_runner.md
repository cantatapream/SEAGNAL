# Phase 0 골든 회귀 게이트 — 실행 메모

> 상위: `../00_MASTER_PLAN.md` (Phase 0 🔁 상시 회귀). 목적: P1~P4 코드 변경이 기존 데이터 적재·도구선택·보안격리를 깨는지 자동 탐지.

## 구성
- `phase0_golden.jsonl` — 케이스(질문 + 구조 불변식 asserts). 실데이터 값은 매일 바뀌므로 **값이 아니라 구조**를 검증.
- `phase0_runner.py` — 케이스를 `/api/assistant/ask` 로 호출해 검사 + `routes/assistant.js` 정적 보안검사.

## 실행
```bash
cd local_server
GEMINI_API_KEY=... [KMA_DMDW_USER_ID=... KMA_DMDW_USER_PWD=...] node server.js &   # 서버 기동
python3 knowledge/phases/phase0_runner.py            # 게이트 실행 (기본 127.0.0.1:3001)
```
종료코드 0 = 통과, 1 = 하드 실패(환경의존 SKIP 제외).

## assert 종류
| 키 | 의미 |
|---|---|
| tools_include | toolsUsed 가 목록 중 ≥1 포함 |
| tools_exclude | toolsUsed 가 목록의 어떤 것도 미포함(오연결 방지) |
| method | internal(웹폴백 아님)/web/any |
| numeric | 답변에 숫자 포함 |
| not_nodata | 답변이 '없음/모름' 류가 아님 |
| corrected | STT 교정 발생 |
| answer_excludes | 답변에 금지 문구 미포함(보안 누설 방지) |
| optional | 환경의존(DMDW·TideBED·수심/CCTV 피드) — 실패해도 SKIP(비차단) |

## 운영 규칙 (DoD 연동)
- 각 후속 단계(P1/P2b/P3/P4) 코드 변경 후 이 게이트를 돌려 **하드 실패 0** 을 확인한다.
- 환경의존(optional) 케이스는 운영 키가 있는 환경에서 별도 확인.
- 정적 보안검사는 **관리자 도구 미노출 불변식**(마스터플랜 §1)을 강제한다.

## 갱신
- 새 기능/도메인이 생기면 골든 케이스를 추가한다(값이 아닌 구조 불변식으로).
