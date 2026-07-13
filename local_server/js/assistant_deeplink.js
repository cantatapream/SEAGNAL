/**
 * ============================================================================
 * 파일명: js/assistant_deeplink.js
 * 역할: AI 비서 답변의 "바로가기" 버튼 → 해양종합정보 페이지의 해당 레이어를
 *       켜진 상태로 열어주는 딥링크 핸들러.
 * ============================================================================
 *
 * [동작]
 *   비서 페이지(assistant.html)에서 바로가기를 누르면 메인 앱으로 이동:
 *     /?assistant=ocean&layer=<current|wind|wave|buoy|typhoon|cctv>[&buoy=<id>]
 *   이 스크립트가 index2 로드 시 그 파라미터를 읽어, 해양종합정보 탭을 열고
 *   해당 레이어 버튼을 활성화한다. 처리 후 URL 파라미터는 깨끗이 제거.
 *
 * [안전성 — 프로덕션 메인 앱에 얹는 추가 코드라 매우 방어적으로 작성]
 *   - index2 페이지에서만 동작 (window.__SEAGNAL_PAGE === 'index2').
 *   - assistant 파라미터가 없으면 즉시 종료 (기존 동작 영향 0).
 *   - 필요한 전역 함수/버튼이 준비될 때까지 폴링, 끝내 없으면 조용히 종료.
 *   - 이미 켜져 있는 토글 레이어는 다시 클릭(=끄기)하지 않는다.
 *   - 모든 단계 try/catch.
 *
 * [연계]
 *   - js/marine.js → window.switchMainTab('ocean-map-section')
 *   - js/ocean_overlay.js → .ocean-overlay-btn[data-layer="current|wind|wave"]
 *   - js/ocean_buoy.js → #ocean-buoy-toggle-btn
 *   - js/ocean_typhoon.js → #ocean-typhoon-toggle-btn
 *   - js/ocean_cctv.js → #ocean-cctv-toggle-btn
 *   - js/config.js → window.showBuoyLocationOnMap(buoyId)
 * ============================================================================
 */
(function () {
  'use strict';
  if (window.__SEAGNAL_PAGE !== 'index2') return;

  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
  var aMode = params.get('assistant');           // 'ocean' | 'tab' | 'tide'
  if (aMode !== 'ocean' && aMode !== 'tab' && aMode !== 'tide') return;

  var layer = params.get('layer') || '';
  var buoyId = params.get('buoy') || '';
  var target = params.get('target') || '';
  // [태풍 시연 전용] 테스트 푸시는 실제 통보문 식별자(연도/호수/코드)를 함께 실어 보낸다.
  //   → 실데이터 그대로 로드(라벨·정보·이미지·지도 이동), 버튼 비활성이어도 강제 활성화.
  var demoTphn = params.get('demoTphn') === '1';
  var dtYear = params.get('dtYear') || '';
  var dtSeq = params.get('dtSeq') || '';
  var dtCode = params.get('dtCode') || '';
  var dtGuide = params.get('dtGuide') || '';  // '1' 이면 탭 시 행동요령(2탭) 팝업 자동 표출(위치기반 반경 시연)
  var lat = parseFloat(params.get('lat'));
  var lon = parseFloat(params.get('lon'));
  var label = params.get('label') || '';

  // 탭 이동 허용 섹션 화이트리스트 (방어적 — 임의 값으로 switchMainTab 호출 방지)
  var ALLOWED_TABS = {
    'weather-alert-section': 1, 'typhoon-section': 1,
    'marine-chart-section': 1, 'ocean-map-section': 1, 'fishing-section': 1,
    'surfing-section': 1, 'promo-section': 1
  };

  // data-layer 오버레이 레이어(라디오식) / 토글 버튼 구분
  var OVERLAY_LAYERS = { current: 1, wind: 1, wave: 1 };
  var TOGGLE_BTN_IDS = {
    buoy: 'ocean-buoy-toggle-btn',
    typhoon: 'ocean-typhoon-toggle-btn',
    cctv: 'ocean-cctv-toggle-btn'
  };

  function cleanUrl() {
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}
  }

  // 준비될 때까지 폴링 (최대 ~12초). ready() 가 true 가 되면 done() 1회 호출.
  function waitFor(ready, done, timeoutMs) {
    var waited = 0, step = 200, limit = timeoutMs || 12000;
    (function tick() {
      var ok = false;
      try { ok = !!ready(); } catch (e) { ok = false; }
      if (ok) { try { done(); } catch (e) {} return; }
      waited += step;
      if (waited >= limit) return; // 끝내 준비 안 되면 조용히 포기
      setTimeout(tick, step);
    })();
  }

  function activateOverlay(name) {
    var btn = document.querySelector('.ocean-overlay-btn[data-layer="' + name + '"]');
    if (!btn) return;
    // 이미 활성(active)이면 클릭 시 꺼질 수 있으므로 비활성일 때만 클릭
    if (!btn.classList.contains('active')) btn.click();
  }

  function activateToggle(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    if (!btn.classList.contains('active')) btn.click();
  }

  function run() {
    try {
      // 탭 이동(특보/태풍/해구/일기도/기상예보 등)
      if (aMode === 'tab') {
        if (ALLOWED_TABS[target] && typeof window.switchMainTab === 'function') {
          window.switchMainTab(target);
        }
        cleanUrl();
        return;
      }

      // 물때: 해양종합정보를 열고, 지정 해점(lat/lon)에서 조석 바텀시트를 올린다.
      if (aMode === 'tide') {
        if (!isFinite(lat) || !isFinite(lon)) { cleanUrl(); return; }
        if (typeof window.switchMainTab === 'function') window.switchMainTab('ocean-map-section');
        // 지도/시트 초기화 여유를 두고 바텀시트 호출 (함수가 준비될 때까지 잠깐 폴링)
        waitFor(function () { return typeof window.showOceanBottomSheet === 'function'; }, function () {
          setTimeout(function () {
            try { window.showOceanBottomSheet(lat, lon, label ? { name: label } : undefined); } catch (e) {}
            cleanUrl();
          }, 600);
        }, 8000);
        return;
      }

      // 특정 부이: 전체 시퀀스를 처리하는 전역 함수가 있으면 그것을 사용
      if (layer === 'buoy' && buoyId && typeof window.showBuoyLocationOnMap === 'function') {
        window.showBuoyLocationOnMap(buoyId);
        cleanUrl();
        return;
      }

      // 해양종합정보 탭 열기
      if (typeof window.switchMainTab === 'function') {
        window.switchMainTab('ocean-map-section');
      }

      // 탭/지도 초기화 여유를 둔 뒤 레이어 활성화
      setTimeout(function () {
        try {
          if (layer === 'typhoon' && demoTphn && dtCode) {
            // [위치기반 태풍 반경 알림 탭] 알림에 실린 실제 통보문(연도/호수/코드)을 강제 활성화
            //   표출 + 지도 이동 (버튼 비활성이어도 동작). dtGuide=1 이면 행동요령(2탭) 팝업 자동 표출.
            waitFor(function () { return window.OceanTyphoon && typeof window.OceanTyphoon.demoFocus === 'function'; }, function () {
              window.OceanTyphoon.demoFocus({ year: dtYear, seq: dtSeq, code: dtCode, openGuide: (dtGuide === '1') });
              cleanUrl();
            }, 8000);
            return; // demoFocus 경로는 자체적으로 cleanUrl 호출
          } else if (OVERLAY_LAYERS[layer]) {
            activateOverlay(layer);
          } else if (TOGGLE_BTN_IDS[layer]) {
            activateToggle(TOGGLE_BTN_IDS[layer]);
          }
        } catch (e) {}
        cleanUrl();
      }, 450);
    } catch (e) { cleanUrl(); }
  }

  // 앱이 충분히 로드되어 진입 함수/버튼이 준비되면 실행
  function appReady() {
    return typeof window.switchMainTab === 'function' &&
      document.getElementById('ocean-map-section') !== null;
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    waitFor(appReady, run);
  } else {
    window.addEventListener('DOMContentLoaded', function () { waitFor(appReady, run); });
  }
})();
