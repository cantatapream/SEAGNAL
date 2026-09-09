# H-29 트랙 C — 예고본 사전수집·시행일 자동 전환 설계 (5~7항)

작성: 2026-09-10 KST · 근거: `MASTER_PLAN.md` H-29 5·6·7·12항 · `_dashboard/H29_design.md`(탐지 쪽) ·
사용자 확정 지시 *"b 만들어"* (= "예고본을 미리 받아 두고, 시행일이 되면 그날부터 자동으로 새 내용으로 답한다").
원칙: 코드로 확인한 사실만 적는다(CLAUDE.md ★추측 금지). 오케스트레이터 잠정안과 어긋난 곳은 §2에 이유를 적었다.

---

## 0. 한 줄 요약

**시행일에 서버가 파일을 고치는 게 아니다.** 예고본(새 원문)을 `_대기/<시행일>/` 에 **미리** 받아 두고,
위키에는 옛 서술·새 서술을 **둘 다** 마커로 넣어 둔 뒤, 런타임이 **읽을 때마다 오늘(KST) 날짜로 한쪽을 고른다.**
시행일 0시가 지나면 다음 요청부터 새 원문·새 서술이 나간다 — 타이머·트리거·재배포가 없다.

## 1. 코드로 확인한 전제 (설계가 서 있는 사실)

| # | 사실 | 어디서 확인 |
|---|---|---|
| F1 | 조문 팝업(`article_text.loadArticle`)은 raw 를 **로컬 디스크가 아니라 GitHub Contents API** 로 읽는다(`githubRaw.fetchText(filePath)`, 토큰 없으면 `no_token`). 경로는 `rawPathOf(법명)` → `law_raw_paths.json` 의 저장소 상대경로 + `/법률.txt` 등 | `services/article_text.js` loadArticle · `services/github_raw.js` |
| F2 | 위키 본문은 **로컬 파일**을 `readPage()` 하나가 읽고 mtime 캐시한다. 검색 점수(`scoreOne`·`termWeights`)·인용 본문(`citableBody`)·컨텍스트(`search` → `sliceRelevant`)·되묻기(`decideClarify` 의 `cp.body`)·근거 표(`extractCitationChain`)가 **전부 readPage 의 body 에서 출발**한다(readPage 호출처 5곳 전수: 779·816·1048·1068·1825행, 다른 파일에서는 호출 없음) | `services/legal_retriever.js` |
| F3 | 2차 조회(`searchRawFallback` → `loadLawBundle`)도 `githubRaw.fetchText(base + '/법률.txt')` 로 원문을 읽는다 | 같은 파일 3186행 |
| F4 | `_dashboard/notice_index.json` 은 **로컬 파일**로 읽힌다(`article_text.pickNoticeGlobal`) → `_dashboard/` 는 배포 이미지에 실린다(`Dockerfile` `COPY . .`, `.dockerignore` 에 knowledge 없음) | `Dockerfile`·`.dockerignore` |
| F5 | 예고본은 `lawService.do?target=eflaw&MST=<예정MST>&efYd=<시행일>` 로 **지금** 전문을 받을 수 있다. 실측(2026-09-10): 어선원법 MST 283875·efYd 20260911 → 187KB, 조문단위 109, `조문변경여부=Y` 3건(제2·28·45조), 부칙단위 28개 | 이 세션 실호출 |
| F6 | **한 MST 는 그 시행일 기준 법 전체의 완전한 스냅샷이다.** 공유수면법은 9/17(MST 273681, 제21조 개정)·9/18(MST 284343, 제8조 타법개정) 두 예고본이 있는데, **9/18 본의 제21조 텍스트가 9/17 본과 동일**(= 9/17 개정이 9/18 본에 이미 반영) | 이 세션 실호출·대조 |
| F7 | 큐 `law_pending` 항목은 `law.raw`(절대경로)·`layer`·`after.MST`·`시행일자`·`changed_articles`·`status`·`scheduled_for` 를 갖는다. 현재 28건 중 앞으로 시행될 것은 22건 | `_dashboard/law_change_queue.json` |
| F8 | raw `.txt` 형식은 `recollect_jomun.build_text()` 가 만든 것(조 머리 `[제N조] 제목 (시행 YYYYMMDD · 구분)`)에 `recollect_budchik.format_budchik()` 의 부칙 블록이 뒤에 붙은 꼴 | 두 스크립트 + 실제 파일 꼬리 |
| F9 | 게이트 도구(`citation_table_scan`·`link_ready`·`reach_eval`·`golden_eval`·`cite_exists`)는 위키를 `fs.readFileSync` 로 **직접** 읽고 `extractCitationChain` 을 태운다 — readPage 를 거치지 않는다. `sectionTable` 은 `|` 로 시작하지 않는 줄을 만나면 표가 끝난 것으로 본다 | 각 도구 소스·`legal_retriever.sectionTable` |
| F10 | `_legacy/` 는 위키 페이지 보관용(현재 .md 1개). raw 구판 보관 관례는 **없다** | `ls _legacy` · `_SCHEMA.md` 0-B |

## 2. 잠정안에서 바꾼 것과 이유

| 잠정안 | 확정 | 이유 |
|---|---|---|
| `_대기/<d>/` 중 최신을 **폴더를 뒤져** 고른다 | **`_dashboard/pending_index.json`(로컬) 에 적힌 것만 본다** | F1: raw 는 GitHub API 로 읽는다. 팝업마다 `listDir(base/_대기)` 를 부르면 대기본이 없는 법(거의 전부)에서 404 호출 1회·오류 로그 1줄이 매번 생긴다. 지도 파일은 `notice_index.json` 과 같은 선례(F4)고, 대기본이 있는 법에서만 GitHub 조회가 1회 늘고 그 대신 현행 조회가 빠져 **총 호출 수는 같다** |
| 위키 마커는 블록형만 | **블록형 + 인라인형, 표 안에서는 인라인형만** | F9: 게이트가 위키를 직접 읽으므로 표 안에 마커 줄이 끼면 그 줄에서 표가 끊긴다. 인라인은 한 칸 안에서 끝나므로 표 구조를 안 건드린다 |
| fold 때 옛 현행을 `_legacy/` 관례대로 | `_legacy/raw/<도메인>/<법>/<층>_시행<옛시행일>_MST<옛MST>.txt` 로 신설 | F10: raw 관례가 없어 만든다. git 에 이미 있으니 지워도 되지만 "삭제 대신 이동"(_SCHEMA 10) 원칙에 맞춘다 |
| 승인(approved)만 수집 | `--all-approved` 기본 + `--all-pending`·`<id>` 선택 | 관리자 승인 UI(트랙 B)가 아직 `scheduled_for` 를 안 채우므로(확인: 승인 라우트는 status 만 바꾼다) 이번 실데이터 확인은 `<id>` 지정으로 한다 |

## 3. 구조

```
[승인]  law_change_queue.json (status approved, scheduled_for=시행일)     ← 트랙 B
   │
   ▼  세션(git 가능한 곳)에서
collect_pending_law.py --all-approved
   ├─ eflaw MST+efYd 실호출 → build_text()+format_budchik() (재사용, 복제 안 함)
   ├─ raw/<도메인>/<법>/_대기/<시행일>/<층>.txt + _meta.json
   └─ _dashboard/pending_index.json 재생성   { "<raw 상대경로>": [ {date, MST, files[], 법령ID, queue_id} ] }
   │
   ▼  사서(별도 에이전트, 이번엔 절차만 §7)
위키 페이지에 <!--시행 d-->새<!--/시행--> / <!--시행전 d-->옛<!--/시행전--> 마커 삽입 → lint → 커밋 → 배포
   │
   ▼  런타임(매 요청)
services/effective_date.js  todayKST() 한 곳
   ├─ article_text.loadArticle: stagedRawPath(base, '법률.txt', today) 가 있으면 그 파일을 GitHub 에서 읽는다
   ├─ legal_retriever.readPage: applyStageMarkers(body, today) → 모든 소비처(F2)가 자동으로 한쪽만 본다
   └─ legal_retriever.loadLawBundle: 2차 조회의 법률.txt 도 같은 규칙
   │
   ▼  시행일 지난 뒤, 세션에서 아무 때나(런타임은 이미 새 내용을 내고 있다)
fold_effective.py [--today YYYYMMDD]
   ├─ raw: 현행 → _legacy/raw/…, _대기/<d>/<층>.txt → 현행, _meta.json MST·시행일 갱신, _대기/<d> 삭제
   ├─ wiki: 마커 접기(시행 블록만 남김, 시행전 삭제) + 변경 이력 한 줄
   └─ pending_index.json 재생성 · Touched 기록
```

### 3-1. 날짜 규칙(한 곳)
- `todayKST()` = `Date.now()+9h` 의 `YYYYMMDD`. 테스트·수동 확인은 `setTodayForTest('20260911')` 로 주입.
- raw: `pending_index[base]` 중 `date <= today` 인 것 가운데 **가장 큰 date** 하나(F6 이 이 규칙의 근거 — 나중 시행본이 앞 시행본을 포함한다).
- 위키: `<!--시행 d-->…<!--/시행-->` 는 `today >= d` 일 때만 남기고, `<!--시행전 d-->…<!--/시행전-->` 는 `today < d` 일 때만 남긴다. 마커 자체는 항상 지운다. 중첩은 지원하지 않는다(사서 규약).
- 블록형: 여는 마커·닫는 마커가 **각각 한 줄을 통째로** 차지. 그 줄들은 통째로 빠진다(표 밖에서만).
- 인라인형: 한 줄 안에서 열고 닫는다. 표 칸 안에서는 이것만 쓴다. 법령 칸·조문 칸에는 넣지 않는다(게이트가 그 칸으로 원문을 연다 — F9).

### 3-2. 캐시
- `readPage` 캐시 키에 `today` 를 더한다 — 마커가 있는 페이지만. 마커 없는 페이지는 종전과 같이 mtime 만 본다(마커 유무는 `indexOf('<!--시행')` 한 번).
- `pending_index.json` 은 mtime 캐시(다른 지도 파일과 같은 방식).

## 4. 왜 `run_once_at` 트리거가 필요 없어지는가 (적대검증 ①의 질문)

7항 원안은 "승인 시 시행일에 깨어나는 트리거를 만들어 그날 재수집·위키 갱신·재빌드"였다. 이 설계에서는:
- **정확성에 필요한 일은 시행일 전에 다 끝나 있다**(원문·위키 둘 다 이미 저장소에 있고 배포돼 있다). 시행일에 남는 일은 `fold_effective.py` 의 **정리(승격·평문화)** 뿐이고, 그건 하루 늦어도 사용자 답변이 달라지지 않는다.
- 트리거가 있어도 **서버는 git 을 못 쓰므로** 그날 파일을 못 고친다(잠정안 §1 마지막 항). 트리거 방식은 결국 "그날 세션이 깨어나 재수집·커밋·배포"인데, 배포가 끝날 때까지 낡은 답이 나간다.
- 정리 작업은 이미 있는 **매주 월요일 04:00 KST 탐지 Routine**(`trig_01KKZTHKRxDbDxs4HK4jiTgi`, H-29 상태줄) 이 도는 세션에서 `fold_effective.py` 를 한 번 더 부르면 된다 — 새 트리거를 만들 이유가 없다(**배선 요청 → 오케스트레이터**, 이 트랙 소유 아님).
- 남는 반론: "시행일 전에 사서가 위키를 못 고치면?" → §5 ⑦. 트리거가 있어도 이 경우는 못 막는다(사서가 안 한 일을 트리거가 대신하지 않는다).

## 5. 대기 중 상태 변화 표 (승인 후 ~ 시행일 사이) — 회귀 테스트와 1:1

| # | 상태 변화 | 무슨 일이 일어나나 | 어떻게 드러나나 / 막나 | 테스트 |
|---|---|---|---|---|
| ① | 같은 법이 또 개정(새 MST, 다른 시행일) | 큐에 새 항목 → `_대기/<d2>/` 가 하나 더 생긴다. 런타임은 `date<=today` 중 최신 하나만 쓴다. F6 대로 뒤 본이 앞 본을 포함하므로 안전 | `pending_index` 에 두 date 가 나란히 있고, 주입 날짜에 따라 고르는 파일이 바뀐다 | T-raw-2, T-raw-3 |
| ①′ | 같은 시행일에 새 MST 로 재공포(대체) | `_대기/<d>/_meta.json` 의 MST 와 다르면 **덮어쓰고** 화면에 "대체" 라고 찍는다 | collect 실행 로그 + Touched | T-collect-2 |
| ② | 시행일 연기·변경 | 옛 `_대기/<옛d>/` 가 **틀린 날에 켜진다.** `collect_pending_law.py --verify` 가 각 대기본의 MST 를 API 로 다시 물어 `시행일자` 가 폴더명과 다르면 ❌ 로 찍고 `--prune` 이면 그 폴더를 지운다(Touched). 배포 전 절차(§7)에 `--verify` 를 넣어 창을 좁힌다 | `--verify` 출력 | T-verify-1 |
| ③ | 예고본 철회(API 에서 빈 응답) | ②와 같은 경로 — 재조회가 비면 ❌ | `--verify` 출력 | T-verify-2 |
| ④ | 서버 재배포·재시작 | 상태가 전부 git(파일)과 날짜 계산에만 있다. 타이머·메모리 상태 없음 → 영향 0 | (구조상) | T-date-1(날짜 함수가 순수) |
| ⑤ | 법률·시행령이 다른 날 시행 | 층마다 `_대기/<d>/<층>.txt` 가 따로 있고 팝업도 층별 파일을 따로 고른다. `pending_index` 항목은 `(date, files[])` 라 한 date 에 한 층만 있어도 된다 | 주입 날짜에 따라 법률만 바뀌고 시행령은 현행 그대로 | T-raw-4 |
| ⑥ | 부칙 경과규정 | 예고본 텍스트에 **부칙 전부**(신·구)를 붙인다(F5: 부칙단위 28개). 팝업은 이미 `addenda` 로 부칙을 따로 보여준다. 위키의 경과규정 서술은 사서 몫(§7 ③) | 수집 파일 꼬리에 `부칙` 블록 | T-collect-1 |
| ⑦ | 사서가 위키를 안 고친 채 시행일 도래 | 팝업은 새 원문, 챗봇 문장은 옛 위키 — **어긋난다.** `collect_pending_law.py --status` 가 대기본마다 "그 법을 인용하는 위키 중 `<!--시행 d-->` 를 가진 페이지 수" 를 찍어 0 이면 ⚠ 로 표시한다. 막지는 못한다(사서 절차 §7 ②가 끝나야 커밋한다는 규칙으로 막는다) | `--status` 출력 | T-status-1 |
| ⑧ | 서버 시간대가 KST 가 아님 | `todayKST` 가 `Date.now()+9h` 를 쓴다(TZ 환경변수에 안 기댄다) | 순수함수 테스트 | T-date-1 |
| ⑨ | 수집 뒤 큐 항목이 dismissed 로 바뀜 | `--verify` 가 큐 상태도 대조해 `dismissed`/`ignored` 면 ❌ | `--verify` 출력 | T-verify-3 |
| ⑩ | 트랙 D 재수집으로 현행 `_meta.json` MST 가 대기본 MST 와 같아짐(이미 현행이 됨) | `--verify` 가 "현행과 동일 — 접기 대상" 으로 찍고, `fold_effective.py` 가 그 `_대기` 를 지우기만 한다(현행은 손대지 않음) | `--verify`·fold 로그 | T-fold-2 |
| ⑪ | 시행일 0시 직후의 캐시 | readPage 캐시 키에 today 가 들어가 자정 후 첫 요청에서 다시 계산한다. 팝업은 캐시가 없다 | 같은 페이지를 두 날짜로 읽어 다른 본문 | T-wiki-4 |
| ⑫ | 별표가 함께 바뀜 | **한계**: 대기본은 조문·부칙만 받는다. 별표 파일은 현행 폴더 것을 그대로 쓴다(별표 재수집은 fold 뒤 트랙 D 절차). H-29 10항이 "별표는 MST 안에 있다"고 했지만 우리 별표 수집은 별도 파이프라인이다 | 설계 문서에 명시 | — |
| ①″ | **같은 MST 인데 내용이 바뀜** — 시행예정 판은 MST 를 유지한 채 나중에 공포된 개정을 흡수한다(실측: 양식산업발전법 MST 281971 이 2026-03-31 공포 개정을 담고 있었다) | 종전 `--verify` 는 시행일자만 봐서 낡은 예고본을 ✅ 로 통과시켰다. 이제 재조회 본문을 저장본과 **대조**해 다르면 ❌(다시 받아야 한다) | `--verify` 로그 "내용이 달라졌다" | T-newer-1 |
| ⑩′ | **현행이 대기본보다 뒤 시행본** — 트랙 D(`recollect_tier.py`)가 시행일 뒤에 먼저 재수집해 두면 현행이 더 새 판이다 | 종전 `fold_raw` 는 MST 가 다르다는 이유만으로 승격해 **새 판을 `_legacy` 로 밀어내고 옛 예고본을 현행으로 되돌렸다**(_meta 시행일도 뒤로 갔다). 이제 현행 파일 머리의 시행일이 대기본 날짜보다 **뒤면 승격하지 않고 대기본만 지운다**. `--verify` 도 ❌ 로 잡는다 | fold·verify 로그 "보다 뒤" | T-newer-2, T-newer-3 |
| ⑭ | **마커의 짝·형식이 깨짐**(닫는 짝 없음·종류 불일치·중첩·줄 가운데 여는 마커·날짜 8자리 아님) | 종전에는 그 블록 아래를 **파일 끝까지 버려** 시행일부터 페이지 뒷부분(근거 조문 표 포함)이 답변에서 사라졌고, 시행 전에는 증상이 없었다. 이제 ①런타임은 접지 않고 마커 표기만 걷어낸다(내용 보존) ②`fold_effective.py` 는 그 페이지를 건너뛴다 ③게이트 V5-12(`lint_stage_markers.py`)가 커밋 전에 막는다 | 게이트 종료코드 + 서버 로그 | T-broken-1~6 |
| ⑬ | 예고본 조문 시행일자가 폴더 날짜와 다름 | F5: 스냅샷의 모든 조문 `조문시행일자` 가 스냅샷 시행일과 같았다(어선원·공유수면 둘 다). 수집 시 `기본정보.시행일자 == 큐 시행일자` 를 확인하고 다르면 저장하지 않는다 | collect 로그 | T-collect-3 |

## 6. 성공 기준 (카파시 4)

1. `node local_server/scripts/test_pending_law.js` — 위 표의 테스트 전부 PASS, `verify_all.sh` SUITES 에 등록.
2. 실데이터: 어선원법(20260911) 예고본을 `_대기/20260911/법률.txt` 로 받고, `setTodayForTest('20260910')` 이면 팝업이 현행(시행 20240724), `'20260911'` 이면 대기본(시행 20260911, 제28조 본문이 API 와 같음)을 돌려준다(githubRaw 를 로컬 파일로 대체해 검증 — 토큰 없는 환경).
3. `verify_all.sh` 총정리 블록에서 나빠진 항목 0(위키를 이번엔 안 고치므로 위키 게이트는 그대로여야 한다).
4. `article_text.js`·`legal_retriever.js` 는 편집 직후 `node --check` 통과, export 목록 유지.

## 7. 사서 단계 절차 (이번엔 문서화만 — 실제 위키 수정은 별도 에이전트)

1. 세션에서 `python3 _dashboard/loop/collect_pending_law.py --all-approved` → `--verify` → `--status`.
2. `_대기/<d>/_meta.json` 의 `changed_articles` 로 영향 조문을 알고, 그 조문을 인용하는 위키 페이지를 `grep -l '<법명>' wiki/**/*.md` + 근거 조문 표로 찾는다.
3. 페이지마다: 옛 서술을 `<!--시행전 d-->…<!--/시행전-->`, 새 서술을 `<!--시행 d-->…<!--/시행-->` 로 **둘 다** 남긴다. 표 칸은 인라인형. 부칙 경과규정이 있으면 새 서술에 적는다. 새 서술의 근거는 `_대기/<d>/<층>.txt` 원문에서 복붙한다(_SCHEMA "원문 발췌는 복붙").
4. `lint_index.py`·`lint_build.py` → `verify_all.sh` → 커밋(경로 개별 지정) → 배포.
5. 시행일 뒤: `python3 _dashboard/loop/fold_effective.py` → lint → 커밋. (월요일 Routine 세션에 넣는 것은 배선 요청.)

## 8. 적대검증 (2026-09-10) — 자체 검토 + **독립 검토 3각도(오후)**

설계·구현 직후의 자체 검토(아래)에 더해, **2026-09-10 오후 오케스트레이터가 독립 검토자 3각도**(①이미 있는 메커니즘·전제 검증 ②상태변화 표의 빈칸 ③게이트·성능·형식 깨짐)를 붙였다 — 지적 26건(high 3·medium 10·low 13), 재현 검증 8건. 결과는 `_dashboard/H29_stage_review_2026-09-10.json`.

**high 3건은 이 문서의 표 ⑭·⑩′·①″ 로 반영하고 코드를 고쳤다**(테스트 T-broken-1~6·T-newer-1~3). medium 중 "2차 조회(`searchRawFallback`)의 추가 파일이 대기본을 무시한다"도 함께 고쳤다(`legal_retriever.js` extras 에 `stagedRawPath` 적용) — 종전에는 `법률.txt` 만 대기본을 쓰고 시행령·시행규칙은 늘 현행을 읽어 시행일 뒤 팝업과 2차 조회 답이 어긋났다.

**아직 안 고친 것(사용자 결정 대기)**: 승인되지 않은 큐 항목도 시행일이 되면 런타임이 자동 전환한다(`pending_index.json` 은 승인 여부를 모른다 — 현재 대기본 8건의 큐 상태가 전부 `pending`). 승인 게이트에 묶을지는 운영 정책이라 임의로 바꾸지 않는다. 그 밖의 medium·low 는 같은 파일에 목록으로 남겼다.

아래는 자체 검토에서 바뀐 것.

- ①"이미 있는 메커니즘으로 되지 않나": 트랙 D 재수집 + 주간 Routine 으로도 결국 갱신되지만 **시행일~다음 월요일~배포까지 최대 7일+ 낡은 답**이 나간다. 그 공백을 없애는 것이 12항의 요지라 별도 메커니즘이 맞다. 다만 `run_once_at` 은 §4 대로 안 만든다.
- ②"표의 빈칸": 원안 7행 → ①′·⑧·⑨·⑩·⑪·⑫·⑬ 여섯 행 추가. 특히 ②연기 는 원안대로면 **틀린 날 켜지는** 결함이라 `--verify` 를 만들었다.
- ③"성능·게이트·색인": `listDir` 방식이면 팝업마다 404 가 생겨 지도 파일로 바꿨다(§2). 색인(`index.json`)은 본문을 안 담아 마커에 영향 없음(lint_index.py 는 `cited`·`links` 만 뽑는다 — 두 블록의 합집합이라 오히려 과잉). 표 안 블록형 마커는 게이트를 끊으므로 금지(§3-1).
- 검산: "readPage 호출처 5곳" 은 grep 으로 셌다(위 F2). "호출 수 같다" 는 loadArticle 코드 경로를 읽고 말한 것이다.

## 9. 구현 결과 (2026-09-10, 이 세션이 직접 확인한 것만)

| 항목 | 결과 |
|---|---|
| 런타임 | `services/effective_date.js`(신설) · `article_text.loadArticle` 대기본 우선 읽기 · `legal_retriever.readPage` 마커 접기(캐시 키에 오늘 포함) · `loadLawBundle` 같은 규칙. 편집 직후 `node --check` 통과, export 유지(+`readPage` 추가) |
| 도구 | `loop/collect_pending_law.py`(수집·`--verify`·`--status`·`--rebuild-index`) · `loop/fold_effective.py`(승격·접기) — 둘 다 `Touched` 기록, 테스트 트리에서는 기록 끔 |
| 테스트 | `scripts/test_pending_law.js` **80 PASS / 0 FAIL**(2026-09-10 오후 독립 검토 반영으로 42→80), `verify_all.sh` SUITES 등록. §5 표 16행 중 ⑫(별표 한계)만 테스트 없음 |
| 실데이터 | 어선원법 20260911(MST 283875)·공유수면법 20260917(273681)·20260918(284343) 예고본 3건 `_대기/` 수집. `--verify` 3건 ✅(API 재조회 시행일자 일치·큐 상태 정상). `--status` 3건 ⚠(위키 마커 0쪽 — 사서 단계 미착수, 인용 위키 64·128쪽) |
| 팝업 전환(실데이터) | `setTodayForTest('20260910')` → 제28조 현행(시행 2024-07-24), `'20260911'` → 대기본(시행 2026-09-11), 읽은 경로 `_대기/20260911/법률.txt`, 호 쪼개기·강조 정상(T-popup-1·2) |
| 형식 대조 | 어선원법 대기본 vs 현행: 조 99=99, 본문 동일 75조, 다른 24조 중 큐가 말한 개정 3조(제2·28·45조) 외 21조는 **호 머리 공백(`1.  `→`1. `)만** 다름(API 출력 변화 — 말뭉치에 이미 한 칸 4,330줄·두 칸 25,233줄 섞여 있어 파서가 둘 다 받는다) |
| 게이트 영향 | `dup_id_check.py` 는 `행정규칙/` 폴더만, `collect_eval.js` 는 법 폴더 한 단계만 본다 → `_대기/` 하위는 세지 않는다(코드 확인). `sync_notice_index` 도 행정규칙만 |

**남은 것(못 한 것)**: ①위키 마커 삽입(사서 단계) ②독립 적대검증(도구 부재, §8) ③트랙 B 배선 — 승인 시 `scheduled_for=시행일자` 채우기, 큐를 `local_server/data/` 로 옮긴 뒤에도 이 도구는 두 경로를 다 본다 ④월요일 Routine 세션에 `collect_pending_law.py --all-approved && --verify` 와 `fold_effective.py` 넣기(오케스트레이터).
