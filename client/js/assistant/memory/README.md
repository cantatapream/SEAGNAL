# memory  `local_server/js/assistant/memory/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `user_memory_bridge.js` | 사용자 기억 v2 — E3 통합 다리. 채팅(WebView) ↔ 자바 Plugin/IndexedDB 의 | `nativePlugin`, `webModule`, `swallow`, `now`, `safeDispatch`, `lsGet` |
| `user_memory_web.js` | SEAGNAL 사용자 기억 v2 — 웹(브라우저) 측 IndexedDB 어댑터 (E2 트랙) | `_idbAvailable`, `_openDB`, `_ensureMode`, `_req`, `_tx`, `_txDone` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
