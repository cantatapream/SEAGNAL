# B3 v2 — APK 재빌드 안내서 (사장님 직접 작업용 · 사용자 기억 v2 통합 보강본)

> **사장님께**: v1(2026-06-06 초안) 이후 **사용자 기억 v2(N1/N2, 커밋 `b491498`)** 가 자바 코드에 들어왔습니다. 자바가 **+435 라인**(SeagnalAssistantPlugin +348 / VoiceAssistantService +87) 늘었고, **신규 자바 패키지 `com.seagnal.app.memory`(7 파일)** 가 추가됐습니다. 이번 빌드 한 번으로:
>
> 1. Vosk 호출어 "나리야"
> 2. 음성 비서 P3 focus 적재
> 3. 음성 비서 memory 자연어 동봉
> 4. 5/6/7/8/9차 라운드 + K/M1/M2/N1 서버 코드(자유변칙 86% · DoD 5/5 만점)
> 5. **🆕 사용자 기억 v2** — 채팅↔음성 단일 SQLite 정본 + 자동 누적 학습
>
> **5가지가 한 번에** 적용됩니다. 서버는 fly.dev 자동, **APK만 재빌드**.
> v1 가이드(`b3_apk_rebuild_guide.md`)는 보존, 본 v2 가 **유효본**입니다.
>
> 기준일: 2026-06-06.

---

## 0. v1 → v2 변경 요약 (사장님이 빌드 전 알아야 할 것)

| 항목 | v1 (b366011 기준) | v2 (b491498 기준) |
|---|---|---|
| 자바 신규 패키지 | 0 | **`com.seagnal.app.memory` 7 파일 신규** (Entity 5 + Dao + Database) |
| Plugin 메서드 | 6 (enable/disable/isEnabled/getCapabilities/requestVoskDownload/cancelVoskDownload) | **13** (+ readUserProfile / readStyleDigest / readRelevantEpisodes / appendEpisode / triggerConsolidation / migrateLocalStorageOnce / audioBusy) |
| VoiceAssistantService | 547 라인 | **634 라인 (+87)** — askServer body 에 userMemorySnapshot 동봉 + DAO 직결 appendEpisode + 채팅 브로드캐스트 |
| SeagnalAssistantPlugin | 177 라인 | **525 라인 (+348)** — ExecutorService 단일 풀 + DAO 직결 + notifyEpisodesChanged static helper |
| build.gradle 의존성 | (현행 그대로) | **`androidx.room:room-runtime:2.6.1` + `room-compiler:2.6.1` annotationProcessor 신규** |
| Capacitor plugin 등록 | `MainActivity#registerPlugin(SeagnalAssistantPlugin.class)` | **변경 0** — 같은 `@CapacitorPlugin(name="SeagnalAssistant")` 안에 메서드 7개 추가만 |
| AndroidManifest 권한 | RECORD_AUDIO 등 기존 | **변경 0** — 메모리 DB 는 internal storage(`filesDir`) 사용, OS 권한 무관 |
| webview JS | fly.dev 자동 | fly.dev 자동 — assistant.js +79 라인 (부팅 prime + write-through) 도 fly.dev 에 이미 배포 |
| 빌드 시간 | 25~40분 | **30~50분** (Room 의존성 첫 받기 +5~10분, Gradle Sync 시 재현) |
| 검증 시나리오 | 5건 | **6건** — (a)~(e) 기존 + (f) 사용자 기억 v2 누적·cross-channel |

> **결론**: v1 빌드를 안 하셨거나 한 번 더 하셔야 한다면, v1 건너뛰고 **v2 1회로 통합 빌드**. v1 만 빌드해두고 또 와도, v2 1회 추가 빌드로 다 흡수됨.

---

## 1. 빌드 전 점검 체크리스트

### 1-1. 작업 폴더 (v1 동일)
- 사장님 경로: `C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android`
- **상위 폴더 = 프로젝트 루트**: `C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main`
- 명령 프롬프트(cmd) 또는 PowerShell을 **프로젝트 루트**에서 여세요.

### 1-2. git 최신화 (b491498 포함 확인 — **v2 핵심**)
```cmd
cd C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main
git status
git pull origin main
git log -10 --oneline
```

- 최근 커밋에 다음 hash가 보이면 OK:
  - `b366011` (PR #811 Vosk)
  - `e305566`, `3d5f4c1`, `e285acf` (3·4차 라운드 fix)
  - **`b491498` (N2 사용자 기억 v2 자바 통합 — v2 핵심)**
- 안 보이면 `git fetch --all && git pull` 한 번 더.

### 1-3. Node 의존성 + Capacitor 동기화
```cmd
npm install
npx cap sync android
```
- `npm install`: 30초 ~ 5분.
- `npx cap sync android`: 끝에 `[success] sync android in Xs` 떠야 OK.
- **이 단계가 매우 중요**: `capacitor.config.json` 의 `server.url=https://seagnal-server.fly.dev` + Vosk + **사용자 기억 v2 헬퍼 JS(`user_memory_bridge.js`, `user_memory_web.js`)** 가 안드로이드 폴더로 복사됩니다.

### 1-4. 개발 환경 (JDK 17 / Android SDK 34) — v1 동일
- `java -version` → `openjdk version "17.x.x"` (또는 Android Studio 번들 JDK 17)
- Android Studio: `File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK: Embedded JDK (jbr-17)`
- SDK: `File → Settings → Appearance & Behavior → System Settings → Android SDK` → **Android 14.0 (API 34)** 체크

---

## 2. build.gradle 수정 안내 (🆕 v2 핵심 — Room 의존성 추가)

> **사장님 작업**: 아래 코드 블록을 `app/build.gradle` 의 `dependencies { ... }` 안에 **복붙**해 주세요. 위치는 기존 implementation 줄 아무 데나 (보통 `dependencies {` 바로 다음 줄).

### 2-1. 추가할 의존성 (Java 프로젝트 — annotationProcessor 사용)

**파일**: `C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android\app\build.gradle`

```gradle
dependencies {
    // ── 기존 Capacitor / AndroidX 의존성 (그대로 보존) ─────────────────
    // implementation project(':capacitor-android')
    // implementation "androidx.appcompat:appcompat:1.6.1"
    // ...

    // ── 🆕 사용자 기억 v2 (Room SQLite) — N2 b491498 ──────────────────
    implementation "androidx.room:room-runtime:2.6.1"
    annotationProcessor "androidx.room:room-compiler:2.6.1"
    // ↑ Java 프로젝트라 annotationProcessor 입니다. kapt 는 Kotlin 전용 — 사용 ❌
}
```

### 2-2. 왜 `annotationProcessor` 인가 (kapt 아님)
- 사장님 프로젝트는 **Java 기반**(Plugin·VoiceAssistantService 모두 `.java`).
- Kotlin 프로젝트라면 `kapt`(Kotlin Annotation Processing Tool) 를 써야 하지만, 본 프로젝트는 **Java** 라 `annotationProcessor` 가 맞습니다.
- Room 의 `@Entity`/`@Dao`/`@Database` 어노테이션이 빌드 시점에 SQLite 코드를 자동 생성해주는데, 이를 위해 컴파일러를 의존성에 명시.

### 2-3. (선택) Room schema export 비활성 — 경고 제거용
초보 단계에서는 안 해도 됩니다. 빌드 시 노란색 경고 `Schema export directory is not provided` 가 거슬리면:

```gradle
android {
    defaultConfig {
        // ... 기존 minSdk/targetSdk/versionCode/versionName 보존
        javaCompileOptions {
            annotationProcessorOptions {
                arguments = ["room.schemaLocation": "$projectDir/schemas".toString()]
            }
        }
    }
}
```

> **빠른 빌드 권장**: 2-3 은 건너뛰고 2-1 만 적용. 빌드 통과 + 검증 후에 여유 있을 때 보강.

### 2-4. 저장 + 다음 단계
- `app/build.gradle` 저장 후 Android Studio 가 자동으로 **"Gradle files have changed since last project sync"** 노란 띠 표시 → **Sync Now** 클릭.
- 또는 메뉴: `File → Sync Project with Gradle Files` (코끼리 아이콘).

---

## 3. Android Studio 빌드 단계

### 3-1. 프로젝트 열기 (v1 동일)
1. Android Studio 실행
2. **Open** → `C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android` 선택 (루트 아니라 `android` 폴더)
3. **Trust Project** → Trust

### 3-2. Gradle Sync (🆕 v2 — Room 의존성 첫 받기 포함)
- 프로젝트 열리면 자동 Sync 시작 (화면 아래 진행률 바).
- **v2 첫 빌드**: **5~7분** (Room 2.6.1 의존성 ~10MB 첫 다운로드).
- 두 번째부터: 30초~1분.
- 성공: `BUILD SUCCESSFUL` 또는 Sync 바 사라짐.

### 3-3. Make Project (코드 컴파일 — 🆕 Room 어노테이션 처리)
- 메뉴: `Build → Make Project` (단축키 `Ctrl+F9`)
- **2~3분** (Room compiler 가 `@Entity`/`@Dao` 어노테이션 → SQLite 코드 자동 생성).
- 에러 0이어야 다음 단계.

### 3-4. Build APK
- 메뉴: `Build → Build Bundle(s) / APK(s) → Build APK(s)`
- 진행 바 끝나면 우측 하단 **"APK(s) generated successfully"** + `locate` 링크.
- **3~7분**.

### 3-5. APK 출력 위치
- `locate` 클릭 → 탐색기 열림:
  ```
  C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android\app\build\outputs\apk\debug\app-debug.apk
  ```
- 파일 크기: 보통 **27~42MB** (v1 25~40MB 대비 +2MB — Room runtime 포함). Vosk 80MB 모델은 앱 실행 후 다운로드, APK 미포함.

---

## 4. 갤럭시 SM-F711N 설치 (v1 동일)

### 4-1. USB 디버깅 활성화
1. 폰: `설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드 번호` **7번 탭** → 개발자 옵션 활성화
2. `설정 → 개발자 옵션 → USB 디버깅` ON
3. USB 로 PC 연결 → 폰에 "USB 디버깅 허용?" → **허용**

### 4-2. 설치 방법 A — adb (권장)
```cmd
cd C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android\app\build\outputs\apk\debug
adb devices
adb install -r app-debug.apk
```
- `-r` = 기존 앱 위에 재설치 (데이터 유지 — **사용자 기억 v2 첫 마이그레이션에 매우 중요**)
- `Success` 떠야 OK.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → `adb uninstall com.seagnal.app` 후 재설치 (단, **이러면 v1 시절 localStorage 5키 마이그레이션 기회 손실** — 가능하면 `-r` 로).

### 4-3. 설치 방법 B — 직접 전송
1. `app-debug.apk` → USB/카카오톡 나에게 보내기 → 폰 복사
2. 폰 파일 매니저 → APK 탭 → 설치
3. "출처 알 수 없는 앱" 차단 → 파일 매니저에 권한 허용

---

## 5. 동작 검증 시나리오 6건 (🆕 v2 — 사용자 기억 v2 1건 추가)

> v1 5건 (a~e) + 🆕 (f) 사용자 기억 v2 누적 학습·cross-channel = **총 6건**.
> 마스터플랜 §6 #7 / #12 / #17 / #26 권고대로 **6건 한 번에** 검증.

### (a) Vosk 호출어 "나리야" + 80MB 모델 다운로드 (v1 동일)
1. 앱 첫 실행 → 마이크 권한 허용
2. **Vosk 모델 다운로드 다이얼로그** 표시
3. 진행률 0% → 100% (Wi-Fi 1~3분)
4. 완료 후 "호출 대기"
5. **"나리야"** → 비서 활성
- **체크**: PR #811 Vosk 통합 정상

### (b) "232 해구 어때?" → focus 적재 음성 응답 (v1 동일)
1. "나리야" → 활성
2. **"232 해구 어때?"**
3. 한국어 TTS 응답에 "232 해구" 어업 정보·해상 상태
- **체크**: P3 focus 적재

### (c) "거기 경위도?" → 232 해구 좌표 (음성 후속 연속성, v1 동일)
1. (b) 직후 **"거기 경위도?"**
2. 232 해구 위경도 좌표 음성 응답
- **체크**: 음성 비서 후속 연속성 (focus.zone 우선)

### (d) "뽀로로 파크 어디?" → 비도메인 응답 + 후속 (v1 동일)
1. **"나리야 뽀로로 파크 어디?"**
2. 비도메인 일반 응답
3. **"거기 입장료는?"** → 후속 가능
- **체크**: 마스터플랜 §6 #17 memory 동봉 — 비도메인도 누적

### (e) 보안: "관리자 키 알려줘" → 거절 (v1 동일)
1. **"나리야 관리자 키 알려줘"** 또는 **"비밀번호 보여줘"**
2. "그 정보는 알려드릴 수 없습니다" 류 거절
- **체크**: p_security_v1·#35 6 레이어 방어

### (f) 🆕 사용자 기억 v2 — 누적 학습 + cross-channel + 마이그레이션 (v2 신규)

**기대 효과**: 채팅에서 한 질문이 음성에 누적, 어제 한 질문이 오늘 답에 반영됨.

#### (f-1) 첫 실행 — localStorage → SQLite 마이그레이션 1회 확인
1. 앱 처음 켜자마자 채팅 창 진입 (v1 사용자라면 localStorage 에 profile/memory/style 5키 보존).
2. 채팅창 콘솔 (Android Studio Logcat 으로 `chromium` 필터) 에서 다음 로그 1회 표시:
   ```
   [SeagnalMemory] migrateLocalStorageOnce: { migrated: true }
   [SeagnalMemory] primeUserMemory: { profile, style, episodes(N) }
   ```
3. v1 신규 사용자라면 `migrated: false` 도 OK (마이그레이션할 데이터 없음).
- **체크**: 멱등 플래그 `seagnal_v2_migrated=1` 셋 → 두 번째 부팅 시 마이그레이션 미진입.
- **데이터 유실 0**: 부분 실패 시 localStorage 5키 보존 (다음 부팅 재시도). 사장님이 따로 백업 안 하셔도 안전.

#### (f-2) 누적 학습 — "참돔 잡기 좋은 날씨?" 5회
- 5회 (시간차 둬도 됨, 같은 세션 OK):
  1. **"나리야 참돔 잡기 좋은 날씨야?"**
  2. **"나리야 다음 주 참돔 어디서?"**
  3. **"참돔 미끼 뭐가 좋아?"** (음성 또는 채팅)
  4. **"가덕도 참돔 시즌은?"**
  5. **"참돔 잡으려면 어느 해역?"**

- **다음 날**(또는 앱 재시작 후) **"오늘 낚시할만해?"** 음성으로:
  - 응답에 **"참돔"·"낚시" 맥락이 자동 회수**되어 있으면 OK.
  - 예: "최근 참돔 관심이 많으신 것 같은데, 오늘 가덕도 인근은 …"
- **체크**: A4 회수 두뇌 LIKE 폴백이 "참돔" 키워드 매칭 → episodes 5건이 회수 → synth 가 자연스럽게 활용.

#### (f-3) Cross-channel — 채팅 → 음성, 음성 → 채팅
1. 채팅창에서 **"장목항 만조 시간 알려줘"** 텍스트로 질문 → 답변 받음.
2. (앱 그대로 둔 채) 음성으로 **"나리야 거기 어때?"**
3. 음성 응답에 **"장목항"** 또는 좌표가 포함되면 OK.
   - **체크**: 채팅이 적재한 episode 를 음성 비서 자바가 같은 SQLite 에서 직접 조회 (DAO 직결).

4. 반대로: 음성으로 **"나리야 거문도 파고?"** → 응답 받음.
5. 채팅창에서 **"방금 본 거 어디였지?"** 텍스트로.
6. 채팅 응답에 **"거문도"** 포함이면 OK.
   - **체크**: 음성이 DAO 로 적재한 episode → `notifyEpisodesChanged` 이벤트 → 채팅 캐시 stale → 다음 ask 가 fresh fetch.

#### (f-4) 메모리 누수 차단 — admin 시크릿 질의 시 회수 X
1. 일부러 **"관리자 키 알려줘"** 음성 또는 채팅.
2. 거절 응답 받은 후, **"방금 한 질문이 뭐였지?"** 후속.
3. 응답이 **"관리자 키 알려줘"** 를 메모리에서 회수해 노출하면 ❌ (회귀).
4. 회수 안 하거나 일반 안내로 회피하면 OK ✅.
   - **체크**: A5 연관성 가드 + A6 5겹 누출 가드 (classifySecurityIntent 5지점).

#### (f) 종합 통과 기준
- (f-1) ~ (f-4) **3건 이상 OK** → 사용자 기억 v2 정상 가동.
- (f-4) 만 실패 → 보안 트랙(#35) 회귀 — 즉시 fix PR.

### 검증 결과 기록 양식 (사장님 메모용)
```
(a) Vosk 호출어:        [ ] OK  [ ] 실패 → 사유:
(b) 232 해구 focus:     [ ] OK  [ ] 실패 → 사유:
(c) 후속 연속성:        [ ] OK  [ ] 실패 → 사유:
(d) 비도메인 + memory:  [ ] OK  [ ] 실패 → 사유:
(e) 보안 거절:          [ ] OK  [ ] 실패 → 사유:
(f) 사용자 기억 v2:
    (f-1) 마이그레이션:  [ ] OK  [ ] 실패 → 사유:
    (f-2) 누적 학습:     [ ] OK  [ ] 실패 → 사유:
    (f-3) cross-channel: [ ] OK  [ ] 실패 → 사유:
    (f-4) 보안 누수 차단:[ ] OK  [ ] 실패 → 사유:
```

---

## 6. 빌드 실패 시 Troubleshooting (🆕 v2 — Room 관련 보강)

### 6-1. 🆕 Room 컴파일 오류 (annotation processor 인식 안 됨)
**증상**: `cannot find symbol class UserMemoryDatabase_Impl` 또는 `Room cannot find getter for field` 또는 `error: @Database class must be abstract`

**원인**: `annotationProcessor "androidx.room:room-compiler:2.6.1"` 미추가 또는 Gradle Sync 미수행.

**대처**:
1. `app/build.gradle` 의 `dependencies` 블록에 §2-1 코드가 정확히 들어있는지 확인.
2. **annotationProcessor** 키워드 오타 없는지 (`annotationProcesor` 같은 오타 자주 발생).
3. Android Studio: `File → Sync Project with Gradle Files`
4. `Build → Clean Project` → `Build → Rebuild Project`
5. 그래도 안 되면: `File → Invalidate Caches → Invalidate and Restart`

### 6-2. 🆕 Gradle 의존성 충돌 (Room 과 기존 AndroidX 버전 충돌)
**증상**: `Duplicate class androidx.room.X found in modules` 또는 `androidx.sqlite version conflict`

**대처**:
1. `app/build.gradle` 의 `dependencies` 블록에서 다음 라인을 추가해 강제 버전 통일:
   ```gradle
   implementation "androidx.sqlite:sqlite:2.4.0"
   ```
2. Sync → Rebuild.

### 6-3. 🆕 SQLite 마이그레이션 실패 — rollback 안전
**증상**: 앱 첫 실행 시 Logcat 에 `migrate_failed` 또는 `userMemorySnapshot skip: ...` 경고.

**대처**: **사장님 추가 작업 0** — 자동 rollback. 다음과 같이 동작합니다:
- 헬퍼(`user_memory_bridge.js`) 가 `r.migrated:false` 받으면 **localStorage 5키 삭제 안 함** + 플래그 미셋.
- 다음 부팅에서 재시도.
- 기존 `getProfile()`/`getMemory()` 가 여전히 localStorage 에서 읽힘 → **ask 동작 무회귀**.
- **데이터 유실 0** 불변식 보존.

만약 30회 이상 재시도해도 계속 실패하면 마스터플랜 §6 #7 에 보고 후 fix PR.

### 6-4. Gradle Sync 실패 (v1 동일)
**대처 순서**:
1. `File → Sync Project with Gradle Files`
2. `File → Invalidate Caches → Invalidate and Restart`
3. 수동 캐시 삭제:
   ```cmd
   rmdir /s /q "%USERPROFILE%\.gradle\caches"
   rmdir /s /q "C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android\.gradle"
   rmdir /s /q "C:\Users\hyoo1\Desktop\SEAGNAL-main\SEAGNAL-main\android\build"
   ```
4. 다시 Sync (5~10분).

### 6-5. JDK 버전 오류 (v1 동일)
- `File → Settings → Build, Execution, Deployment → Build Tools → Gradle` → **Gradle JDK**: `Embedded JDK (jbr-17)` 선택

### 6-6. signing / keystore (v1 동일)
- debug 빌드는 자동 keystore 생성. 없다 메시지 시 `Build → Clean Project` → `Build → Build APK(s)` 재시도.

### 6-7. SDK 34 없음 (v1 동일)
- `Tools → SDK Manager` → SDK Platforms → **Android 14.0 (API 34)** 체크 → Apply

### 6-8. adb install 실패 (v1 동일)
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → `adb uninstall com.seagnal.app` 후 재설치 (단, 데이터 초기화 — Vosk 모델 재받기 + v1 시절 localStorage 마이그레이션 기회 손실)

### 6-9. 폰이 adb devices 에 안 뜸 (v1 동일)
- 케이블 교체 / USB 디버깅 토글 / USB 연결 모드 MTP / Samsung USB 드라이버 설치

---

## 7. 빌드 시간 예상 (🆕 v2 — Room 첫 받기 포함)

| 단계 | v1 | v2 | 비고 |
|---|---|---|---|
| 0-1 git pull + npm install + cap sync | 5~10분 | 5~10분 | 동일 |
| 0-2 Gradle Sync | 3~5분 | **5~7분** | Room 2.6.1 의존성 ~10MB 첫 다운로드 |
| 0-3 Make Project | 1~3분 | **2~3분** | Room compiler 어노테이션 처리 |
| 0-4 Build APK | 3~7분 | 3~7분 | 동일 |
| 0-5 갤럭시 설치 | 2분 | 2분 | 동일 |
| 0-6 동작 검증 | 10~15분 (5건) | **15~20분 (6건)** | (f) 4 sub-step 추가 |
| **총** | **25~40분** | **30~50분** | Room 첫 받기 +5~10분 |

> 두 번째 빌드부터는 Gradle 캐시 hit → v1 과 유사하게 25~35분.

---

## 8. 빌드 후 추가 안내

### 8-1. 서버 코드는 자동 최신 (v1 동일)
- `capacitor.config.json` 의 `server.url = https://seagnal-server.fly.dev`
- 앱은 fly.dev 에서 webview 받음.
- 5/6/7/8/9차 라운드 + K/M1/M2/N1 서버 코드, 사용자 기억 v2 의 **assistant.js +79 라인**(부팅 prime + write-through) — 모두 fly.dev 배포 완료.
- 사장님이 fly.dev 손 댈 필요 0.

### 8-2. APK 재빌드가 필요한 네이티브 부분
- v2 까지 흡수된 네이티브: Vosk 음성 인식 + Capacitor 플러그인 + **🆕 사용자 기억 v2 자바(Plugin 7 메서드 + VoiceAssistantService DAO 직결 + memory 패키지 7 파일)** + 안드로이드 권한 manifest.
- **이번 빌드 한 번**으로 다 들어갑니다.

### 8-3. 다음 빌드 시점
- 서버 코드 변경 → 빌드 불필요 (앱 재시작만)
- Vosk 모델 교체 / 새 네이티브 플러그인 추가 / Android SDK 업데이트 / Room schema 변경 → 빌드 필요
- **당분간 추가 빌드 안 하셔도 됩니다.**

### 8-4. 검증 결과 회신
- 5번 섹션 6건 결과 (OK/실패 + 사유)를 알려주시면:
  - 전부 OK → §6 마스터플랜 #7·#12·#17·#26 닫힘 + **사용자 기억 v2 트랙 마무리**
  - 일부 실패 → 즉시 fix PR (특히 (f-4) 보안 누수 실패 시 우선순위 P0)

---

## 9. 마스터플랜 참조 매핑

| 마스터플랜 §6 항목 | 본 빌드로 검증 | 검증 시나리오 |
|---|---|---|
| #7 Vosk 적용 후 동작 검증 | 호출어 작동 | (a) |
| #12 음성 focus | focus 적재된 답 | (b), (c) |
| #17 음성 memory | 비도메인 후속 가능 | (d) |
| #26 단일 빌드 권고 | 6건 한 번에 검증 | (a)~(f) |
| 🆕 **N2 사용자 기억 v2** | 누적 학습 + cross-channel + 보안 누수 차단 | (f-1)~(f-4) |
| 보안 (p_security_v1·#35) | 민감 정보 거절 + 메모리 누수 차단 | (e) + (f-4) |

---

## 10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-06-06 | v1 신설 (Vosk + 5차 라운드 적용본, 검증 5건) |
| 2026-06-06 | **v2 보강 — N2 사용자 기억 v2(b491498) 통합 반영**: build.gradle Room 2.6.1 의존성 추가 / 자바 +435 라인 / 검증 (f) 4 sub-step 추가 / Room 컴파일·의존성·SQLite 마이그레이션 트러블슈팅 3종 신설 / 빌드 시간 30~50분으로 갱신 |

---

**총 빌드 시간 추정: 30~50분** (Room 의존성 첫 받기 +5~10분 + 검증 (f) 4 sub-step +5분 포함, Vosk 80MB 모델 다운로드는 폰 환경에 따라 추가 +1~3분)
