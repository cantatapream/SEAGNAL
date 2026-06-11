// ====================================================================
// cctv4.js — 클릭 핸들러 + 모달 팝업 표시/닫기 + 즐겨찾기 토글
//
// [역할]
//   1. 지도 마커 클릭 이벤트를 처리합니다.
//   2. 모달 방식(화면 중앙 고정)으로 CCTV 영상 팝업을 표시합니다.
//   3. 제공기관(providerKey)에 따라 영상 표출 방식을 분기합니다.
//      - KBS(iframe): KBS cctvShare 페이지를 iframe으로 임베드
//      - 거제시(hls):  HLS 스트림을 HLS.js video 엘리먼트로 직접 재생
//   4. 팝업 헤더 링크 버튼을 제공기관별로 동적 생성합니다.
//   5. 팝업 닫을 때 iframe src 또는 HLS 인스턴스를 즉시 해제합니다.
//
// [팝업 UI 구조 — KBS]
//   ┌──────────────────────────────────────────────────┐
//   │ 📹 가거도 ★  KBS재난포털↗   [✕]                 │
//   │    전남 신안 가거도          CCTV더보기↗          │
//   ├──────────────────────────────────────────────────┤
//   │   <iframe: KBS cctvShare 페이지>                  │
//   │   (상단 타이틀 + 하단 버튼은 CSS 클리핑으로 숨김)  │
//   └──────────────────────────────────────────────────┘
//
// [팝업 UI 구조 — 거제시(HLS)]
//   ┌──────────────────────────────────────────────────┐
//   │ 📹 견내량 ★  거제시CCTV↗    [✕]                 │
//   │    경남 거제 사등면 덕호리                         │
//   ├──────────────────────────────────────────────────┤
//   │   <video: HLS.js로 직접 스트림 재생>               │
//   └──────────────────────────────────────────────────┘
//
// [연계]
//   - cctv1.js CCTV_PROVIDERS         — 제공기관 type·links 조회
//   - cctv2.js cctvMap                — 클릭 이벤트 등록 대상
//   - cctv3.js ol.Feature 속성        — cctvId, name, subtitle, providerKey,
//                                        shareUrl, streamUrl
//   - cctv6.js CctvFavorites          — 즐겨찾기 추가/제거/확인
//   - index.html #cctv-modal-backdrop — 모달 배경 딤처리 DOM
//   - backbutton.js PopupStack        — 뒤로가기로 팝업 닫기 지원
//   - HLS.js (CDN)                    — HLS 스트림 재생 라이브러리
// ====================================================================

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 현재 열린 팝업의 데이터 (즐겨찾기 토글에 사용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 현재 열려 있는 팝업의 CCTV 데이터를 전역으로 보관합니다.
 *
 * [보관하는 이유]
 *   즐겨찾기 별 버튼의 onclick="toggleCctvFavorite()"에서
 *   cctvId, name, providerKey 등을 별도 인자 없이 참조하기 위함입니다.
 *   팝업이 닫히면 null로 초기화됩니다.
 */
let _currentCctvData = null;

/** 연안침식(coastal) 이미지 자동 갱신 타이머 ID */
let _cctvImageRefreshTimer = null;

/**
 * CCTV 팝업이 마지막으로 열린(display:flex) 시각(ms).
 * [버그수정] 터치 합성 click 관통 가드용 — 팝업이 열린 직후 같은 탭의 native
 *   click 이 전체화면 오버레이(.cctv-modal-overlay onclick=closeCctvPopup)에
 *   떨어져 팝업이 즉시 닫히는 문제를 막기 위해, 열린 지 일정 시간 이내의
 *   닫기 요청은 무시한다. (부이 모달 backdrop pointer-events 가드와 동일 취지)
 */
let _cctvPopupOpenedAt = 0;

/** 해무 CCTV 슬라이드 인덱스 (0 = 가장 오래된 이미지) */
let _seafogSlideIndex = 0;

/** 해무 CCTV 이미지 배열 [{ imgDt, uri }, ...] */
let _seafogSlides = [];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 클릭 이벤트 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 지도 클릭 시 호출됩니다.
 *
 * [동작]
 *   - 클릭 위치에 CCTV 마커가 있으면 → showCctvPopup() 호출
 *   - 마커가 없는 빈 지도를 클릭하면 → closeCctvPopup() 호출
 *
 * [연계]
 *   - cctv2.js initCctvMap() — cctvMap.on('singleclick', handleCctvMapClick)으로 등록
 *
 * @param {ol.MapBrowserEvent} event — OpenLayers 클릭 이벤트 객체
 */
function handleCctvMapClick(event) {
    const feature = cctvMap.forEachFeatureAtPixel(event.pixel, function (f) {
        return f;
    });

    if (!feature) {
        // 빈 지도 클릭: 팝업 닫기
        closeCctvPopup();
        return;
    }

    // ── 클러스터 처리: feature.get('features')로 내부 Feature 배열 추출 ──
    const clusterFeatures = feature.get('features');

    if (clusterFeatures && clusterFeatures.length > 1) {
        // 클러스터 클릭: 클러스터 내 모든 마커가 보이도록 줌 인
        const extent = ol.extent.createEmpty();
        clusterFeatures.forEach(function (f) {
            ol.extent.extend(extent, f.getGeometry().getExtent());
        });
        cctvMap.getView().fit(extent, {
            duration: 500,
            padding: [80, 80, 80, 80],
            maxZoom: 18
        });
        return;
    }

    // ── 개별 마커 클릭: 클러스터 래퍼에서 내부 Feature 꺼내기 ──
    const innerFeature = (clusterFeatures && clusterFeatures.length === 1)
        ? clusterFeatures[0]
        : feature;

    if (innerFeature && innerFeature.get('cctvId')) {
        // Feature 좌표에서 경위도 추출 (EPSG:3857 → WGS84)
        const coords = ol.proj.toLonLat(innerFeature.getGeometry().getCoordinates());

        // 마커 클릭: 해당 CCTV 팝업 표시
        showCctvPopup({
            cctvId:       innerFeature.get('cctvId'),
            name:         innerFeature.get('name'),
            subtitle:     innerFeature.get('subtitle'),
            providerKey:  innerFeature.get('providerKey'),
            providerName: innerFeature.get('providerName'),
            shareUrl:     innerFeature.get('shareUrl'),
            streamUrl:    innerFeature.get('streamUrl'),
            cnt:          innerFeature.get('cnt')         || '1',
            sensorName:   innerFeature.get('sensorName')  || null,
            cameraCount:  innerFeature.get('cameraCount') || 1,
            // obsName: 해무 CCTV 전용 — 서버 API 쿼리에 사용 (/api/seafog-cctv?obs=...)
            obsName:      innerFeature.get('obsName')     || null,
            lng:          coords[0],
            lat:          coords[1]
        });
    } else {
        // Feature이지만 CCTV 속성 없음: 팝업 닫기
        closeCctvPopup();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 표시 (모달 방식)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 영상 팝업을 화면 중앙 모달로 표시합니다.
 *
 * [영상 표출 방식 분기]
 *   data.streamUrl 존재 → HLS 스트림 (거제시 등 지자체)
 *     → <video> 엘리먼트 + HLS.js 로 직접 재생
 *   data.shareUrl 존재  → 공유 페이지 iframe (KBS)
 *     → <iframe src="..."> 임베드
 *     → CSS 클리핑으로 KBS 내부 타이틀·하단 버튼 숨김
 *
 * [헤더 링크 버튼 동적 생성]
 *   CCTV_PROVIDERS[data.providerKey].links 배열을 순회하여
 *   제공기관마다 다른 외부 링크 버튼을 자동 생성합니다.
 *   예) KBS: [KBS재난포털↗][CCTV더보기↗]
 *       거제시: [거제시 CCTV↗]
 *
 * [연계]
 *   - handleCctvMapClick() — 마커 클릭 시 호출
 *   - cctv6.js CctvFavorites.has() — 즐겨찾기 등록 여부 확인 (별 버튼 상태)
 *   - closeCctvPopup()     — 닫기 버튼 / 배경 클릭 시 호출
 *   - _initCctvHlsPlayer() — HLS 방식일 때 innerHTML 설정 후 호출
 *
 * @param {Object} data — { cctvId, name, subtitle, providerKey, providerName, shareUrl, streamUrl }
 */
function showCctvPopup(data) {
    // [임시 진단 로그 — CCTV 팝업 미표출 원인 추적용. 진단 끝나면 제거.]
    var _prov = (window.CCTV_PROVIDERS && data) ? window.CCTV_PROVIDERS[data.providerKey] : null;
    console.log('[DIAG][cctvpopup] called providerKey=', data && data.providerKey, 'type=', _prov ? _prov.type : '(provider없음)', 'streamUrl=', !!(data && data.streamUrl), 'shareUrl=', data && data.shareUrl, 'cctvId=', data && data.cctvId);
    const backdrop = document.getElementById('cctv-modal-backdrop');
    if (!backdrop) { console.log('[DIAG][cctvpopup] #cctv-modal-backdrop 없음 → return (팝업 미표출)'); return; }

    // 현재 팝업 데이터를 전역에 저장 (즐겨찾기 토글 시 사용)
    _currentCctvData = data;

    // 즐겨찾기 등록 여부에 따라 별 버튼 상태 결정
    const isFav    = window.CctvFavorites && CctvFavorites.has(data.cctvId);
    const favIcon  = isFav ? 'fa-solid fa-star'  : 'fa-regular fa-star';
    const favColor = isFav ? '#fbbf24'            : 'rgba(255,255,255,0.6)';
    const favTitle = isFav ? '즐겨찾기 해제'       : '즐겨찾기 추가';

    // ── 제공기관별 헤더 링크 버튼 동적 생성 ──────────────────────────
    // CCTV_PROVIDERS[key].links 배열을 HTML 버튼으로 변환
    // KBS    → [KBS재난포털↗] [CCTV더보기↗]
    // 거제시 → [거제시 CCTV↗]
    const provider  = window.CCTV_PROVIDERS ? window.CCTV_PROVIDERS[data.providerKey] : null;
    const links     = provider ? (provider.links || []) : [];
    const linksHtml = links.map(function (l) {
        const orgLine = l.org
            ? `<span class="cctv-link-org">${l.org}</span>`
            : '';
        return `<a class="cctv-action-btn${l.org ? ' cctv-action-btn--two-line' : ''}"
                   href="${l.url}"
                   target="_blank" rel="noopener noreferrer"
                   title="${l.org ? l.org + ' ' : ''}${l.label}">
                    ${orgLine}
                    <span class="cctv-link-label">
                        ${l.label}
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                    </span>
                </a>`;
    }).join('');

    // image 타입(연안침식)일 때 헤더 중앙에 표시할 안내 박스
    const imageNoticeHtml = (provider && provider.type === 'image')
        ? `<div class="cctv-image-notice">
               이미지로 제공되며<br>3초마다 자동 새로고침됩니다
           </div>`
        : '';

    // ── 영상 영역 HTML ────────────────────────────────────────────────
    // seafog → 스틸컷 슬라이더 | streamUrl → HLS video | ongjin → 안내+버튼
    // image → img 태그 | 나머지 → iframe
    let mediaHtml;
    if (provider && provider.type === 'seafog') {
        // ── 해무 CCTV 스틸컷 슬라이더 ──────────────────────────────────
        // 처음에는 로딩 상태로 렌더링하고, _initSeafogSlider()가 비동기로
        // 서버 API를 호출한 뒤 이 영역을 실제 이미지로 교체합니다.
        //
        // [팝업 구조]
        //   ┌──────────────────────────────────────────────────┐
        //   │  [이미지 영역] — 클릭 시 전체화면                 │
        //   │  (전체화면 중 hover → 하단에 ◀ 1/4 ▶ 오버레이)   │
        //   ├──────────────────────────────────────────────────┤
        //   │  ◀  1/4  ▶  │  04월 05일 09:30 기준             │
        //   │              │  CCTV는 스틸컷으로 제공합니다.     │
        //   └──────────────────────────────────────────────────┘
        mediaHtml = `
            <div class="cctv-seafog-wrap" id="cctv-seafog-wrap">

                <!-- 이미지 영역: 클릭 시 전체화면. 슬라이드 전환 시 src만 교체 (DOM 유지) -->
                <div class="cctv-seafog-img-area" id="cctv-seafog-img-area"
                     onclick="seafogFullscreen()" title="클릭하여 전체화면">

                    <!-- 로딩 스피너: 이미지 로드 전 표시 -->
                    <div class="cctv-seafog-loading" id="cctv-seafog-loading">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        <span>이미지 불러오는 중...</span>
                    </div>

                    <!-- 전체화면 전용 네비게이션 오버레이
                         평소: display:none / 전체화면+hover: 하단에 표시 -->
                    <div class="cctv-seafog-fs-nav" id="cctv-seafog-fs-nav"
                         onclick="event.stopPropagation()">
                        <button class="cctv-seafog-fs-btn" onclick="seafogPrev()" title="이전">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span class="cctv-seafog-fs-page" id="cctv-seafog-fs-page">—</span>
                        <button class="cctv-seafog-fs-btn" onclick="seafogNext()" title="다음">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                </div>

                <!-- 네비게이션 바: ◀ 1/4 ▶ | 기준 시각 + 안내 문구 -->
                <div class="cctv-seafog-nav">
                    <div class="cctv-seafog-nav-controls">
                        <button class="cctv-seafog-nav-btn" onclick="seafogPrev()" title="이전 이미지">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <!-- 페이지 인디케이터: "1/4" -->
                        <span class="cctv-seafog-page-indicator" id="cctv-seafog-page-indicator">—</span>
                        <button class="cctv-seafog-nav-btn" onclick="seafogNext()" title="다음 이미지">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    <!-- 기준 시각 + 안내 문구 (세로 배치) -->
                    <div class="cctv-seafog-timestamp-wrap">
                        <div class="cctv-seafog-timestamp" id="cctv-seafog-timestamp">—</div>
                        <div class="cctv-seafog-notice-inline">CCTV는 스틸컷으로 제공합니다.</div>
                    </div>
                </div>

            </div>`;
    } else if (provider && provider.type === 'image') {
        // 연안침식 모니터링: 이미지 직접 표시 (3초마다 src 갱신)
        const camCount = parseInt(data.cameraCount, 10) || 1;
        let imgsHtml = '';
        for (let i = 0; i < camCount; i++) {
            const src = provider.imageBaseUrl(data.cctvId, i) + '?' + Date.now();
            const label = camCount > 1 ? ` 카메라 ${i + 1}` : '';
            imgsHtml += `<div class="cctv-coast-img-wrap">` +
                `<img id="cctv-coast-img-${i}" class="cctv-coast-img" referrerpolicy="no-referrer"` +
                ` src="${src}" alt="${data.name}${label}"` +
                ` onerror="this.style.display='none';` +
                    `var _e=document.getElementById('cctv-coast-err-${i}');if(_e)_e.style.display='flex';">` +
                `<div id="cctv-coast-err-${i}" class="cctv-coast-err" style="display:none;">` +
                    `<i class="fa-solid fa-triangle-exclamation"></i>` +
                    `<span>이미지를 불러올 수 없습니다</span>` +
                `</div>` +
                `</div>`;
        }
        mediaHtml = `<div class="cctv-coast-wrap">${imgsHtml}</div>`;
    } else if (data.providerKey === 'ongjin') {
        // 옹진군: HTTP 전용 서버 → HTTPS 앱에서 iframe 임베드 불가
        // 안내 메시지 + CCTV 보기(새 창) + 옹진군 시스템 링크 버튼
        mediaHtml = `
           <div class="cctv-modal-ongjin-notice">
               <p class="cctv-ongjin-msg">
                   <i class="fa-solid fa-triangle-exclamation"></i>
                   이 CCTV는 보안 연결(HTTPS)을 지원하지 않아<br>앱 내에서 영상을 표시할 수 없습니다.
               </p>
               <div class="cctv-ongjin-buttons">
                   <a class="cctv-ongjin-btn cctv-ongjin-btn-primary"
                      href="${data.shareUrl}"
                      target="_blank" rel="noopener noreferrer">
                       <i class="fa-solid fa-play"></i> CCTV 보기
                   </a>
                   <a class="cctv-ongjin-btn"
                      href="http://218.148.169.193/"
                      target="_blank" rel="noopener noreferrer">
                       옹진군 재난 CCTV 시스템
                       <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                   </a>
               </div>
           </div>`;
    } else if (data.streamUrl) {
        // HLS 스트림 (거제시 등 지자체)
        mediaHtml = `<!-- HLS 스트림 비디오 -->
           <div class="cctv-modal-video-wrap">
               <video id="cctv-modal-video"
                      autoplay muted playsinline controls
                      title="${data.name} CCTV 영상">
               </video>
           </div>`;
    } else {
        // iframe 공유 페이지 — 제공기관별 클리핑 값을 인라인 스타일로 적용
        const clipTop  = (provider && provider.iframeTopClip)   || 0;
        const wrapH    = (provider && provider.iframeWrapHeight) || 400;
        const cntNum   = parseInt(data.cnt, 10) || 1;

        if (cntNum >= 2 && data.sensorName) {
            // ── 멀티카메라: 각 채널을 개별 iframe으로 분리 → 위아래 쌓기 ──
            // 화면 높이의 88%에서 모달 헤더(~52px)와 채널 간 간격을 빼고 균등 분배
            const availH     = Math.floor((window.innerHeight * 0.88 - 60) / cntNum);
            const singleWrapH = Math.min(availH, wrapH);
            const singleIframeH = singleWrapH + clipTop + (clipTop > 0 ? 60 : 0);

            const ids   = data.cctvId.split(',').map(function (s) { return s.trim(); });
            const names = data.sensorName.split(',').map(function (s) { return s.trim(); });

            const stackedHtml = ids.map(function (id, idx) {
                const snName = names[idx] || id;
                const url = 'https://safecity.busan.go.kr/#/cctv?cnt=1' +
                            '&cctv_cd=' + id +
                            '&sensorName=' + encodeURIComponent(snName);
                return `<div class="cctv-modal-iframe-wrap" style="height:${singleWrapH}px;">` +
                           `<iframe src="${url}" frameborder="0" scrolling="no"` +
                           ` allowfullscreen allow="autoplay; encrypted-media; fullscreen"` +
                           ` title="${snName}" style="top:-${clipTop}px; height:${singleIframeH}px;">` +
                           `</iframe></div>`;
            }).join('<div style="height:4px;background:rgba(0,0,0,0.4);"></div>');

            mediaHtml = `<div class="cctv-modal-iframe-stack">${stackedHtml}</div>`;
        } else {
            // ── 단일 카메라: 기존 방식 ──
            const iframeH = wrapH + clipTop + (clipTop > 0 ? 60 : 0);
            mediaHtml = `<div class="cctv-modal-iframe-wrap" style="height:${wrapH}px;">` +
                            `<iframe id="cctv-modal-iframe" src="${data.shareUrl}"` +
                            ` frameborder="0" scrolling="no" allowfullscreen` +
                            ` allow="autoplay; encrypted-media; fullscreen"` +
                            ` title="${data.name} CCTV 영상"` +
                            ` style="top:-${clipTop}px; height:${iframeH}px;">` +
                            `</iframe></div>`;
        }
    }

    // 모달 내부 HTML 구성
    backdrop.innerHTML = `
        <!-- 반투명 배경: 클릭 시 팝업 닫기 -->
        <div class="cctv-modal-overlay" onclick="closeCctvPopup()"></div>

        <!-- 모달 카드 -->
        <div class="cctv-modal-card">

            <!-- 헤더: 아이콘+이름(★) / 기관링크 / 닫기 -->
            <div class="cctv-modal-header">

                <!-- 왼쪽: 카메라 아이콘 + 지점명(★ 인접) + 부제목 -->
                <div class="cctv-modal-title-wrap">
                    <i class="fa-solid fa-video cctv-modal-icon"></i>
                    <div class="cctv-modal-title-text">
                        <!-- 지점명 + 즐겨찾기 별 버튼을 한 줄에 배치 -->
                        <div class="cctv-modal-title-row">
                            <span class="cctv-modal-title">${data.name}</span>
                            <button class="cctv-modal-fav-btn"
                                    id="cctv-fav-toggle-btn"
                                    onclick="toggleCctvFavorite()"
                                    title="${favTitle}">
                                <i class="${favIcon}" style="color: ${favColor};"></i>
                            </button>
                        </div>
                        <div class="cctv-modal-subtitle">${data.subtitle}</div>
                    </div>
                </div>

                <!-- 중앙: image 타입 안내 박스 (연안침식 전용) -->
                ${imageNoticeHtml}

                <!-- 오른쪽: 기관별 링크 버튼들(세로) + 닫기 -->
                <div class="cctv-modal-actions">
                    <div class="cctv-action-links">
                        ${linksHtml}
                    </div>
                    <button class="cctv-modal-close-btn" onclick="closeCctvPopup()" title="닫기">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- 영상 영역: 제공기관 방식에 따라 video 또는 iframe -->
            ${mediaHtml}

        </div>
    `;

    // 모달 표시 (display: flex → 화면 중앙에 배치)
    console.log('[DIAG][cctvpopup] 끝까지 도달 → display:flex 설정 (팝업 표시되어야 정상)');
    backdrop.style.display = 'flex';
    // [버그수정] 합성 click 관통 가드 기준 시각 기록 (closeCctvPopup 에서 사용)
    _cctvPopupOpenedAt = Date.now();

    // HLS 스트림인 경우 비디오 플레이어 초기화 (innerHTML 설정 후 실행)
    if (data.streamUrl) {
        _initCctvHlsPlayer(data.streamUrl);
    }

    // 연안침식 이미지인 경우 3초마다 src 갱신 타이머 시작
    if (provider && provider.type === 'image') {
        _startCoastImageRefresh(provider, data);
    }

    // 해무 CCTV인 경우 서버 API 호출 후 슬라이더 초기화
    if (provider && provider.type === 'seafog') {
        _initSeafogSlider(data);
    }

    // PopupStack 등록: 뒤로가기 버튼으로 모달 닫기 지원
    if (window.PopupStack) {
        PopupStack.push('cctv-popup', closeCctvPopup);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HLS 비디오 플레이어 초기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * HLS.js를 사용하여 거제시 등 HLS 스트림을 video 엘리먼트에 연결합니다.
 *
 * [지원 환경]
 *   - HLS.js 지원 브라우저 (Chrome, Firefox, Edge 등): HLS.js로 재생
 *   - Safari (네이티브 HLS 지원): video.src에 직접 지정
 *   - 둘 다 지원 안 하면: 재생 불가 (재생 안 됨 메시지 없음)
 *
 * [hls 인스턴스를 video._hls에 보관하는 이유]
 *   closeCctvPopup()에서 팝업을 닫을 때 hls.destroy()로
 *   스트림 수신을 완전히 중단하기 위함입니다.
 *
 * @param {string} streamUrl — HLS .m3u8 스트림 URL
 */
function _initCctvHlsPlayer(streamUrl) {
    const video = document.getElementById('cctv-modal-video');
    if (!video) return;

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        // Chrome/Firefox/Edge 등: HLS.js 사용
        const hls = new Hls({ enableWorker: false });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            // 재생목록 파싱 완료 후 자동 재생 시도 (음소거 상태이므로 대부분 허용)
            video.play().catch(function () {});
        });
        // 닫기 시 참조할 수 있도록 video 엘리먼트에 보관
        video._hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari: 네이티브 HLS 지원
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function () {
            video.play().catch(function () {});
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 연안침식 이미지 자동 갱신
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 3초마다 연안침식 이미지 src를 갱신합니다.
 * 타임스탬프를 URL 끝에 붙여 브라우저 캐시를 우회합니다.
 */
function _startCoastImageRefresh(provider, data) {
    _stopCoastImageRefresh();
    const camCount = parseInt(data.cameraCount, 10) || 1;
    _cctvImageRefreshTimer = setInterval(function () {
        for (var i = 0; i < camCount; i++) {
            var img = document.getElementById('cctv-coast-img-' + i);
            if (img) {
                // 갱신 전 에러 패널 숨기고 이미지 복원
                var errEl = document.getElementById('cctv-coast-err-' + i);
                if (errEl) errEl.style.display = 'none';
                img.style.display = '';
                img.src = provider.imageBaseUrl(data.cctvId, i) + '?' + Date.now();
            }
        }
    }, 3000);
}

/**
 * 해안 CCTV 이미지 자동 새로고침 타이머 정지.
 *
 * [호출 시점]
 *   - 팝업 닫을 때 (closeCctvPopup) — 보이지 않는 이미지 갱신을 막아 네트워크 절약
 *   - 새 _startCoastImageRefresh 시작 직전 (이중 타이머 방지)
 *
 * [안전성] 타이머가 없으면 (_cctvImageRefreshTimer === null) 그냥 통과.
 */
function _stopCoastImageRefresh() {
    if (_cctvImageRefreshTimer) {
        clearInterval(_cctvImageRefreshTimer);
        _cctvImageRefreshTimer = null;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 해무 CCTV 스틸컷 슬라이더
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 해무 CCTV 팝업 슬라이더를 초기화합니다.
 *
 * [동작 순서]
 * 1. 서버 /api/seafog-cctv?obs={obsName} 호출
 * 2. 응답받은 이미지 배열을 _seafogSlides에 저장
 * 3. 첫 번째 이미지(가장 오래된 것)부터 표시
 *
 * [자동 전환 없음]
 * ◀/▶ 버튼으로만 수동 전환합니다.
 *
 * [전체화면]
 * imgArea 컨테이너를 전체화면 대상으로 사용합니다.
 * 이미지는 src만 교체하므로 DOM 구조가 유지되어 전체화면이 해제되지 않습니다.
 *
 * @param {Object} data — showCctvPopup()에서 전달된 CCTV 데이터
 */
async function _initSeafogSlider(data) {
    const imgArea = document.getElementById('cctv-seafog-img-area');
    const tsEl    = document.getElementById('cctv-seafog-timestamp');
    if (!imgArea) return;

    _seafogSlides     = [];
    _seafogSlideIndex = 0;

    try {
        const obsEncoded = encodeURIComponent(data.obsName || '');
        const res  = await fetch('/api/seafog-cctv?obs=' + obsEncoded);
        const json = await res.json();

        if (!json.ok || !json.stations) throw new Error(json.message || '데이터 없음');

        const slides = json.stations[data.obsName] || [];
        if (slides.length === 0) throw new Error('이미지 데이터 없음');

        _seafogSlides = slides;

        // 로딩 스피너 제거 후, 영속 img + 영속 error div 삽입
        // (슬라이드 전환 시 src만 교체 → imgArea가 DOM에 유지 → 전체화면 해제 안됨)
        const loadingEl = document.getElementById('cctv-seafog-loading');
        if (loadingEl) loadingEl.remove();

        // imgArea 안에 img / error div 추가 (fs-nav는 HTML에 이미 있음)
        const img = document.createElement('img');
        img.className = 'cctv-seafog-img';
        img.alt       = '해무 CCTV';
        img.onerror   = function () { _seafogImgError(this); };

        const errDiv = document.createElement('div');
        errDiv.className   = 'cctv-seafog-error';
        errDiv.style.display = 'none';
        errDiv.innerHTML   = '<i class="fa-solid fa-triangle-exclamation"></i>' +
                             '<span>이미지를 불러올 수 없습니다</span>';

        // fs-nav 앞에 삽입 (순서: img → errDiv → fs-nav)
        const fsNav = document.getElementById('cctv-seafog-fs-nav');
        imgArea.insertBefore(errDiv, fsNav);
        imgArea.insertBefore(img, errDiv);

        // 첫 번째 슬라이드 표시
        _renderSeafogSlide(tsEl, 0);

    } catch (err) {
        const loadingEl = document.getElementById('cctv-seafog-loading');
        if (loadingEl) {
            loadingEl.innerHTML =
                '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i>' +
                `<span>${err.message}</span>`;
        }
        if (tsEl) tsEl.textContent = '—';
    }
}

/**
 * 특정 인덱스의 스틸컷을 표시합니다.
 *
 * [설계 포인트]
 * imgArea 안의 <img> 엘리먼트는 슬라이드가 바뀌어도 DOM에서 제거되지 않습니다.
 * src 속성만 교체하므로 imgArea가 전체화면 상태여도 fullscreen이 해제되지 않습니다.
 *
 * @param {HTMLElement} tsEl — 타임스탬프 DOM 엘리먼트
 * @param {number}      idx  — _seafogSlides 인덱스
 */
function _renderSeafogSlide(tsEl, idx) {
    const slide = _seafogSlides[idx];
    if (!slide) return;

    // imgDt: "2026-04-05 09:30" → "04월 05일 09:30 기준"
    let tsText = slide.imgDt;
    try {
        const parts     = slide.imgDt.split(' ');
        const dateParts = parts[0].split('-');
        tsText = `${dateParts[1]}월 ${dateParts[2]}일 ${parts[1]} 기준`;
    } catch (e) { /* 파싱 실패 시 원본 사용 */ }

    // 타임스탬프 갱신
    if (tsEl) tsEl.textContent = tsText;

    // 페이지 인디케이터 갱신 (일반 nav + 전체화면 nav)
    const pageText = `${idx + 1}/${_seafogSlides.length}`;
    const pageEl   = document.getElementById('cctv-seafog-page-indicator');
    const fsPageEl = document.getElementById('cctv-seafog-fs-page');
    if (pageEl)   pageEl.textContent   = pageText;
    if (fsPageEl) fsPageEl.textContent = pageText;

    // 에러 상태 초기화
    const imgArea = document.getElementById('cctv-seafog-img-area');
    if (!imgArea) return;
    const imgEl = imgArea.querySelector('.cctv-seafog-img');
    const errEl = imgArea.querySelector('.cctv-seafog-error');
    if (errEl) errEl.style.display = 'none';
    if (imgEl) {
        imgEl.style.display = '';

        // 로딩 완료(onload) 또는 실패(onerror) 전까지 ◀/▶ 버튼 비활성화
        _setSeafogNavDisabled(true);
        imgEl.onload  = function () { _setSeafogNavDisabled(false); };
        imgEl.onerror = function () { _seafogImgError(this); _setSeafogNavDisabled(false); };

        imgEl.src = slide.uri; // DOM 유지 + src만 교체
    }
}

/**
 * ◀/▶ 버튼(일반 nav + 전체화면 오버레이 nav)을 일괄 활성화/비활성화합니다.
 * 이미지 src 교체 직후 비활성화하고, 로드 완료(성공·실패 모두) 시 재활성화합니다.
 *
 * @param {boolean} disabled — true: 비활성화 / false: 활성화
 */
function _setSeafogNavDisabled(disabled) {
    // 일반 네비게이션 바 버튼
    document.querySelectorAll('.cctv-seafog-nav-btn').forEach(function (btn) {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.4' : '';
        btn.style.cursor  = disabled ? 'not-allowed' : '';
    });
    // 전체화면 오버레이 버튼
    document.querySelectorAll('.cctv-seafog-fs-btn').forEach(function (btn) {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.4' : '';
        btn.style.cursor  = disabled ? 'not-allowed' : '';
    });
}

/**
 * 이미지 로드 실패 시 호출됩니다.
 * img와 error div가 영속적으로 DOM에 존재하므로
 * img를 숨기고 error div를 표시하는 방식으로 처리합니다.
 * (버튼 재활성화는 _renderSeafogSlide의 onerror 핸들러에서 담당)
 */
function _seafogImgError(imgEl) {
    if (!imgEl || !imgEl.isConnected) return;
    imgEl.style.display = 'none';
    const errEl = imgEl.parentElement && imgEl.parentElement.querySelector('.cctv-seafog-error');
    if (errEl) errEl.style.display = 'flex';
}

/** 이전 이미지 (◀ 버튼) */
function seafogPrev() {
    if (_seafogSlides.length === 0) return;
    _seafogSlideIndex = (_seafogSlideIndex - 1 + _seafogSlides.length) % _seafogSlides.length;
    const tsEl = document.getElementById('cctv-seafog-timestamp');
    _renderSeafogSlide(tsEl, _seafogSlideIndex);
}

/** 다음 이미지 (▶ 버튼) */
function seafogNext() {
    if (_seafogSlides.length === 0) return;
    _seafogSlideIndex = (_seafogSlideIndex + 1) % _seafogSlides.length;
    const tsEl = document.getElementById('cctv-seafog-timestamp');
    _renderSeafogSlide(tsEl, _seafogSlideIndex);
}

/**
 * imgArea 컨테이너를 전체화면으로 전환합니다.
 *
 * [기존 <img> 대신 imgArea를 전체화면 대상으로 쓰는 이유]
 * 슬라이드 전환 시 src만 바꾸므로 imgArea가 DOM에 유지됩니다.
 * 따라서 전체화면 상태에서 슬라이드를 넘겨도 fullscreen이 해제되지 않습니다.
 */
function seafogFullscreen() {
    const el = document.getElementById('cctv-seafog-img-area');
    if (!el) return;
    if (el.requestFullscreen) {
        el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 닫기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 모달 팝업을 닫습니다.
 *
 * [스트림 중단 처리]
 *   - iframe 방식: src를 ''으로 교체 → 브라우저가 KBS 페이지 언로드
 *   - HLS 방식:    hls.destroy() → HLS.js 스트림 수신 즉시 중단
 *
 * [연계]
 *   - showCctvPopup() — 닫기 버튼 onclick, 배경 onclick
 *   - handleCctvMapClick() — 빈 지도 클릭 시
 *   - PopupStack — 뒤로가기 시 자동 호출
 */
function closeCctvPopup() {
    const backdrop = document.getElementById('cctv-modal-backdrop');
    if (!backdrop || backdrop.style.display === 'none') return;
    // [버그수정] 터치 합성 click 관통 가드: 팝업이 열린 직후(같은 탭의 native
    //   click 이 전체화면 오버레이에 떨어져) 즉시 닫히는 것을 방지. 열린 지
    //   350ms 이내의 닫기 요청은 무시한다. 정상적인 '바깥 클릭/닫기 버튼' 은
    //   항상 그 이후라 영향 없음.
    if (Date.now() - _cctvPopupOpenedAt < 350) {
        console.log('[DIAG][cctvpopup] close 무시됨 (' + (Date.now() - _cctvPopupOpenedAt) + 'ms) — 합성 click 가드 동작');
        return;
    }
    // [임시 진단 로그 — 팝업이 열리자마자 닫히는지 추적용. 진단 끝나면 제거.]
    console.log('[DIAG][cctvpopup] closeCctvPopup 호출됨 (누가 닫는지 ↓ 스택)');
    console.trace('[DIAG][cctvpopup] close stack');

    // iframe 스트림 즉시 중단 (KBS 방식)
    const iframe = backdrop.querySelector('iframe');
    if (iframe) iframe.src = '';

    // HLS 스트림 즉시 중단 (거제시 등 HLS 방식)
    const video = backdrop.querySelector('#cctv-modal-video');
    if (video) {
        video.pause();
        video.src = '';
        if (video._hls) {
            video._hls.destroy();
            video._hls = null;
        }
    }

    // 연안침식 이미지 갱신 타이머 중단
    _stopCoastImageRefresh();

    // 현재 팝업 데이터 초기화
    _currentCctvData = null;

    // 모달 숨기기 + 내용 비우기
    backdrop.style.display = 'none';
    backdrop.innerHTML = '';

    // PopupStack에서 제거
    if (window.PopupStack) {
        PopupStack.remove('cctv-popup');
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 즐겨찾기 토글
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 팝업 헤더의 별 버튼을 클릭했을 때 즐겨찾기를 추가하거나 제거합니다.
 * 버튼 아이콘을 즉시 갱신하여 등록/해제 상태를 시각적으로 피드백합니다.
 *
 * [인자를 받지 않는 이유]
 *   팝업 HTML의 onclick="toggleCctvFavorite()" 에서 호출되는데,
 *   필요한 데이터(cctvId, shareUrl, streamUrl 등)는 이미
 *   _currentCctvData에 저장되어 있으므로 인자 전달이 불필요합니다.
 *   덕분에 긴 onclick 문자열 생성이 필요 없고 특수문자 이스케이프 문제도 없습니다.
 *
 * [연계]
 *   - cctv6.js CctvFavorites.add() / remove() / has() — 실제 저장/삭제 처리
 *   - showCctvPopup() — 팝업 innerHTML에서 onclick으로 호출
 */
function toggleCctvFavorite() {
    if (!window.CctvFavorites || !_currentCctvData) return;

    const btn = document.getElementById('cctv-fav-toggle-btn');
    if (!btn) return;

    const { cctvId, name, subtitle, providerKey, shareUrl, streamUrl, cameraCount, obsName } = _currentCctvData;

    if (CctvFavorites.has(cctvId)) {
        // ─── 이미 등록됨 → 제거 ───
        CctvFavorites.remove(cctvId);
        btn.title = '즐겨찾기 추가';
        btn.innerHTML = `<i class="fa-regular fa-star" style="color: rgba(255,255,255,0.6);"></i>`;
    } else {
        // ─── 미등록 → 추가 ───
        // obsName: seafog(해무 CCTV) 전용 — 즐겨찾기에서 팝업 재열 시 API 쿼리에 필요
        const added = CctvFavorites.add({ cctvId, name, subtitle, providerKey, shareUrl, streamUrl, cameraCount, obsName });
        if (added) {
            btn.title = '즐겨찾기 해제';
            btn.innerHTML = `<i class="fa-solid fa-star" style="color: #fbbf24;"></i>`;
        }
    }
}
