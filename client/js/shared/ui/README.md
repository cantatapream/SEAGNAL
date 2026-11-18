# ui  `local_server/js/shared/ui/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ui_modal.js` | 공통 UI 모달 (기상청 iframe, SEAGNAL 시스템 모달) | `handleKmaLinkClick`, `openKmaIframeModal`, `closeKmaIframeModal`, `showSeagnalModal`, `closeSeagnalModal` |
| `locate_toast.js` | 「내 위치」(GPS) 버튼 진행 토스트 — 「위치정보를 확인하고 있어요」 스피너 → 성공 시 초록 체크 + 「위치정보를 확인했어요」 → fade out / 실패 시 주황 느낌표 + 「위치를 확인하지 못했어요」 두 줄 → fade out (2026-11-18 사용자 확정, 종전 5곳 alert 경고창 대체). **자리**: 놓을 때마다 화면에 떠 있는 버튼·범례를 재서 아래쪽 요소 중 가장 높은 것 바로 위, 옆쪽 버튼 줄이 걸치면 남은 가로 공간 가운데(2026-11-18 사용자 「다른 버튼들이나 인터페이스와 겹치지 않게」). 위치는 콜백으로만 넘기고 서버로 보내지 않는다(`test_guide_tabs` [2b] 가 확인) | `locateWithToast` |
| `wheel_date_picker.js` | 앱의 모든 날짜칸(`<input type="date">`)·날짜시각칸(`datetime-local`)을 누르면 기본 달력 대신 화면 아래에서 올라오는 **휠 선택기**(년·월·일, 날짜시각칸은 시·분까지)를 띄운다(2026-11-18 사용자 요청 「캘린더 방식 → 휠 피커로 년월일 선택」). 칸마다 고치지 않고 문서 전체에서 누름을 가로채므로 새로 만드는 날짜칸도 자동 적용. 값 형식(`YYYY-MM-DD`)·`change` 이벤트는 원래와 같아 각 화면 코드는 그대로. 빼고 싶은 칸은 `data-native-picker` 속성. 원래 readonly·disabled 칸은 건드리지 않음. `min`·`max` 를 넘는 값은 끝으로 맞춤. 시험: `local_server/scripts/test_wheel_date_picker.js` | `WheelDatePicker.open`, `WheelDatePicker.close` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
