/**
 * ============================================================================
 * 파일명: js/user_memory_bridge.js
 * 역할: 사용자 기억 v2 — E3 통합 다리. 채팅(WebView) ↔ 자바 Plugin/IndexedDB 의
 *       단일 진입점. 채널을 자동 검출해 안드로이드는 Capacitor Plugin,
 *       웹/PWA 는 user_memory_web.js (E2) 로 위임한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : Capacitor SeagnalAssistant 플러그인(네이티브 채널) /
 *                    window.SeagnalMemoryWeb(웹 채널 위임) — 단, 현재 user_memory_web.js 는
 *                    SeagnalUserMemory 로 노출되어 전역명 불일치(확인 필요)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : assistant.js (window.SeagnalMemory 소비) — 현재 index2.html 에 미로드(배선 대기)
 * ============================================================================
 *
 * [설계 출처]
 *   local_server/knowledge/phases/memory_v2_E3_bridge_impl.md
 *   - §2 모듈 표면(8 함수 + 이벤트 헬퍼 1 = 9)
 *   - §3 부팅 prime — 턴당 호출 0 목표
 *   - §4 episodesChanged 이벤트 발행/구독
 *
 *   local_server/knowledge/phases/memory_v2_A2_bridge_design.md
 *   - §3 Plugin 5 메서드 계약
 *   - §6.2 write-through 미러
 *
 * [노출 표면 — window.SeagnalMemory]
 *   primeUserMemory()                       — 부팅 1회 + 8턴마다
 *   getUserProfile()                        — 캐시 우선
 *   getStyleDigest()                        — 캐시 우선
 *   getRelevantEpisodes(query, limit)       — isStale 시 fresh, 평소 캐시
 *   appendEpisode(payload)                  — write-through (캐시 + IDB + Plugin)
 *   triggerConsolidation()                  — fire-and-forget enqueue
 *   migrateLocalStorageOnce()               — 첫 부팅 1회
 *   isAudioBusy()                           — 음성 SPEAKING 폴링
 *   onEpisodesChanged(handler)              — 이벤트 구독
 *
 * [제약]
 *   - assistant.js 수정 금지 — 본 헬퍼는 별도 모듈로 노출만 한다.
 *     다음 라운드(E_impl) 가 assistant.js 의 getProfile/getMemory/getStyle/getFocus
 *     호출을 본 헬퍼로 치환한다.
 *   - 자바 Plugin 직접 수정 금지 — readUserProfile 등 5 메서드는 미존재.
 *     본 헬퍼는 메서드 존재 여부를 typeof 로 가드해 부드럽게 폴백한다.
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ── 채널 검출 ─────────────────────────────────────────────────────────────
  function nativePlugin() {
    try {
      var Cap = global.Capacitor;
      if (!Cap || !Cap.Plugins) return null;
      // isNativePlatform 은 신버전(>=4)만 존재 — 구버전은 isNative
      var isNative =
        (typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) ||
        Cap.isNative === true;
      if (!isNative) return null;
      return Cap.Plugins.SeagnalAssistant || null;
    } catch (e) { return null; }
  }
  function webModule() {
    // E2 산출물. 미존재 시 null — Safari Private 등 폴백.
    return global.SeagnalMemoryWeb || null;
  }

  // ── 캐시 모델 (E3 §2.3) ────────────────────────────────────────────────────
  var MemoryCache = {
    profile:   null,
    style:     null,
    focusLast: null,
    episodes:  [],
    primedAt:  0,
    isStale:   true
  };

  // 안드로이드 episodesChanged 1회만 구독.
  var _pluginListenerAttached = false;
  // 미러가 죽었을 때(Safari Private) 메모리 큐 — 다음 prime 에 flush.
  var _pendingWrites = [];
  // 다중 동시 prime 폭주 가드.
  var _primeInflight = null;

  // ── 유틸 ────────────────────────────────────────────────────────────────
  function swallow(_e) { /* fire-and-forget */ }
  function now() { return Date.now(); }
  function safeDispatch(name, detail) {
    try {
      var evt;
      if (typeof CustomEvent === 'function') {
        evt = new CustomEvent(name, { detail: detail });
      } else {
        evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(name, false, false, detail);
      }
      global.dispatchEvent(evt);
    } catch (e) { /* SSR/노 DOM 환경 — 무시 */ }
  }
  // legacy localStorage 5키 — 마이그레이션·Safari 폴백 공용.
  var LS = {
    PROFILE: 'seagnal_profile',
    MEMORY:  'seagnal_memory',
    STYLE:   'seagnal_style',
    FOCUS:   'seagnal_focus',
    NATURAL: 'seagnal_natural_voice',
    MIGRATED:'seagnal_v2_migrated'
  };
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsGetJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
  }

  // ── Plugin 이벤트 구독 — 음성 측 쓰기를 WebView 캐시에 반영 ─────────────────
  function attachPluginListenerOnce() {
    if (_pluginListenerAttached) return;
    var P = nativePlugin();
    if (!P || typeof P.addListener !== 'function') return;
    _pluginListenerAttached = true;
    try {
      P.addListener('episodesChanged', function (e) {
        MemoryCache.isStale = true;
        // WebView 내부 구독자(예: admin 캐시)에도 동일 이벤트 재발행.
        safeDispatch('episodesChanged', e || {});
      });
    } catch (e) { _pluginListenerAttached = false; }
  }

  // ── 채널 분기 — 단일 read 호출 (캐시 미스 시 진입) ───────────────────────────
  function callReadProfile() {
    var P = nativePlugin();
    if (P && typeof P.readUserProfile === 'function') {
      return P.readUserProfile().then(function (r) { return r && r.profile != null ? r.profile : null; });
    }
    var W = webModule();
    if (W && typeof W.readUserProfile === 'function') {
      return Promise.resolve(W.readUserProfile());
    }
    // 폴백: legacy localStorage
    return Promise.resolve(lsGetJson(LS.PROFILE));
  }
  function callReadStyle() {
    var P = nativePlugin();
    if (P && typeof P.readStyleDigest === 'function') {
      return P.readStyleDigest().then(function (r) { return (r && r.style) || emptyStyle(); });
    }
    var W = webModule();
    if (W && typeof W.readStyleDigest === 'function') {
      return Promise.resolve(W.readStyleDigest()).then(function (s) { return s || emptyStyle(); });
    }
    return Promise.resolve(lsGetJson(LS.STYLE) || emptyStyle());
  }
  function callReadEpisodes(query, limit) {
    var l = (typeof limit === 'number' && limit > 0) ? limit : 8;
    var P = nativePlugin();
    if (P && typeof P.readRelevantEpisodes === 'function') {
      return P.readRelevantEpisodes({ query: query || '', limit: l })
        .then(function (r) { return (r && r.episodes) || []; });
    }
    var W = webModule();
    if (W && typeof W.readRelevantEpisodes === 'function') {
      return Promise.resolve(W.readRelevantEpisodes(query, l)).then(function (a) { return a || []; });
    }
    // 폴백: legacy memory[] 를 note 형태로 그대로.
    var mem = lsGetJson(LS.MEMORY) || [];
    return Promise.resolve(mem.slice(-l).reverse().map(function (note, i) {
      return { id: -1 - i, ts: now() - i * 60000, channel: 'chat', zone: null, note: String(note) };
    }));
  }
  function emptyStyle() {
    return { totalQuestions: 0, zoneCounts: {}, topicCounts: {} };
  }

  // ── prime — 부팅 + 8턴마다 (§3) ────────────────────────────────────────────
  function primeUserMemory(opts) {
    var force = !!(opts && opts.force);
    // 폭주 가드: 5초 내 중복 호출은 같은 promise 반환
    if (!force && _primeInflight) return _primeInflight;
    if (!force && (now() - MemoryCache.primedAt) < 5000 && !MemoryCache.isStale) {
      return Promise.resolve(snapshot());
    }
    attachPluginListenerOnce();
    var p = Promise.all([
      callReadProfile().catch(function () { return null; }),
      callReadStyle().catch(function () { return emptyStyle(); }),
      callReadEpisodes('', 8).catch(function () { return []; })
    ]).then(function (results) {
      MemoryCache.profile  = results[0];
      MemoryCache.style    = results[1];
      MemoryCache.episodes = results[2] || [];
      MemoryCache.primedAt = now();
      MemoryCache.isStale  = false;
      safeDispatch('memoryPrimed', snapshot());
      // 폴백 큐 flush — Safari 가 일반 모드로 복귀했을 수 있다.
      flushPendingWrites();
      return snapshot();
    });
    _primeInflight = p;
    p.then(function () { _primeInflight = null; }, function () { _primeInflight = null; });
    return p;
  }
  function snapshot() {
    return {
      profile:   MemoryCache.profile,
      style:     MemoryCache.style,
      focusLast: MemoryCache.focusLast,
      episodes:  MemoryCache.episodes.slice(),
      primedAt:  MemoryCache.primedAt
    };
  }

  // ── read 진입점 — 캐시 우선 ────────────────────────────────────────────────
  function getUserProfile() {
    if (MemoryCache.primedAt && MemoryCache.profile !== undefined) {
      return MemoryCache.profile;
    }
    // 미primed 시 동기 폴백(localStorage) — assistant.js 의 기존 동기 호출 호환.
    return lsGetJson(LS.PROFILE);
  }
  function getStyleDigest() {
    if (MemoryCache.primedAt && MemoryCache.style) {
      return MemoryCache.style;
    }
    return lsGetJson(LS.STYLE) || emptyStyle();
  }
  function getFocusLast() {
    if (MemoryCache.focusLast) return MemoryCache.focusLast;
    return lsGetJson(LS.FOCUS);
  }
  // 의미검색은 항상 비동기. isStale 시 fresh fetch, 평소 캐시.
  function getRelevantEpisodes(query, limit) {
    var l = (typeof limit === 'number' && limit > 0) ? limit : 8;
    if (!MemoryCache.isStale && MemoryCache.episodes.length && !query) {
      return Promise.resolve(MemoryCache.episodes.slice(0, l));
    }
    return callReadEpisodes(query, l).then(function (eps) {
      if (!query) {
        // 일반 회수 → 캐시 갱신
        MemoryCache.episodes = eps;
        MemoryCache.isStale = false;
      }
      return eps;
    }).catch(function () {
      return MemoryCache.episodes.slice(0, l);
    });
  }

  // ── write-through (E3 §2.4) ────────────────────────────────────────────────
  // payload: { query, answer, zone?, tools?, channel='chat', focus? }
  function appendEpisode(payload) {
    if (!payload || !payload.query || !payload.answer) {
      return Promise.reject(new Error('appendEpisode requires {query, answer}'));
    }
    var channel = payload.channel || 'chat';
    var stamp = {
      id:      null,
      ts:      now(),
      channel: channel,
      zone:    payload.zone || null,
      note:    (payload.zone ? payload.zone + ': ' : '') +
               '"' + String(payload.query) + '" → ' + String(payload.answer).slice(0, 160)
    };

    // (1) 캐시 즉시 push
    MemoryCache.episodes.unshift(stamp);
    if (MemoryCache.episodes.length > 8) MemoryCache.episodes.pop();
    if (payload.focus) MemoryCache.focusLast = payload.focus;

    // (2) IndexedDB write (E2). 미존재 시 메모리 큐.
    var W = webModule();
    var idbWrite = (W && typeof W.appendEpisode === 'function')
      ? Promise.resolve(W.appendEpisode(payload)).catch(swallow)
      : (function () { _pendingWrites.push(payload); return Promise.resolve(); })();

    // (3) Plugin fire-and-forget — UI 지연 0
    var P = nativePlugin();
    if (P && typeof P.appendEpisode === 'function') {
      P.appendEpisode({
        query:   payload.query,
        answer:  String(payload.answer).slice(0, 600),
        zone:    payload.zone,
        tools:   payload.tools,
        channel: channel,
        focus:   payload.focus
      }).then(function (r) {
        if (r && typeof r.id === 'number') stamp.id = r.id;
      }).catch(swallow);
    }

    // (4) 이벤트 발행
    safeDispatch('episodesChanged', { episode: stamp, channel: channel });

    return idbWrite.then(function () { return stamp; });
  }

  // 폴백 큐 flush — IndexedDB 가 살아났을 때 호출
  function flushPendingWrites() {
    if (!_pendingWrites.length) return;
    var W = webModule();
    if (!W || typeof W.appendEpisode !== 'function') return;
    var queue = _pendingWrites.slice();
    _pendingWrites = [];
    queue.forEach(function (p) {
      try { Promise.resolve(W.appendEpisode(p)).catch(function () { _pendingWrites.push(p); }); }
      catch (e) { _pendingWrites.push(p); }
    });
  }

  // ── triggerConsolidation — fire-and-forget enqueue ─────────────────────────
  function triggerConsolidation() {
    var P = nativePlugin();
    if (P && typeof P.triggerConsolidation === 'function') {
      return P.triggerConsolidation().catch(function (e) { return { scheduled: false, error: String(e) }; });
    }
    var W = webModule();
    if (W && typeof W.triggerConsolidation === 'function') {
      return Promise.resolve(W.triggerConsolidation())
        .then(function (r) { return r || { scheduled: true }; })
        .catch(function () { return { scheduled: false }; });
    }
    return Promise.resolve({ scheduled: false });
  }

  // ── 첫 부팅 1회 마이그레이션 ───────────────────────────────────────────────
  function migrateLocalStorageOnce() {
    if (lsGet(LS.MIGRATED) === '1') return Promise.resolve({ migrated: false, reason: 'already' });
    var payload = {
      profile:      lsGetJson(LS.PROFILE),
      memory:       lsGetJson(LS.MEMORY) || [],
      style:        lsGetJson(LS.STYLE),
      focus:        lsGetJson(LS.FOCUS),
      naturalVoice: lsGet(LS.NATURAL)
    };
    var empty = !payload.profile && !payload.memory.length && !payload.style && !payload.focus && !payload.naturalVoice;
    if (empty) {
      try { localStorage.setItem(LS.MIGRATED, '1'); } catch (e) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
      return Promise.resolve({ migrated: false, reason: 'empty' });
    }
    var P = nativePlugin();
    var step;
    if (P && typeof P.migrateLocalStorageOnce === 'function') {
      // Plugin 은 JSON 문자열을 받음 (A2 §3.6 의 시그니처와 동일)
      step = P.migrateLocalStorageOnce({
        profile:      payload.profile ? JSON.stringify(payload.profile) : null,
        memory:       payload.memory.map(function (n) { return String(n); }),
        style:        payload.style ? JSON.stringify(payload.style) : null,
        focus:        payload.focus ? JSON.stringify(payload.focus) : null,
        naturalVoice: payload.naturalVoice
      });
    } else {
      var W = webModule();
      step = (W && typeof W.migrateLocalStorageOnce === 'function')
        ? Promise.resolve(W.migrateLocalStorageOnce(payload))
        : Promise.resolve({ migrated: false, reason: 'no-channel' });
    }
    return step.then(function (r) {
      if (r && r.migrated) {
        // localStorage 5키 삭제 + flag — A2 §5.2 의 6단계 마지막
        lsRemove(LS.PROFILE);
        lsRemove(LS.MEMORY);
        lsRemove(LS.STYLE);
        lsRemove(LS.FOCUS);
        lsRemove(LS.NATURAL);
        try { localStorage.setItem(LS.MIGRATED, '1'); } catch (e) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
      }
      return r || { migrated: false };
    }).catch(function (e) {
      // 실패 시 localStorage 보존 — 다음 부팅 재시도(A2 §5.3)
      return { migrated: false, error: String(e) };
    });
  }

  // ── 음성 발화 중 (music lock) — A2 §4.4 ────────────────────────────────────
  function isAudioBusy() {
    var P = nativePlugin();
    if (P && typeof P.audioBusy === 'function') {
      return P.audioBusy().then(function (r) { return !!(r && r.busy); }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  // ── 이벤트 구독 헬퍼 ────────────────────────────────────────────────────────
  function onEpisodesChanged(handler) {
    if (typeof handler !== 'function') return function () {};
    var wrapper = function (e) { try { handler(e && e.detail); } catch (_) { /* 남이 건넨 handler 가 던져도 이벤트 구독 고리를 끊지 않는다 — 다음 기억 갱신도 계속 받는다 */ } };
    global.addEventListener('episodesChanged', wrapper);
    return function unsubscribe() { global.removeEventListener('episodesChanged', wrapper); };
  }

  // ── 노출 ────────────────────────────────────────────────────────────────────
  global.SeagnalMemory = {
    primeUserMemory:       primeUserMemory,
    getUserProfile:        getUserProfile,
    getStyleDigest:        getStyleDigest,
    getFocusLast:          getFocusLast,
    getRelevantEpisodes:   getRelevantEpisodes,
    appendEpisode:         appendEpisode,
    triggerConsolidation:  triggerConsolidation,
    migrateLocalStorageOnce: migrateLocalStorageOnce,
    isAudioBusy:           isAudioBusy,
    onEpisodesChanged:     onEpisodesChanged,
    // 디버그/테스트 보조 — 다음 라운드 단위테스트에서 사용
    _internal: {
      cache: MemoryCache,
      pendingWrites: function () { return _pendingWrites.slice(); },
      hasNative: function () { return !!nativePlugin(); },
      hasWeb:    function () { return !!webModule(); }
    }
  };
})(typeof window !== 'undefined' ? window : this);
