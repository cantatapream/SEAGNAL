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
| `android/app/build.gradle` | `com.google.android.play:app-update:2.1.0` · versionCode 15 · versionName 1.3.0 |
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

## 4. 검증 — 무엇을 확인했고 무엇을 못 했나

| 단계 | 무엇을 | 상태 (2026-11-20 00:56 KST 기준) |
|---|---|---|
| ① 자동 검사 | `verify_all.sh` 전체 | **exit 0** — 스위트 153개 전부 0 FAIL, V2·V3(로드 순서 144개)·V4 통과. 「실패·악화 총정리」의 26줄은 전부 법률 위키 분류 표시(0건 또는 기준선 이하)이고 이번 변경은 위키를 건드리지 않았다. ⚠`NODE_PATH=/opt/node-tools/node_modules` 를 줘야 한다(안 주면 화면 스위트가 `playwright-core` 없음으로 죽는다) |
| ①-2 새 스위트 | `test_location_alert_exposure`(73) · `test_inapp_update_flow`(82 — 화면 흐름·네이티브와 이름 대조·채널 id·음성 삭제) | 전부 PASS |
| ①-3 실제 브라우저 | 크로뮴(휴대폰 크기)으로 기본 숨김 → 관리자 로그인 → 버튼 3개 → 일반 공개 → 모두 비노출 → 401 → 되돌리기 | 17 PASS / 0 FAIL |
| ② 빌드 | GitHub Actions 「Build Debug APK」 | run #40·#41·#42 **성공**. #41 로그를 직접 읽음: versionName 1.3.0 · versionCode 15 · 권한 12개에 마이크·음성 모델 없음 · 헤드업 meta-data·`SeagnalApplication` 있음. (#39 는 SDK 설치 단계에서 죽었다 — 워크플로 문제, 고쳤다) |
| ②-2 빌드 안 검사 | 병합 매니페스트(최종본) 검사 단계 신설 — 마이크 권한·음성 서비스가 있으면, 헤드업 채널·푸시 수신 서비스·`capacitor.config.json` 이 없으면 빌드 실패 | #41·#42 통과 |
| ③ 독립 검토 | 다른 에이전트 넷이 각기 다른 각도로 — A 옛 APK 호환 · B 네이티브 · C 노출 범위 · D 음성 삭제 | 넷 다 치명·높음 **코드** 결함 없음. B 의 「높음」은 이 문서 §5-3 에 `cap sync` 가 빠진 것(고쳤다). 반영·기각 내역: `location_alert.design.md` §19.8, 이 문서 §3 |
| ④ 실기기 — 헤드업 | 시험용 APK 를 폰에 깔고 푸시를 받아 본다 | **아직 — 사용자만 할 수 있다** |
| ⑤ 실기기 — 앱 안 업데이트 | Play 「내부 테스트」에 두 버전을 차례로 올려 본다 | **아직 — 사용자만 할 수 있다** |

이 작업 환경에는 휴대폰도 Play 스토어도 없다. **④⑤를 통과하기 전에는 일반 사용자에게 출시하지 않는다.**

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

### 5-1. 서버·화면 (본 서버 반영)
1. 이 브랜치를 main 에 합친다 → 자동 배포.
2. 확인: 옛 버전 앱(1.2.2)으로 평소처럼 쓸 수 있는지, 설정 → 푸시 알림에서 「위치 기반 기상 정보 제공」이 일반 기기에 안 보이는지,
   관리자 센터 → 「위치 기반」 탭에 버튼 3개가 보이고 「관리자만 노출」이 켜져 있는지.

### 5-2. 시험용 APK 로 헤드업 확인 (④)
1. GitHub → Actions → 「Build Debug APK」 → 실행 → 끝나면 Artifacts 의 `seagnal-debug-apk` 를 받는다.
2. 시험할 폰에 설치한다. ⚠서명이 달라 **스토어에서 받은 앱 위에 덮어 깔리지 않는다** — 스토어 앱을 지우고 깔거나 다른 폰을 쓴다.
3. 앱을 한 번 켜고 알림을 허용한 뒤, **앱을 끈 상태**와 **켠 상태** 각각에서 관리자 센터 「직접 발송」으로 푸시를 보낸다.
   - "끈 상태"는 **최근 앱 목록에서 밀어서 끄기**다. 설정의 「강제 종료」로 끄면 푸시 자체가 오지 않는다(안드로이드 규칙).
   - **화면을 켜고 잠금을 푼 채로** 본다. 잠겨 있으면 헤드업 대신 잠금화면 알림으로 보인다.
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
3. Android Studio 에서 서명된 번들(AAB)을 만든다 — versionCode 15 · versionName 1.3.0 (이미 올려 뒀다).
4. Play 콘솔 → 테스트 → **내부 테스트** 에 올리고, 테스터(본인 계정)로 등록한 폰에서 스토어를 통해 설치한다.
   - ★가능하면 **스토어판 1.1.1 이 깔린 폰을 그대로 1.3.0 으로 올려서** 본다 — 실제 사용자가 겪는 길이다
     (옛 「기타」 알림 채널이 이미 있는 상태에서 올라온다. 시험용 APK 로는 이 길을 볼 수 없다).
5. 헤드업을 다시 확인한다(정식 서명본).
6. 앱 안 업데이트 확인: versionCode 16 인 번들을 하나 더 만들어 내부 테스트에 올린다 → 15 가 깔린 폰에서 앱을 켠다 →
   Play 확인 창 → [업데이트] → 내려받기 → 「다시 시작」 띠 → 누르면 16 으로 바뀌는지.
   (스토어가 새 버전을 알아채는 데 시간이 걸릴 수 있다. Play 스토어 앱에서 내 앱 페이지를 한 번 열면 빨라진다.)

### 5-4. 일반 출시
1. 내부 테스트를 통과한 번들을 프로덕션으로 승격한다(단계적 출시 권장 — 문제가 보이면 멈출 수 있다).
2. 관리자 센터 → 버전 탭에서 `latestVersion` 을 올리면 **옛 버전(1.2.2 이하) 사용자**에게 종전 팝업이 뜬다.
