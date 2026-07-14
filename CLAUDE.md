# CLAUDE.md — AI 작업 지침

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
