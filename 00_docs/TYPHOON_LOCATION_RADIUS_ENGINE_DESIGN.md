# 위치기반 태풍 반경 알림 엔진 + 서브토글 회귀테스트 — 종합 설계문서

> 본 문서는 독립 설계 에이전트 A·B(약 95% 수렴)의 설계를 하나로 통합한 **설계 전용** 문서입니다.
> **이 문서 외 구현/코드 변경은 포함하지 않습니다.** 코드로 확정한 사실은 `파일:라인`으로 표기하고,
> 미확인 사항은 `[가정]` 으로 표기했습니다.
>
> 작성일: 2026-06-17 · 대상 코드 루트: `local_server/` · 설계문서 루트: `00_docs/`
> 선행 설계: `00_docs/LOCATION_BASED_ALERT_DESIGN.md` (위치기반 특보 엔진, 방식 A)

---

## 1. 요약

해상특보 위치기반 경보(이미 가동 중)와 **별도 스트림**으로, "내 위치"가 라이브 태풍의
(비대칭) 강풍/폭풍반경에 처음 드는 시점을 단말이 판정하여 **로컬 알림**으로 경고하는 엔진을 추가한다.

설계 원칙(특보 엔진과 동일):

- **위치 좌표는 서버로 보내지 않는다.** 서버는 토큰·동의 사실만 안다(`location_alert_store` 레코드 = `token/agreed/version/at`, `services/location_alert_store.js:43-48`).
- 서버는 태풍 변화 시 동의 단말 전체에 **데이터 전용(조용한) FCM "깨우는 신호"** 1회 방송.
- 단말이 자기 위치 + `/api/typhoon` 재조회 + 내장 비대칭 반경 수식으로 직접 판정하고, 반경 진입 시에만 로컬 알림 표출.
- 기존 자산을 최대 재사용(특히 검증된 순수 모듈 `services/typhoon_radius.js`, 메시지 빌더 `services/typhoon_message.js`).

**핵심 함정(A·B 둘 다 지적, 코드로 확정):** 기존 `pushNotificationReceived` 분기는 native-capable
단말에서 JS 처리를 건너뛴다(네이티브가 처리한다고 가정 — `capacitor-plugins.js:100-106`). 그러나 네이티브는
`location_alert_wake` 만 처리한다. **태풍 타입은 네이티브 미처리이므로, native-capable이라도 JS `handleTyphoonWake`를
반드시 실행해야 한다.** → 태풍 분기는 native-capable 게이트를 적용하지 않는다.

---

## 2. 아키텍처 / 데이터 흐름

```
[KMA dmdw]                                                    [동의 단말 (on-device)]
    │                                                              │
    ▼ (10분 주기, scheduler.js)                                     │ 위치 = localStorage
typhoon_crawler.run()  ──write──▶  data/typhoon.json              │ (서버로 안 감)
    │   {typhoons:[{seq,name,latestTmFc,bulletins}]}              │
    ▼ .then()                                                     │
typhoon_notifier.detectAndNotify (발생/소멸 — 기존)                │
    ▼ .then()  ★1줄 추가                                          │
typhoon_radius_dispatch.dispatchTyphoonOnLatest()  [신규]         │
    │  ① 서명 = 활성태풍 seq + latestTmFc (변화감지)               │
    │  ② 동의 토큰 전체 selectTargetTokens()                       │
    │  ③ 데이터메시지 방송: {type:'typhoon_radius_wake', sig,...}  │
    └───────────────── FCM (data-only, high priority) ───────────▶│
                                                                   ▼
                              capacitor-plugins.js: pushNotificationReceived
                                  type==='typhoon_radius_wake'  ★게이트 미적용
                                                                   ▼
                              js/location_alert_typhoon_runtime.js [신규]
                                  handleTyphoonWake(data)
                                  ① subTyphoon===false? → skip (fail-open)
                                  ② getPosition() 없으면 skip ({lat,lng}→{lat,lon})
                                  ③ fetch('/api/typhoon')  (60s 캐시, max-age=60)
                                  ④ radiusEntry(loc,frames,'storm') 우선
                                        없으면 'strong' (반경 밖이면 skip)
                                  ⑤ 24h dedup(KST 일) + 07:00~22:00 KST window
                                        (야간이면 다음 07:00 LocalNotifications 예약)
                                  ⑥ buildRadiusAlert(which,snap,eta)
                                        showLocalNotification(extra.url=buildDemoUrl(guide:true))
                                                                   ▼
                              알림 탭 → localNotificationActionPerformed [신규 리스너]
                                  → extra.url 딥링크 라우팅
```

**서버는 좌표·subTyphoon·하루1회·window를 모른다 — 전부 단말 책임.** 서버는 "태풍 통보문이 갱신됐다"는
신호만 보낸다.

---

## 3. 서버: `services/typhoon_radius_dispatch.js` (신규)

`services/location_alert_dispatch.js` 를 미러링한 독립 모듈. 동일한 패턴 재사용:
`selectTargetTokens`(`location_alert_dispatch.js:112-119`), `_defaultSendFn`(멀티캐스트, `:134-149`),
`recordHistory`(`:40-61`), 변화감지 서명 파일 기법(`:221-248`).

### 3.1 변화 감지 (서명)

- 입력: `data/typhoon.json` (크롤러가 쓰는 파일). 구조 확정:
  `{ updatedAt, year, hasActive, typhoons: [{ seq, name, nameEn, latestTmFc, bulletins }] }`
  (`typhoon_crawler.js:404`, `:407-411`).
- 서명 = 활성 태풍들의 `seq + latestTmFc` 조합 (`typhoon.json` 의 두 필드가 실제 존재함을 확인).
  예: `"11:202606171800|12:202606171500"`. 이전 서명과 동일하면 재방송하지 않음(중복/이력 폭주 방지).
- 서명 파일: `data/typhoon_radius_last_sig.json` `[가정 — 신규 파일명, 특보의 location_alert_last_sig.json 패턴 따름]`.
- 활성 태풍 0건이면 방송하지 않음(`no_active` 반환), 서명만 비움.

### 3.2 페이로드 (확정 권장: 신호 + 단말 재조회)

```js
function buildTyphoonWakeMessage(sig) {
  return {
    data: { type: 'typhoon_radius_wake', v: '1', sig: String(sig) },
    android: { priority: 'high' },
  };
}
```

- **프레임 데이터를 직접 담지 않는다.** 복수 태풍 × 다수 프레임(통보문 forecast 배열)이면 FCM data 4KB 한계를
  초과할 위험이 있어, 단말이 `fetch('/api/typhoon')`로 재조회한다. `/api/typhoon`은 `Cache-Control: public, max-age=60`
  (`routes/typhoon.js:45`)이므로 다수 단말이 동시에 깨어나도 디스크 읽기 1회 수준으로 흡수된다.

### 3.3 공개 함수 (특보 dispatch와 동형)

- `selectTargetTokens(consents)` — **재사용**(특보와 동일 로직: `agreed && token` dedup). 같은 동의 저장소를 본다.
- `buildTyphoonWakeMessage(sig)` — 위.
- `_defaultSendFn(tokens, message)` — `sendEachForMulticast`(data-only), firebase 미구성/실패 흡수.
- `recordHistory(activeSummary, count)` — 발송 이력 `data/custom_push_history.json` 에 `tab:'typhoon'` 으로 기록
  (특보는 `tab:'location'`). 관리자 "발송 이력 > 태풍 발생/소멸" 탭에서 렌더됨(§ ⓑ 검증 결과 참조).
- `dispatchTyphoon(opts)` — `{ sendFn, getConsents, now, record }` 주입 가능(테스트용).
- `dispatchTyphoonOnLatest(opts)` — 디스크 `typhoon.json` 읽어 서명 비교 후 `dispatchTyphoon`. 스케줄러 hook이 호출.

### 3.4 스케줄러 hook (1줄 추가, throw 흡수)

기존 태풍 체인은 두 곳:

1. 부팅 1회 (`scheduler.js:2362-2364`):
   ```js
   typhoonCrawler.run()
     .then(() => { if (typhoonNotifier.enabled) return typhoonNotifier.detectAndNotify({ log }); })
     .catch(err => log(`⚠️ [typhoon] 초기 수집/알림 오류: ${err.message}`));
   ```
2. 10분 주기 (`scheduler.js:2530-2535`, `min % 10 === 7`):
   ```js
   typhoonCrawler.run()
     .then(() => { if (typhoonNotifier.enabled) return typhoonNotifier.detectAndNotify({ log }); })
     .catch(err => log(`⚠️ [typhoon] 수집/알림 오류: ${err.message}`));
   ```

**변경 계획:** 10분 주기 체인(#2)에 `.then(() => typhoonRadiusDispatch.dispatchTyphoonOnLatest({ log }).catch(()=>{}))`
를 1단 추가. **부팅 체인(#1)은 baseline만 — 즉시 방송하지 않는다**(권장값, §11). 부팅 시 첫 `dispatchTyphoonOnLatest`는
서명 파일이 비어 있으면 baseline 서명만 기록하고 발송하지 않도록 한다(특보 `dispatchOnLatest` 의 `sig===''` 처리와 동형, `location_alert_dispatch.js:246` 참조).
실패는 체인이 흡수.

---

## 4. 단말: `js/location_alert_typhoon_runtime.js` (신규, 특보 runtime과 별 파일 공존)

기존 `js/location_alert_runtime.js`(특보용)는 건드리지 않고 **별도 파일**로 공존시킨다. IIFE/전역 노출 패턴 동일.

### 4.1 표출 셸 `handleTyphoonWake(data)`

```
① subTyphoon 게이트:
     root.LocationAlertSettings.get().subTyphoon === false → skip
     (미설정/미로드 = fail-open, 특보 subAlert 게이트와 동일 — location_alert_runtime.js:120-124)
② 위치:
     pos = LocationAlertBackground.getPosition()   // {lat,lng,acc,at}  (background.js:70-72)
     없으면 skip. radiusEntry는 {lat,lon} 을 요구하므로 매핑 필수:
       loc = { lat: pos.lat, lon: pos.lng }   ★ lng→lon 키 변환
③ fetch('/api/typhoon') → { typhoons:[{seq,name,nameEn,latestTmFc,bulletins}] }
④ 복수 태풍 = 가장 이른 진입 1건만 (확정 권장):
     각 태풍의 프레임 모음(framesOf)에 대해 radiusEntry(loc, frames, 'storm') 우선,
     없으면 radiusEntry(loc, frames, 'strong'). 둘 다 null이면 그 태풍 skip.
     진입한 태풍이 여럿이면 ETA(entry.time)가 가장 이른 1건 채택.
⑤ dedup + window:
     24h dedup: KST 캘린더 일(YYYYMMDD, KST) 기준 — 이미 같은 날 보냈으면 skip.
     window: 07:00~22:00 KST 사이만 즉시 표출. 야간이면 다음 07:00 KST 로
       LocalNotifications.schedule({ schedule:{ at } }) 예약.
⑥ buildRadiusAlert(which, snap, eta) + showLocalNotification:
     extra.url = buildDemoUrl({ year, seq, code, guide:true })
       (typhoon_message.js:244-252 — guide:true → &dtGuide=1)
```

### 4.2 프레임 형태 매핑 (radiusEntry 입력)

`radiusEntry`(`services/typhoon_radius.js:87`)가 기대하는 프레임:
`{ time:"YYYYMMDDHHmm", lat, lon, radStrong, radStrongS, radStrongD, radStorm, radStormS, radStormD }`.

- `/api/typhoon` bulletins 의 통보문 frame(current/forecast)을 위 형태로 매핑한다. 단말 측 `framesOf(typhoon)` 헬퍼가
  통보문의 current+forecast 프레임을 모아 정렬 가능한 배열로 변환.
- **`time` 필드는 `typhoon_crawler.js normRow` 가 채운다(ⓐ 검증 — 확정, §10 참조)**. 좌표/반경 필드명도
  `normRow`가 산출하는 키와 일치하는지 매핑 단계에서 흡수. `[가정]` `normRow` 가 lat/lon/radStrong* 키를
  `radiusEntry` 와 동일 이름으로 산출하지 않을 수 있으므로, `framesOf` 에 키 매핑 어댑터를 둔다(코드 확인은 구현 단계).

### 4.3 순수부 분리 (테스트 가능)

표출 셸(I/O·플러그인 의존)과 분리해 다음을 순수 함수로 노출:

- `decideTyphoonAlert(loc, typhoons, now)` → `{ which, snap, eta }|null` — ④의 "가장 이른 진입 1건" 선택까지.
- `framesOf(typhoon)` → 정렬·매핑된 프레임 배열.
- `inSendWindow(date)` → boolean (07:00~22:00 KST).
- `nextWindowStart(date)` → 다음 07:00 KST의 epoch ms.
- (dedup 키 산출) `kstDayKey(date)` → `"YYYYMMDD"`(KST).

`radiusEntry` 자체는 이미 21개 자체검증 테스트 보유(`typhoon_radius.js:133-204`) — 재사용·무변경.

---

## 5. capacitor 수신 분기 (`capacitor-plugins.js`) — ★함정 강조

### 5.1 현재 코드 (확정)

`pushNotificationReceived` 리스너(`capacitor-plugins.js:93-109`):

```js
if (data.type === 'location_alert_wake' && window.LocationAlertRuntime) {
    const ui = window.LocationAlertUI;
    if (ui && typeof ui.isNativeCapable === 'function') {
        ui.isNativeCapable().then((cap) => { if (!cap) window.LocationAlertRuntime.handleWake(data.snapshot); });
    } else {
        window.LocationAlertRuntime.handleWake(data.snapshot);
    }
}
```

→ native-capable이면 `handleWake`를 **건너뛴다**(네이티브가 처리한다고 가정).

### 5.2 추가할 분기 (게이트 미적용)

```js
if (data.type === 'typhoon_radius_wake' && window.LocationAlertTyphoonRuntime) {
    // ★ 네이티브는 location_alert_wake 만 처리한다. 태풍 타입은 네이티브 미처리이므로
    //   native-capable 여부와 무관하게 JS 가 항상 처리해야 한다(게이트 미적용).
    window.LocationAlertTyphoonRuntime.handleTyphoonWake(data);
}
```

이 게이트 미적용이 **v1 핵심 함정의 해소**다(§7, §11).

### 5.3 알림 탭 라우팅 (로컬 알림용 신규 리스너) — ⓒ 검증 결과 반영

**확정(ⓒ):** 현재 `pushNotificationActionPerformed`(`capacitor-plugins.js:112-133`)는 `notification.notification.data.url`
을 읽어 딥링크한다. 그러나 이는 **PushNotifications** 이벤트다. 태풍 경보는 **LocalNotifications** 로 표출되며,
`localNotificationActionPerformed` 리스너는 **현재 코드 어디에도 없다**(grep 결과 0건). 또한 현재 `showLocalNotification`
(`location_alert_runtime.js:91-103`)은 `extra`/url 을 schedule 에 담지 않는다.

따라서 다음 두 가지가 신규로 필요:

1. 태풍 runtime의 `showLocalNotification` 은 `notifications[].extra = { url }` 를 포함해 schedule.
2. `capacitor-plugins.js` 에 신규 리스너:
   ```js
   const { LocalNotifications } = window.Capacitor.Plugins;
   await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
       const url = ev && ev.notification && ev.notification.extra && ev.notification.extra.url;
       if (url) window.location.href = url;   // (기존 PushNotifications 핸들러의 same-page 처리 재사용 권장)
   });
   ```
   `[가정]` `@capacitor/local-notifications` 플러그인 사용 가정(번들에 LocalNotifications 존재 — `location_alert_runtime.js:89` 가 이미 참조).

---

## 6. subTyphoon 게이트

- UI(`js/location_alert_ui.js`)는 이미 `subTyphoon` 을 **저장만** 한다(무수정으로 연결됨):
  - 기본값 ON (`data: { ..., subTyphoon: true }`, `location_alert_ui.js:60`).
  - `setSub` 화이트리스트 `'subAlert'|'subTyphoon'` (`:78-81`).
  - `init` 마이그레이션: 구버전 저장값에 sub키 없으면 `Object.assign` 이 덮어쓰지 않아 기본 ON 유지 (`:61-69`).
  - `clear()` 가 `enabled=false/consent=null` 로 초기화하되 sub 선호 보존(`!== false`) (`:88-95`).
  - UI 체크박스 onchange → `setSub('subTyphoon', ...)` 바인딩 (`:368-371`).
- **런타임이 읽기만 하면 연결 완료.** `handleTyphoonWake` ①단계에서 `LocationAlertSettings.get().subTyphoon === false` 면 skip,
  미설정/미로드는 fail-open(특보 subAlert 게이트와 동형 — `location_alert_runtime.js:120-124`).

---

## 7. killed(앱 종료) 상태 — v1 / v2

| 상태 | foreground | background(JS 동작) | killed(종료) |
|---|---|---|---|
| **v1 (본 설계)** | JS `handleTyphoonWake` | JS `handleTyphoonWake` | **미수신** (네이티브 미처리) |
| **v2 (보류)** | 동일 | 동일 | 네이티브 처리 |

- **v1 = JS(foreground/background)만.** 네이티브 MessagingService 는 `location_alert_wake` 만 처리하므로 태풍 wake는
  killed에서 수신되지 않는다. → **확정 권장: killed는 v2 보류**(§11).
- **v1은 APK 불필요.** 웹/서버 원격 로드(JS 파일 + capacitor-plugins.js 분기)로 출시 가능. 단, capacitor-plugins.js 가
  네이티브 빌드에 번들된 정적 자산이면 APK 재배포가 필요할 수 있음 — `[가정]` 원격 로드 구성 여부는 배포 파이프라인 확인 필요.
- **v2 (보류):** 네이티브 `MessagingService` 에 `typhoon_radius_wake` 분기 추가 + `radiusEntry`(비대칭 반경 수식)의
  Java 포팅. 순수 JS 모듈(`typhoon_radius.js`)이 사양서 역할.

---

## 8. 프라이버시 / Play 정책

- **위치는 on-device.** 서버는 좌표를 모른다(저장소 레코드 = `token/agreed/version/at`만, `location_alert_store.js:43-48`).
- wake 페이로드 = **공개 태풍 데이터에 대한 신호(sig)** 뿐. 위치·개인정보 없음.
- 단말 재조회 대상 `/api/typhoon` 도 공개 데이터.
- 백그라운드 위치 수집 동의 문안은 기존 특보 동의(`location_alert_ui.js:136-147`)에 이미 포함 — 단, "태풍 반경" 명시
  추가 및 `CONSENT_VERSION` 변경 여부는 **사장님 결정 필요**(§11). 현재 `CONSENT_VERSION = '2026-06-16'`
  (`location_alert_ui.js:21`).

---

## 9. 파일별 변경 계획

### 신규 (2개)

| 파일 | 내용 |
|---|---|
| `local_server/services/typhoon_radius_dispatch.js` | 서버 디스패치(§3). `location_alert_dispatch.js` 미러. |
| `local_server/js/location_alert_typhoon_runtime.js` | 단말 표출 셸 + 순수부(§4). 특보 runtime과 별 파일 공존. |

### 수정 (최소 침습)

| 파일 | 변경 | 근거(라인) |
|---|---|---|
| `local_server/scheduler.js` | 10분 주기 태풍 체인에 `.then(dispatchTyphoonOnLatest)` 1줄(throw 흡수) | `scheduler.js:2530-2535` |
| `local_server/capacitor-plugins.js` | ① `typhoon_radius_wake` 수신 분기(게이트 미적용) ② `localNotificationActionPerformed` 신규 리스너 | `:93-109`, `:112-133` |

### 무변경(재사용)

| 파일 | 재사용 요소 |
|---|---|
| `local_server/services/typhoon_radius.js` | `radiusEntry`/`radAt`/`haversineKm` + 21 자체테스트 (`:87`, `:133-204`) |
| `local_server/services/typhoon_message.js` | `buildRadiusAlert`(`:263-278`), `buildDemoUrl`(`:244-252`) |
| `local_server/services/location_alert_store.js` | `getActiveConsents`/`selectTarget` 입력 |
| `local_server/services/location_alert_dispatch.js` | 패턴 템플릿(미러) — 직접 수정 안 함 |
| `local_server/js/location_alert_ui.js` | subTyphoon 저장(무수정으로 연결) |
| `local_server/js/location_alert_background.js` | `getPosition()`(`:70-72`) |
| `local_server/js/assistant_deeplink.js`, `js/ocean_typhoon.js` | 딥링크/demoFocus |

---

## 10. 코드로 확정한 검증 항목 ⓐⓑⓒ

### ⓐ `typhoon_crawler.js normRow` 가 frame에 `time:"YYYYMMDDHHmm"` 를 채우는가 — **확정: YES**

`typhoon_crawler.js:234` `function normRow(r, isCurrent)`, `:238`:
```js
time: trimStr(r.ftTm || r.typTm),   // YYYYMMDDHHmm
```
주석으로도 `YYYYMMDDHHmm` 명시. `radiusEntry` 의 정렬(`timeKey`, `typhoon_radius.js:75-78`)·ETA에 필요한 `time` 필드가 채워짐.
`normRow` 는 current/forecast 양쪽에 적용됨(`typhoon_crawler.js:288`, `:291`). 단, lat/lon/rad* 키 명칭의 정확한 일치는
구현 단계에서 `framesOf` 어댑터로 흡수(§4.2 `[가정]`).

### ⓑ 발송이력 tab('typhoon'/'location') 관리자 렌더 — **확정: YES, 둘 다 렌더됨**

`js/alert_push.js`:
- `:601` `{ id: 'typhoon', name: '태풍 발생/소멸' }  // 태풍 알림(tab:'typhoon')만 필터링`
- `:602` `{ id: 'location', name: '위치기반' }        // 위치기반 알림(tab:'location')만 필터링`
- `:124` `if (tabId === 'history' || tabId === 'typhoon' || tabId === 'location') { ... }`

→ 신규 dispatch가 `recordHistory` 에 `tab:'typhoon'` 으로 기록하면 기존 관리자 "태풍 발생/소멸" 탭에 그대로 노출됨.
**추가 UI 작업 불필요.** (특보 dispatch는 `tab:'location'`, `location_alert_dispatch.js:52`.)

### ⓒ `pushNotificationActionPerformed` 가 로컬알림 extra.url 을 읽어 딥링크하는가 — **확정: NO (신규 리스너 필요)**

- `capacitor-plugins.js:112-133` 의 핸들러는 `notification.notification.data.url` 을 읽음 — 이는 **PushNotifications**(서버 발송 알림) 전용.
- 태풍 경보는 **LocalNotifications** 로 표출(`location_alert_runtime.js:91`). `localNotificationActionPerformed` 리스너는
  **코드 전체에 0건**(grep 확인). 현재 `showLocalNotification` 은 schedule 에 `extra`/url 도 담지 않음(`:91-103`).
- → §5.3 대로 (1) 태풍 runtime의 schedule 에 `extra:{url}` 추가, (2) `localNotificationActionPerformed` 신규 리스너 추가가 필요.
  (특보는 url을 쓰지 않으므로 영향 없음 — 본 설계가 처음 도입.)

---

## 11. 결정/검증 항목 (권장값 명시)

### 확정 권장 (A·B 권장 일치)

| 항목 | 권장값 |
|---|---|
| wake 페이로드 | 신호(sig) + 단말 `/api/typhoon` 재조회 (4KB 회피, 60s 캐시: `routes/typhoon.js:45`) |
| 24h dedup | KST 캘린더 일(`YYYYMMDD` KST) 기준 |
| 복수 태풍 | 가장 이른 진입 1건만 알림 |
| 위치 stale | best-effort 사용(컷오프 없음) |
| killed | v2 보류 (v1은 JS foreground/bg만) |
| capacitor native-capable 게이트 | **태풍 분기는 게이트 미적용(JS 항상 실행)** — 함정 해소 |
| 부팅 시 dispatch | baseline 서명만 기록(즉시 방송 안 함) |

### 사장님 결정 필요

| 항목 | 내용 |
|---|---|
| **동의 문안 + CONSENT_VERSION** | 동의 문안에 "태풍 반경" 명시 추가 + `CONSENT_VERSION`(현재 `'2026-06-16'`, `location_alert_ui.js:21`) 변경(=재동의 유발) 여부. **UI 수정 중인 다른 세션과 조율 필요.** 변경 시 기존 동의자 전원 재동의 팝업 노출. |

---

## 12. 엣지 케이스

- 위치 없음 → skip(②).
- 진입 프레임 없음(반경 밖) → skip(④).
- `subTyphoon === false` → skip(①). 미설정/미로드 → fail-open(표출).
- 야간(22:00~07:00 KST) → 다음 07:00 예약(⑤). `[가정]` LocalNotifications schedule.at 지원.
- 같은 날 이미 발송 → 24h dedup skip(⑤).
- 복수 태풍 동시 진입 → ETA 최이른 1건만(④).
- `/api/typhoon` 실패/빈 응답 → skip, throw 흡수.
- 활성 태풍 0 → 서버 방송 안 함(서명 비움).
- 동일 통보문 재방송 → 서명 동일 → 서버 skip.
- 동의자 0 → 서버 `no_targets`(서명 갱신 보류해 동의자 생기면 다음 주기 발송 — 특보 `:244-247` 패턴).
- LocalNotifications 플러그인 없음(웹) → 표시 skip(`location_alert_runtime.js:90` 패턴).
- `lng→lon` 키 변환 누락 시 `radiusEntry` 가 `lon` 미존재로 항상 null → **반드시 매핑**(§4.1 ★).

---

## 13. 테스트 계획

> 현 상태: `package.json` 의 `test` 스크립트가 `echo "Error: no test specified" && exit 1`
> (root `package.json:8`, local_server `package.json` 도 스크립트 미정의). **신규/기존 테스트를 묶는
> 러너 등록 권장**(§13.3).

기존 테스트 러너 컨벤션(확정):
- 가짜 storage(`fakeStore`)로 `global.localStorage/sessionStorage` 주입(`test_location_alert_ui.js:9-19`).
- `check(name, cond, extra)` 헬퍼 + `process.exit(fail?1:0)`(`:24-27`, `:78`).
- runtime 테스트는 `global.LocationAlertCore = require(...)` 주입 후 순수부 검증(`test_location_alert_runtime.js:11-12`).

### 13.1 파트1 — 서브토글 회귀테스트 (기존 파일에 케이스 추가, 신규 파일 없음)

**`scripts/test_location_alert_ui.js` 에 `[6] 하위토글` 섹션 추가 (~8~10 케이스):**

1. 기본 subAlert ON / subTyphoon ON (`clear()` 직후 `get().subAlert/subTyphoon === true`).
2. `setSub('subAlert', false)` → `subAlert === false`.
3. `setSub('subTyphoon', false)` → `subTyphoon === false`.
4. `setSub('badKey', false)` 무시(화이트리스트) → 데이터 불변.
5. init 마이그레이션: sub키 없는 구버전 저장값 직접 주입 → `init()` 후 둘 다 ON.
6. `clear()` 가 enabled=false / consent=null 로 초기화.
7. `clear()` 가 sub 선호 보존: subTyphoon=false 저장 후 clear → 여전히 false(`!== false` 규칙).
8. `clear()` 후 미설정 sub(=undefined)는 ON으로 보존(`!== false` → true).
9. 영속성: setSub 저장 후 `data` 리셋 → `init()` 재로드 시 값 유지.
10. setSub 후 `localStorage[STORAGE_KEY]` JSON에 키 반영 확인.

**`scripts/test_location_alert_runtime.js` 에 `[6] subAlert 게이트` 섹션 추가 (~6 케이스):**
(특보 runtime의 `handleWake` subAlert 게이트 회귀 — `location_alert_runtime.js:120-124`)
가짜 `root`(전역) + `fetch` + `Capacitor.Plugins.LocalNotifications.schedule` 스파이 주입.

1. `subAlert === false` → `schedule` 미호출.
2. `subAlert === true` → `schedule` 호출(메시지 있을 때).
3. `subAlert` 미설정(기본 ON) → 호출(fail-open).
4. `LocationAlertSettings` 미로드 → 호출(fail-open).
5. 위치 없음(`getPosition()===null`) → 미호출.
6. 메시지 없음(`decideAlert`→null, 예: 특보 없음) → 미호출.

### 13.2 파트2 — 태풍 엔진 신규 테스트

신규 파일 권장: `scripts/test_typhoon_radius_dispatch.js`, `scripts/test_typhoon_runtime.js`.

**서버 `dispatchTyphoon` (순수/주입):**
- `selectTargetTokens`: agreed=true dedup, agreed=false 제외, 빈 입력 → [].
- 서명: 동일 seq+latestTmFc → 재발송 skip; 변경 → 발송.
- `getConsents`/`sendFn` mock → `dispatchTyphoon` 호출 횟수·토큰 검증.
- `record:false` 시 이력 미기록.
- 활성 0 → no_active.

**단말 순수부:**
- `framesOf`: 통보문 → 정렬된 프레임 배열, 키 매핑.
- `decideTyphoonAlert`: storm 우선 / strong 폴백 / 반경 밖 null.
- 복수 태풍: ETA 최이른 1건 선택.
- `inSendWindow`: 06:59→false, 07:00→true, 21:59→true, 22:00→false (KST).
- `nextWindowStart`: 야간 시각 → 다음 07:00 KST.
- `kstDayKey`: UTC 경계(예: 22:00 UTC = 익일 07:00 KST) 정확.

**단말 표출 셸 `handleTyphoonWake` (스파이 주입):**
- `subTyphoon===false` → schedule 미호출; 미설정 → 호출(fail-open).
- 위치 없음 → 미호출.
- `fetch /api/typhoon` mock → 진입 시 `buildRadiusAlert` + `extra.url`(buildDemoUrl guide:true) 포함 schedule.
- 24h dedup: 같은 KST 일 재호출 → 미호출.
- 야간 → 즉시 schedule 대신 `schedule.at` 예약.

**capacitor 분기(단위/로직):**
- `type==='typhoon_radius_wake'` → native-capable 여부 무관하게 `handleTyphoonWake` 호출(게이트 미적용 회귀).
- `localNotificationActionPerformed` → `extra.url` → 라우팅.

### 13.3 러너 등록 (권장)

`local_server/package.json` 에 다음 추가 권장 `[가정 — 파일명 목록은 위 신규 포함]`:
```jsonc
"scripts": {
  "test": "node scripts/test_location_alert_core.js && node scripts/test_location_alert_forecast.js && node scripts/test_location_alert_server.js && node scripts/test_location_alert_runtime.js && node scripts/test_location_alert_ui.js && node services/typhoon_radius.js && node scripts/test_typhoon_radius_dispatch.js && node scripts/test_typhoon_runtime.js"
}
```

---

## 14. 구현 순서 (제안)

1. **서버 dispatch** `services/typhoon_radius_dispatch.js` + 단위테스트(주입 mock). 발송 없이 서명/선택 로직부터.
2. **스케줄러 hook** 1줄(throw 흡수) + 부팅 baseline 처리.
3. **단말 순수부** `decideTyphoonAlert/framesOf/inSendWindow/nextWindowStart/kstDayKey` + 테스트.
4. **단말 표출 셸** `handleTyphoonWake` + 스파이 테스트.
5. **capacitor 분기** `typhoon_radius_wake`(게이트 미적용) + `localNotificationActionPerformed` 리스너 + `showLocalNotification` extra.url.
6. **subTyphoon 연동 확인**(UI 무수정) + 파트1 회귀테스트 케이스 추가.
7. **러너 등록**(package.json) + 전체 그린.
8. (사장님 결정 후) 동의 문안/CONSENT_VERSION 처리.
9. (이후) v2: 네이티브 MessagingService 분기 + radiusEntry Java 포팅(killed 지원).
