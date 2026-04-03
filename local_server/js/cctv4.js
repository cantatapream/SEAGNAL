// ====================================================================
// cctv4.js — 클릭 핸들러 + 팝업 표시/닫기
//
// [역할]
//   1. 지도 클릭 이벤트를 처리합니다.
//      - 마커 클릭 → 해당 CCTV 팝업 표시
//      - 빈 지도 클릭 → 팝업 닫기
//   2. CCTV 영상 팝업을 지도 아래 #cctv-popup-container에 표시합니다.
//   3. 팝업을 닫을 때 iframe src를 비워 스트림을 중단합니다.
//
// [팝업 구조 (텍스트)]
//   ┌──────────────────────────────────────┐
//   │ 📹 CCTV 지점명               [✕]    │  ← 헤더
//   │ 상세 위치 (subtitle)                  │  ← 부제목
//   ├──────────────────────────────────────┤
//   │  <iframe: KBS cctvShare 페이지>      │  ← 영상 (내부에 출처 포함)
//   └──────────────────────────────────────┘
//
// [연계]
//   - cctv2.js cctvMap               — 클릭 이벤트 등록 대상
//   - cctv3.js ol.Feature 속성       — cctvId, name, subtitle, shareUrl
//   - index.html #cctv-popup-container — 팝업 렌더링 DOM
//   - backbutton.js PopupStack        — 뒤로가기로 팝업 닫기 지원
// ====================================================================

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
 *   - showCctvPopup()        — 팝업 표시
 *   - closeCctvPopup()       — 팝업 닫기
 *
 * @param {ol.MapBrowserEvent} event — OpenLayers 클릭 이벤트 객체
 */
function handleCctvMapClick(event) {
    // 클릭한 픽셀 위치에서 Feature(마커)를 찾음
    // forEachFeatureAtPixel: 해당 픽셀에 Feature가 있으면 첫 번째 것을 반환
    const feature = cctvMap.forEachFeatureAtPixel(event.pixel, function (f) {
        return f;
    });

    if (feature && feature.get('cctvId')) {
        // ─── 마커를 클릭한 경우: CCTV 팝업 표시 ───
        showCctvPopup({
            cctvId:       feature.get('cctvId'),
            name:         feature.get('name'),
            subtitle:     feature.get('subtitle'),
            providerName: feature.get('providerName'),
            shareUrl:     feature.get('shareUrl')
        });
    } else {
        // ─── 빈 지도를 클릭한 경우: 팝업 닫기 ───
        closeCctvPopup();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 표시
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 영상 팝업을 지도 아래 #cctv-popup-container에 표시합니다.
 *
 * [팝업이 지도 아래에 표시되는 이유]
 *   iframe은 전체 폭이 필요하고, 지도 위에 오버레이하면 지도 조작을 방해합니다.
 *   따라서 tide.js(지도 위 오버레이)와 달리 지도 아래 별도 컨테이너를 사용합니다.
 *
 * [동작]
 *   1. #cctv-popup-container innerHTML에 팝업 HTML 삽입
 *   2. container display: block으로 변경
 *   3. 팝업이 보이도록 부드럽게 스크롤
 *   4. PopupStack에 등록 (뒤로가기 지원)
 *
 * [연계]
 *   - handleCctvMapClick() — 마커 클릭 시 호출
 *   - closeCctvPopup()     — 팝업 내 닫기 버튼 onclick
 *   - PopupStack           — backbutton.js 뒤로가기 처리
 *
 * @param {Object} data — { cctvId, name, subtitle, providerName, shareUrl }
 */
function showCctvPopup(data) {
    const container = document.getElementById('cctv-popup-container');
    if (!container) return;

    // ─── 팝업 HTML 구성 ───
    container.innerHTML = `
        <div class="cctv-popup">

            <!-- 팝업 헤더: 카메라 아이콘 + CCTV 지점명 + 닫기 버튼 -->
            <div class="cctv-popup-header">
                <div class="cctv-popup-title-wrap">
                    <i class="fa-solid fa-video cctv-popup-icon"></i>
                    <div>
                        <div class="cctv-popup-title">${data.name}</div>
                        <div class="cctv-popup-subtitle">${data.subtitle}</div>
                    </div>
                </div>
                <button class="cctv-popup-close" onclick="closeCctvPopup()" title="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- iframe: KBS cctvShare 페이지 (KBS 측 페이지 내부에 출처 표기 포함) -->
            <div class="cctv-popup-iframe-wrap">
                <iframe
                    src="${data.shareUrl}"
                    class="cctv-popup-iframe"
                    frameborder="0"
                    scrolling="no"
                    allowfullscreen
                    allow="autoplay; encrypted-media; fullscreen"
                    title="${data.name} CCTV 영상">
                </iframe>
            </div>

        </div>
    `;

    // ─── 팝업 표시 ───
    container.style.display = 'block';

    // ─── 팝업이 화면에 보이도록 부드럽게 스크롤 ───
    // 'nearest': 이미 보이면 스크롤 안 함, 안 보이면 최소한만 스크롤
    setTimeout(function () {
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);

    // ─── PopupStack 등록: 뒤로가기 버튼으로 팝업 닫기 지원 ───
    if (window.PopupStack) {
        PopupStack.push('cctv-popup', closeCctvPopup);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 닫기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 팝업을 닫습니다.
 *
 * [iframe src를 먼저 비우는 이유]
 *   display:none만 하면 iframe이 DOM에 남아 있어
 *   백그라운드에서 KBS 스트림을 계속 수신합니다.
 *   src를 '' (빈 문자열)로 바꾸면 연결이 즉시 끊깁니다.
 *
 * [연계]
 *   - showCctvPopup()  — 팝업 내 닫기 버튼 onclick="closeCctvPopup()"
 *   - handleCctvMapClick() — 빈 지도 클릭 시
 *   - PopupStack       — 뒤로가기 시 자동 호출
 */
function closeCctvPopup() {
    const container = document.getElementById('cctv-popup-container');
    if (!container || container.style.display === 'none') return;

    // iframe src 초기화 → 스트림 연결 즉시 해제
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.src = '';

    // 팝업 숨기기 + 내용 비우기
    container.style.display = 'none';
    container.innerHTML = '';

    // PopupStack에서 제거
    if (window.PopupStack) {
        PopupStack.remove('cctv-popup');
    }
}
