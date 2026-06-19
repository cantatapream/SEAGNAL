# 사용자 기억 시스템 v2 — A1 저장소 설계 (Personal RAG / LLM-Managed User Memory)

> 트랙: **A1 (저장소 청사진)** · 상위 비전: "LLM이 사용자에 대해 계속 공부하면서 매 질문마다 그 공부 내용을 보고 답한다."
> 작성일: 2026-06-06 · 상태: **설계 전용(코드 수정 0)**
> 관련 불변식: `cross_cutting.md §3 프라이버시`(로컬 원칙·서버 비식별 인메모리) · `security_boundary.md §1(c) 컨텍스트 격리`(라벨 출력금지 #24)
> 후속 트랙: A2(쓰기 파이프라인) · A3(영구 압축 두뇌) · A4(검색·RAG) · A5(주입 컨텍스트 빌더) · A6(보안·격리) · A7(평가·게이트) · **A8(마이그레이션)** · A9(백업·복원, 결정 대기)

---

## 0. 한눈에 — 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| 안드로이드 매체 | **SQLite + Room 라이브러리** | 구조화·인덱스·트랜잭션·무한 증가 안전 |
| 웹/채팅 매체 | **IndexedDB(idb 래퍼)** | localStorage 5MB 한계 회피, 동일 스키마 미러 |
| 보존 정책 | episodes **영구 원본** + consolidated_memory **AI 갱신본**(논리 삭제 X, version 분리) | "공부한 내용을 매번 본다"는 비전과 일치, 원본 회수 가능 |
| 압축 트리거 | **episodes 행 ≥ 10,000** OR **마지막 압축 이후 ≥ 500건** OR **수동(/설정)** | 폭주 방지·배터리 보호 |
| 마이그레이션 | 기존 `seagnal_memory(20)` → `episodes` 신규 행 1회 변환 (트랙 **A8** 분리) | 데이터 손실 0, 롤백 안전 |
| 백업·복원 | **사장님 결정 대기** (옵션 3종 후보 §7) | 로컬 원칙(`cross_cutting §3`) 위반 가능성 — 동의 범위 명문화 선행 |
| 보안 | 모든 테이블 **휴대폰/브라우저 로컬**, 서버 미동기화. `source_channel`만 메타. **라벨 누수 가드(#24) 영향 없음** (저장만, 출력 시 정제) | 기존 불변식 유지 |

---

## 1. 저장 매체 결정 (안드로이드 + 웹)

### 1.1 안드로이드 — SQLite (Room)

| 후보 | 장점 | 단점 | 결정 |
|---|---|---|---|
| **SQLite (Room)** | 인덱스·트랜잭션·스키마 마이그레이션 내장 · 행 수 무한 안전 · LiveData/Flow 관찰 가능 | APK +500KB~1MB(androidx.room-runtime + room-ktx) · 컴파일러 어노테이션 처리 | **채택** |
| SharedPreferences | 의존성 0 · 단순 | key-value flat · 무한 누적 시 read 시 전체 역직렬화(O(n) 메모리) · 인덱스 불가 | 기각 |
| JSON 파일 (`filesDir`) | 의존성 0 · 백업 단순 | 전체 read/write · 동시성 락 직접 관리 · 검색 시 풀스캔 | 기각 |

**Room 채택 근거**:
- 무한 누적 전제 → 인덱스 없는 매체는 검색 지연(p95)이 사용자 질문당 누적되어 **`cross_cutting §2` p95 ≤5000ms 게이트 위협**.
- 기존 `VoiceAssistantService.recentMemory(ArrayDeque<String> 8)` 은 RAM only → 앱 종료 시 소실. Room 으로 교체 시 동일 인터페이스(`addLast/pollFirst`) DAO 메서드로 흡수 가능.

### 1.2 웹/채팅 — IndexedDB

| 후보 | 장점 | 단점 | 결정 |
|---|---|---|---|
| **IndexedDB** | 비동기·인덱스·수십~수백 MB 가능 · 대부분 브라우저 지원 | API 장황 → `idb`(Jake Archibald) 또는 `dexie.js` 래퍼 권장 | **채택** |
| localStorage(현행) | 단순 · 동기 | **5~10MB 하드 한계**, 무한 누적 불가, JSON 직렬화/역직렬화 비용 O(n) | 기각(누적 매체로) |
| Cache API / OPFS | 대용량 가능 | 구조화 질의 없음 · 키-값 / 파일 시스템 추상화 | 기각 |

**위험**: Safari Private Mode 에서 IndexedDB 쿼터 0 또는 일시 저장. → **폴백**: 감지 시 localStorage 모드로 **읽기 전용 디그레이드**(쓰기 큐는 메모리 보관 후 다음 세션에 재시도). 사용자에게 "음성 비서 기억이 일시 저장 모드입니다" 1회 토스트.

### 1.3 통합 — 동일 논리 스키마

두 매체는 **동일 스키마(테이블·필드·인덱스명)** 를 미러링. 안드로이드 ↔ 웹 사이의 직접 동기화는 v2 범위 외(A9 백업·복원에서만 다룸). 단 채널 식별을 위해 모든 쓰기 row 에 `source_channel ∈ {chat, voice}` 컬럼 강제.

---

## 2. 스키마 설계 (DDL 의사코드)

> 의사코드는 SQLite 방언. Room 어노테이션은 별도 트랙(A2 구현)에서 매핑. IndexedDB 는 동일 컬럼명을 키 경로/인덱스명으로 1:1 매핑.

### 2.1 `user_profile` — 단일 행 (직군·정적)

```sql
CREATE TABLE user_profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),  -- 싱글톤 강제
  jikgun          TEXT,        -- 직군 코드 (예: marine_leisure, local_gov, fishing 등)
  default_zone    TEXT,        -- 기본 해역 (예: KR_S_SOUTH)
  display_name    TEXT,        -- 호칭/별명 (옵션)
  answer_style    TEXT,        -- 선호 답변 길이/톤 (short/normal/long, casual/formal)
  experience_years INTEGER,    -- 관련 경력 (해당 직군 노출 시)
  preferred_format TEXT,       -- 표/문장/리스트 선호
  onboarded_at    INTEGER,     -- epoch ms
  updated_at      INTEGER      -- epoch ms (트리거로 갱신)
);
```

- **불변식**: 1행 강제(`CHECK id=1`). 직군 변경은 UPDATE.
- **마이그레이션 출처**: 기존 `localStorage.seagnal_profile` JSON.

### 2.2 `interest_topics` — 다행 (관심사·빈도)

```sql
CREATE TABLE interest_topics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  topic           TEXT NOT NULL,           -- 정규화된 키워드 (예: "태풍", "안개", "물때")
  zone            TEXT,                    -- 해역 한정 토픽일 때만
  count           INTEGER NOT NULL DEFAULT 1,
  last_seen_at    INTEGER NOT NULL,        -- epoch ms
  first_seen_at   INTEGER NOT NULL,
  source_channel  TEXT NOT NULL CHECK (source_channel IN ('chat','voice','mixed')),
  UNIQUE (topic, zone, source_channel)     -- 채널·해역별 별도 행
);
```

- **upsert 규칙**: 동일 `(topic, zone, source_channel)` 존재 시 `count += 1`, `last_seen_at = now`. 채널이 섞이면 mixed 로 머지(A2 정책).
- **마이그레이션 출처**: 기존 `style.topicCounts`, `style.zoneCounts` Map → `interest_topics` 다행 변환.

### 2.3 `style_digest` — 단일 행 (말투 요약)

```sql
CREATE TABLE style_digest (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  style_note      TEXT,                   -- AI가 갱신한 1문장 요약 (현 styleNote)
  preferred_format TEXT,                  -- table/sentence/list
  total_questions INTEGER NOT NULL DEFAULT 0,
  first_at        INTEGER,
  updated_at      INTEGER,
  version         INTEGER NOT NULL DEFAULT 1   -- 갱신 회차 (디버깅용)
);
```

- **갱신 주기**: `total_questions % 8 == 0` 시 AI 호출(기존 `STYLE_REFRESH_EVERY` 동일).
- **누락 호환**: 기존 `seagnal_style` JSON 1:1 매핑.

### 2.4 `episodes` — 다행, **무한 누적 원본**

```sql
CREATE TABLE episodes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        INTEGER NOT NULL,        -- epoch ms
  query             TEXT NOT NULL,           -- 사용자 원문 (≤300자, 트림)
  answer_summary    TEXT NOT NULL,           -- 어시스턴트 답변 요약 (≤600자, 트림)
  zone              TEXT,                    -- 응답 시 추정 해역
  tools_used        TEXT,                    -- JSON 배열 stringified (예: '["get_marine_forecast"]')
  domain            TEXT,                    -- 도메인 분류 (marine_forecast/typhoon/general 등)
  source_channel    TEXT NOT NULL CHECK (source_channel IN ('chat','voice')),
  intent            TEXT,                    -- planQuery 의 1차 의도 (옵션)
  consolidated_ref  INTEGER,                 -- 압축본으로 흡수된 경우 consolidated_memory.id (NULL=원본)
  compressed_flag   INTEGER NOT NULL DEFAULT 0   -- 0=raw, 1=압축됨(검색 우선순위 ↓)
);
```

- **회수 용도**: 압축본이 정밀도를 잃었을 때 원본 회수.
- **트림 상한**: query 300자 · answer_summary 600자 — `services/assistant_log.js` 의 인메모리 비식별 정책과 **동일 상한** 적용해 누수면 일관 유지.
- **개인정보 필드 금지**: 좌표·전화·이메일·계정 식별자 저장 금지(쓰기 파이프라인 A2 가드).

### 2.5 `consolidated_memory` — 다행, **AI 압축 두뇌**

```sql
CREATE TABLE consolidated_memory (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          INTEGER NOT NULL,
  topic               TEXT NOT NULL,            -- 묶음 토픽
  summary             TEXT NOT NULL,            -- AI가 다수 episodes 를 압축한 핵심 (1~3문장)
  relevance_tags      TEXT,                     -- JSON 배열 stringified (검색 보조)
  ref_count           INTEGER NOT NULL DEFAULT 0,  -- 후속 질문에서 참조된 횟수
  last_referenced_at  INTEGER,
  source_episode_ids  TEXT,                     -- JSON 배열, 원본 회수용
  version             INTEGER NOT NULL DEFAULT 1, -- 같은 topic 의 갱신본 누적 (delete X, 새 행 INSERT)
  superseded_by       INTEGER                   -- 같은 topic 의 후속 버전 id (NULL=최신)
);
```

- **갱신 정책**: **논리 삭제 0**. 새 버전은 새 행 INSERT 후, 직전 버전의 `superseded_by`에 신규 id 기록. 검색은 `WHERE superseded_by IS NULL` 만 우선.
- **압축 소스**: A3(영구 압축 두뇌) 트랙이 episodes 를 토픽별로 묶어 LLM 호출 → 압축본 INSERT → 해당 episodes 행에 `consolidated_ref` set, `compressed_flag=1`.

---

## 3. 인덱스 설계

```sql
-- episodes 검색 (최근순·토픽·해역·채널)
CREATE INDEX idx_episodes_created_at        ON episodes(created_at DESC);
CREATE INDEX idx_episodes_zone_created      ON episodes(zone, created_at DESC);
CREATE INDEX idx_episodes_domain_created    ON episodes(domain, created_at DESC);
CREATE INDEX idx_episodes_channel_created   ON episodes(source_channel, created_at DESC);
CREATE INDEX idx_episodes_compressed        ON episodes(compressed_flag, created_at DESC);

-- consolidated_memory 검색 (토픽·최신·참조 빈도)
CREATE INDEX idx_consolidated_topic_active  ON consolidated_memory(topic) WHERE superseded_by IS NULL;
CREATE INDEX idx_consolidated_last_ref      ON consolidated_memory(last_referenced_at DESC);
CREATE INDEX idx_consolidated_ref_count     ON consolidated_memory(ref_count DESC);

-- interest_topics 빈도 정렬
CREATE INDEX idx_interest_count             ON interest_topics(count DESC);
CREATE INDEX idx_interest_last_seen         ON interest_topics(last_seen_at DESC);
```

- **FTS5(검색용 가상 테이블)**: A4 트랙에서 `episodes_fts(query, answer_summary, topic)` 및 `consolidated_memory_fts(summary, topic, relevance_tags)` 도입 검토. **A1 범위 외** — 기본 인덱스만 우선.
- IndexedDB 매핑: 위 인덱스 각각을 `objectStore.createIndex(name, keyPath, {unique:false})` 로 1:1 이식. compound 인덱스(`zone_created`)는 `[zone, created_at]` 배열 키 경로.

---

## 4. TTL · 보존 정책

| 테이블 | 보존 | 삭제 정책 |
|---|---|---|
| `user_profile` | 영구 | 사용자 명시 삭제 시만 (설정 → 초기화) |
| `interest_topics` | 영구 | 동상 |
| `style_digest` | 영구 (덮어쓰기) | UPDATE만, DELETE 금지 |
| `episodes` | **영구 누적(원본)** | TTL 없음. 단 §5 용량 임계 도달 시 압축(논리 이동) |
| `consolidated_memory` | **영구**, **논리 삭제 X**, **version 분리** | 갱신 = 새 행 INSERT + 이전 행 `superseded_by` 기록 |

**원칙**: "공부한 내용을 매번 본다"는 비전 = 학습 결과(consolidated_memory)는 **결코 삭제하지 않는다**. 원본(episodes)도 압축 후에도 회수 가능하도록 보존. **사용자 명시 초기화 명령**(설정 → "내 기억 모두 지우기")만 DROP 권한.

**프라이버시 정합성** (`cross_cutting §3`): 로컬 매체이고 서버 미동기화이므로 영속화하더라도 "비식별 인메모리(서버)"는 불변. 단, **사용자 명시 초기화 UI 제공**은 A6(보안·격리) 트랙 DoD 에 포함 필수.

---

## 5. 용량 관리 — 자동 영구 압축 트리거 (의사코드)

```
function maybeTriggerConsolidation():
  total = SELECT COUNT(*) FROM episodes WHERE compressed_flag = 0
  last  = SELECT MAX(created_at) FROM consolidated_memory
  since = SELECT COUNT(*) FROM episodes
          WHERE compressed_flag = 0 AND created_at > IFNULL(last, 0)

  if (total >= 10000) or (since >= 500) or (user_requested):
    pick_batch:
      candidates = SELECT id, topic, query, answer_summary, zone, domain
                   FROM episodes
                   WHERE compressed_flag = 0
                   ORDER BY created_at ASC
                   LIMIT 500
    group_by_topic(candidates) -> groups       # 키워드 클러스터링 (A3)
    for each group g:
      summary = LLM_compress(g.records)        # A3 압축 두뇌 호출
      new_id  = INSERT INTO consolidated_memory(
                   topic, summary, relevance_tags,
                   source_episode_ids = json(g.ids),
                   version = next_version_for(topic))
      if previous_version_id exists:
        UPDATE consolidated_memory SET superseded_by = new_id WHERE id = previous_version_id
      UPDATE episodes SET compressed_flag = 1, consolidated_ref = new_id WHERE id IN g.ids
```

- **배터리·지연 가드**: 압축은 **WorkManager(안드로이드) / requestIdleCallback(웹) 백그라운드**. 사용자 질문 경로 차단 금지.
- **LLM 비용**: 500건/배치 × 1회 호출 → 토큰 계측 미구현(`cross_cutting §2 #8`)이라 베이스라인 측정 선행 권고. A7(평가·게이트) 토큰 상한 확정 전까지 **배치당 토큰 ≤ 8k 의사 상한**.
- **실패 복구**: LLM 실패 시 `compressed_flag` 미변경 → 다음 트리거에서 재시도. 트랜잭션으로 INSERT + UPDATE 원자 보장.

---

## 6. 마이그레이션 (기존 → v2) — A8 트랙 분리

### 6.1 출처 → 대상 매핑

| 기존 (localStorage / RAM) | v2 신규 |
|---|---|
| `seagnal_profile` JSON | `user_profile` 1행 UPSERT |
| `seagnal_memory[20]` 문자열 배열 | `episodes` 신규 행 N개 (`created_at` = 추정 시각 또는 `now() - i*60s`, `source_channel='chat'`) |
| `seagnal_style.{totalQuestions, styleNote, preferredFormat, firstAt, updatedAt}` | `style_digest` 1행 |
| `seagnal_style.{zoneCounts, topicCounts}` Map | `interest_topics` 다행 (`source_channel='chat'`) |
| `VoiceAssistantService.recentMemory[8]` (RAM) | 마이그레이션 대상 아님 (앱 종료 시 이미 소실 가정) — 신규 쓰기부터 `source_channel='voice'` 로 episodes 누적 |

### 6.2 절차 (1회성, 멱등)

```
on_v2_first_boot:
  if (db.user_profile NOT EXISTS):
    p = read(localStorage.seagnal_profile or null)
    INSERT user_profile(...) with p
  if (db.episodes COUNT = 0):
    mem = read(localStorage.seagnal_memory or [])
    for i, note in enumerate(mem):
      INSERT episodes(created_at = now - (len(mem)-i)*60_000,
                       query = note.query or note,
                       answer_summary = note.answer or '(과거 메모)',
                       source_channel = 'chat')
  if (db.style_digest NOT EXISTS):
    s = read(localStorage.seagnal_style or null)
    INSERT style_digest(...) with s
    for (topic, count) in s.topicCounts:
      INSERT interest_topics(topic, count, source_channel='chat', ...)
  mark localStorage.seagnal_v2_migrated_at = now
  # 원본 localStorage 는 보존(롤백 안전), 차후 90일 후 정리
```

- **멱등성**: 각 단계 `EXISTS/COUNT` 가드 → 재실행해도 중복 없음.
- **롤백**: localStorage 원본 보존 → v2 코드 회귀 시 즉시 v1 동작 복구.
- **데이터 손실 위험**: `recentMemory(8)` 은 이미 RAM only 라 어차피 소실. **수용 가능**.

---

## 7. 백업 · 복원 — **사장님 결정 대기**

> "사용자 휴대폰 분실 대비"는 비전 명시 항목이나, **현 `cross_cutting §3` 로컬 원칙(휴대폰 로컬 저장 불변식)** 과 충돌 가능. 결정 전 어떤 옵션도 구현 금지.

### 7.1 후보 옵션 비교

| 옵션 | 동의 범위 | 정합성 | 비용 |
|---|---|---|---|
| (A) **백업 없음 — 분실 시 처음부터** | 불필요 | 로컬 원칙 100% 보존 | 0 |
| (B) **사용자 명시 export/import** (사용자가 .db 또는 .json 파일을 직접 보관) | 1회 명시 동의 (파일 저장 시점) | 로컬 원칙 보존 (서버 미경유) | UI만 |
| (C) **SEAGNAL 서버 암호화 백업** (E2E 사용자 비밀번호 키) | 영속화·외부 전송 명시 동의 필요 | `cross_cutting §3` 영속화·외부전송 동의 범위 결정 항목과 직결 — **§3 (d) 책임주체에서 사장님/운영 결정 사안으로 명시됨** | 서버 스토리지 + 키 관리 |
| (D) Android Auto Backup / iCloud | OS 표준 동의 | 사용자가 OS 설정으로 자율 선택 — SEAGNAL 책임 면제 | 0 (allowBackup=true 설정만) |

### 7.2 권고 (사장님 검토용)

- **단기**: (A)+(D) 조합. v2 출시 시 백업 미제공, OS 자동 백업 허용. 사용자 분실 시 OS 백업 복원 가능성에 의존.
- **중기**: (B) export/import 메뉴 추가 (사용자 명시 1회 동의로 .json 다운로드, 동일 형식 import).
- **장기 (사장님 결정 시에만)**: (C) E2E 암호화 클라우드 백업. **`cross_cutting §3` 보존기간·범위 명문화 선행 필수**.

> **결정 필요 사항**: 위 4안 중 어느 라인까지 v2 범위에 포함할지 사장님 confirm. 본 A1 설계는 옵션 (A)~(D) 모두 스키마 변경 없이 수용 가능하도록 작성됨.

---

## 8. 위험 평가

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| 1 | **APK 크기 증가** (Room 라이브러리 ~500KB~1MB) | 신규 설치 시 다운로드 +1MB | androidx.room-runtime + ktx 만 (room-compiler 는 kapt 전용). 측정 후 ProGuard/R8 검증 |
| 2 | **마이그레이션 데이터 손실** | 사용자 신뢰 훼손 | §6 멱등 절차 + localStorage 원본 90일 보존 + A8 트랙에 단위테스트 DoD |
| 3 | **IndexedDB 브라우저 지원** (Safari Private 등 쿼터 0) | 채팅 사용자 일부 기능 디그레이드 | §1.2 폴백 정책 (read-only 모드 + 토스트). 데이터 손실은 없음(localStorage 원본 보존) |
| 4 | **무한 누적 디스크 폭주** | 5년 누적 시 수 GB 가능 | §5 영구 압축 트리거 + 원본 episodes 도 압축 후 인덱스 페이지로만 잔류(요약은 consolidated_memory 가 보유) |
| 5 | **압축 LLM 호출 비용** | 토큰 계측 미구현으로 폭주 위험 | §5 배치당 토큰 의사 상한 + `cross_cutting §2` 토큰 계측 게이트(#8) 가동 후 정식 임계 확정 |
| 6 | **개인정보 누수면 확장** | `security_boundary §1(c)` 컨텍스트 격리 약화 우려 | episodes/consolidated_memory 둘 다 `cleanAnswer` 후처리 대상 출력만 저장 + 좌표·연락처 컬럼 부재 + 모든 응답 경로의 #24 누수가드 무영향 (저장만, 주입 컨텍스트 빌더는 A5 별도) |
| 7 | **음성↔채팅 채널 혼선** | 같은 토픽이 채널별 별도 행 → 검색 점수 분산 | `interest_topics.source_channel = mixed` 머지 규칙(A2) + 검색은 채널 무관 OR 우선(A4) |
| 8 | **사용자 명시 초기화 부재** | GDPR/사용자권리 위반 가능 | A6 트랙 DoD: 설정 → "기억 전체 삭제" + "특정 토픽 삭제" UI 필수 |
| 9 | **Room 스키마 마이그레이션 회귀** | 앱 업데이트 시 DB 손상 | Room `Migration` 클래스 + 단위테스트 + 마이그레이션 실패 시 백업 복원 로직(A8) |
| 10 | **백업 결정 지연** | v2 출시 지연 | 본 A1 은 백업 옵션 4종 모두 스키마 변경 없이 수용 가능 → 백업 결정은 출시 후 별도 트랙(A9)으로 연기 가능 |

---

## 9. 후속 트랙 (A2~A9) 의존성

```
A1 (본 문서, 저장소 청사진)
 ├─ A2 (쓰기 파이프라인)        : episodes/interest_topics 쓰기 정책, 개인정보 가드
 ├─ A3 (영구 압축 두뇌)         : §5 의사코드 → 실제 LLM 호출 + 배치 정책
 ├─ A4 (검색·RAG)              : FTS5/IndexedDB 인덱스 활용, 질문→relevant rows
 ├─ A5 (주입 컨텍스트 빌더)     : RAG 결과 → 합성 프롬프트 메모리 블록 (#24 라벨 출력금지 가드 유지)
 ├─ A6 (보안·격리)              : 사용자 명시 초기화 UI, 누수 회귀 가드
 ├─ A7 (평가·게이트)            : 메모리 정확도·환각·지연(p95) 측정
 ├─ A8 (마이그레이션)           : §6 절차 구현·단위테스트
 └─ A9 (백업·복원)              : §7 사장님 결정 후 분기
```

---

**핵심 결정 한 줄**: episodes(영구 원본) + consolidated_memory(논리 삭제 X·version 분리) 이원 구조를 SQLite/Room(안드로이드) + IndexedDB(웹) 동일 스키마로 미러링하고, 백업·복원만 사장님 결정 대기 항목으로 분리한다.
