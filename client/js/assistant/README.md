# assistant  `local_server/js/assistant/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `assistant.js` | SEAGNAL AI 비서 프론트엔드 (글자 입력 질문 + 답변 표시 + TTS 읽어 주기. 마이크·음성 인식은 2026-11-19 제거) | `normalize`, `setStatus`, `setBanner`, `showEq`, `setHeard`, `setAnswer` |
| `assistant_deeplink.js` | AI 비서 답변의 "바로가기" 버튼 → 해양종합정보 페이지의 해당 레이어를 | `cleanUrl`, `waitFor`, `activateOverlay`, `activateToggle`, `run`, `appReady` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## 음성 비서 삭제 (2026-11-19, 사용자 지시)

> 원문: *"마이크가 들어가는 부분은 모두 제거해줘. 사용하지 않을거야."* · *"음성모델 ? 그것도 제거해줘."*

마이크로 듣는 기능을 앱 전체에서 뺐다 — 호출어("나리야") 상시 청취, 웹 음성 인식, 클라우드 받아쓰기, Vosk 음성 모델 내려받기.
- 지운 파일: `assistant_overlay.js`(상시 청취 상태 오버레이), 안드로이드 `voice/` 의 서비스·엔진 7개.
- 남긴 것: 글자 입력 질문, 답변 읽어 주기(TTS — 스피커 출력), 사용자 기억(`memory/`, 네이티브 `SeagnalAssistant` 플러그인의 기억 메서드).
- 서버 `POST /api/assistant/transcribe` 삭제. 관리자 센터 AI → AI 비서의 「마이크」·「음성 비서(나리야)」 줄 삭제.
- 상세·검사: `00_docs/operations/app-release-headsup-inapp-update.md` §3-1, `local_server/scripts/test_inapp_update_flow.js` [6].
