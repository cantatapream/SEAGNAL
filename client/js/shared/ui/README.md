# ui  `local_server/js/shared/ui/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ui_modal.js` | 공통 UI 모달 (기상청 iframe, SEAGNAL 시스템 모달) | `handleKmaLinkClick`, `openKmaIframeModal`, `closeKmaIframeModal`, `showSeagnalModal`, `closeSeagnalModal` |
| `locate_toast.js` | 「내 위치」(GPS) 버튼 진행 토스트 — 「위치정보를 확인하고 있어요」 스피너 → 성공 시 초록 체크 → fade out / 실패 시 주황 느낌표 + 「위치를 확인하지 못했어요」 두 줄 → fade out (2026-11-18 사용자 확정, 종전 5곳 alert 경고창 대체). 위치는 콜백으로만 넘기고 서버로 보내지 않는다(`test_guide_tabs` [2b] 가 확인) | `locateWithToast` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
