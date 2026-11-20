# 앱 1.3.0 — 헤드업 알림 · 앱 안 업데이트(유연형) · 음성 비서 삭제 (2026-11-19)

> 이 문서는 **APK(휴대폰 쪽)를 고친 작업**의 배경·설계·검증·배포 절차다.
> 서버·화면은 본 서버에 합치는 즉시 모든 사용자에게 반영되지만, APK 는 스토어 심사를 거쳐
> 업데이트한 사람에게만 가고 **잘못 나가면 다시 올려야 한다.** 그래서 설계 원칙이 "옛 버전을 건드리지 않는다"다.

## 1. 사용자 확정 사항 (원문)

> *"현재 우리 앱이 푸시를 발송하여 사용자가 푸시를 받았을 때 상태표시줄에만 푸시 왔다는 아이콘이 뜨고 상태표시줄을 아래로 내려야만 내용이 보이는데 카카오톡처럼 화면 위에 토스트 메시지로 나오게 하려면 어떻게 해야하는거니?"*

> *"앱 업데이트를 하고자 하는데 헤드업이 가능하도록 만들고자 해. 내 취지처럼. 그렇다면 그 기능이 반영되도록 apk를 수정하여야 하고,"*

> *"또한 "유연형 앱을 계속 쓰는 동안 뒤에서 내려받고, 다 받으면 "다시 시작" 버튼 권장 업데이트" 이 방식으로 적용되도록 하고 싶어."*

> *"중요한점은 나는 별도 테스트 서버 없이 바로 본 서버에 머지하고 있기 때문에, 본 서버에 잘못된 업데이트가 반영되어서 헤드업 등 작동이 제대로 안되면 apk를 또 다시 업데이트 해주어야 하는 상황이 발생하고, 사용자들이 그동안 정상적으로 쓰지 못하는 문제가 발생할 수 있기 떄문에 그 부분을 유념하여 몇번을 검증 재검증 하여야해."*

> 버전: *"1.3.0으로 할게."* (스토어 현재판 1.1.1 → 1.3.0 · versionCode 3 → 15)

> *"작업 과정에서 이미지와 같이 마이크가 들어가는 부분은 모두 제거해줘. 사용하지 않을거야."* · *"음성모델 ? 그것도 제거해줘."*

> *"앱의 아이콘을 바꾸고자해."* → *"앱 아이콘만 바꿀거고 내가 추후 제공해줄게."* → 2026-11-20 그림 받음(*"첨부파일은 아이콘이야."* — `app-icons-7-sizes.zip`) → 넣었다(§3-2)

## 2. 헤드업 알림 — 서버를 고치지 않는다

### 왜 지금은 상태표시줄에만 뜨나 (코드로 확인)
- 서버의 일반 푸시는 채널을 지정하지 않는다 — `services/admin_push.js`, `routes/push.js` 의 `notification:{title,body}` + `android:{priority:'high'}`.
- 채널 지정이 없으면 Firebase 가 스스로 만드는 `fcm_fallback_notification_channel` 로 표시한다. 그 채널은 중요도 "보통"이다
  (firebase-messaging `CommonNotificationBuilder.getOrCreateChannel` — 원본 주석: *"shows everywhere, makes noise, but does not visually intrude"*).
- 안드로이드 8+ 는 **채널 중요도가 "높음"** 이어야 화면 위에 띄운다.

### 무엇을 고쳤나
| 파일 | 내용 |
|---|---|
| `android/.../SeagnalApplication.java` (신설) | 앱 프로세스가 뜰 때 채널 `seagnal_push_high`(중요도 높음, 이름 「SEA:GNAL 알림」)를 만든다 |
| `AndroidManifest.xml` | `<application android:name=".SeagnalApplication">` + meta-data `com.google.firebase.messaging.default_notification_channel_id = seagnal_push_high` |

- Firebase 는 ①메시지가 지정한 채널 ②매니페스트 기본 채널 ③자체 폴백 채널 순으로 고르고, **①②는 그 채널이 이미 만들어져 있을 때만** 쓴다.
  그래서 채널을 Activity 가 아니라 **Application** 에서 만든다 — 앱이 꺼진 상태에서 푸시를 받아 프로세스가 막 떴을 때도 채널이 있어야 한다.
- **앱을 켜서 보고 있을 때도 헤드업이 뜬다** — `@capacitor/push-notifications` 7.0.4 의 `fireNotification` 이 같은 `getOrCreateChannel` 을 쓴다
  (`capacitor.config.json` 의 `presentationOptions` 에 `alert` 가 있어 앱이 켜져 있어도 알림을 띄운다. 종전에는 이때도 상태표시줄에만 떴다).
- 화면이 잠겨 있을 때는 헤드업이 아니라 잠금화면 알림으로 보인다(firebase `DisplayNotification.isAppForeground` 가 잠금 상태를 따로 본다).
- **서버·화면 코드는 바꾸지 않았다.** 옛 버전 앱은 채널도 meta-data 도 없으므로 종전과 똑같이 표시된다.
- 위치기반 특보 알림은 종전부터 별도 채널(`location_alert_safety`, 중요도 높음)을 쓴다 — 건드리지 않았다.

### 한계
- 사용자가 폰 설정에서 그 채널을 "조용히"로 낮추거나 방해금지를 켜면 헤드업이 안 뜬다(안드로이드 규칙 — 앱이 되돌릴 수 없다).
- 안드로이드 7.x(채널이 없는 버전)는 종전과 같다.
- 종전 채널 「기타」는 폰 설정 목록에 남는다(지우지 않았다 — 쓰이지 않을 뿐이다).

## 3. 앱 안 업데이트(유연형)

### 흐름
1. 새 버전을 Play 에 출시한다.
2. 사용자가 앱을 켜면 앱이 Play 에 "새 버전 있나"를 묻는다(화면에 안 보인다).
3. 있으면 **Play 가 만든 확인 창**(「업데이트할까요?」)이 뜬다. [나중에]를 누르면 하루 동안 다시 묻지 않는다.
4. [업데이트]를 누르면 앱을 쓰는 동안 뒤에서 내려받는다.
5. 다 받으면 화면 아래에 **「새 버전을 내려받았습니다 [다시 시작]」** 띠가 뜬다. 누르면 설치 후 새 버전으로 다시 켜진다.
6. 안 누르고 앱을 닫아도 받아 둔 것은 남는다 — 다음에 켜면 바로 띠가 뜬다.

### 무엇을 고쳤나
| 파일 | 내용 |
|---|---|
| `android/.../update/AppUpdatePlugin.java` (신설) | Capacitor 플러그인 `SeagnalAppUpdate` — `check`·`start`·`complete` + 사건 `installState` |
| `MainActivity.java` | `registerPlugin(AppUpdatePlugin.class)` |
| `android/app/build.gradle` | `com.google.android.play:app-update:2.1.0` · versionCode 16(2026-11-20 — 15 는 GPS 필수 선언이 든 채 Play 에 한 번 올려 번호가 쓰였다, §4-2) · versionName 1.3.0 |
| `client/capacitor-plugins.js` | `tryInAppUpdate`·`showUpdateReadyBar` 신설, `checkAppUpdate` 가 앱 안 업데이트를 먼저 시도 |

### 못 쓰는 경우는 종전 방식 그대로
`capacitor-plugins.js` 는 **모든 버전의 앱이 함께 받아 가는 화면 코드**다. 그래서 아래 경우는 종전 방식
(서버 `app_version.json` 의 `latestVersion` 비교 → 「업데이트가 필요합니다」 팝업 → 스토어 이동)이 그대로 돈다.

| 경우 | 동작 |
|---|---|
| 옛 APK(플러그인 없음) | 종전 방식 |
| Play 에 물을 수 없음(APK 직접 설치 등) | 종전 방식 |
| 새 버전은 있는데 Play 가 유연형을 불허 | 종전 방식 |
| Play 확인 창을 못 띄움 | 종전 방식 |

### 독립 검토로 보강한 것 (2026-11-19)
- Play 에 묻는 호출(`check`)에 **10초 한도** — Capacitor 다리에는 시간 제한이 없어, Play 가 끝내 답하지 않으면 종전 방식으로도 못 넘어간다(검토 A·B).
  사용자가 고르기를 기다리는 `start` 에는 한도를 두지 않는다.
- Play 가 "모름"(`UpdateAvailability.UNKNOWN`)이라고 답하면 "최신"으로 치지 않고 종전 방식으로 간다(`known:false`).
- 상태 리스너를 `check` **보다 먼저** 건다 — 그 사이에 내려받기 완료 사건이 오면 놓친다.
- `AppUpdateManagerFactory.create` 에 Activity 가 아니라 앱 컨텍스트를 넘긴다(공식 문서 표현대로).

### ⚠달라지는 점 — 새 APK 에서는 "강제 업데이트 팝업"이 안 뜬다
종전 팝업은 닫는 버튼이 없어 사실상 강제였다. 새 APK(1.3.0+)가 Play 에서 설치돼 있으면 **Play 기준**으로만 움직이므로,
관리자 화면에서 `latestVersion` 을 올려도 그 팝업은 뜨지 않는다(옛 APK·스토어 밖 설치에는 종전대로 뜬다).
강제 업데이트가 다시 필요해지면 따로 설계한다(예: `app_version.json` 의 `minVersion` — 지금은 쓰는 코드가 없다).

### 이 기능은 "다음 업데이트"부터 보인다
1.3.0 자체는 종전 방식(스토어)으로 받는다. 1.3.0 이 깔린 폰이 **그다음 버전** 을 받을 때부터 앱 안에서 된다.

## 3-1. 음성 비서 삭제 — 마이크·호출어 듣기·음성 모델

| 어디 | 지운 것 |
|---|---|
| `AndroidManifest.xml` | 권한 `RECORD_AUDIO`·`FOREGROUND_SERVICE_MICROPHONE`·`FOREGROUND_SERVICE_DATA_SYNC`, 서비스 `VoiceAssistantService`·`VoskDownloadService` |
| `android/app/build.gradle` | Porcupine(호출어)·Vosk(오프라인 음성 인식)·JNA 의존성 |
| `android/.../voice/` | `VoiceAssistantService`·`VoskDownloadService`·`VoskModelManager`·`VoskWakeEngine`·`PorcupineWakeEngine`·`AndroidSpeechWakeEngine`·`WakeWordEngine` |
| `voice/SeagnalAssistantPlugin.java` | 마이크 권한 선언, `enable`·`disable`·`isEnabled`·`getCapabilities`·`requestVoskDownload`·`cancelVoskDownload`·`audioBusy` (사용자 기억 메서드 6개는 그대로) |
| `MainActivity.java` | WebView 의 마이크 권한 요청을 허용하던 `WebChromeClient` |
| 화면 | 관리자 센터 AI → AI 비서의 「마이크」·「음성 비서(나리야)」 줄, `assistant_overlay.js`, `assistant.html`·`assistant.js` 의 마이크 버튼·웹 음성 인식·클라우드 받아쓰기·상시 비서 카드 |
| 서버 | `POST /api/assistant/transcribe` |

- **남긴 것**: 글자로 묻는 AI 비서, 답변 읽어 주기(TTS — 스피커 출력), 사용자 기억(Room), 위치 권한 줄.
- 옛 시험용 APK(1.1.2~1.2.2)에는 상시 청취 서비스가 들어 있는데 끄는 화면이 없어졌다 → `capacitor-plugins.js` 가 앱을 켤 때
  `SeagnalAssistant.disable` 이 있으면 한 번 불러 끈다(새 APK·스토어판에는 그 메서드가 없어 아무 일도 하지 않는다).
- 손대지 않은 것(언급만): 서버 프롬프트의 자기소개 문구 *"음성 비서 나리야"*(`routes/assistant.js` 3곳 — 문구를 바꾸면 답변이 달라진다),
  시안 페이지 `client/assistant_overlay_preview.html`.
- 심사 쪽 이득: 첫 스토어 업데이트에서 **마이크 권한과 마이크·데이터 동기화 전경 서비스 신고가 필요 없어진다**(§4-1).

## 3-2. 앱 아이콘 교체 (2026-11-20)

사용자가 준 `app-icons-7-sizes.zip`(48·72·96·144·192·512·1024px + 원본 1254px — 남색 바탕에 물결 + 맥박선)을 런처 아이콘 자리에 넣었다.
**앱 아이콘만** 바꿨다(사용자 지시) — 시작 화면(스플래시)·웹 파비콘은 그대로다.

| 파일 (`android/app/src/main/res/`) | 내용 |
|---|---|
| `mipmap-*/ic_launcher.png` | 옛 방식 아이콘(안드로이드 7.x) — 받은 크기별 파일 그대로(48/72/96/144/192) |
| `mipmap-*/ic_launcher_round.png` | 같은 그림을 원형으로 자른 것 |
| `mipmap-*/ic_launcher_foreground.png` | 적응형 아이콘 앞 레이어 — 1024px 원본을 108/162/216/324/432 로 줄인 것 |
| `mipmap-*/ic_launcher_background.png` | 가장자리와 같은 남색(#010736) 단색(지금 xml 은 안 쓰지만 색을 맞춰 뒀다) |
| `mipmap-anydpi-v26/ic_launcher.xml`·`ic_launcher_round.xml` | 뒤 레이어를 **단색(`@color/ic_launcher_background`)** 으로 — 종전에는 뒤 레이어도 16.7% 안쪽으로 넣어 가장자리가 비었다 |
| `values/ic_launcher_background.xml` | `#FFFFFF` → `#010736` |

- 앞 레이어는 종전처럼 16.7% 안쪽으로 넣는다 → 그림 전체가 "보이는 영역(72dp)"에 딱 맞는다. 런처가 원·둥근 사각으로 잘라도 물결·맥박선이 안 잘린다
  (원·둥근 사각·물방울 사각 세 모양으로 잘라 본 미리보기를 눈으로 확인했다 — 실기기 런처에서 본 것은 아니다).
- 알림의 작은 아이콘은 종전처럼 앱 아이콘을 쓴다(`LocationAlertNotifier` 의 `R.mipmap.ic_launcher`, 일반 푸시는 Firebase 기본값) — 새 그림으로 바뀐다.
- **스토어 등록 화면의 아이콘은 따로다** — Play 콘솔 → 스토어 등록정보에 `icon-512.png` 를 직접 올려야 바뀐다.
- 다시 만들 때: zip 을 푼 폴더·`res` 폴더를 주고 아이콘 생성 스크립트(작업 기록 참고 — 저장소에는 넣지 않았다)를 돌리거나, Android Studio 의 Image Asset 으로 만든다.

## 3-3. 시험 발송 — 「직접 발송」의 "이 휴대폰에만 보내기" (2026-11-20)

> 사용자 원문: *「직접 발송」에 "이 휴대폰에만 보내기" 체크칸과 10초 지연을 추가할지. 추가*

| 파일 | 내용 |
|---|---|
| `local_server/services/push_device_test.js` (신설) | 입력 확인 · 푸시 한 통 만들기(실제 「직접 발송」과 같은 모양 — 채널 지정 없음) · 한 대에 보내기/예약 |
| `local_server/routes/push.js` | `POST /api/admin/push-test-device` — 관리자 토큰 필수. 구독자 파일·발송 이력을 건드리지 않는다 |
| `client/js/push/alert_push.js` | 체크칸 2개(이 휴대폰에만 · 10초 뒤에), 켜면 해역·「구독자 전원」 잠금, 확인 창 대상 「이 휴대폰 1대(시험)」 |

- **다른 사람에게 나갈 길이 없다**: 서버는 요청에 실린 푸시 주소 한 개에만 보낸다. 화면은 시험 모드에서 실패·통신 오류·인증 실패가 나도
  일반 발송(`/api/push-custom`)으로 넘어가지 않는다(시험 `test_push_device_test.js` [5] 가 고정).
- **10초 지연은 서버가 센다**: 화면에서 세면 앱을 끄는 순간 요청이 안 나간다. 그 10초 안에 서버가 다시 켜지면 그 시험 푸시는 사라진다.
- 종전부터 서버에 있던 `/api/push-custom` 의 `adminToken`(그 토큰의 구독자로만 한정)은 쓰지 않았다 — 그 길은 값이 비면 전원 발송으로 떨어진다.
- ⚠따로 남은 문제(이번에 고치지 않았다): `/api/push-custom`·`/api/push-typhoon`·`/api/test-push`·발송 이력 삭제에는 **관리자 인증이 없다**
  (`routes/push.js` 에 인증 참조 0건 — 코드로 확인, 운영 서버에 요청을 보내 본 것은 아니다). 별도 작업으로 제안해 뒀다.
  - ✅**2026-11-20 고쳤다**(사용자 — *「이것 반영하고자 하는데, 주의할 점이 발생하지 않도록 그 부분에 대해서는 재검토 할 수 있도록 해줘.」*):
    `/api/push-custom`·`/api/push-typhoon`·`DELETE /api/push-history(/:id)` 앞에 문지기(`services/internal_push_auth.js requireAdminOrInternal`).
    관리자는 로그인 열쇠(X-Admin-Token — 관리자 화면 fetch 래퍼가 이 네 주소에도 붙인다), **서버 안의 자동 특보(push_sender.js)·자동 태풍(typhoon_notifier.js)
    푸시는 서버가 켜질 때 만든 내부 열쇠**로 통과한다(같은 프로세스 메모리에만 있음). 시험 `test_push_route_auth.js`.
    확인: 실제 라우터로 내부 열쇠 → 통과(태풍 200, 특보는 문지기 지나 처리 단계까지) · 열쇠 없음 → 401 · 브라우저에서 로그인 전 401 / 로그인 뒤 직접 발송·기록 삭제 200.
  - 남은 것: `/api/test-push`(push_test.js)는 그대로 — 받는 토큰 **한 대**에만 보내고, 거기서 설정하는 `global.mockWarningData` 는 지금 아무 데서도 읽지 않는다(코드 확인).
    조회(`GET /api/push-history`)도 그대로 열려 있다.

## 4. 검증 — 무엇을 확인했고 무엇을 못 했나

| 단계 | 무엇을 | 상태 (2026-11-20 00:56 KST 기준) |
|---|---|---|
| ① 자동 검사 | `verify_all.sh` 전체 | **exit 0** — 스위트 153개 전부 0 FAIL, V2·V3(로드 순서 144개)·V4 통과. 「실패·악화 총정리」의 26줄은 전부 법률 위키 분류 표시(0건 또는 기준선 이하)이고 이번 변경은 위키를 건드리지 않았다. ⚠`NODE_PATH=/opt/node-tools/node_modules` 를 줘야 한다(안 주면 화면 스위트가 `playwright-core` 없음으로 죽는다) |
| ①-0 ★최종(main 을 합친 뒤) | `verify_all.sh` 전체를 다시 — main 120커밋을 합치고(충돌 6곳 해소) 이름 정리·시험 발송까지 넣은 마지막 커밋 `6876adf6` 에서 | **exit 0** (2026-11-20 새벽) — 스위트 165개 전부 0 FAIL · 「실패를 세운 검사」 0줄 · V5-57(고친 위키 1쪽을 다른 눈이 읽었나) 통과 · 총정리 줄이 첫 통과 실행과 같다. 새 스위트 넷: 노출 범위 73 · 앱 안 업데이트 82 · 이 휴대폰에만 보내기 69 · 이름 검사 13. 빌드는 run #45(합친 커밋 `8949d5fb`) 성공 |
| ①-2 새 스위트 | `test_location_alert_exposure`(73) · `test_inapp_update_flow`(82 — 화면 흐름·네이티브와 이름 대조·채널 id·음성 삭제) | 전부 PASS |
| ①-3 실제 브라우저 | 크로뮴(휴대폰 크기)으로 기본 숨김 → 관리자 로그인 → 버튼 3개 → 일반 공개 → 모두 비노출 → 401 → 되돌리기 | 17 PASS / 0 FAIL |
| ② 빌드 | GitHub Actions 「Build Debug APK」 | run #40·#41·#42 **성공**. #41 로그를 직접 읽음: versionName 1.3.0 · versionCode 15 · 권한 12개에 마이크·음성 모델 없음 · 헤드업 meta-data·`SeagnalApplication` 있음. (#39 는 SDK 설치 단계에서 죽었다 — 워크플로 문제, 고쳤다) |
| ②-2 빌드 안 검사 | 병합 매니페스트(최종본) 검사 단계 신설 — 마이크 권한·음성 서비스가 있으면, 헤드업 채널·푸시 수신 서비스·`capacitor.config.json` 이 없으면 빌드 실패 | #41·#42 통과 |
| ③ 독립 검토 | 다른 에이전트 넷이 각기 다른 각도로 — A 옛 APK 호환 · B 네이티브 · C 노출 범위 · D 음성 삭제 | 넷 다 치명·높음 **코드** 결함 없음. B 의 「높음」은 이 문서 §5-3 에 `cap sync` 가 빠진 것(고쳤다). 반영·기각 내역: `location_alert.design.md` §19.8, 이 문서 §3 |
| ④ 실기기 — 헤드업 | 시험용 APK 를 폰에 깔고 푸시를 받아 본다 | **확인됨(2026-11-20, 사용자 실기기)** — 시험용 APK(run #45 산출물)를 시험 폰에 깔고 「이 휴대폰에만 보내기 (시험)」로 보냄. 사용자 원문: *「시험 휴대폰에서 정상적으로 화면 앞 헤드업 알림이 떴어.」* · *「앱을 끈 상태에서 확인한거야.」* (이 작업 환경에서 직접 본 것은 아니다 — 사용자 보고) |
| ④-2 스토어용 서명본 | GitHub Actions 「Build Release AAB (스토어용)」 | run #3(2026-11-20) **성공** — `SEAGNAL-1.3.0-15-release.aab`. 로그·파일로 확인: 병합 매니페스트(release) 검사 통과 · `jar verified` · 서명 인증서 SHA-1 `9C:C8:DA:CA:45:FB:63:90:80:6F:C2:55:C6:A7:04:58:24:2D:AD:2A`(키 `android/seagnal-release-key`, 소유자 표시 CN=JS_Shin). ⚠Play 에 등록된 업로드 키와 같은지는 **아직 모른다** — 내부 테스트에 올려 보면 안다 |
| ④-3 Play 내부 테스트 → 프로덕션 제출 | 17 (1.3.0) | **2026-11-20 사용자 확인**: 내부 테스트로 스토어판 1.1.1 → 16 → 17 업데이트 정상 · 앱 열림 · 새 아이콘 · 앱을 끈 상태 헤드업 정상. 지원 기기 손실 0(전화·태블릿·TV·크롬북). 「앱 콘텐츠」 신고서 경고·빨간 띠 사라짐, 「정책 상태」 문제 없음. 프로덕션 「전체 출시」(100%)로 검토 제출 — 빠른 검사의 「android.hardware.screen.portrait 필수 기능」 경고는 1.1.1 에도 있던 세로 고정(screenOrientation=portrait) 때문이라 「무시하고 계속하기」(사용자 선택). 스토어 아이콘 변경도 함께 검토 중. **검토 결과 대기** |
| ⑤ 실기기 — 앱 안 업데이트 | Play 「내부 테스트」에 두 버전을 차례로 올려 본다 | **아직 — 사용자만 할 수 있다** |

이 작업 환경에는 휴대폰도 Play 스토어도 없다. **④⑤를 통과하기 전에는 일반 사용자에게 출시하지 않는다.**

## 4-2. ★GPS 필수 선언 — 내부 테스트에 올리자마자 Play 가 잡은 것 (2026-11-20)

1.3.0(versionCode 15)을 Play 「내부 테스트」에 올리니 「미리보기 및 확인」에 경고가 떴다(사용자 화면 캡처):

| 폼 팩터 | 마지막 출시 | 더 이상 지원 안 됨 | 이번 출시 |
|---|---|---|---|
| 전화 | 12,543 | 223 (-2%) | 12,320 |
| 태블릿 | 6,844 | 2,365 (-35%) | 4,479 |
| TV | 4 | 3 | 1 |
| Chromebook | 77 | 77 (-100%) | 0 |

Play 가 적은 이유: **「필요한 기능을 지원하지 않습니다 — 시스템 기능」**. 경고문: *「이미 이러한 기기에 앱을 설치한 사용자에게 업데이트가 제공되지 않습니다.」*

- **원인(파일로 확인)**: 번들의 최종 매니페스트에 필수 기능이 `android.hardware.location.gps` 하나 있었다.
  `@capacitor-community/background-geolocation` 플러그인 매니페스트가 `<uses-feature android:name="android.hardware.location.gps" />` 를 끼워 넣는다(required 기본값 true).
  우리 소스 매니페스트에는 없는 줄이라 **소스만 봐서는 안 보인다.**
- **고침**: `AndroidManifest.xml` 에 같은 기능을 `android:required="false"` + `tools:replace="android:required"` 로 선언(병합 규칙이 "하나라도 true 면 true" 라서 덮어써야 한다).
  GPS 가 없어도 안전한 까닭: 플러그인은 FusedLocationProvider, 우리 `LocationAlertLocator` 는 provider 마다 `isProviderEnabled`·try/catch 를 거쳐 NETWORK 로 넘어간다.
- **다시 못 들어오게**: 두 빌드 절차(`build-apk.yml`·`build-release-aab.yml`)의 병합 매니페스트 검사에 **「필수로 선언된 기기 기능이 하나라도 있으면 실패」** 를 넣었다.
- **버전**: 15 는 Play 에 한 번 올려 번호가 쓰였다 → **versionCode 16**(versionName 은 그대로 1.3.0). 15 는 출시하지 않았다(사용자: *「지금 이 버전으로 올리지 말고.」*).
- **교훈**: 이 검사는 디버그 빌드에도 처음부터 넣을 수 있었다. 권한은 병합 매니페스트로 봤는데 **기능(uses-feature)은 안 봤다** — Play 의 기기 필터는 권한이 아니라 기능으로 건다.
- **빌드로 확인한 것(2026-11-20)**: Build Release AAB run #5 · Build Debug APK run #47 **성공**(커밋 `9f55f5f1`).
  release 병합 매니페스트에 실제 `uses-feature` 태그는 하나, `android:required="false"`. 받은 번들을 직접 열어 15 와 견줬다 —
  **15: gps 태그에 required 속성 없음(=필수) → 16: required=false.** 서명 인증서 SHA-1 은 15 와 같다(`9C:C8:DA:CA:…:2D:AD:2A`), `jar verified`.
  - 첫 시도(run #46·#4)는 새 검사가 **소스 매니페스트의 설명 주석 속 태그 글자**를 선언으로 세어 실패했다 → 주석을 걷어 낸 뒤 세도록 고쳤다.
- **아직 모르는 것**: Play 의 지원 기기 수가 실제로 돌아오는지 — 16 을 내부 테스트에 올려 「지원 기기 변경사항」을 다시 봐야 안다.
- ⚠나머지 경고 2개(가독화 파일 없음 · 네이티브 디버그 기호 없음)는 비정상 종료 분석용 부가 파일 안내다 — 출시를 막지 않는다.

## 4-3. ★백그라운드 위치·위치 전경 서비스 권한을 뺐다 — versionCode 17 (2026-11-20)

16 을 내부 테스트에 올린 뒤 Play 첫 화면에 빨간 띠 「변경사항에 문제가 발견되었습니다」가 떴다. 「정책 상태」는 「발견된 문제 없음」,
원인은 「정책 및 프로그램 → 앱 콘텐츠」의 **「선언 2개에 주의 필요」** 였다(사용자 화면 캡처):
- **포그라운드 서비스 권한** — 「선언 기한이 지났습니다」(2024-01-31). *「앱 업데이트를 계속 출시하려면 … 삭제하세요 / 이 선언을 작성하세요」*
- **위치 정보 액세스 권한** — 「하나 이상의 App Bundle 또는 APK 의 매니페스트에 위치 정보 액세스 권한이 포함되어 있습니다」

둘 다 「위치 기반 기상 정보 제공」(앱이 꺼져 있을 때 위치 확인) 하나 때문이다. 이 기능은 지금 **관리자에게만** 보여 검토자가 기능을 볼 수 없다 →
신고서를 내도 거절될 가능성이 크고, 거절되면 헤드업·앱 안 업데이트가 든 업데이트 전체가 막힌다.
사용자 결정: *「위치기반 빼자.(2개 기능)」*

- 뺀 것: `ACCESS_BACKGROUND_LOCATION` · `FOREGROUND_SERVICE_LOCATION` · `FOREGROUND_SERVICE`(매니페스트에서 `tools:node="remove"`),
  `@capacitor-community/background-geolocation` 플러그인(`package.json` · `capacitor.settings.gradle` · `capacitor.build.gradle`).
  화면 코드는 이 플러그인을 이미 쓰지 않았다(이벤트 기반 전환 — `location_alert_background.js` 머리말, `test_location_alert_fresh_fix.js` 18 통과).
- 남긴 것: 전경 위치(`ACCESS_FINE/COARSE_LOCATION`) — 앱을 켠 상태의 위치 기능용. GPS `required="false"` 선언도 남겼다.
- 영향: 1.3.0 에서는 앱이 꺼져 있을 때 위치 기반 특보 경보가 위치를 얻지 못한다(관리자 전용 기능 — 일반 사용자 영향 없음).
  켜려고 하면 `LocationPermPlugin.requestBackground` 가 Capacitor 의 "Missing the following permissions in AndroidManifest.xml" 로 거절되고,
  화면(`location_alert_ui.js` `requestBackgroundLocation`)이 잡아 앱 정보 화면으로 넘긴다 — 앱이 죽지 않는다(코드 확인).
- 다시 못 들어오게: 두 빌드 절차의 병합 매니페스트 검사에 「백그라운드 위치·전경 서비스 권한이 있으면 실패」를 넣었다.
- **일반 공개할 때**: 권한·플러그인을 되살리고, Play 신고서 두 개(설명·시연 영상·검토자가 기능을 볼 수 있는 길)를 함께 낸다. 이 검사도 그때 고친다.
- versionCode 16 → **17**(16 은 내부 테스트에 나갔다). 앱 콘텐츠의 경고는 16 이 남아 있는 동안 계속 보일 수 있다 — 17 로 바꿔 출시한 뒤 다시 본다.

## 4-1. ★이번이 "첫 스토어 업데이트"다 (2026-11-19 사용자 확인 + 커밋 이력)

> 사용자 원문: *"우리 앱은 플레이스토어 배포하고 한번도 플레이스토어를 통해 업데이트 한적이 없어 다 서버로 머지해서."*

- 스토어에 올라간 것은 **1.1.1(versionCode 3)** 하나다 — 커밋 `4812cd7e`(2026-03-19) *"Bump version to 1.1.1 (versionCode 3) for Play Store release"*.
  ⚠Play 콘솔을 직접 본 것은 아니다. **올리기 전에 콘솔의 현재 versionCode 를 눈으로 확인한다.**
- 그 뒤 1.1.2(4)~1.2.2(14)는 시험용 APK 로만 돌았다(커밋 이력 — `git log -- android/app/build.gradle`).
- 그래서 일반 사용자는 전부 **3월의 옛 APK** 를 쓴다. 이번 업데이트는 3월 이후 쌓인 네이티브 변경을 **한꺼번에** 싣는다:
  위치기반 특보(백그라운드 위치 "항상 허용") · 사용자 기억(Room) · 헤드업 · 앱 안 업데이트. (음성 비서는 §3-1 로 뺐다.)
- **versionName 을 1.2.1 아래로 내리면 안 된다** — 위치기반 기능은 앱 버전이 `NATIVE_MIN_VERSION`(1.2.1) 이상일 때만 켤 수 있다
  (`client/js/location-alert/location_alert_ui.js`). 1.1.2 로 내면 새 앱인데도 "업데이트가 필요합니다"가 뜬다.
- **versionCode 는 15 이상** — 스토어는 3보다 크기만 하면 받지만, 시험용 APK(4~14)가 깔린 폰은 그보다 낮은 번호로 못 덮는다.

### 3월 판(1.1.1) 이후 새로 들어간 권한 — 심사에서 따로 묻는 것들
`AndroidManifest.xml` 에 지금 있는 것 중 1.1.1 뒤에 추가된 것(커밋 이력의 설명 기준):
`FOREGROUND_SERVICE` · `FOREGROUND_SERVICE_LOCATION` · `ACCESS_BACKGROUND_LOCATION` · `ACCESS_NETWORK_STATE`.
(마이크 쪽 `RECORD_AUDIO`·`FOREGROUND_SERVICE_MICROPHONE`·`FOREGROUND_SERVICE_DATA_SYNC` 는 §3-1 로 지웠다.)
⚠아래는 구글 플레이 정책에 대한 **작성자의 기억**이며 이 세션에서 콘솔·정책 원문으로 확인하지 못했다 — 올릴 때 콘솔이 요구하는 대로 따른다.
- 백그라운드 위치(`ACCESS_BACKGROUND_LOCATION`): 콘솔에서 **위치 권한 신고서**(왜 필요한지 + 시연 영상)를 내고 따로 심사받는다.
- 전경 서비스 유형(위치 — 백그라운드 위치 플러그인이 선언한다): 콘솔의 **전경 서비스 신고**에 용도를 적는다.
- 위치를 새로 쓰므로 **데이터 보안(Data safety) 양식**과 개인정보처리방침을 맞춘다.
- 그래서 **심사가 평소보다 오래 걸리거나 반려될 수 있다.** 내부 테스트 트랙은 이 신고 없이도 올릴 수 있는 경우가 많아
  기능 확인(④⑤)은 먼저 할 수 있다(이것도 기억 — 콘솔에서 확인).

## 5. 배포 절차 (순서가 중요하다)

### 5-1. 서버·화면 (본 서버 반영) — 먼저 한다
1. 이 브랜치를 main 에 합친다 → 자동 배포.
2. 확인: 옛 버전 앱(스토어판 1.1.1)으로 평소처럼 쓸 수 있는지, 설정 → 푸시 알림에서 「위치 기반 기상 정보 제공」이 일반 기기에 안 보이는지,
   관리자 센터 → 「위치 기반」 탭에 버튼 3개가 보이고 「관리자만 노출」이 켜져 있는지, 「직접 발송」에 "이 휴대폰에만 보내기 (시험)" 체크칸이 보이는지.

> ★순서가 바뀌었다(2026-11-20): 시험 발송 체크칸이 화면 코드라 **본 서버에 합쳐야** 시험용 앱에서 보인다. 그래서 5-1 이 5-2 보다 먼저다.

### 5-2. 시험용 APK 로 헤드업 확인 (④)
⚠**「직접 발송」을 체크칸 없이 누르면 실제 구독자에게 나간다.** 시험은 반드시 아래 3번처럼 체크칸을 켜고 한다
(2026-11-19 의 처음 안내 *"「직접 발송」으로 푸시를 보낸다"* 는 이 점을 빠뜨린 잘못된 안내였다 — 코드 확인: `client/js/push/alert_push.js` 의 `executeCustomPush`).

1. GitHub → Actions → 「Build Debug APK」 → 가장 최근 성공한 실행 → Artifacts 의 `seagnal-debug-apk` 를 받는다.
2. 시험할 폰에 설치한다. ⚠서명이 달라 **스토어에서 받은 앱 위에 덮어 깔리지 않는다** — 스토어 앱을 지우고 깔거나 다른 폰을 쓴다.
   앱을 한 번 켜고 알림을 허용한다.
3. **그 폰에서** 관리자 센터 → 특보 관리 → 「직접 발송」을 열고:
   - **"이 휴대폰에만 보내기 (시험)"** 을 켠다 → 그 화면을 연 폰 한 대에만 간다(서버가 구독자 목록을 읽지 않는다 — `services/push_device_test.js`).
     확인 창의 대상이 **「이 휴대폰 1대(시험)」** 인지 보고 [지금 발송]을 누른다.
   - **앱을 켠 상태 시험**: 「10초 뒤에 보내기」를 끄고 보낸다 → 바로 온다.
   - **앱을 끈 상태 시험**: 「10초 뒤에 보내기」를 켜고 보낸 뒤, 10초 안에 앱을 **최근 앱 목록에서 밀어서** 끈다.
     설정의 「강제 종료」로 끄면 푸시 자체가 오지 않는다(안드로이드 규칙).
   - **화면을 켜고 잠금을 푼 채로** 본다. 잠겨 있으면 헤드업 대신 잠금화면 알림으로 보인다.
   - PC 나 다른 폰에서 "저 폰에만 보내기"는 안 된다 — 받을 폰에서 직접 보내야 한다(푸시 주소가 그 폰 안에 저장돼 있다).
4. 확인할 것: 화면 위에 잠깐 뜨는가 · 폰 설정 → 앱 → 알림에 「SEA:GNAL 알림」 채널이 생겼는가 · 알림을 누르면 앱이 열리는가.
5. 시험용 APK 에서는 앱 안 업데이트가 동작하지 않는다(스토어 밖 설치) — 정상이다.

### 5-3. 정식 빌드 → Play 「내부 테스트」 (⑤)
1. 아이콘은 이미 넣었다(§3-2). 스토어 등록 화면의 아이콘은 콘솔에서 `icon-512.png` 를 따로 올린다.
2. ★**빌드 전에 반드시** 저장소 맨 위에서 `npm install` → `npx cap sync android` 를 돌린다(독립 검토 B 가 찾음).
   - 이 명령이 `android/app/src/main/assets/capacitor.config.json`(서버 주소·`presentationOptions`)과 플러그인 목록을 만든다.
     둘 다 git 에 없는 생성물이라, 건너뛰면 **플러그인이 빠지거나 옛 설정으로 빌드된 앱**이 나간다.
   - 2026-11-19 에 저장소의 `android/capacitor.settings.gradle`·`android/app/capacitor.build.gradle` 을 다시 만들어 보니
     백그라운드 위치·로컬 알림·Preferences 플러그인이 빠져 있었다(지금은 넣어 커밋했다). 그래도 `assets/` 쪽 때문에 sync 는 매번 필요하다.
   - 확인: 빌드 뒤 `android/app/build/intermediates/merged_manifests/release/.../AndroidManifest.xml` 에
     `RECORD_AUDIO` 가 **없고** `default_notification_channel_id` 가 **있는지** 본다.
3. Android Studio 에서 서명된 번들(AAB)을 만든다 — versionCode 16 · versionName 1.3.0 (이미 올려 뒀다. 15 는 쓰지 않는다 — §4-2).
   - ★**깃허브에서 만드는 길(2026-11-20 추가 — 사용자 요청 「깃허브에서 할 수 있도록 해줄래 ?」)**: GitHub → Actions → 「Build Release AAB (스토어용)」 → [Run workflow].
     끝나면 Artifacts 의 `seagnal-release-aab` 안에 서명된 `.aab` 가 있다. 위 2번(`npm install` → `cap sync`)과 병합 매니페스트 검사를 그 절차가 직접 한다.
     - 서명 키: 저장소의 **`android/seagnal-release-key`**(PKCS12 · alias `key0` · 2026-02-14 생성 — 사용자가 준 릴리즈 키와 같은 파일, 2026-11-20 지문 대조).
       비밀번호는 깃허브 Settings → Secrets and variables → Actions 의 **`ANDROID_KEYSTORE_PASSWORD`** 에서만 읽는다(키 비밀번호를 따로 정했으면 `ANDROID_KEY_PASSWORD` 도).
     - `apk_build/android.keystore`(2025-12-26 · alias `android`)는 **다른 옛 키**다. 처음에 확장자(.jks·.keystore)로만 찾아 이것을 릴리즈 키로 잘못 봤다
       (등록된 비밀번호로 열리지 않아 run #2 에서 드러났다). 쓰지 않는다.
     - ⚠**이 저장소는 공개 저장소인데 릴리즈 키 파일이 들어 있다**(전부터 있었다). 비밀번호가 유일한 방어선이다 — 저장소를 비공개로 돌리거나
       키 파일을 빼는 것은 사용자 결정 사항. 빼기로 하면 파일을 base64 글자로 바꿔 Secrets 의 `ANDROID_KEYSTORE_BASE64` 에 등록한다(있으면 절차가 그것을 쓴다).
     - 절차가 맨 먼저 키와 비밀번호를 확인한다 — 없거나 틀리면 빌드 전에 멈추고 까닭을 적는다.
     - ⚠이 키가 **Play 에 등록된 업로드 키와 같은지는 저장소로는 알 수 없다.** Play 콘솔의 업로드 키 인증서 지문과 실행 로그의 「키 인증서 SHA-1」을 견준다.
       다르면 Play 가 올리기를 거부할 뿐이다(기존 앱·사용자에게는 영향 없음).
4. Play 콘솔 → 테스트 → **내부 테스트** 에 올리고, 테스터(본인 계정)로 등록한 폰에서 스토어를 통해 설치한다.
   - ★가능하면 **스토어판 1.1.1 이 깔린 폰을 그대로 1.3.0 으로 올려서** 본다 — 실제 사용자가 겪는 길이다
     (옛 「기타」 알림 채널이 이미 있는 상태에서 올라온다. 시험용 APK 로는 이 길을 볼 수 없다).
5. 헤드업을 다시 확인한다(정식 서명본).
6. 앱 안 업데이트 확인: versionCode 17 인 번들을 하나 더 만들어 내부 테스트에 올린다 → 16 이 깔린 폰에서 앱을 켠다 →
   Play 확인 창 → [업데이트] → 내려받기 → 「다시 시작」 띠 → 누르면 16 으로 바뀌는지.
   (스토어가 새 버전을 알아채는 데 시간이 걸릴 수 있다. Play 스토어 앱에서 내 앱 페이지를 한 번 열면 빨라진다.)

### 5-4. 일반 출시
1. 내부 테스트를 통과한 번들을 프로덕션으로 승격한다(단계적 출시 권장 — 문제가 보이면 멈출 수 있다).
2. 관리자 센터 → 버전 탭에서 `latestVersion` 을 올리면 **옛 버전(1.2.2 이하) 사용자**에게 종전 팝업이 뜬다.
   - ★2026-11-20 안내 창을 **시안 C** 로 바꿨다(사용자 확정 — *「3안 처럼 반영 … 업데이트하러가기 버튼 내 텍스트 바로 아래 플레이스토어로 이동합니다. 라고 작게 명시」* · *「하루(24시간) 뒤 … 이대로 하자.」*):
     새 아이콘 · 「새 버전이 나왔어요」 · v현재 → **v최신** · 바뀐 점 목록 · [업데이트하러 가기 / Play 스토어로 이동합니다] · [나중에].
     **[나중에] 를 누르면 24시간 동안 다시 뜨지 않는다**(`seagnal_update_popup_later_at`).
   - 바뀐 점 목록 = 버전 탭 「업데이트 메시지」. 규칙: **한 줄 = 목록 한 칸 · 줄 맨 앞 이모지 = 아이콘(없으면 •) · 「|」 뒤 = 작은 설명.**
     버전 탭 **[이 휴대폰에서 미리 보기]** 로 입력한 그대로 창을 띄워 볼 수 있다(저장·발송 없음, 「나중에」 기록도 안 남김).
   - 이 창은 서버에서 내려가는 화면(`client/capacitor-plugins.js`)이라 **1.1.1 앱에도 그대로 뜬다** — APK 업데이트 불필요.
   - ★2026-11-20 **[적용]만으로 끝난다**(사용자 확정 — *「적용만으로 끝나게 고쳐놓고 진행하자. 그래야 만약에 문제있어서 1.1.1 버전 3으로 적용만 하면 바로 적용되는거잖아.」*).
     종전에는 [적용]이 `client/app_version.json` 에 써서 **main 에 무엇이든 머지하면(자동 배포) 저장소 값으로 덮여** 조용히 사라졌다.
     이제 `local_server/data/app_version.json`(Fly.io 볼륨 — `.dockerignore` 에 빠져 있어 배포가 건드리지 않는다)에 쓰고, `/api/app-version` 이 그것을 먼저 읽는다
     (`services/app_version_store.js`, 시험 `test_app_version_store.js`). **되돌리기도 [적용] 한 번.** ⚠한 번 적용한 뒤에는 저장소의 `client/app_version.json` 을 고쳐도 반영되지 않는다.
   - ⚠**출시가 100% 퍼지고 하루 이틀 뒤에** `latestVersion` 을 올린다 — 그 전에 올리면 스토어에 아직 업데이트가 안 보이는 사용자가 생긴다.
     1.3.0 이후 앱은 이 창 대신 Play 의 앱 안 업데이트 창이 먼저 뜬다(관리자 센터 값과 무관).
