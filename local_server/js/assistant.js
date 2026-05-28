/**
 * ============================================================================
 * 파일명: js/assistant.js
 * 역할: SEAGNAL 음성 비서 프론트엔드 (호출어 "누구야" + STT + TTS + 텍스트 폴백)
 * ============================================================================
 *
 * [흐름]
 *   마이크 ON → (호출어 대기) → "누구야" 인식 → (명령 수신) → 질문 캡처
 *            → POST /api/assistant/ask → 답변 표시 + 음성 출력(TTS) → 다시 호출어 대기
 *
 * [중요]
 *   - Web Speech API(webkitSpeechRecognition)는 브라우저/WebView 지원에 의존한다.
 *     미지원 환경에서는 음성 UI를 숨기고 하단 텍스트 입력으로 동일 기능을 제공한다.
 *   - 프로덕션에서 상시 호출어를 더 견고히 하려면 오프라인 wake-word 엔진
 *     (예: Picovoice Porcupine)이나 네이티브 음성 플러그인으로 교체하면 된다.
 *
 * [기존 앱에 끼워넣기]
 *   index2.html 등에 <script src="/js/assistant.js"></script> 만 추가해도
 *   이 파일이 필요한 DOM(#micBtn 등)을 못 찾으면 조용히 위젯을 자동 생성하도록
 *   확장할 수 있다. 본 프로토타입은 assistant.html 의 DOM 을 사용한다.
 * ============================================================================
 */
(function () {
  'use strict';

  // ── 설정 ───────────────────────────────────────────────────────────────
  var WAKE_WORDS = ['나리야', '나리아', '나리', '누구야', '시그널아'];
  var COMMAND_TIMEOUT_MS = 6000;   // 호출어 후 명령 대기 최대 시간
  var API_URL = '/api/assistant/ask';

  // ── DOM ────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var micBtn = $('micBtn'), micLabel = $('micLabel');
  var dot = $('dot'), statusText = $('statusText');
  var heardEl = $('heard'), answerEl = $('answer'), metaEl = $('answerMeta');
  var srcBadge = $('srcBadge'), speechWarn = $('speechWarn');
  var askForm = $('askForm'), qInput = $('qInput');
  var speakingEq = $('speakingEq'), answerActions = $('answerActions'), stateBanner = $('stateBanner');
  var lastAnswer = '';   // "다시 듣기"용

  // ── 상태 ───────────────────────────────────────────────────────────────
  var micOn = false;          // 마이크 토글
  var mode = 'idle';          // idle | wake | command | thinking | speaking
  var commandTimer = null;
  var recognition = null;
  var restartGuard = false;   // onend 자동 재시작 루프 보호

  // ── 유틸 ───────────────────────────────────────────────────────────────
  function normalize(s) { return String(s || '').replace(/[\s.,!?~·]/g, '').toLowerCase(); }

  function setStatus(text, cls) {
    statusText.textContent = text;
    dot.className = 'dot' + (cls ? ' ' + cls : '');
  }

  // 듣는 중/말하는 중을 한눈에 구별하는 강조 배너 (Gemini 풍 활성 표시)
  function setBanner(text, cls) {
    if (!stateBanner) return;
    if (!text) { stateBanner.className = 'listening-banner'; stateBanner.textContent = ''; return; }
    stateBanner.textContent = text;
    stateBanner.className = 'listening-banner show ' + (cls || '');
  }
  function showEq(on) { if (speakingEq) speakingEq.style.display = on ? 'inline-flex' : 'none'; }

  function setHeard(t) { heardEl.textContent = t || '—'; }

  function setAnswer(text, aiUsed) {
    answerEl.textContent = text || '—';
    if (aiUsed === true) { srcBadge.className = 'badge ai'; srcBadge.textContent = 'AI'; }
    else if (aiUsed === false) { srcBadge.className = 'badge local'; srcBadge.textContent = '데이터'; }
    else { srcBadge.textContent = ''; }
  }

  // 호출어가 발화 안에 들어 있으면, 호출어 이후의 텍스트(질문)를 잘라 반환.
  // 호출어만 있고 질문이 없으면 '' 반환. 호출어가 전혀 없으면 null 반환.
  function extractAfterWake(transcript) {
    var norm = normalize(transcript);
    for (var i = 0; i < WAKE_WORDS.length; i++) {
      var w = normalize(WAKE_WORDS[i]);
      var idx = norm.indexOf(w);
      if (idx !== -1) {
        // 원문에서 대략적인 호출어 끝 위치 이후를 질문으로 사용 (정규화 길이 기반 근사)
        var after = transcript.slice(transcript.length - (norm.length - (idx + w.length)));
        return after.replace(/^[\s,.!?~·]+/, '').trim();
      }
    }
    return null;
  }

  // ── TTS (음성) — 텍스트는 화면에, 음성은 여기서. 자연음성↔내장음성 둘 다 지원 ──────
  var NATURAL_KEY = 'seagnal_natural_voice';
  function getNaturalVoice() { try { return localStorage.getItem(NATURAL_KEY) === '1'; } catch (e) { return false; } }
  function setNaturalVoice(on) { try { localStorage.setItem(NATURAL_KEY, on ? '1' : '0'); } catch (e) {} }

  function speakStartVisual() {
    mode = 'speaking'; safeStopRecognition();
    setStatus('말하는 중…', 'speak'); setBanner('🔊 답변하고 있어요', 'speak'); showEq(true);
  }
  function speakEndVisual() {
    showEq(false);
    if (micOn) startWakeMode(); else { setBanner(''); setStatus('대기 중 — 마이크를 켜세요', ''); }
  }

  function speak(text) {
    lastAnswer = text || lastAnswer;
    if (!text) return;
    if (getNaturalVoice()) { speakNatural(text); return; }   // 자연 음성(서버 TTS)
    speakOnDevice(text);                                      // 내장 음성(오프라인/무료)
  }

  // 내장 TTS (Web Speech) — 오프라인·무료, 단 기계음
  function speakOnDevice(text) {
    if (!('speechSynthesis' in window) || !text) { return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 1.0; u.pitch = 1.0;
      var ko = window.speechSynthesis.getVoices().filter(function (v) { return /ko/i.test(v.lang); })[0];
      if (ko) u.voice = ko;
      u.onstart = speakStartVisual;
      u.onend = speakEndVisual;
      window.speechSynthesis.speak(u);
    } catch (e) { showEq(false); }
  }

  // 자연 음성 (서버 Gemini TTS) — 네트워크 필요. 실패/오프라인 시 내장 TTS 폴백.
  function speakNatural(text) {
    speakStartVisual();
    fetch('/api/assistant/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text })
    })
      .then(function (r) { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = new Audio(url);
        a.onended = function () { URL.revokeObjectURL(url); speakEndVisual(); };
        a.onerror = function () { URL.revokeObjectURL(url); speakOnDevice(text); };
        a.play().catch(function () { URL.revokeObjectURL(url); speakOnDevice(text); });
      })
      .catch(function () { speakOnDevice(text); });  // 서버 TTS 불가 → 내장 음성
  }

  // 마지막 답변 다시 듣기 — 자연/내장 음성 설정을 그대로 따른다.
  function replayLast() {
    if (!lastAnswer) return;
    if (getNaturalVoice()) {
      showEq(true);
      fetch('/api/assistant/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastAnswer }) })
        .then(function (r) { if (!r.ok) throw new Error('tts'); return r.blob(); })
        .then(function (blob) { var url = URL.createObjectURL(blob); var a = new Audio(url); a.onended = a.onerror = function () { URL.revokeObjectURL(url); showEq(false); }; a.play().catch(function () { URL.revokeObjectURL(url); showEq(false); }); })
        .catch(function () { showEq(false); });
      return;
    }
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(lastAnswer);
      u.lang = 'ko-KR';
      var ko = window.speechSynthesis.getVoices().filter(function (v) { return /ko/i.test(v.lang); })[0];
      if (ko) u.voice = ko;
      u.onstart = function () { showEq(true); };
      u.onend = function () { showEq(false); };
      window.speechSynthesis.speak(u);
    } catch (e) { showEq(false); }
  }

  // ── 로컬 저장 (프로필 + 메모리 + 성향) — 휴대폰 내부에만 보관 ──────────────────
  var PROFILE_KEY = 'seagnal_profile', MEMORY_KEY = 'seagnal_memory', MEMORY_MAX = 20;
  var STYLE_KEY = 'seagnal_style', STYLE_REFRESH_EVERY = 8;

  function getProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; }
  }
  function setProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p || {})); } catch (e) {}
  }
  function clearProfile() { try { localStorage.removeItem(PROFILE_KEY); } catch (e) {} }
  function getMemory() {
    try { var m = JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]'); return Array.isArray(m) ? m : []; }
    catch (e) { return []; }
  }
  function pushMemory(note) {
    if (!note) return;
    var m = getMemory(); m.push(note);
    if (m.length > MEMORY_MAX) m = m.slice(-MEMORY_MAX);
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(m)); } catch (e) {}
  }

  // [성향 다이제스트] 통계는 결정론적으로 누적(질문수·자주 보는 해역/주제),
  //   말투/선호 요약(styleNote)은 몇 건마다 AI로 갱신. 전부 휴대폰에만 저장.
  function getStyle() {
    try { var s = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null'); return s || { totalQuestions: 0, zoneCounts: {}, topicCounts: {} }; }
    catch (e) { return { totalQuestions: 0, zoneCounts: {}, topicCounts: {} }; }
  }
  function setStyle(s) { try { localStorage.setItem(STYLE_KEY, JSON.stringify(s || {})); } catch (e) {} }

  // 응답으로 통계 누적: 해역 카운트 + 주제(링크/intent) 카운트 + 총 질문수
  function updateStyleStats(d) {
    var s = getStyle();
    s.totalQuestions = (s.totalQuestions || 0) + 1;
    s.zoneCounts = s.zoneCounts || {}; s.topicCounts = s.topicCounts || {};
    if (d && d.zone) s.zoneCounts[d.zone] = (s.zoneCounts[d.zone] || 0) + 1;
    var topics = {};
    (d && d.links || []).forEach(function (l) { if (l.layer) topics[l.layer] = 1; if (l.target) topics[l.target] = 1; });
    if (d && d.intent && d.intent !== 'brain') topics[d.intent] = 1;
    Object.keys(topics).forEach(function (t) { s.topicCounts[t] = (s.topicCounts[t] || 0) + 1; });
    // 프로필의 답변 스타일을 선호형식 기본값으로
    var p = getProfile(); if (p && p.answerStyle && !s.preferredFormat) s.preferredFormat = p.answerStyle;
    setStyle(s);
    // 몇 건마다 AI 말투 요약 갱신
    if (s.totalQuestions % STYLE_REFRESH_EVERY === 0) refreshStyleDigest();
  }

  function refreshStyleDigest() {
    var mem = getMemory(); if (!mem.length) return;
    var history = mem.slice(-20).map(function (x) { return { note: x }; });
    fetch('/api/assistant/style-digest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history: history })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { var s = getStyle(); if (d.styleNote) s.styleNote = d.styleNote; if (d.preferredFormat) s.preferredFormat = d.preferredFormat; setStyle(s); }
    }).catch(function () { /* 무시 */ });
  }

  // 질문이 "내 위치/가까운/근처" 류인지 — GPS가 필요한지 판단
  function needsLocation(query) {
    return /내\s*위치|현재\s*위치|가까운|가장\s*가까운|제일\s*가까운|근처|주변|여기서|여기/.test(query || '');
  }

  // 기기 위치 획득 — Capacitor Geolocation(권한 자동 처리) 우선, 없으면 브라우저 geolocation
  function getUserLocation() {
    return new Promise(function (resolve) {
      var Geo = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation)
        ? window.Capacitor.Plugins.Geolocation : null;
      if (Geo && Geo.getCurrentPosition) {
        var go = function () {
          Geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000 })
            .then(function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); })
            .catch(function () { resolve(null); });
        };
        // 권한 프롬프트를 먼저 띄운 뒤 위치 조회
        if (Geo.requestPermissions) { Geo.requestPermissions().then(go).catch(go); } else { go(); }
        return;
      }
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
          function () { resolve(null); }, { enableHighAccuracy: false, timeout: 8000 });
        return;
      }
      resolve(null);
    });
  }

  // ── 서버 질의 ─────────────────────────────────────────────────────────
  function ask(query) {
    if (!query) return;
    setHeard(query);
    mode = 'thinking';
    setStatus('생각 중…', 'think');
    setBanner('💭 생각하고 있어요', 'cmd');
    setAnswer('…', null);
    renderActions(null);

    if (needsLocation(query)) {
      setStatus('위치 확인 중…', 'think');
      getUserLocation().then(function (loc) {
        if (!loc) {
          setAnswer('위치 권한이 필요해요. 권한을 허용하면 현재 위치 기준으로 찾아드릴게요. (관리자 AI 탭에서 위치 권한 허용 가능)', null);
          setStatus('대기 중', 'on'); renderActions(null);
          if (micOn) startWakeMode();
          return;
        }
        doAsk(query, loc);
      });
      return;
    }
    doAsk(query, null);
  }

  function doAsk(query, loc) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, profile: getProfile(), memory: getMemory(), style: getStyle(), location: loc })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { throw new Error((d && d.error) || '응답 오류'); }
        // 음성인식 보정이 있었으면 "들은 질문 → 교정"으로 표시
        if (d.corrected) setHeard(query + '  →  ' + d.corrected);
        lastAnswer = d.answer || '';
        setAnswer(d.answer, d.aiUsed);
        metaEl.textContent = d.zone
          ? ('해역: ' + d.zone + (d.zoneFromProfile ? '(프로필 기본)' : '') + ' · 의도: ' + d.intent)
          : '';
        renderActions(d.links);
        // 성향 통계 누적(질문수·해역·주제) + 주기적 말투 요약 갱신
        updateStyleStats(d);
        // 과거 대화 요약을 휴대폰에 누적 → 다음 질문에 참고
        if (d.zone) pushMemory(d.zone + ': "' + query + '" → ' + String(d.answer).slice(0, 50));
        speak(d.answer);
        if (!('speechSynthesis' in window) && micOn) startWakeMode();
        // 임의 지점 물때: 지명 검색 → 확인 → 고조/저조 조회 흐름 시작
        if (d.tideSearch) startTidePlaceSearch(d.tideSearch);
      })
      .catch(function (err) {
        setAnswer('죄송해요, 데이터를 가져오지 못했습니다. (' + err.message + ')', null);
        metaEl.textContent = '';
        renderActions(null);
        if (micOn) startWakeMode();
      });
  }

  // 답변 아래 액션 버튼: "다시 듣기"(음성) + 앱 내 기능 바로가기(links)
  function renderActions(links) {
    if (!answerActions) return;
    answerActions.innerHTML = '';
    if (!lastAnswer) return;

    if ('speechSynthesis' in window) {
      var replay = document.createElement('button');
      replay.className = 'action-btn ghost';
      replay.textContent = '🔊 다시 듣기';
      replay.addEventListener('click', replayLast);
      answerActions.appendChild(replay);
    }

    (links || []).forEach(function (lk) {
      if (!lk || !lk.type) return;
      var b = document.createElement('button');
      b.className = 'action-btn';
      b.textContent = lk.label || '앱에서 보기';
      b.addEventListener('click', function () { openAppFeature(lk); });
      answerActions.appendChild(b);
    });
  }

  // 앱 내 기능으로 이동(딥링크). 메인 앱(index2)으로 진입하며 파라미터를 넘긴다.
  // 파라미터 규약: ?assistant=<type>[&layer=<layer>][&zone=<zone>][&buoy=<id>]
  function openAppFeature(lk) {
    // 웹 출처 링크는 외부 URL로 열기
    if (lk.type === 'web' && lk.url) { try { window.open(lk.url, '_blank'); } catch (e) { window.location.href = lk.url; } return; }
    var url = location.origin + '/?assistant=' + encodeURIComponent(lk.type);
    if (lk.layer) url += '&layer=' + encodeURIComponent(lk.layer);
    if (lk.target) url += '&target=' + encodeURIComponent(lk.target);
    if (lk.zone) url += '&zone=' + encodeURIComponent(lk.zone);
    if (lk.buoy) url += '&buoy=' + encodeURIComponent(lk.buoy);
    if (lk.lat != null && lk.lon != null) url += '&lat=' + encodeURIComponent(lk.lat) + '&lon=' + encodeURIComponent(lk.lon);
    if (lk.label) url += '&label=' + encodeURIComponent(lk.label);
    window.location.href = url;
  }

  // ── 임의 지점 물때: 지명 검색 → 확인 → 앱 바텀시트(고조/저조는 앱이 표출) ──────────
  // answerActions 에 임의 버튼 렌더 (확인 등)
  function renderButtons(btns) {
    if (!answerActions) return;
    answerActions.innerHTML = '';
    (btns || []).forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'action-btn' + (b.ghost ? ' ghost' : '');
      el.textContent = b.label;
      el.addEventListener('click', b.onClick);
      answerActions.appendChild(el);
    });
  }

  // 1) 지명으로 장소 검색(카카오 프록시) → 첫 후보를 확인 요청
  function startTidePlaceSearch(place) {
    setStatus('장소 찾는 중…', 'think');
    fetch('/api/search-place?q=' + encodeURIComponent(place))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (o) {
        if (o.status === 503) {
          setAnswer('장소 검색 기능이 지금 준비돼 있지 않아요. 해역 이름(예: 제주도 북부 앞바다)으로 물어봐 주세요.', null);
          renderActions(null); return;
        }
        var docs = (o.j && o.j.documents) || [];
        if (!docs.length) {
          setAnswer('"' + place + '"을(를) 못 찾았어요. 더 정확한 지명으로 다시 말씀해 주세요.', null);
          renderActions(null); return;
        }
        askConfirmPlace(docs, 0);
      })
      .catch(function (e) { setAnswer('장소 검색 중 오류가 났어요. (' + e.message + ')', null); renderActions(null); });
  }

  // 2) 후보 i 를 "여기 맞나요?" 확인. 아니오면 다음 후보 제시.
  function askConfirmPlace(docs, i) {
    var r = docs[i];
    var msg = '"' + r.place_name + '"' + (r.address_name ? ' (' + r.address_name + ')' : '') + ' 말씀이신가요?';
    setStatus('확인이 필요해요', 'on');
    setAnswer(msg, null);
    speak(r.place_name + ' 말씀이신가요?');
    var btns = [{
      label: '예, 맞아요', onClick: function () { confirmTidePlace(r); }
    }];
    if (i + 1 < docs.length) btns.push({ label: '아니요, 다른 곳', ghost: true, onClick: function () { askConfirmPlace(docs, i + 1); } });
    renderButtons(btns);
  }

  // 3) 확정 → 그 지점(가장 가까운 해점)의 물때를 앱 바텀시트로 안내.
  //    고조/저조 계산/표출은 앱이 담당(TideBED + 빈해역/동해북부 IDW 보간까지 정확).
  //    비서는 지명 확인 + 해당 해점으로 가는 버튼만 제공한다.
  function confirmTidePlace(r) {
    var lat = parseFloat(r.y), lon = parseFloat(r.x), name = r.place_name;
    if (!isFinite(lat) || !isFinite(lon)) { setAnswer('좌표를 확인하지 못했어요.', null); return; }
    var txt = name + ' 인근 해점의 물때를 앱에서 보여드릴게요. 아래 버튼을 누르면 그 해점에서 고조·저조가 표시됩니다.';
    lastAnswer = txt;
    setStatus('답변 완료', 'on');
    setAnswer(txt, false);
    renderActions([{ type: 'tide', lat: lat, lon: lon, label: name + ' 물때 보기' }]);
    speak(txt);
  }

  // ── 음성 인식 (Web Speech API) ──────────────────────────────────────────
  function speechSupported() {
    return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  }

  function createRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var r = new SR();
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = function (ev) {
      var interim = '', finalText = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      var live = (finalText || interim).trim();
      if (!live) return;

      if (mode === 'wake') {
        // 호출어 탐지
        var after = extractAfterWake(live);
        if (after !== null) {
          beep();
          if (after) {
            // "누구야 + 질문"이 한 발화에 들어온 경우 즉시 질의
            if (finalText) ask(after);
            else { setHeard(after); } // 아직 interim이면 표시만
          } else {
            startCommandMode();
          }
        }
      } else if (mode === 'command') {
        setHeard(live);
        if (finalText) {
          clearTimeout(commandTimer);
          ask(finalText.trim());
        }
      }
    };

    r.onend = function () {
      // continuous 인식은 주기적으로 종료된다. 마이크가 켜져 있고 말하는 중이
      // 아니라면 자동 재시작하여 "상시 대기"를 유지한다.
      if (micOn && mode !== 'speaking' && mode !== 'thinking' && !restartGuard) {
        restartGuard = true;
        setTimeout(function () { restartGuard = false; safeStartRecognition(); }, 250);
      }
    };

    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micOn = false; updateMicUI();
        setStatus('마이크 권한이 거부되었습니다', '');
        showSpeechWarn('마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요. (텍스트 입력은 사용 가능)');
      }
      // no-speech / aborted 등은 onend 의 자동 재시작에 맡긴다.
    };

    return r;
  }

  function safeStartRecognition() {
    if (!recognition) return;
    try { recognition.start(); } catch (e) { /* 이미 시작됨 등 → 무시 */ }
  }
  function safeStopRecognition() {
    if (!recognition) return;
    try { recognition.stop(); } catch (e) { /* 무시 */ }
  }

  function startWakeMode() {
    mode = 'wake';
    setStatus('"나리야" 라고 불러주세요', 'on');
    setBanner('👂 "나리야" 부르면 반응해요', '');  // 대기(상시 청취) — 은은한 배너
    showEq(false);
    setHeard('—');
    safeStartRecognition();
  }

  function startCommandMode() {
    mode = 'command';
    setStatus('듣고 있어요… 질문하세요', 'listen');
    setBanner('🎙️ 듣고 있어요 — 질문하세요', 'cmd');  // 명령 수신 — 강조 배너
    setHeard('…');
    clearTimeout(commandTimer);
    commandTimer = setTimeout(function () {
      if (mode === 'command' && micOn) {
        setStatus('질문을 못 들었어요. 다시 "나리야"', 'on');
        startWakeMode();
      }
    }, COMMAND_TIMEOUT_MS);
  }

  // 짧은 인식 신호음 (Web Audio)
  function beep() {
    try {
      var ctx = beep._ctx || (beep._ctx = new (window.AudioContext || window.webkitAudioContext)());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      o.start(); o.stop(ctx.currentTime + 0.2);
    } catch (e) { /* 무시 */ }
  }

  // ── 마이크 토글 UI ───────────────────────────────────────────────────────
  function updateMicUI() {
    if (micOn) {
      micBtn.className = 'mic active';
      micLabel.textContent = '듣는 중 (끄기)';
    } else {
      micBtn.className = 'mic off';
      micLabel.textContent = '마이크 켜기';
      setStatus('대기 중 — 마이크를 켜세요', '');
    }
  }

  function toggleMic() {
    if (!speechSupported()) {
      showSpeechWarn('이 브라우저/앱은 음성 인식을 지원하지 않습니다. 아래 입력창으로 질문하세요.');
      return;
    }
    micOn = !micOn;
    if (micOn) {
      if (!recognition) recognition = createRecognition();
      // TTS 보이스 로딩 트리거 (일부 브라우저는 최초 호출 시 비어있음)
      if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
      updateMicUI();
      startWakeMode();
    } else {
      mode = 'idle';
      clearTimeout(commandTimer);
      safeStopRecognition();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      updateMicUI();
    }
  }

  function showSpeechWarn(msg) {
    speechWarn.style.display = 'block';
    speechWarn.textContent = msg;
  }

  // ── 텍스트 폴백 + 예시 칩 ─────────────────────────────────────────────────
  askForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = qInput.value.trim();
    if (q) { ask(q); qInput.value = ''; }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () { ask(chip.textContent.trim()); });
  });

  micBtn.addEventListener('click', toggleMic);

  // ── 네이티브 백그라운드 비서 (안드로이드 앱 전용) ────────────────────────────
  // 앱(Capacitor) 안에서 열렸고 SeagnalAssistant 플러그인이 있으면, 웹 STT 대신
  // 네이티브 포그라운드 서비스로 "나리야" 상시 청취를 켜고 끌 수 있다.
  function setupNativeBridge() {
    var Native = (window.Capacitor && window.Capacitor.Plugins &&
      window.Capacitor.Plugins.SeagnalAssistant) ? window.Capacitor.Plugins.SeagnalAssistant : null;
    if (!Native) return; // 일반 웹 브라우저 → 숨김 유지

    var box = $('nativeBox'), statusEl = $('nativeStatus'), toggleBtn = $('nativeToggle');
    box.style.display = 'block';
    var running = false;

    function render() {
      statusEl.textContent = running ? '켜짐 — "나리야" 대기 중' : '꺼짐';
      statusEl.style.color = running ? 'var(--ok)' : 'var(--muted)';
      toggleBtn.textContent = running ? '끄기' : '켜기';
    }

    Native.isEnabled().then(function (r) { running = !!(r && r.running); render(); })
      .catch(function () { render(); });

    toggleBtn.addEventListener('click', function () {
      toggleBtn.disabled = true;
      // 네이티브 음성 답변도 개인화되도록 프로필을 함께 전달
      var op = running
        ? Native.disable()
        : Native.enable({ serverUrl: location.origin, profile: JSON.stringify(getProfile() || {}) });
      op.then(function (r) {
        running = r ? !!r.running : !running;
        render();
      }).catch(function (e) {
        statusEl.textContent = '오류: ' + (e && e.message ? e.message : '권한/서비스 실패');
        statusEl.style.color = 'var(--warn)';
      }).then(function () { toggleBtn.disabled = false; });
    });
  }

  // ── 온보딩 (AI 대화형) + 프로필 관리 ────────────────────────────────────────
  var onboardEl = $('onboard'), obLog = $('obLog'), obForm = $('obForm'), obInput = $('obInput');
  var mainUI = $('mainUI'), profileBox = $('profileBox'), profileSummary = $('profileSummary');
  var obMessages = [];
  var obBusy = false;

  function showMainUI(show) { if (mainUI) mainUI.style.display = show ? 'block' : 'none'; }

  function obBubble(text, who) {
    var b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'max-width:85%; padding:9px 12px; border-radius:12px; font-size:14px; line-height:1.5;' +
      (who === 'user'
        ? 'align-self:flex-end; background:var(--accent); color:#04263b;'
        : 'align-self:flex-start; background:rgba(255,255,255,.08); color:var(--text);');
    obLog.appendChild(b);
    obLog.scrollTop = obLog.scrollHeight;
  }

  function startOnboarding() {
    obMessages = [];
    obLog.innerHTML = '';
    profileBox.style.display = 'none';
    showMainUI(false);
    onboardEl.style.display = 'block';
    onboardTurn(); // 첫 인사/질문
  }

  // 현재까지의 obMessages 를 서버로 보내 다음 AI 메시지(또는 완료)를 받는다.
  function onboardTurn() {
    if (obBusy) return;
    obBusy = true;
    fetch('/api/assistant/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: obMessages })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '온보딩 오류');
        obBubble(d.message, 'ai');
        obMessages.push({ from: 'ai', text: d.message });
        if (d.done) {
          if (d.profile) setProfile(d.profile);
          finishOnboarding();
        }
      })
      .catch(function (e) { obBubble('연결에 문제가 있어요: ' + e.message, 'ai'); })
      .then(function () { obBusy = false; });
  }

  obForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = obInput.value.trim();
    if (!t || obBusy) return;
    obBubble(t, 'user');
    obMessages.push({ from: 'user', text: t });
    obInput.value = '';
    onboardTurn();
  });

  var obSkip = $('obSkip');
  if (obSkip) obSkip.addEventListener('click', function (e) {
    e.preventDefault();
    setProfile({}); // 빈 프로필로 저장(=온보딩 완료 표시) → 다음부터 안 물어봄
    finishOnboarding();
  });

  function finishOnboarding() {
    onboardEl.style.display = 'none';
    renderProfile();
    showMainUI(true);
  }

  function renderProfile() {
    var p = getProfile();
    if (!p) { profileBox.style.display = 'none'; return; }
    var bits = [];
    if (p.occupation) bits.push('직종: ' + p.occupation);
    if (p.purpose) bits.push('목적: ' + p.purpose);
    if (p.weatherFactors) bits.push('관심: ' + (Array.isArray(p.weatherFactors) ? p.weatherFactors.join(', ') : p.weatherFactors));
    if (p.location && (p.location.zone || p.location.freeText)) bits.push('활동해역: ' + (p.location.zone || p.location.freeText));
    if (p.vessel && (p.vessel.text || p.vessel.tonnage)) bits.push('선박: ' + (p.vessel.text || p.vessel.tonnage));
    if (p.vesselText) bits.push('선박: ' + p.vesselText);
    if (p.answerStyle) bits.push('답변: ' + p.answerStyle);
    // 누적 성향 통계 한 줄
    var s = getStyle();
    if (s && s.totalQuestions) {
      var topN = function (c, n) { return c ? Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, n) : []; };
      var tz = topN(s.zoneCounts, 2), tt = topN(s.topicCounts, 2);
      var stat = '질문 ' + s.totalQuestions + '회';
      if (tz.length) stat += ' · 자주: ' + tz.join(', ');
      if (s.styleNote) stat += ' · ' + s.styleNote;
      bits.push('<span style="color:var(--muted);font-size:12px;">' + stat + '</span>');
    }
    profileSummary.innerHTML = bits.length ? bits.join('<br/>') : '(저장된 정보 없음 — 건너뜀)';
    profileBox.style.display = 'block';
  }

  var editBtn = $('editProfile'), delBtn = $('deleteProfile');
  if (editBtn) editBtn.addEventListener('click', startOnboarding);
  if (delBtn) delBtn.addEventListener('click', function () {
    clearProfile();
    try { localStorage.removeItem(MEMORY_KEY); localStorage.removeItem(STYLE_KEY); } catch (e) {}
    renderProfile();
    startOnboarding();
  });

  setupNativeBridge();

  // 자연 음성 토글 연결
  var natToggle = $('naturalVoiceToggle');
  if (natToggle) {
    natToggle.checked = getNaturalVoice();
    natToggle.addEventListener('change', function () { setNaturalVoice(natToggle.checked); });
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────
  if (!speechSupported()) {
    showSpeechWarn('이 브라우저/앱은 음성 인식을 지원하지 않습니다. 아래 입력창으로 질문하세요. (서버/AI 기능은 정상 동작)');
    micBtn.disabled = true;
    micBtn.style.opacity = '.5';
  }

  // 프로필이 없으면 첫 실행 온보딩, 있으면 요약 표시
  if (getProfile() === null) {
    startOnboarding();
  } else {
    renderProfile();
    showMainUI(true);
  }
})();
