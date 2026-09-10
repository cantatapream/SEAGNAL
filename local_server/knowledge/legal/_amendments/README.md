# _amendments/ — 개정 감지 대기·검토실 (사용자 확정 2026-07-18)

역할: **법률 개정·조문 변경이 감지됐을 때, 사람이 검토하기 전까지 그 "변경 데이터"를 모아두는 방.**
사람이 검토·승인하면 → 매니페스트 재생성·재수집·위키 반영(또는 옛 조문 `_legacy/` 이동)의 다음 단계로 넘어간다.

## 흐름 (Phase G 개정감지 스케줄러와 연결)
1. 스케줄러가 각 raw `_meta.json`의 MST·시행일을 DRF 현행본과 정기 대조.
2. 하나라도 바뀌면(신설·삭제·금액변경·조번재편·소관부처개편) → **변경 항목을 여기 `_amendments/`에 적재**(대기).
   - 항목 예: {법령, 무엇이 바뀜(신설/삭제/금액/조번/소관), 기존값 vs 새값, 감지시각, 연쇄 dirty 대상(그 타법 인용 기준법들)}.
3. **사람 검토 게이트**: 관리자가 확인(관리센터 AI탭 "개정 검토 큐" UI, MASTER_PLAN Phase F).
4. 승인 → 매니페스트 재생성(map_scope) → 재수집 → 재빌드 → 재감사. 옛 조문은 `_legacy/`로.
   반려/보류 → 여기 남겨둠.

## 왜 별도 방인가
- `_candidates/`(AI가 대화 중 알게 된 새 지식 후보)와 다르다 — 이건 **공식 법령의 개정 변경**.
- `_legacy/`(폐지·구법 보관)와 다르다 — 이건 **검토 전 대기**. 승인돼야 반영·이동.
- 자동 라이브 반영 금지 불변식(환각0)에 따라, **개정도 사람 승인 게이트를 거쳐** 위키에 들어간다.

**실배선 완료(2026-08-10)**: 탐지 엔진은 H-29(`_dashboard/loop/detect_law_changes.py`, `_dashboard/H29_design.md`) — `services/legal_amendment_scanner.js`가 이를 자식 프로세스로 실행해 결과를 이 방(`queue.jsonl`)으로 mirror한다. 매일 KST 01:00 cron + 관리자 "지금 스캔" 버튼(백그라운드) 둘 다 이 경로.

**큐 위치 변경(2026-09-10)**: 관리자 UI가 읽고 쓰는 실제 큐는 이제 Fly 볼륨의 `local_server/data/legal_amendments_queue.jsonl` 이다(탐지 엔진 산출물도 `local_server/data/law_change_queue.json`). 이 폴더의 `queue.jsonl` 은 **첫 배포 때 볼륨으로 복사되는 시드(초기값) 사본**이고, 이후 서버가 여기에 쓰지 않는다 — 이미지 안 경로에 두면 재배포마다 스캔 결과·승인/무시 기록이 git 상태로 되돌아갔기 때문(그동안 실서비스에서 개정검토가 결과를 낸 적이 없던 원인 중 하나). 항목 스키마는 `services/legal_amendment_scanner.js` `toLegacyEntry()` — 종류(`kind_code`)·바뀐 조문(`changed_articles`)·관련 법(`related_laws`)·이전/현재의 공포·발령·시행일·부처·개정구분을 담는다. 우리 법과 무관한 신규 고시(`related_laws` 빈 것)는 관리자 큐에 올리지 않는다.

## 승인을 누르면 실제로 무슨 일이 일어나나 (2026-09-10 정리 — 사용자 질문 "승인을 누르면 자동으로 재수집 진행하는거니?")

**자동으로 되는 것 두 가지**
1. 큐 두 곳에 `status:"approved"` 가 적힌다 — 관리자 큐 `data/legal_amendments_queue.jsonl` 과
   **탐지 큐 `data/law_change_queue.json`**. 두 번째가 2026-09-10에 새로 이어진 것이다.
   그 전에는 승인이 관리자 큐에만 남았고, 재수집 도구
   (`_dashboard/loop/collect_pending_law.py --all-approved`)는 **탐지 큐**에서 승인을 찾기 때문에
   **승인해도 재수집 대상이 0건**이었다. 옮겨 적기는 `services/legal_amendment_scanner.js`
   `mirrorDecisionToH29()` 가 한다(응답의 `mirrored` 필드로 성공 여부가 보인다).
2. **미리 받아 둔 예고본이 있는 건은 그 순간부터 답변에 반영될 자격을 얻는다** — 시행일이 되면
   챗봇이 새 원문·새 위키 서술로 답한다(시행일이 이미 지났으면 즉시). 승인 게이트는
   `services/effective_date.js` 가 관리자 큐의 `approved` 를 읽어 판정한다(`_SCHEMA.md` §10).

**자동으로 되지 않는 것 — 원문 재수집과 위키 수정**
서버는 git 을 쓸 수 없다. 그리고 배포해도 남는 저장 공간은 `local_server/data` **하나뿐**이라
(`fly.toml` mounts), 서버가 `raw/` 나 `wiki/` 에 새 파일을 써도 **다음 배포 때 사라진다.**
그래서 재수집·위키 수정은 **작업 세션**이 해서 저장소에 커밋해야 한다:
```
python3 _dashboard/loop/collect_pending_law.py --all-approved   # 예고본 내려받기(승인된 것만)
python3 _dashboard/loop/collect_pending_law.py --verify         # 받은 것이 맞는지 재조회 대조
#   → 위키에 시행일 마커 반영(사서) → lint → 커밋 → 배포
python3 _dashboard/loop/fold_effective.py                        # 시행일이 지난 뒤 정리(승격·마커 접기)
```
⚠**작업 컴퓨터는 실서비스의 승인을 바로 보지 못한다.** 승인은 폰(실서비스 볼륨)에 남고, 작업
컴퓨터가 읽는 것은 자기 사본이다. 그래서 실무는 둘 중 하나다 — ①승인한 카드의 id 를 알려 주고
`collect_pending_law.py <id>` 로 받는다 ②`--all-pending` 으로 대기분까지 함께 받아 둔다(받아 두기만
할 뿐, 승인 전에는 답변에 반영되지 않는다).
