# settings  `local_server/js/settings/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `settings.js` | 탭 시스템, 스타일 주입, 사용자 설정, 알림 설정, 위치 기반 검색 | `initTabs`, `injectTabStyles`, `injectGlobalStyles`, `initNotificationUI`, `updateRadioVisual`, `updateMasterState`, `UserSettings.hasInterestZones`(관심해역 골랐나 — 꺼 둔 구역이 하나라도 있으면 참. 특보현황 ⚙·관심 기상청이 씀, 2026-10-17) |
| `zone_guide.js` | 관심 해역 설정 유도 팝업 (1회성 넛지) | `checkZoneGuide`, `isAllZonesOn`, `showZoneGuideModal`, `showZoneGuideToast` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## "푸시 알림 받기"를 직접 끈 경우 지키기 (2026-11-18)

종전에는 폰의 알림 권한이 허용돼 있으면 앱을 켤 때마다 `capacitor-plugins.js` 가 저장값의 `master` 를 켬으로 덮어써,
**앱 설정에서 끈 알림이 다음 실행 때 다시 켜지고 서버에도 켬으로 전달됐다**(끈 사용자에게 푸시가 다시 감).

| 언제 | 무엇을 | 함수 |
|---|---|---|
| 설정 [저장] — 켜져 있던 것을 끔 | 폰에 `push_master_user_off = '1'` 표시를 남김 | `settings.js markPushMasterUserOff` |
| 설정 [저장] — 켬 | 표시를 지움 | 같은 함수 |
| 설정 [저장] — 원래 꺼져 있던 채 | 그대로(표시 안 남김 — 한 번도 켠 적 없는 사람이 나중에 폰 권한을 허용하면 자동으로 켜져야 한다) | 같은 함수 |
| 앱 실행 — 폰 권한 허용 | 표시가 없으면 자동으로 켬, **있으면 건드리지 않음** | `capacitor-plugins.js autoEnableMasterOnGrant` |

- 저장 전 값은 **저장소에서** 읽는다(메모리 값은 `capacitor-plugins.js` 가 저장소를 직접 바꾼 뒤 낡을 수 있다). 같은 이유로 `NotificationSettings.set()` 도 저장소를 먼저 다시 읽는다 — AI 챗봇 답변알림 [허용](`ai_chat.js`)이 낡은 `master=false` 를 서버로 보내던 것이 함께 풀린다(독립 검토 2026-11-18).
- 직접 끈 사람이 폰 권한을 껐다가 나중에 허용해도 자동으로 켜지지 않는다(직접 끈 것이 우선) — 권한 안내 팝업에 「허용한 뒤 스위치를 다시 켜고 [저장]」을 적어 뒀다.
- 과거에 껐다가 이미 켬으로 되돌아간 기기는 복구할 수 없다(무엇이 원래 뜻이었는지 기록이 없다) — 다시 끄면 그때부터 유지된다.
- 시험: `local_server/scripts/test_push_master_keep.js` (위 표의 행 + 재설치·다른 설정 보존 등 8가지).
