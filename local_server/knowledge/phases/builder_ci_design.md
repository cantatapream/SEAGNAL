# 빌더 CI 자동화 설계안

나리야 지식 빌더(데이터 카탈로그·그래프·임베딩)와 Phase 0 게이트를 PR/푸시 시 자동 검증해
**드리프트·무결성 회귀를 머지 전에 차단**한다. 동봉 초안: `ci_workflow_draft.yml`.

> 경로 주의: 레포 루트는 `SEAGNAL/`, 빌더는 `SEAGNAL/local_server/knowledge/...` 에 있다.
> 따라서 모든 잡은 `working-directory: local_server` 로 동작. 워크플로 파일은 메인이
> `SEAGNAL/.github/workflows/` 로 이동(현재 `deploy.yml`·`deploy-staging.yml` 와 동거).

---

## 1. 설계 원칙

1. **키 없이 도는 검사 = 머지 차단(필수)**, **키/서버 필요한 검사 = 분리(옵션·비차단 또는 별도 시크릿 잡)**.
   - `build_data_catalog.js`·`build_graph.js`·phase0 정적검사 3종은 순수 fs/정규식 → 키 불요 → 게이트.
   - 골든 회귀(`phase0_runner.py` 라이브 호출)·임베딩 빌드는 외부 키/서버 필요 → 분리.
2. **외부 의존(marine.kma·KHOA·Gemini) 격리**: 네트워크 호출이 필요한 잡은 PR 게이트에서 빼고
   시크릿 보유 잡으로만 실행. PR 위양성(외부 API 일시 장애)으로 머지가 막히지 않게 한다.
3. **시크릿 비노출**: 게이트 잡들은 `secrets` 를 일절 참조하지 않는다(포크 PR 에서도 안전).

---

## 2. 잡 구성

| 잡 | 트리거 | 키/서버 | 머지 차단 | 내용 |
|----|--------|---------|-----------|------|
| `lint` | PR·push | 불요 | **차단** | node `--check` 문법체크, python `compile` 문법체크 |
| `builders` | PR·push | 불요 | **차단** | `build_data_catalog.js`(드리프트 exit 1) + `build_graph.js`, 산출물이 커밋본과 동일한지 `git diff` 확인 |
| `phase0-static` | PR·push | 불요 | **차단** | phase0 정적검사 3종(관리자격리·그래프무결성·카탈로그드리프트)만 추출 실행 |
| `embeddings` (옵션) | 수동/스케줄 | `GEMINI_API_KEY` | 비차단 | 임베딩 캐시 재생성 검증. PR 게이트에서 제외 |
| `golden-gate` (별도) | 수동/스케줄 | 다수(아래) | 비차단 | 서버 부팅 후 `phase0_runner.py` 라이브 골든 |

### 2-1. `lint` — 문법체크 (c)
- Node: `git ls-files '*.js'` 의 각 파일을 `node --check`.
- Python: `python -m py_compile` 로 phases/*.py 컴파일. 외부 패키지 불요(표준 라이브러리만 import).

### 2-2. `builders` — 드리프트 검출 (a)
- `node knowledge/build_data_catalog.js`: cache_manager 키·assistant.js TOOL_EXEC 와 META/ONDEMAND 의
  양방향 드리프트를 검출해 exit 1. CI 가 그대로 실패한다.
- `node knowledge/graph/build_graph.js`: 그래프 재생성(순수, 의존성 0).
- **산출물 신선도**: 빌드 후 커밋본과 재빌드본을 비교. 단 두 산출물 모두 매 빌드 `builtAt` 시각을
  새로 쓰므로 **단순 `git diff` 는 항상 실패**(위양성). 타임스탬프 줄(`"builtAt"`)을 제외하고 비교해
  실제 데이터 드리프트만 잡는다(검증 완료). 커밋된 산출물이 소스와 어긋나면 실패 → "빌드하고 커밋하라" 신호.

### 2-3. `phase0-static` — 정적검사 3종 (b)
`phase0_runner.py` 는 모듈 끝에서 `main()`(골든=서버 호출)을 **무조건 실행**한다. 따라서 단순
`import` 는 서버를 기다리며 멈춘다. CI 에선 소스에서 `main()` 호출만 제거하고 `exec` 해 정적 함수
3개만 호출한다(파일 자체는 수정 불필요. 실제 검증 완료):

```python
import re, sys, os
src = open('phase0_runner.py', encoding='utf-8').read()
src = re.sub(r'^main\(\)\s*$', '', src, flags=re.M)   # 서버 호출 자동실행 방지
ns = {'__name__': 'phase0_ci', '__file__': os.path.abspath('phase0_runner.py')}
exec(compile(src, 'phase0_runner.py', 'exec'), ns)
probs = ns['static_security_check']() + ns['graph_integrity_check']() + ns['data_catalog_check']()
[print('FAIL:', x) for x in probs]; sys.exit(1 if probs else 0)
```

> 권고: 메인이 `phase0_runner.py` 끝줄을 `if __name__ == "__main__": main()` 로 가드하면 이 우회가
> 사라지고 `phase0-static` 잡이 평범한 import 로 단순화된다.

- `static_security_check` : 관리자 도구 격리(`/api/admin` 호출·`admin*` 도구 정의 금지).
- `graph_integrity_check` : 8직군·servedBy≥50·직군별 관심사·런타임 연결.
- `data_catalog_check` : 카탈로그 단일출처 드리프트(캐시키·도구 누락).

> 의존: 이 잡은 `builders` 이후여야 `data_catalog.json`·`graph.json` 최신본으로 검사 가능.
> 초안에선 `phase0-static` 가 빌더를 다시 돌려 자족적으로 만든다(잡 간 아티팩트 전달 불필요).

### 2-4. `embeddings` — 임베딩(옵션) (d)
- `services/topic_embedding.js` 는 `GEMINI_API_KEY` 필요. 키 없으면 빌더가 silent 폴백 →
  PR 게이트에 넣으면 "조용히 통과"라 무의미. 따라서 **PR 게이트에서 제외**, 수동/스케줄 잡으로만.

### 2-5. `golden-gate` — 라이브 골든(별도, 시크릿 필요)
- 서버 부팅(`node server.js`) 후 `python3 phase0_runner.py http://127.0.0.1:3001`.
- 외부 API(기상청 marine·apihub, KHOA, Gemini)에 실호출 → **PR 차단 게이트로 부적합**(외부 장애 위양성).
- `workflow_dispatch` + nightly `schedule` 로만. 시크릿 목록은 §3.

---

## 3. 시크릿 목록

게이트 잡(`lint`/`builders`/`phase0-static`)은 **시크릿 0개**. 아래는 분리 잡 전용.

| 시크릿 | 사용 잡 | 용도 |
|--------|---------|------|
| `GEMINI_API_KEY` | embeddings, golden-gate | Gemini 임베딩·LLM 추론 |
| `MARINE_USER_ID` / `MARINE_USER_PWD` | golden-gate | 기상청 marine.kma 로그인 크롤링 |
| `ROMS_SERVICE_KEY` | golden-gate | KHOA 해류·낚시·서핑 등 |
| `KAKAO_REST_API_KEY` | golden-gate | 지명→좌표(resolve_location) |
| `ADMIN_PASSWORD` | golden-gate | 관리자 라우트(서버 부팅 시) |
| `VAPID_*`, `CLOUDINARY_*` | golden-gate | 서버 부팅 의존(없으면 부팅 실패 가능) |

운영 팁: golden-gate 는 `MARINE_DISABLE=1` 로 외부 의존을 줄여 콜드스타트 안정화 후,
golden 의 `optional=true` 케이스는 SKIP 처리(러너 내장)되어 외부 피드 장애 시에도 비차단.

---

## 4. 자체검토(2차 pass)

- **시크릿 노출**: 게이트 3잡에 `secrets.*` 참조 전무 → 포크 PR 도 안전. 시크릿은 golden-gate/
  embeddings 잡에만 `env:` 로 주입, 로그 echo 금지(GitHub 가 마스킹하나 출력 자체를 피함).
- **실행시간**: lint/builders/phase0-static 모두 순수 fs·정규식·문법체크라 수 초~수십 초. `npm ci`
  불필요(빌더는 의존성 0). 단 lint 의 `node --check` 대상에 server.js 등 런타임 require 가 있는
  파일도 포함되나 `--check` 는 실행 아닌 파싱만이라 안전·고속.
- **외부의존 분리**: marine.kma/KHOA/Gemini 실호출은 전부 golden-gate(별도·비차단)로 격리.
  PR 게이트는 네트워크 0. 외부 API 장애가 머지를 막지 않는다.
- **타임스탬프 위양성 회피**: 두 산출물의 `builtAt` 때문에 단순 diff 가 항상 실패하므로 신선도
  검사는 해당 줄을 제외하고 비교한다(위 §2-2). 실제 검증으로 확인.
- **`phase0_runner.py` 자동 main() 함정**: 단순 import 시 골든(서버 호출)이 돌아 멈춘다 → §2-3 우회 적용.
- **남은 리스크**: 신선도 검사는 빌더 산출물을 레포에 커밋하는 정책 전제. 산출물을 .gitignore 한다면
  이 스텝을 제거하고 "빌드 성공" 만으로 충분.

요약: PR 게이트=키0·네트워크0의 3잡(문법·드리프트·정적무결성), 외부의존/서버 필요분은 시크릿 보유 별도 잡으로 분리.

[2차 검토] 이상 없음
