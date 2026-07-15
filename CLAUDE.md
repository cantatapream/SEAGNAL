# CLAUDE.md — AI 작업 지침

## 모든 코드 작업의 기본 규칙 — 카파시 가이드라인 (필수)
코드를 쓰거나·고치거나·리뷰할 때는 **항상 아래 4가지를 지킨다.** 상세 규칙은
`.claude/skills/karpathy-guidelines/SKILL.md`를 읽고 따른다. (사소한 작업은 판단해서 융통성 허용)

1. **코딩 전에 생각** — 추측하지 말고, 모르면 묻는다. 해석이 여럿이면 조용히 고르지 말고 다 제시한다. 더 단순한 방법이 있으면 말한다. 혼란을 숨기지 않는다.
2. **단순함 우선** — 시킨 것만, 최소 코드로. 요청 안 한 유연성·추상화·불필요한 예외처리 금지. 200줄이 50줄로 되면 다시 쓴다.
3. **외과수술식 변경** — 고쳐야 할 것만 건드린다. 멀쩡한 옆 코드·주석·포맷을 '개선'하지 않는다. 기존 스타일에 맞춘다. 관계없는 죽은 코드는 지우지 말고 언급만 한다.
4. **목표 기반 실행** — "되게 해줘"가 아니라 **검증 가능한 성공 기준**을 먼저 정하고 통과할 때까지 반복한다.

---

**코드를 추가·수정하기 전에 반드시 [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) 를 먼저 읽고 그 절차를 따르세요.**
현재 구조는 [ARCHITECTURE.md](ARCHITECTURE.md) 참고.

아래는 가이드의 핵심 요약(전체는 위 문서). 이것만으로 판단하지 말고 가이드 원문을 확인하세요.

## 배치 결정 트리 (새 코드의 자리)

1. 없으면 앱이 안 뜨나? → `client/js/core/`
2. 둘 이상 기능이 함께 쓰나? → `client/js/shared/<utils|ui|geo|tide>/`
3. 4개 탭 중 하나의 화면 기능? → `client/js/<forecast|ocean-map|marine-life|notice>/<기능>/`
4. 탭 밖 독립 기능(푸시·위치·태풍·AI·설정·관리자)? → `client/js/<기능>/`
5. 서버 코드? → `local_server/routes|services|advisory/`

## 반드시 지킬 것

- **파일 헤더**: 역할(초보자용 1~3줄) + `[연계]`(사용파일/서버API/마크업/호출처) + `[로드 순서]`
- **함수 주석**: 무엇을 한다 + 예시 + `@param/@returns` + `[연계]`(누구와/어디의/왜)
- **문서**: 코드와 **같은 커밋**에서 README/guide 갱신
- **설계도면**: 파일 추가·이동·삭제 시 `node scripts/refactor/gen_architecture.js > ARCHITECTURE.md` 재생성
- **로드 순서**: index2.html script 순서 = 실행 순서. 함부로 바꾸지 말 것 (번들러 없음)
- **검증**: 커밋 전 `bash scripts/refactor/verify_all.sh` 통과

## 커밋 전 체크리스트

```
□ 배치 트리로 자리 결정   □ 파일 헤더 표준   □ 함수 주석(왜-연계)
□ README/guide 갱신       □ 로드 순서 등록   □ ARCHITECTURE.md 재생성
□ verify_all.sh 통과      □ 문서·도면·코드 같은 커밋
```
