# assistant  `local_server/js/assistant/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `assistant.js` | SEAGNAL 음성 비서 프론트엔드 (호출어 "누구야" + STT + TTS + 텍스트 폴백) | `normalize`, `setStatus`, `setBanner`, `showEq`, `setHeard`, `setAnswer` |
| `assistant_deeplink.js` | AI 비서 답변의 "바로가기" 버튼 → 해양종합정보 페이지의 해당 레이어를 | `cleanUrl`, `waitFor`, `activateOverlay`, `activateToggle`, `run`, `appReady` |
| `assistant_overlay.js` | 백그라운드 "나리야" 음성 비서의 상태/대화를 앱 화면에 동적 오버레이로 표시. | `injectStyle`, `ensure`, `hideNow`, `hideSoon` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
