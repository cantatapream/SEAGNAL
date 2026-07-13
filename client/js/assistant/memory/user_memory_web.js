/**
 * ============================================================================
 * 파일명: js/user_memory_web.js
 * 역할: SEAGNAL 사용자 기억 v2 — 웹(브라우저) 측 IndexedDB 어댑터 (E2 트랙)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (vanilla IndexedDB, 외부 라이브러리 의존 없음)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : user_memory_bridge.js 의 웹 채널 위임 대상 — bridge 는 SeagnalMemoryWeb 를
 *                    찾으나 본 파일은 SeagnalUserMemory 로 노출(전역명 불일치, 확인 필요).
 *                    현재 index2.html 에 미로드(배선 대기)
 * ============================================================================
 *
 * [배경]
 *   A1 저장소 설계(`knowledge/phases/memory_v2_A1_storage_design.md`)에 따라
 *   안드로이드 SQLite/Room 과 동일한 5 테이블 스키마를 IndexedDB 로 미러링한다.
 *   기존 `assistant.js` 의 localStorage 5 키 흐름(seagnal_profile/memory/style/
 *   focus + natural_voice)은 5MB 한계와 O(n) 직렬화 비용 문제로 무한 누적
 *   원본(episodes) + 압축본(consolidated_memory) 모델을 담을 수 없다.
 *
 * [설계 정합성 — A1 §2 DDL 1:1 매핑]
 *   - user_profile           단일 행 (id=1)
 *   - interest_topics        (topic, zone, source_channel) 복합 유니크
 *   - style_digest           단일 행 (id=1)
 *   - episodes               autoIncrement id, created_at 인덱스
 *   - consolidated_memory    autoIncrement id, topic / last_referenced_at 인덱스
 *
 * [Safari Private Mode 폴백] (§1.2 위험 #3)
 *   IndexedDB 가용성을 부팅 시 1회 프로브한다. open() 실패 / quota 0 / 또는
 *   indexedDB 자체가 undefined 면 자동으로 localStorage 폴백 모드로 진입한다.
 *   이 경우 5개 함수는 기존 5키(seagnal_profile/memory/style/focus) 위에서
 *   "읽기 전용 디그레이드 + 메모리 큐" 방식으로 동작한다(사용자 데이터 손실 0).
 *
 * [통합 트랙]
 *   본 파일은 E2(어댑터 작성)만 담당한다. assistant.js 의 호출부 교체는 E3.
 *   외부 라이브러리 의존성 없음(vanilla IndexedDB). UMD/IIFE 호환.
 *
 * [에러 정책]
 *   모든 공개 함수는 throw 하지 않는다. 실패 시 null/빈 배열 + console.warn.
 *   이는 사용자 질의 경로를 절대 차단하지 않기 위함이다.
 * ============================================================================
 */
(function (root, factory) {
  'use strict';
  // UMD: AMD / CommonJS / 글로벌 IIFE 모두 지원
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SeagnalUserMemory = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 상수 ────────────────────────────────────────────────────────────────
  var DB_NAME = 'seagnal_user_memory_v2';
  var DB_VERSION = 1;

  var STORE_PROFILE = 'user_profile';
  var STORE_INTEREST = 'interest_topics';
  var STORE_STYLE = 'style_digest';
  var STORE_EPISODES = 'episodes';
  var STORE_CONSOLIDATED = 'consolidated_memory';

  // 기존 localStorage 5 키 (마이그레이션 출처 + Safari 폴백 매체)
  var LS_PROFILE = 'seagnal_profile';
  var LS_MEMORY = 'seagnal_memory';
  var LS_STYLE = 'seagnal_style';
  var LS_FOCUS = 'seagnal_focus';   // E2 범위: 읽기 전용 참조(쓰기는 E3 정책)
  var LS_MIGRATED = 'seagnal_v2_migrated';

  // 트림 상한 (A1 §2.4 episodes — assistant_log.js 인메모리 비식별 정책과 동일)
  var MAX_QUERY_LEN = 300;
  var MAX_ANSWER_LEN = 600;

  // ── 가용성 프로브 ──────────────────────────────────────────────────────
  // IndexedDB 가 정상 동작하는지 확인. Safari Private 등에서는 indexedDB 객체는
  // 존재하나 open() 시 InvalidStateError / QuotaExceededError 발생. 한 번 성공
  // 하면 모드를 'idb' 로 고정, 실패 시 'ls' (localStorage) 로 영구 폴백.
  var _mode = null;            // 'idb' | 'ls' | null (미초기화)
  var _dbPromise = null;       // 캐시된 IDBDatabase Promise
  var _migrated = false;       // migrateLocalStorageOnce 완료 플래그(세션 1회)

  function _idbAvailable() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) { return false; }
  }

  // ── DB 오픈 + 스키마 마이그레이션 ──────────────────────────────────────
  function _openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!_idbAvailable()) { reject(new Error('indexedDB unavailable')); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      req.onupgradeneeded = function (ev) {
        var db = req.result;

        // user_profile — 싱글톤(id=1)
        if (!db.objectStoreNames.contains(STORE_PROFILE)) {
          db.createObjectStore(STORE_PROFILE, { keyPath: 'id' });
        }

        // interest_topics — autoIncrement + (topic, zone, source_channel) 유니크
        if (!db.objectStoreNames.contains(STORE_INTEREST)) {
          var s = db.createObjectStore(STORE_INTEREST, { keyPath: 'id', autoIncrement: true });
          s.createIndex('topic', 'topic', { unique: false });
          s.createIndex('zone', 'zone', { unique: false });
          s.createIndex('count_desc', 'count', { unique: false });
          s.createIndex('last_seen_at', 'last_seen_at', { unique: false });
          // compound 유니크(A1 §2.2 UNIQUE 제약 미러)
          s.createIndex('topic_zone_channel', ['topic', 'zone', 'source_channel'], { unique: true });
        }

        // style_digest — 싱글톤(id=1)
        if (!db.objectStoreNames.contains(STORE_STYLE)) {
          db.createObjectStore(STORE_STYLE, { keyPath: 'id' });
        }

        // episodes — autoIncrement + 검색 인덱스(A1 §3)
        if (!db.objectStoreNames.contains(STORE_EPISODES)) {
          var e = db.createObjectStore(STORE_EPISODES, { keyPath: 'id', autoIncrement: true });
          e.createIndex('created_at', 'created_at', { unique: false });
          e.createIndex('zone_created', ['zone', 'created_at'], { unique: false });
          e.createIndex('domain_created', ['domain', 'created_at'], { unique: false });
          e.createIndex('channel_created', ['source_channel', 'created_at'], { unique: false });
          e.createIndex('compressed_flag', 'compressed_flag', { unique: false });
        }

        // consolidated_memory — autoIncrement + topic / last_ref / ref_count 인덱스
        if (!db.objectStoreNames.contains(STORE_CONSOLIDATED)) {
          var c = db.createObjectStore(STORE_CONSOLIDATED, { keyPath: 'id', autoIncrement: true });
          c.createIndex('topic', 'topic', { unique: false });
          c.createIndex('last_referenced_at', 'last_referenced_at', { unique: false });
          c.createIndex('ref_count', 'ref_count', { unique: false });
          // 활성(최신) 버전 우선 — superseded_by IS NULL 필터 보조
          c.createIndex('superseded_by', 'superseded_by', { unique: false });
        }
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('open failed')); };
      req.onblocked = function () { reject(new Error('open blocked')); };
    });
    return _dbPromise;
  }

  // 모드 결정 — 최초 호출 시 IndexedDB open 시도. 실패 시 'ls' 로 고정.
  function _ensureMode() {
    if (_mode) return Promise.resolve(_mode);
    return _openDB().then(function () {
      _mode = 'idb';
      return _mode;
    }).catch(function (e) {
      console.warn('[user_memory] IndexedDB unavailable, falling back to localStorage:', e && e.message);
      _mode = 'ls';
      _dbPromise = null;
      return _mode;
    });
  }

  // ── Promise 헬퍼 — IDBRequest → Promise 래핑 ──────────────────────────
  function _req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function _tx(storeNames, mode) {
    return _openDB().then(function (db) {
      var t = db.transaction(storeNames, mode);
      return t;
    });
  }

  // 트랜잭션 완료 대기(쓰기 후 commit 보장)
  function _txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('tx aborted')); };
    });
  }

  // ── localStorage 폴백 헬퍼 ─────────────────────────────────────────────
  function _lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function _lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('[user_memory] localStorage set failed:', e && e.message); return false; }
  }

  // ── 트림 가드 (A1 §2.4 개인정보·길이 상한) ─────────────────────────────
  function _trim(s, max) {
    if (s == null) return '';
    s = String(s);
    return s.length > max ? s.slice(0, max) : s;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1) readUserProfile() → Promise<object|null>
  // ────────────────────────────────────────────────────────────────────────
  function readUserProfile() {
    return _ensureMode().then(function (mode) {
      if (mode === 'ls') {
        return _lsGet(LS_PROFILE, null);
      }
      return _tx([STORE_PROFILE], 'readonly').then(function (tx) {
        return _req(tx.objectStore(STORE_PROFILE).get(1));
      });
    }).catch(function (e) {
      console.warn('[user_memory] readUserProfile failed:', e && e.message);
      return null;
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2) readStyleDigest() → Promise<object|null>
  // ────────────────────────────────────────────────────────────────────────
  function readStyleDigest() {
    return _ensureMode().then(function (mode) {
      if (mode === 'ls') {
        return _lsGet(LS_STYLE, null);
      }
      return _tx([STORE_STYLE], 'readonly').then(function (tx) {
        return _req(tx.objectStore(STORE_STYLE).get(1));
      });
    }).catch(function (e) {
      console.warn('[user_memory] readStyleDigest failed:', e && e.message);
      return null;
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3) readRelevantEpisodes(query, limit=5) → Promise<Array>
  //    A4 정밀화(FTS5/임베딩) 전 베이스라인 — 단순 LIKE + recency.
  //    1) created_at 역순으로 최대 200건 스캔
  //    2) 각 행에 대해 query 의 한글/영문 토큰(2자 이상)이 episode.query 또는
  //       answer_summary 에 substring match 되면 점수 +1
  //    3) recency 보정 (최신일수록 +0.0~1.0 가산)
  //    4) 상위 limit 반환. 매치 0건이면 최신 limit건을 그대로 반환.
  // ────────────────────────────────────────────────────────────────────────
  function readRelevantEpisodes(query, limit) {
    limit = limit | 0; if (limit <= 0) limit = 5;
    var q = String(query || '').toLowerCase();
    var tokens = q.split(/[\s,.!?~·]+/).filter(function (t) { return t.length >= 2; });

    return _ensureMode().then(function (mode) {
      if (mode === 'ls') {
        // localStorage 폴백: seagnal_memory 는 자유 텍스트 배열 → 최신 N개 반환
        var mem = _lsGet(LS_MEMORY, []);
        if (!Array.isArray(mem)) return [];
        var arr = mem.slice(-50).reverse().map(function (note, i) {
          // 점수: 토큰 매치 횟수 + recency
          var text = String(note || '').toLowerCase();
          var score = 0;
          for (var k = 0; k < tokens.length; k++) if (text.indexOf(tokens[k]) !== -1) score++;
          score += (50 - i) / 50;
          return { note: note, score: score, query: '', answer_summary: String(note || ''), created_at: 0 };
        });
        arr.sort(function (a, b) { return b.score - a.score; });
        return arr.slice(0, limit);
      }

      // IndexedDB 경로: created_at 역순 cursor 로 최대 200건 스캔
      return _tx([STORE_EPISODES], 'readonly').then(function (tx) {
        var store = tx.objectStore(STORE_EPISODES);
        var idx = store.index('created_at');
        var scanned = [];
        var SCAN_MAX = 200;

        return new Promise(function (resolve, reject) {
          var cursorReq = idx.openCursor(null, 'prev');
          cursorReq.onerror = function () { reject(cursorReq.error); };
          cursorReq.onsuccess = function () {
            var cur = cursorReq.result;
            if (!cur || scanned.length >= SCAN_MAX) {
              resolve(scanned);
              return;
            }
            scanned.push(cur.value);
            cur.continue();
          };
        });
      }).then(function (rows) {
        if (!rows.length) return [];
        var scored = rows.map(function (r, i) {
          var hay = ((r.query || '') + ' ' + (r.answer_summary || '')).toLowerCase();
          var score = 0;
          for (var k = 0; k < tokens.length; k++) if (hay.indexOf(tokens[k]) !== -1) score += 1;
          // recency: 0(가장 오래된 200건째) ~ 1.0(최신)
          score += (rows.length - i) / rows.length;
          return Object.assign({}, r, { _score: score });
        });
        // 매치된 게 1건이라도 있으면 점수순. 아니면 최신순 그대로.
        var anyMatch = scored.some(function (r) { return r._score >= 2; });
        if (anyMatch) scored.sort(function (a, b) { return b._score - a._score; });
        return scored.slice(0, limit);
      });
    }).catch(function (e) {
      console.warn('[user_memory] readRelevantEpisodes failed:', e && e.message);
      return [];
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4) appendEpisode(query, answer, zone, tools, channel='chat') → Promise<void>
  //    A1 §2.4 episodes 스키마에 단일 행 INSERT. 트림 가드 + 개인정보 미저장.
  // ────────────────────────────────────────────────────────────────────────
  function appendEpisode(query, answer, zone, tools, channel) {
    var record = {
      created_at: Date.now(),
      query: _trim(query, MAX_QUERY_LEN),
      answer_summary: _trim(answer, MAX_ANSWER_LEN),
      zone: zone || null,
      tools_used: tools ? JSON.stringify(tools) : null,
      domain: null,           // A2 트랙(쓰기 파이프라인)에서 채움
      source_channel: (channel === 'voice' ? 'voice' : 'chat'),
      intent: null,
      consolidated_ref: null,
      compressed_flag: 0
    };

    return _ensureMode().then(function (mode) {
      if (mode === 'ls') {
        // 폴백: 기존 seagnal_memory 형식("zone: \"q\" → a") 으로 1줄 추가
        var note = (record.zone ? record.zone + ': ' : '') +
                   '"' + record.query + '" → ' + record.answer_summary.slice(0, 160);
        var mem = _lsGet(LS_MEMORY, []);
        if (!Array.isArray(mem)) mem = [];
        mem.push(note);
        if (mem.length > 200) mem = mem.slice(-200);   // 폴백 모드에서도 상한
        _lsSet(LS_MEMORY, mem);
        return;
      }

      return _tx([STORE_EPISODES], 'readwrite').then(function (tx) {
        var store = tx.objectStore(STORE_EPISODES);
        store.add(record);
        return _txDone(tx);
      });
    }).catch(function (e) {
      console.warn('[user_memory] appendEpisode failed:', e && e.message);
      return null;
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5) readConsolidatedTop(limit=5) → Promise<Array>
  //    활성(superseded_by == null) 행만, last_referenced_at 역순으로 상위 N개.
  //    last_referenced_at 미설정 행은 created_at 으로 보정.
  // ────────────────────────────────────────────────────────────────────────
  function readConsolidatedTop(limit) {
    limit = limit | 0; if (limit <= 0) limit = 5;

    return _ensureMode().then(function (mode) {
      if (mode === 'ls') {
        // 폴백: consolidated_memory 가 없으므로 빈 배열
        return [];
      }
      return _tx([STORE_CONSOLIDATED], 'readonly').then(function (tx) {
        var store = tx.objectStore(STORE_CONSOLIDATED);
        // 모든 행을 가져온 뒤 활성만 필터 + 정렬 (행 수 적을 것으로 가정)
        return _req(store.getAll());
      });
    }).then(function (all) {
      if (!Array.isArray(all) || !all.length) return [];
      var active = all.filter(function (r) {
        return r && (r.superseded_by == null);
      });
      active.sort(function (a, b) {
        var aT = a.last_referenced_at || a.created_at || 0;
        var bT = b.last_referenced_at || b.created_at || 0;
        return bT - aT;
      });
      return active.slice(0, limit);
    }).catch(function (e) {
      console.warn('[user_memory] readConsolidatedTop failed:', e && e.message);
      return [];
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6) migrateLocalStorageOnce()
  //    A1 §6 절차의 멱등 1회 이전:
  //      seagnal_profile → user_profile 1행
  //      seagnal_memory[N] → episodes N행 (created_at 추정 = now - (N-i)*60_000)
  //      seagnal_style → style_digest 1행 + interest_topics 다행 (topicCounts/zoneCounts)
  //    완료 후 localStorage.seagnal_v2_migrated 플래그 + 원본은 보존(롤백 안전).
  //    Safari 폴백 모드에서는 no-op (이미 localStorage 가 1차 매체).
  // ────────────────────────────────────────────────────────────────────────
  function migrateLocalStorageOnce() {
    if (_migrated) return Promise.resolve({ migrated: false, reason: 'already_session' });

    return _ensureMode().then(function (mode) {
      // 폴백 모드면 IndexedDB 자체가 없으므로 마이그레이션 의미 없음
      if (mode === 'ls') {
        _migrated = true;
        return { migrated: false, reason: 'fallback_mode' };
      }

      // 영구 플래그 확인 — 1회만 수행
      var flag = null;
      try { flag = localStorage.getItem(LS_MIGRATED); } catch (e) { /* 무시 */ }
      if (flag) {
        _migrated = true;
        return { migrated: false, reason: 'already_marked', at: flag };
      }

      var profile = _lsGet(LS_PROFILE, null);
      var memory = _lsGet(LS_MEMORY, []);
      var style = _lsGet(LS_STYLE, null);

      return _tx(
        [STORE_PROFILE, STORE_EPISODES, STORE_STYLE, STORE_INTEREST],
        'readwrite'
      ).then(function (tx) {
        var pStore = tx.objectStore(STORE_PROFILE);
        var eStore = tx.objectStore(STORE_EPISODES);
        var sStore = tx.objectStore(STORE_STYLE);
        var iStore = tx.objectStore(STORE_INTEREST);
        var now = Date.now();
        var stats = { profile: 0, episodes: 0, style: 0, topics: 0 };

        // (a) user_profile — 기존에 없으면 INSERT(id=1 강제)
        return _req(pStore.get(1)).then(function (existing) {
          if (!existing && profile && typeof profile === 'object') {
            var row = {
              id: 1,
              jikgun: profile.occupation || profile.jikgun || null,
              default_zone: (profile.location && (profile.location.zone || profile.location.freeText)) || null,
              display_name: profile.displayName || null,
              answer_style: profile.answerStyle || null,
              experience_years: profile.experienceYears || null,
              preferred_format: profile.preferredFormat || null,
              onboarded_at: profile.onboardedAt || now,
              updated_at: now,
              // 원본 보존(롤백 + 차후 매핑 손실 방지)
              _raw_v1: profile
            };
            pStore.put(row);
            stats.profile = 1;
          }
          return _req(eStore.count());
        }).then(function (epCount) {
          // (b) episodes — 비어 있을 때만 1회 이전
          if (epCount === 0 && Array.isArray(memory) && memory.length) {
            var N = memory.length;
            for (var i = 0; i < N; i++) {
              var note = memory[i];
              var q = '', a = '(과거 메모)';
              if (typeof note === 'string') {
                // 기존 형식 "zone: \"질문\" → 답변" 파싱 시도
                var m = note.match(/^(?:([^:]+):\s*)?"([^"]+)"\s*→\s*(.+)$/);
                if (m) { q = m[2]; a = m[3]; }
                else { q = note; }
              } else if (note && typeof note === 'object') {
                q = note.query || note.q || '';
                a = note.answer || note.a || note.note || '(과거 메모)';
              }
              eStore.add({
                created_at: now - (N - i) * 60000,
                query: _trim(q, MAX_QUERY_LEN),
                answer_summary: _trim(a, MAX_ANSWER_LEN),
                zone: null,
                tools_used: null,
                domain: null,
                source_channel: 'chat',
                intent: null,
                consolidated_ref: null,
                compressed_flag: 0
              });
              stats.episodes++;
            }
          }
          return _req(sStore.get(1));
        }).then(function (existingStyle) {
          // (c) style_digest — 없을 때만 1행 INSERT
          if (!existingStyle && style && typeof style === 'object') {
            sStore.put({
              id: 1,
              style_note: style.styleNote || null,
              preferred_format: style.preferredFormat || null,
              total_questions: style.totalQuestions || 0,
              first_at: style.firstAt || now,
              updated_at: style.updatedAt || now,
              version: 1
            });
            stats.style = 1;

            // (d) interest_topics — topicCounts/zoneCounts → 다행
            var topics = style.topicCounts || {};
            var zones = style.zoneCounts || {};
            // 주제(topicCounts) 우선
            Object.keys(topics).forEach(function (t) {
              var c = topics[t] | 0;
              if (!t || c <= 0) return;
              iStore.add({
                topic: t,
                zone: null,
                count: c,
                last_seen_at: now,
                first_seen_at: now,
                source_channel: 'chat'
              });
              stats.topics++;
            });
            // 해역(zoneCounts) — zone 자체를 별도 topic 으로 누적(검색 보조)
            Object.keys(zones).forEach(function (z) {
              var c = zones[z] | 0;
              if (!z || c <= 0) return;
              iStore.add({
                topic: '__zone__:' + z,
                zone: z,
                count: c,
                last_seen_at: now,
                first_seen_at: now,
                source_channel: 'chat'
              });
              stats.topics++;
            });
          }
          return null;
        }).then(function () {
          return _txDone(tx);
        }).then(function () {
          try { localStorage.setItem(LS_MIGRATED, String(now)); } catch (e) { /* 무시 */ }
          _migrated = true;
          return { migrated: true, stats: stats, at: now };
        });
      });
    }).catch(function (e) {
      console.warn('[user_memory] migrateLocalStorageOnce failed:', e && e.message);
      return { migrated: false, error: e && e.message };
    });
  }

  // ── 진단/유틸 (디버깅용, E3 통합 시 검증) ────────────────────────────────
  function getMode() { return _mode; }
  function _reset() {
    // 테스트 보조 — 캐시 초기화 (DB 자체는 보존)
    _mode = null; _dbPromise = null; _migrated = false;
  }

  // ── 공개 API ───────────────────────────────────────────────────────────
  return {
    // 5 함수 (E2 요구사항)
    readUserProfile: readUserProfile,
    readStyleDigest: readStyleDigest,
    readRelevantEpisodes: readRelevantEpisodes,
    appendEpisode: appendEpisode,
    readConsolidatedTop: readConsolidatedTop,
    // 마이그레이션
    migrateLocalStorageOnce: migrateLocalStorageOnce,
    // 진단
    getMode: getMode,
    _reset: _reset,
    // 메타
    _DB_NAME: DB_NAME,
    _DB_VERSION: DB_VERSION
  };
});
