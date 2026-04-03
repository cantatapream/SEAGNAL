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
            cnt:          innerFeature.get('cnt') || '1',
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
    const backdrop = document.getElementById('cctv-modal-backdrop');
    if (!backdrop) return;

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
        return `<a class="cctv-action-btn"
                   href="${l.url}"
                   target="_blank" rel="noopener noreferrer"
                   title="${l.label}">
                    ${l.label}
                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                </a>`;
    }).join('');

    // ── 영상 영역 HTML ────────────────────────────────────────────────
    // streamUrl → HLS video | ongjin → 안내+버튼 | 나머지 → iframe
    let mediaHtml;
    if (data.providerKey === 'ongjin') {
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
        const clipTop  = (provider && provider.iframeTopClip)    || 0;
        const wrapH    = (provider && provider.iframeWrapHeight)  || 400;
        const iframeH  = wrapH + clipTop + (clipTop > 0 ? 60 : 0);
        const cntNum   = parseInt(data.cnt, 10) || 1;

        // cnt=2 이상: iframe 내부에서 영상이 가로로 나란히 표출됨
        // → iframe scrolling을 허용하여 내부 가로 스크롤 가능하게
        mediaHtml = `<!-- iframe 공유 페이지 — cnt=${cntNum}, clip=${clipTop}px, wrap=${wrapH}px -->
           <div class="cctv-modal-iframe-wrap"
                style="height: ${wrapH}px;">
               <iframe id="cctv-modal-iframe"
                   src="${data.shareUrl}"
                   frameborder="0"
                   scrolling="${cntNum >= 2 ? 'auto' : 'no'}"
                   allowfullscreen
                   allow="autoplay; encrypted-media; fullscreen"
                   title="${data.name} CCTV 영상"
                   style="top: -${clipTop}px; height: ${iframeH}px;">
               </iframe>
           </div>`;
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
    backdrop.style.display = 'flex';

    // HLS 스트림인 경우 비디오 플레이어 초기화 (innerHTML 설정 후 실행)
    if (data.streamUrl) {
        _initCctvHlsPlayer(data.streamUrl);
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

    const { cctvId, name, subtitle, providerKey, shareUrl, streamUrl } = _currentCctvData;

    if (CctvFavorites.has(cctvId)) {
        // ─── 이미 등록됨 → 제거 ───
        CctvFavorites.remove(cctvId);
        btn.title = '즐겨찾기 추가';
        btn.innerHTML = `<i class="fa-regular fa-star" style="color: rgba(255,255,255,0.6);"></i>`;
    } else {
        // ─── 미등록 → 추가 ───
        const added = CctvFavorites.add({ cctvId, name, subtitle, providerKey, shareUrl, streamUrl });
        if (added) {
            btn.title = '즐겨찾기 해제';
            btn.innerHTML = `<i class="fa-solid fa-star" style="color: #fbbf24;"></i>`;
        }
    }
}
