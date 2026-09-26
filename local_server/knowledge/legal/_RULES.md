# _RULES.md — 짧은 규칙집 (규칙마다 **그것을 지키는 검사 이름**을 옆에)

> **이 문서를 먼저 읽는다.** 등록부 `2-4`. 만든 날 2026-09-25.
>
> 왜 짧은가 — 규칙이 적힌 문서 다섯이 합쳐 **2.7MB** 다
> (`HANDOFF.md` 2.1MB · `MASTER_PLAN.md` 347KB · `_SCHEMA.md` 145KB · `_CHATBOT.md` 95KB · `README.md` 9.5KB).
> 세션이 그것을 다 읽지 못하니 **규칙이 있어도 안 읽히고, 안 읽히는 규칙은 죽는다.**
> 이 저장소 조사가 찾아낸 뿌리 사슬의 첫 세 마디가 정확히 그것이다:
>
> | 마디 | 무슨 일이 나나 |
> |---|---|
> | ① | 규칙은 있었다 — **코드가 그 규칙을 안 읽는다** |
> | ② | 코드가 안 읽는 규칙은 **죽는다**(글만 남고 실제는 딴 길로 간다) |
> | ③ | **검사가 안 재는 자리도 죽는다** — 아무도 어긋난 것을 모른다 |
>
> 그래서 이 문서의 규칙은 **한 줄마다 검사 이름을 달고 있다.** 검사가 없는 줄은
> **「⚠검사 없다」고 적어 둔다** — 그것이 ③을 눈에 보이게 하는 유일한 방법이다.
>
> **다섯 문서는 버리지 않는다.** 그것들은 **상세와 이력**이고, 이 문서는 **지금 지켜야 할 것**이다.
> 어긋나면 **이 문서가 아니라 검사가 옳다** — 검사는 실제로 돌고, 글은 낡는다.

---

## §0. 검사를 한 번에 돌리는 법

```bash
node local_server/server.js &            # 게이트가 서버를 요구한다(없으면 스모크·V4가 전부 실패)
bash scripts/refactor/verify_all.sh      # 게이트 + 스위트 전부
```

끝에 **실패 항목을 한 번 더 모아 찍는다.** 그 블록을 읽는다 — `head`·`tail` 로 자르면
가운데 실패를 놓친다. **「돌렸다」와 「읽었다」는 다르다**(CLAUDE.md 추측금지 7).

---

## §1. 말하기 전에 — 추측 금지

> 사장님 확정 2026-08-23: *"추측하지 말고 정확히 확인해서 코드와 로직 그리고 데이터에 근거해서"*

| 규칙 | 어겼을 때 실제로 난 일 | 검사 |
|---|---|---|
| **숫자를 말하려면 방금 세었어야 한다.** 못 셌으면 「세어 보지 않았다」고 말한다 | 등록부 진행판을 손으로 적었더니 **222행**이라 했는데 실제 235행이었다 — 세는 자가 10칸을 안 보고 있었다 | `V5-44` 진행판=실측 · `test_counting_dict` |
| **「없다·안 된다·못 한다」는 확인 기록이 있어야 한다** | L-140·L-141·L-166·L-390 이 전부 이 유형. `P-13` 은 *"Pillow 이 안 깔려 있다"* 로 여러 날 묶여 있었고, `import PIL` 한 줄로 **깔려 있음**이 드러났다 | ⚠검사 없다 — **사람이 지킬 규칙**(L-390) |
| **원인은 재현하거나 코드를 끝까지 읽고 말한다** | 인용 15건을 *"원문에 없는 말"* 이라 적었는데 둘은 **글자 그대로** 있었다(한자 괄호 탓). 그다음 내가 만든 정정도 반만 맞았다 — 진짜 원인은 `best_window()` 의 고르는 법이었다 | `V5-43` 인용 없는 EXACT 주장 |
| **과거 판정을 물려받아 쓰지 않는다** | 「이미 끝났는데 마커만 안 바뀐 칸」이 하루에 **다섯** 나왔다(`2-19`·`3-30`·`P-11`·`4-2`·`P-9b`) | `V5-44` · `V5-24` 「사람이 봐야 한다」 표시 |
| **남이 한 말을 옮길 때도 이 규칙이 걸린다** — 특히 「없다·미구현」류 | 2026-08-27 하루에 네 번. 전달은 **두 겹으로 낡는다** | ⚠검사 없다 — 사람이 지킬 규칙 |
| **틀린 것을 알면 즉시 정정한다.** 옛 서술은 **지우지 않고** 정정을 붙인다 | 이 저장소의 기록 규약 자체다 — 지우면 왜 틀렸는지가 사라진다 | ⚠검사 없다(규약) |

---

## §2. 재는 법 — 숫자를 만들 때

| 규칙 | 왜 | 검사 |
|---|---|---|
| **뜻과 범위를 먼저 못박는다.** 「근거 조문 행」 같은 말은 뜻이 여럿이다 | 같은 이름의 수가 넷 다르게 나왔다. 원인 둘 — ①범위가 달랐다(+3,685) ②표 **머리행**을 데이터 행으로 셌다(+1,248, 버그) | `test_counting_dict` · `_dashboard/loop/_counting.js`(정의의 유일한 자리) |
| **★검사는 챗봇·제품이 쓰는 그 함수를 부른다.** 세는 법을 검사 안에 다시 짜지 않는다 (**L-136**) | 다시 짜면 **두 자가 갈린다** — 제품은 틀린 채 검사만 통과한다 | 게이트 대부분이 이 꼴이다. 어긴 자는 새로 만들 때 잡는다 |
| **규칙은 한 곳에만 둔다** (**L-386**) | 낱말 목록을 두 곳에 적었더니 **917 ↔ 987** 로 갈렸다. `_dashboard/bnum_words.json` 한 곳으로 모았다 | `test_counting_dict` · `test_meta_schema` |
| **빨간불에 기준선을 다시 굽지 않는다** (**G-49**) | 기준선을 고쳐 통과시키면 그 자리는 영영 안 보인다. 나빠진 것이 정당하면 **왜 정당한지 커밋에 적고** 갱신한다 | 게이트가 `--base …/pinned|baseline` 으로 잰다 |
| **0 을 요구할 수 있는 자리와 아닌 자리를 가른다** | 모든 링크가 대칭일 필요는 없다 → `V5-10` 은 **늘지 않는 것만** 본다. 별표 복원은 원본이 있어야 한다 → `V5-20` 도 같다 | 각 게이트 머리 주석에 적혀 있다 |
| **판정이 안 바뀌어도 한 층 아래를 잰다** (**L-389**) | 「변경 이력」이 점수에 섞여 있었다 — **판정은 그대로였지만** 검색어 46.6%의 무게가 왜곡돼 있었다 | `test_score_body` |
| **A/B 는 A 를 먼저 재야 A/B다** (**L-391**) | 옮긴 뒤에만 재면 「원래 그랬다」와 「내가 바꿨다」를 가릴 수 없다 | `scripts/refactor/ab_card_html.js` |
| **「기계가 고르지 않는다」** (**G-34**) — 사람 판단이 필요한 칸은 기계가 닫지 않는다 | 기계가 닫은 칸은 근거 없이 「끝」이 된다 | `worklist_progress.py --gate`(V5-44)가 **후보만** 내놓는다 |

---

## §3. 코드를 고칠 때

### ⓐ 카파시 4 (상세 `.claude/skills/karpathy-guidelines/SKILL.md`)

1. **코딩 전에 생각** — 추측 말고, 모르면 묻는다. 해석이 여럿이면 **다 제시한다**.
2. **단순함 우선** — 시킨 것만, 최소 코드로. 요청 안 한 유연성·추상화 금지.
3. **외과수술식 변경** — 고쳐야 할 것만. 멀쩡한 옆 코드·주석·포맷을 「개선」하지 않는다.
4. **목표 기반** — **검증 가능한 성공 기준**을 먼저 정하고 통과할 때까지 반복한다.

⚠**검사 없다** — 사람(또는 검토자)이 지킬 규칙이다.

### ⓑ 새 코드의 자리 (배치 결정 트리)

| 물음 | 자리 |
|---|---|
| 없으면 앱이 안 뜨나 | `client/js/core/` |
| 둘 이상 기능이 함께 쓰나 | `client/js/shared/<utils\|ui\|geo\|tide>/` |
| 4개 탭 중 하나의 화면 기능 | `client/js/<forecast\|ocean-map\|marine-life\|notice>/<기능>/` |
| 탭 밖 독립 기능(푸시·위치·태풍·AI·설정·관리자) | `client/js/<기능>/` |
| 서버 코드 | `local_server/routes\|services\|advisory/` |

검사: `V2` 경로 무결성(`check_paths.js`) · `V3` 로드 순서(`check_order.js`) ·
`V2-b` 절대경로(`check_abs_paths.js`).

### ⓒ 반드시 지킬 것

| 규칙 | 검사 |
|---|---|
| **파일 헤더** — 역할(초보자용 1~3줄) + `[연계]` + `[로드 순서]` | ⚠검사 없다 (`check_comment_only.js` 는 있으나 게이트에 안 걸려 있다) |
| **함수 주석** — 무엇을 한다 + 예시 + `@param/@returns` + `[연계]` | ⚠검사 없다 |
| **문서는 코드와 같은 커밋**에서 갱신 | ⚠검사 없다(규약) |
| **설계도면 재생성** — 파일 추가·이동·삭제 시 `node scripts/refactor/gen_architecture.js > ARCHITECTURE.md` | ⚠검사 없다 — 게이트가 도면 최신성을 안 본다 |
| **로드 순서** — `index2.html` script 순서 = 실행 순서(번들러 없다) | `V3` 로드 순서 |
| **커밋 전 게이트 통과** | `verify_all.sh`(CI 가 자동으로 돈다 — `.github/workflows/verify-all-gate.yml`) |
| **화면을 뜯기 전에 시험을 깐다** — 특히 **관리자·운영자 화면**(아무도 비명을 안 지른다) | `test_admin_cards`(카드 7종) · `test_chat_render`(답변 렌더) |

### ⓓ 단계가 끝날 때마다 네 가지 (사장님 확정 2026-08-20)

1. **기계 확인** — 그 단계가 건드린 검사를 돌린다. **숫자가 나빠졌으면 넘어가지 않는다.**
2. **판정 근거 확인** — 그 단계가 낸 「없다·못 한다」를 표본으로 뽑아 **확인 기록이 있는지** 본다. 없으면 무효다.
3. **도구 자체 의심** — 새 검사를 만들었으면 *"이 검사가 통과했다고 정말 괜찮은가? 무엇을 안 보고 있나?"*
4. **결과 기록** — 「확인함」이 아니라 **무엇을 어떻게 확인했는지** 커밋 메시지에 적는다.

---

## §4. git — 디렉토리째 금지 (사장님 확정 2026-08-23 · **L-171**·L-179)

| 규칙 | 실제로 난 사고 | 검사 |
|---|---|---|
| `git add -A` · `git add .` **금지** | 남의 미완성 작업을 커밋에 쓸어담았다(2회) | ⚠검사 없다 — 습관으로 지킨다 |
| `git checkout -- <디렉토리>` **금지** | 남이 방금 끝낸 판독 23장을 지웠다(「500m→50m」 같은 안전 직결 수정이 날아갔다). 2026-09-25 에 또 났다 — 되돌리기 한 번이 **남의 수정 둘**을 지웠다(**L-388**) | ⚠검사 없다 |
| **파일을 고치는 스크립트는 자기가 고친 경로를 남긴다** — `_dashboard/loop/_touched.py` 의 `Touched` | 되돌릴 목록이 없으면 디렉토리째 되돌리게 된다 | `V5-33` 원문 수정의 되돌리기 기록 |
| **되돌릴 때는 그 목록만** — `python3 _dashboard/loop/_touched.py --revert <기록파일>` | 같은 이유 | `V5-33` |
| **커밋은 경로를 개별 지정한다.** 좁혀야 하면 `git add -- <경로> ':(exclude)<남의 경로>'` | 같은 이유 | ⚠검사 없다 |

---

## §5. 원문(raw)·위키

### ⓐ 데이터 품질 4축 — 이 순서로 본다 (사장님 확정 2026-08-20)

| 축 | 무엇 | 검사 |
|---|---|---|
| ① **수집** | 자료가 실제로 있나 — **「구조적으로 못 얻는 것」과 「얻을 수 있는데 안 한 것」을 반드시 가른다** | `V5-9`(`collect_eval.js`) |
| ② **형태** | 챗봇이 읽을 수 있는 꼴인가 | `V5-3`(`citation_table_scan.js`) |
| ③ **도달** | 챗봇이 실제로 그 자료에 닿는가 | `V5-5`·`V5-7`·`V5-8`·`V5-8c` |
| ④ **연결** | 자료끼리 이어져 있는가 | `V5-2`(깨진 링크) · `V5-10`(한쪽만 걸린 링크) |

> ⚠**정정 (2026-09-25)** — `CLAUDE.md` 는 *"①없음(신설 예정) … 비대칭 링크갭은 미게이트"* 라고
> 적고 있다. **낡았다.** ①은 `V5-9`, 비대칭 링크는 `V5-10` 이 지금 본다(`verify_all.sh` 515·523행).
> 옛 문장은 지우지 않고 이 정정을 붙인다.

### ⓑ 원문을 고칠 때

- **원문(raw)을 고치는 일은 되돌릴 수 있어야 한다** — `Touched` 기록 없이 고치지 않는다 (`V5-33`).
- **발췌본은 발췌라고 적는다** — 마무리 정직문구 3종(A·B·C) (`V5-38` · `V5-36` 발췌 범위가 사실인가).
- **「다음 각 호」라 해 놓고 그 글이 없으면** 결손이다 (`V5-16`).
- **아직 오지 않은 시행일의 조문을 현행으로 쓰지 않는다** (`V5-14`).
- **같은 고시 사본끼리 판이 맞아야 한다** (`V5-15`).

### ⓒ 위키에 올릴 때(승급)

- 승급 요건은 `_SCHEMA §5-D` 다. 기계 판정은 `V5-13` 이 **이번에 올린 쪽만** 본다.
- **사람이 봐야 하는 것은 `⚠REVIEW` 마커로 남기고 대기열에 등록한다**
  (`V5-24` · `test_review_marker_registered` · `test_unverified_review`).
- **위키 표준 절**은 `06_STANDARD_SECTIONS.md` 가 아니라 `_dashboard/section_rules.json` 이 정한다
  (글만 있고 검사가 없던 자리였다 — 뿌리 사슬 ③). 검사 `V5-35` · `test_section_ready`.
- **점수에 과거 서술을 섞지 않는다** — 「변경 이력」 절은 검색 점수에서 뺀다. 단 **본문은 그대로 둔다**
  (인용·모델 컨텍스트·되묻기는 본문 전체를 봐야 한다). 검사 `test_score_body`.

---

## §6. 등록부(`00_WORKLIST.md`)·기록

| 규칙 | 왜 | 검사 |
|---|---|---|
| **칸 머리의 마커가 그 항목의 상태다.** 끝냈으면 **머리를 먼저** 바꾸고 옛 마커는 취소선으로 남긴다 | 칸 안에는 「완료」가 적혀 있는데 머리가 ⬜ 인 칸이 계속 나왔다 | `V5-44` |
| **진행판 숫자는 손으로 고치지 않는다** — `python3 _dashboard/loop/worklist_progress.py --update` 가 다시 쓴다 | 손으로 적으면 반드시 틀린다 | `V5-44` |
| **새 교훈은 `_LESSONS.md` 맨 아래에 append 한다.** 번호를 겹치지 않는다 | 번호가 겹치면 인용이 가리키는 곳이 둘이 된다 | `V5-19` 교훈 번호 겹침 |
| **색인·목록을 만드는 자가 있으면 같은 커밋에서 다시 돌린다** (**L-209**) | 색인이 본문보다 낡으면 계기판이 거짓을 찍는다 | `V5-0` 계기판 최신성 |
| **이 규칙집의 검사 목록은 손으로 적지 않는다** — `python3 scripts/refactor/gen_rulebook.py` 가 찍는다 | 손으로 적은 목록이 낡는 것이 이 문서가 막으려는 병 그 자체다 | `V5-47` 규칙집 검사 목록 최신성 |

---

## §7. 사람만 할 수 있는 일 — 기계가 대신 고르지 않는다 (**G-34**)

- **판정이 갈리는 칸**(원문 대조가 필요한 인용, 이름이 바뀐 것인지 폐지인지) — 기계는 **후보만** 낸다.
- **사장님 결심이 필요한 칸**은 등록부에 🔴 로 두고 **선택지 ⓐⓑⓒ 와 추천**을 적는다. 기계가 고르지 않는다.
- **검토 화면을 눌러 확정하는 일** — `review_html/*.html`(인용 원문대조 · 고시 적용범위 · 별표 항목수).

---

## §8. 검사 목록 (기계가 찍는다)

<!-- 검사목록:시작 — `python3 scripts/refactor/gen_rulebook.py` 가 다시 쓴다. 손으로 고치지 않는다 -->

### ⓐ 게이트 54 개 — `bash scripts/refactor/verify_all.sh` 가 한 번에 돈다

| 검사 이름 | 무엇을 못박나 | 자 |
|---|---|---|
| `V5-0` | 계기판 최신성(색인이 위키보다 낡지 않았나) | `local_server/knowledge/legal/_dashboard/loop/index_fresh.py` |
| `V5-3` | 근거 조문 표 무결성 | `local_server/knowledge/legal/_dashboard/loop/citation_table_scan.js` |
| `V5-4` | 정답 페이지 도달 | `local_server/knowledge/legal/_dashboard/loop/page_eval.js` · `local_server/knowledge/legal/_dashboard/loop/context_eval.js` · `local_server/knowledge/legal/_dashboard/loop/reach_eval.js` |
| `V5-5` | 근거 조문 행 도달성 | `local_server/knowledge/legal/_dashboard/loop/reach_eval.js` |
| `V5-6` | 근거 조문 인용 존재성 | `local_server/knowledge/legal/_dashboard/loop/cite_exists.js` |
| `V5-7` | 골든 문항 근거 도달성 | `local_server/knowledge/legal/_dashboard/loop/golden_eval.js` |
| `V5-8` | 조문 링크 도달성(눌러서 원문이 열리나) | `local_server/knowledge/legal/_dashboard/loop/link_ready.js` |
| `V5-8c` | 고시 지도 최신성(다른 부처 고시를 찾을 수 있나) | `local_server/knowledge/legal/_dashboard/loop/sync_notice_index.py` |
| `V5-23` | 본문 그림 도달성 | `local_server/knowledge/legal/_dashboard/loop/body_image_ready.js` |
| `V5-22` | 근거 조문 표의 법령 칸 특정 | `local_server/knowledge/legal/_dashboard/loop/law_cell_named.js` |
| `V5-18` | 꼬리표 판번호 제자리 | `local_server/knowledge/legal/_dashboard/loop/meta_schema_gate.js` |
| `V5-19` | 교훈 번호 겹침 | `local_server/knowledge/legal/_dashboard/loop/lesson_no_gate.js` |
| `V5-24` | 「사람이 봐야 한다」 표시 | `local_server/knowledge/legal/_dashboard/loop/admrul_review_gate.js` |
| `V5-25` | 74법 목록 밖 기준법급 부령 | `local_server/knowledge/legal/_dashboard/loop/tier1_outside_gate.js` |
| `V5-26` | §8-B 줄번호 인용 | `local_server/knowledge/legal/_dashboard/loop/line_cite_gate.js` |
| `V5-27` | §5-D ⓕ 각 호 개수 | `local_server/knowledge/legal/_dashboard/loop/ho_count_gate.js` |
| `V5-28` | 목차 링크 도달성 | `local_server/knowledge/legal/_dashboard/loop/index_links_gate.js` |
| `V5-29` | 감사 교차오염 | `local_server/knowledge/legal/_dashboard/loop/audit_crosstalk_gate.js` |
| `V5-30` | 검수 대기 수 일치 | `local_server/knowledge/legal/_dashboard/loop/review_count_agree_gate.js` |
| `V5-31` | 조문 머리줄 없는 원문 | `local_server/knowledge/legal/_dashboard/loop/article_head_missing_gate.js` |
| `V5-32` | 계층 별표 도달성 | `local_server/knowledge/legal/_dashboard/loop/byl_tier_ready.js` |
| `V5-33` | 원문 수정의 되돌리기 기록 | `local_server/knowledge/legal/_dashboard/loop/raw_touch_guard.js` |
| `V5-34` | 기준법·타법 이중 폴더 | `local_server/knowledge/legal/_dashboard/loop/dup_law_folder_gate.js` |
| `V5-35` | 위키 표준 절 | `local_server/knowledge/legal/_dashboard/loop/section_ready.js` |
| `V5-36` | 발췌 범위가 사실인가 | `local_server/knowledge/legal/_dashboard/loop/article_range_gate.js` |
| `V5-37` | 머리말이 본문을 잘라먹지 않나 | `local_server/knowledge/legal/_dashboard/loop/head_prose_gate.js` |
| `V5-38` | 마무리 정직문구 | `local_server/knowledge/legal/_dashboard/loop/honest_phrase_gate.js` |
| `V5-39` | 별표 파일의 속 | `local_server/knowledge/legal/_dashboard/loop/byl_body_census.js` |
| `V5-40` | 별표 항목수 대조 | `local_server/knowledge/legal/_dashboard/loop/annex_rowcount_gate.js` |
| `V5-41` | 「실측」 칸 | `local_server/knowledge/legal/_dashboard/loop/meta_measured_gate.js` |
| `V5-42` | 별표 줄의 임자 | `local_server/knowledge/legal/_dashboard/loop/annex_row_coverage.js` |
| `V5-43` | 인용 없는 EXACT 주장 | `local_server/knowledge/legal/_dashboard/loop/exact_claim_recheck.py` |
| `V5-46` | 본문이 가리키는데 없는 별표 | `local_server/knowledge/legal/_dashboard/loop/byl_ref_gap.py` · `loop_tool_census.js` |
| `V5-45` | 안 짚히는 자 | `local_server/knowledge/legal/_dashboard/loop/loop_tool_census.js` |
| `V5-44` | 진행판 = 실측 | `local_server/knowledge/legal/_dashboard/loop/worklist_progress.py` |
| `V5-49` | [미확인] 없이 나가는 REVIEW 줄 | `local_server/knowledge/legal/_dashboard/loop/unverified_leak_gate.js` |
| `V5-48` | 모델이 받는 근거자료 크기 | `local_server/knowledge/legal/_dashboard/loop/context_size.js` · `scripts/refactor/gen_rulebook.py` |
| `V5-47` | 규칙집 검사 목록 최신성 | `scripts/refactor/gen_rulebook.py` |
| `V5-20` | 표가 열 단위로 펼쳐진 자리 | `local_server/knowledge/legal/_dashboard/loop/col_split_scan.js` |
| `V5-21b` | 법률계열 별표 도달성(줄) | `local_server/knowledge/legal/_dashboard/loop/byl_line_ready.js` |
| `V5-21a` | 계층 무접두 별표 파일 도달성 | `local_server/knowledge/legal/_dashboard/loop/byl_bare_ready.js` |
| `V5-11` | 별표 도달성(고시 별표를 눌러 열 수 있나) | `local_server/knowledge/legal/_dashboard/loop/annex_ready.js` |
| `V5-8b` | 원문 덮어쓰기 신호 — 같은 폴더에 같은 ID 가 둘 | `local_server/knowledge/legal/_dashboard/loop/dup_id_check.py` |
| `V5-8c` | 도달(품질 4축 ③) — 본문에 있는데 표에 없어 챗봇이 못 꺼내는 조문 | `local_server/knowledge/legal/_dashboard/loop/body_cite_gap.py` |
| `V5-9` | 수집(품질 4축 ①) — 가져야 할 원문이 손에 있나 | `local_server/knowledge/legal/_dashboard/loop/collect_eval.js` |
| `V5-10` | 연결(품질 4축 ④) — 한쪽만 걸린 링크 | `local_server/knowledge/legal/_dashboard/loop/link_sym.js` |
| `V5-2` | 위키 링크 무결성 | `_dashboard/loop/xref_check.py` · `local_server/knowledge/legal/_dashboard/loop/lint_stage_markers.py` |
| `V5-13` | 승급 요건(§5-D) — 이번에 canonical 로 올린 쪽만 본다 | `local_server/knowledge/legal/_dashboard/loop/promote_guard.js` |
| `V5-14` | 아직 오지 않은 시행일 | `local_server/knowledge/legal/_dashboard/loop/future_date_guard.py` |
| `V5-15` | 같은 고시 사본끼리 판이 맞나 | `local_server/knowledge/legal/_dashboard/loop/admrul_copy_sync.py` |
| `V5-16` | 「다음 각 목/각 호」라 해 놓고 그 글이 없는 자리 | `local_server/knowledge/legal/_dashboard/loop/mok_promise_guard.py` |
| `V5-17` | 파일에는 있는데 챗봇이 못 읽는 조문 | `local_server/knowledge/legal/_dashboard/loop/unreachable_article_guard.py` |
| — | 서버 스모크 (대표 엔드포인트) | (`verify_all.sh` 안에서 바로) |
| `V6` | API 자식 오염 가드 | (`verify_all.sh` 안에서 바로) |

### ⓑ 테스트 스위트 49 개 — 같은 게이트가 이어서 돈다

| 검사 이름 | 무엇을 못박나 |
|---|---|
| `test_child_relevance` | 자식 정합 필터(§7.7.26) 검증 |
| `test_child_unknown_gate` | 자식 정보 '미상' 게이트 검증 |
| `test_child_confirm` | 자식 확정 관찰창 회귀 테스트 |
| `test_ef_exact_refine` | 발효시각 "범위형 → 정확시각" 정밀화 알림 |
| `test_unverified_leak` | **V5-49 의 탐지기가 진짜 잡는지** 고정 문장으로 확인한다. |
| `test_cancel_verdict_room` | 판정 보류실 e2e 시뮬레이션 |
| `test_push_pagination` | 2026-07-13 실사고: 전국 구독자에게 여러 해역 동시 "발표"(publish) 푸시가 |
| `test_bulletin_cancel_scanner` | bulletin_cancel_scanner 단위 테스트 |
| `test_parent_release_debounce` | 부모 해제 디바운스 검증 |
| `test_zone_tree_wiring` | 해역·항해구역 트리(zone_tree.json) 실서빙 배선 회귀 테스트 |
| `test_ask_context` | 이해확인 · 상황질문(범위좁히기) · 온디바이스 프로필 확인 회귀 테스트 |
| `test_naver_term_step` | 모르는 구어 해소(네이버 뜻 확인) 회귀 테스트 |
| `test_article_images` | 조문 본문 안 원문 이미지 — 마커 정리·참조 상한 회귀 테스트 |
| `test_chat_render` | 답변 본문 조문 링크 · 별표 표 줄 잇기 회귀 테스트 |
| `test_glossary_parse` | 구어 표(`wiki/_glossary.md`) 파싱이 링크문법 때문에 줄을 잃지 않는가. |
| `test_citation_chain` | 근거 목록(citationChain)이 고시·지침·조례를 잃지 않는가. |
| `test_clarify_options` | 되묻기가 "어떤 법이냐"고 물으면서 정작 1순위 법을 빼놓지 않는가. |
| `test_unverified_review` | 미검증(⚠REVIEW) 내용을 **지우지 않고 표시해 보내는지** 고정한다. |
| `test_accident_sheet` | 사고 분석 바텀시트·격자가 조용히 깨지지 않게 고정한다. |
| `test_pending_law` | 예고본 사전수집·시행일 자동 전환(H-29 트랙 C)을 고정한다. |
| `test_hazard_rocks_tide` | 간출암 조석 곡선 팝업이 조용히 깨지지 않게 고정한다. |
| `test_guide_tabs` | 「안내」 팝업이 화면·데이터와 어긋나지 않게 고정한다. |
| `test_tab_structure` | 하단 메뉴·하위탭 구성이 조용히 되돌아가지 않게 고정한다. |
| `test_usage_keys` | 사용량 통계 회귀 검사 — ①앱이 세는 모든 기능 키에 한글 이름표가 있는가 |
| `test_maintenance_tree` | 점검 탭(선택 차단) 회귀 검사 — ①관리자 트리(admin.js featureTree)의 모든 id 가 |
| `test_overlay_solo` | 해양안전 오버레이가 "한 번에 하나만" 켜지는지 실제로 눌러 본다. |
| `test_wiki_brief_bulk` | 「위키 반영 지시문」을 만드는 `services/legal_wiki_brief.js` 가 **큐에 있는 것만** 옮겨 |
| `test_review_marker_registered` | 위키 본문에 `⚠REVIEW-<식별자>` 마커를 달아 놓고 **승인 대기열 |
| `test_stale_reopen` | 관리자가 닫아 둔 「원문신선도」 카드라도 **원문이 아직 낡아 있으면 다시 대기로 |
| `test_mok_audit_scanner` | 「원문결손」 스캐너(조문 목 누락 · 고시 별표 누락)의 배선이 **살아 있는지** 확인한다. |
| `test_add_other_law_refresh` | `add_other_law_article.js --refresh` 가 **raw 원문을 안전하게 갈아 끼우는지** |
| `test_pressure_card` | 바텀시트 "기압" 카드가 조용히 깨지지 않게 고정한다. |
| `test_typhoon_source` | 태풍 탭 "자료 출처" 전환이 조용히 깨지지 않게 고정한다. |
| `test_typhoon_jma` | 태풍 탭의 "일본(JMA)" 출처가 조용히 깨지지 않게 고정한다. |
| `test_byl_decl` | 별표 파일 **선언줄** 판독(`bylDeclLine`·`parseBylDecl`·`hasBylBody`). |
| `test_treaty_caselaw_meta` | §5-6 국제협약 · §5-7 판례변동 메타를 **읽는지** 고정한다. |
| `test_context_budget` | 모델에게 넘기는 [근거자료]의 **합계 상한**(P-19)을 고정한다. |
| `test_counting_dict` | ★**세는 법 사전**(2-6)이 정한 뜻과 범위를 고정한다. |
| `test_silent_catch` | 2-6b ★「조용히 삼키는 catch」의 뜻을 고정하고 **늘지 못하게** 막는다. |
| `test_gate_5xx_class` | G-47 ★V4 게이트가 5xx 를 「환경」으로 봐주는 **잠금**을 고정한다. |
| `test_meta_schema` | 2-2 ★꼬리표(`_meta.json`) 의 **뜻과 제자리**를 고정한다. |
| `test_admrul_review` | V5-24 의 자를 고정한다 — 「사람이 봐야 한다」 표시 세는 법 (2026-09-23, G-24 · 2-19) |
| `test_ho_count` | §5-D ⓕ 「각 호 N개」 세는 법을 못박는다 (2026-09-23, G-7) |
| `test_section_ready` | V5-35(위키 표준 절)의 「세는 법」을 못박는다. (3-4) |
| `test_treaty_article` | **조약 조문머리(꼴④)** 를 못박는다. (3-51) |
| `test_byl_body_kind` | 별표 파일의 **속이 무엇인가**를 세 갈래로 가르는 자를 못박는다. (3-49) |
| `test_box_rows` | `countBoxRows()` — 표의 「행」을 세는 자 (Q-18 결심 ①, 2026-09-24). |
| `test_score_body` | ★「변경 이력」이 **검색 점수에서 빠졌는지**를 고정한다. (결심 4-5ⓐ) |
| `test_admin_cards` | ★관리자 검토 카드 **7종의 HTML 을 못박는다**. (4-1 · 4-3) |

> 위 두 표는 **기계가 찍은 것**이다 — `verify_all.sh` 의 절 머리줄과 `SUITES` 배열,
> 그리고 각 스위트 파일 머리 주석에서 그대로 뽑았다. 손으로 고치면 다음 실행에 사라진다.
> 낡았는지는 `python3 scripts/refactor/gen_rulebook.py --check` 가 잰다(게이트 **V5-47**).

<!-- 검사목록:끝 -->

---

## §9. ⚠규칙인데 검사가 없는 자리 (뿌리 사슬 ③을 눈에 보이게 둔다)

아래는 **글로만 있는 규칙**이다. 없다고 적어 두는 것이 지금 할 수 있는 정직한 일이다.

| 규칙 | 왜 아직 검사가 없나 |
|---|---|
| 카파시 4 (단순함·외과수술식 변경) | 사람의 판단이다. 검토자가 본다 |
| 파일 헤더·함수 주석 표준 | `check_comment_only.js` 가 있는데 **게이트에 안 걸려 있다** — 걸 수 있는 일감이다 |
| `ARCHITECTURE.md` 재생성 | 도면 최신성을 재는 자가 없다 — `gen_architecture.js` 출력과 견주면 된다 |
| 「없다·못 한다」에 확인 기록 | 대화·커밋 메시지 속 진술은 기계가 못 잡는다 |
| `git add -A` 금지 | 훅으로 막을 수는 있으나 아직 없다 |
| 병렬 경합 규칙 | 어떤 파일을 동시에 쓰는지 사후에만 안다 |
| 시간 표기 KST · 응답 언어·난이도 | 기계가 잴 대상이 아니다 |

---

## §10. 이 문서와 다섯 문서의 관계

| 문서 | 크기 | 지금 어떤 구실인가 |
|---|---|---|
| **이 `_RULES.md`** | 30KB 안 | **지금 지켜야 할 것** — 먼저 읽는다 |
| `HANDOFF.md` | 2.1MB | **작업 이력·현재 상태 스냅샷** — 「무엇을 하던 중이었나」 |
| `MASTER_PLAN.md` | 347KB | **단계별 계획(H-번호)** — 「왜 그렇게 하기로 했나」 |
| `_SCHEMA.md` | 145KB | **위키 구축 상세 규약(§번호)** — 「정확히 어떤 꼴인가」 |
| `_CHATBOT.md` | 95KB | **챗봇 답변·검색 상세 규약(§번호)** |
| `README.md` | 9.5KB | 총괄 안내 |
| `_LESSONS.md` | 1MB | **시행착오 로그(L-번호, 추가만)** — 「전에 어떻게 틀렸나」 |

**어느 쪽이 옳은가** — ①**검사** ②이 문서 ③다섯 문서. 검사는 실제로 돌고, 글은 낡는다.
다섯 문서에서 낡은 것을 찾으면 **지우지 말고 정정을 붙이고**, 여기에도 반영한다(등록부 `2-5`).
