# cctv  `local_server/js/ocean-map/cctv/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `cctv1.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | — |
| `cctv4.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `handleCctvMapClick`, `showCctvPopup`, `_initCctvHlsPlayer`, `_startCoastImageRefresh`, `_stopCoastImageRefresh`, `_initSeafogSlider` |
| `ocean_cctv.js` | CCTV 레이어 + **해양종합정보 「안내」 팝업(13탭)** | `_buildInfoHtml`, `_buildSingleStyle`, `_buildFeatures`, `_ensureCctvLayer`, `_favLocStyle`, `_ensureFavLocLayer` |

### 해양종합정보 「안내」 팝업 (2026-09-09 개편, 13탭)

`INFO_TAB_ITEMS` 가 탭 목록이다. **원칙: 탭이 곧 그 화면의 버튼이다** — 화면에 버튼이 없는 기능은
탭으로 두지 않는다(사용자 확정). 그래서 옛 18탭에서 7개를 뺐다:

| 뺀 탭 | 이유 |
|---|---|
| 주요지명 · 내 위치 | 버튼이 화면에서 제거됨 |
| 물빠짐 · CCTV · 노출암·간출암 | 해양안전 전용으로 옮겨져 이 화면에서는 숨김 |
| 특보 ON/OFF | 별도 버튼이 아니라 **특보구역에 딸린 곁가지** → 특보구역 탭에 합침 |
| 시정 | **천기 팝아웃의 7번째 항목** → 천기 탭에 합침 |

새로 넣은 탭은 **천기**와 **태풍**(둘 다 버튼은 있는데 안내가 없었다 — 태풍 출처는
사용자 확정으로 *기상청 방재기상플랫폼*, `typhoon_crawler.js` 가 dmdw.kma.go.kr 에서 10분마다 수집). 이름이 바뀐 탭은 부이→**기상부이**,
해구도→**해구기상**. 조석 탭은 실제 동작(누른 좌표로 TideBED 직접 조회)에 맞춰 전면 재작성했다.
탭 순서는 화면 오버레이 버튼 순서를 그대로 따른다.

⚠`window.oceanInfoTabHtml()` 은 예전에 해양안전 안내가 본문을 빌려 가던 통로였는데, 개편으로
해양안전이 자기 문구를 갖게 되어 **현재 호출부가 없다**. 전역 함수를 지우면 V4 시뮬레이션의
"사라진 전역함수" 검사에 걸리므로 그대로 남겨 둔다.

회귀 검사: `local_server/scripts/test_guide_tabs.js` (탭 목록·순서·이름 + 본문 숫자 ↔ 데이터 대조).

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
