// ====================================================================
// cctv4.js — 클릭 핸들러 + 모달 팝업 표시/닫기 + 즐겨찾기 토글
//
// [역할]
//   1. 지도 마커 클릭 이벤트를 처리합니다.
//   2. 모달 방식(화면 중앙 고정)으로 CCTV 영상 팝업을 표시합니다.
//   3. 팝업 헤더에 KBS 재난포털/CCTV 더보기 링크 버튼과 즐겨찾기 별 버튼을 배치합니다.
//   4. iframe 하단 KBS 버튼 영역을 CSS 클리핑으로 숨깁니다.
//   5. 팝업 닫을 때 iframe src를 비워 스트림을 즉시 중단합니다.
//
// [팝업 UI 구조]
//   ════════════════════════════════════════ (반투명 배경 딤처리)
//   ┌──────────────────────────────────────────────┐
//   │ 📹 가거도  [KBS재난포털↗][CCTV더보기↗][☆][✕]│ ← 헤더
//   │    전남 신안 가거도                           │ ← 부제목
//   ├──────────────────────────────────────────────┤
//   │                                              │
//   │   <iframe: KBS cctvShare 페이지>             │ ← 영상
//   │   (하단 KBS 버튼은 CSS 클리핑으로 숨김)       │
//   │                                              │
//   └──────────────────────────────────────────────┘
//
// [연계]
//   - cctv2.js cctvMap               — 클릭 이벤트 등록 대상
//   - cctv3.js ol.Feature 속성       — cctvId, name, subtitle, shareUrl
//   - cctv6.js CctvFavorites         — 즐겨찾기 추가/제거/확인
//   - index.html #cctv-modal-backdrop — 모달 배경 딤처리 DOM
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
 *
 * @param {ol.MapBrowserEvent} event — OpenLayers 클릭 이벤트 객체
 */
function handleCctvMapClick(event) {
    const feature = cctvMap.forEachFeatureAtPixel(event.pixel, function (f) {
        return f;
    });

    if (feature && feature.get('cctvId')) {
        // 마커 클릭: 해당 CCTV 팝업 표시
        showCctvPopup({
            cctvId:       feature.get('cctvId'),
            name:         feature.get('name'),
            subtitle:     feature.get('subtitle'),
            providerName: feature.get('providerName'),
            shareUrl:     feature.get('shareUrl')
        });
    } else {
        // 빈 지도 클릭: 팝업 닫기
        closeCctvPopup();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 표시 (모달 방식)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 영상 팝업을 화면 중앙 모달로 표시합니다.
 *
 * [모달 방식을 사용하는 이유]
 *   화면 중앙에 고정(position: fixed)되어 지도를 벗어나 표시되므로
 *   iframe의 전체 폭 활용과 스크롤 없는 영상 시청이 가능합니다.
 *
 * [iframe 하단 버튼 숨기기]
 *   KBS cctvShare 페이지 하단의 "KBS 재난포털" / "CCTV 더보기" 버튼은
 *   크로스도메인 제약으로 JS/CSS 직접 조작 불가합니다.
 *   대신 iframe wrapper의 overflow:hidden + 클리핑 높이로 시각적으로 숨깁니다.
 *   → wrapper height: 370px (영상 영역만), iframe height: 430px (버튼까지 포함)
 *
 * [연계]
 *   - handleCctvMapClick()  — 마커 클릭 시 호출
 *   - cctv6.js CctvFavorites.has() — 즐겨찾기 등록 여부 확인 (별 버튼 상태)
 *   - closeCctvPopup()      — 닫기 버튼 / 배경 클릭 시 호출
 *   - PopupStack            — backbutton.js 뒤로가기 처리
 *
 * @param {Object} data — { cctvId, name, subtitle, providerName, shareUrl }
 */
function showCctvPopup(data) {
    const backdrop = document.getElementById('cctv-modal-backdrop');
    if (!backdrop) return;

    // 즐겨찾기 등록 여부에 따라 별 버튼 상태 결정
    // ★ 노란 채워진 별 = 등록됨, ☆ 빈 별 = 미등록
    const isFav = window.CctvFavorites && CctvFavorites.has(data.cctvId);
    const favIcon  = isFav ? 'fa-solid fa-star'   : 'fa-regular fa-star';
    const favColor = isFav ? '#fbbf24'             : 'rgba(255,255,255,0.6)';
    const favTitle = isFav ? '즐겨찾기 해제'        : '즐겨찾기 추가';

    // 모달 내부 HTML 구성
    backdrop.innerHTML = `
        <!-- 반투명 배경: 클릭 시 팝업 닫기 -->
        <div class="cctv-modal-overlay" onclick="closeCctvPopup()"></div>

        <!-- 모달 카드 -->
        <div class="cctv-modal-card">

            <!-- 헤더: 아이콘+이름/부제목 | KBS링크 | 즐겨찾기별 | 닫기 -->
            <div class="cctv-modal-header">

                <!-- 왼쪽: 카메라 아이콘 + 지점명 + 부제목 -->
                <div class="cctv-modal-title-wrap">
                    <i class="fa-solid fa-video cctv-modal-icon"></i>
                    <div class="cctv-modal-title-text">
                        <div class="cctv-modal-title">${data.name}</div>
                        <div class="cctv-modal-subtitle">${data.subtitle}</div>
                    </div>
                </div>

                <!-- 오른쪽: 외부 링크 버튼들 + 즐겨찾기 + 닫기 -->
                <div class="cctv-modal-actions">
                    <!-- KBS 재난포털 바로가기 (iframe에서 숨긴 버튼 대체) -->
                    <a class="cctv-action-btn"
                       href="https://d.kbs.co.kr/special/cctv"
                       target="_blank" rel="noopener noreferrer"
                       title="KBS 재난포털 열기">
                        KBS재난포털
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                    </a>

                    <!-- CCTV 더보기 바로가기 (iframe에서 숨긴 버튼 대체) -->
                    <a class="cctv-action-btn"
                       href="https://d.kbs.co.kr/special/cctv"
                       target="_blank" rel="noopener noreferrer"
                       title="CCTV 더보기">
                        CCTV더보기
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                    </a>

                    <!-- 즐겨찾기 별 버튼: 클릭 시 등록/해제 토글 -->
                    <button class="cctv-modal-fav-btn"
                            id="cctv-fav-toggle-btn"
                            onclick="toggleCctvFavorite(${data.cctvId}, '${data.name}', '${data.subtitle}', '${data.shareUrl}')"
                            title="${favTitle}">
                        <i class="${favIcon}" style="color: ${favColor};"></i>
                    </button>

                    <!-- 닫기 버튼 -->
                    <button class="cctv-modal-close-btn" onclick="closeCctvPopup()" title="닫기">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- iframe 영역: wrapper로 감싸서 하단 KBS 버튼을 클리핑 -->
            <!-- wrapper height(370px) < iframe height(430px) → 버튼 55px 잘림 -->
            <div class="cctv-modal-iframe-wrap">
                <iframe
                    id="cctv-modal-iframe"
                    src="${data.shareUrl}"
                    frameborder="0"
                    scrolling="no"
                    allowfullscreen
                    allow="autoplay; encrypted-media; fullscreen"
                    title="${data.name} CCTV 영상">
                </iframe>
            </div>

        </div>
    `;

    // 모달 표시 (display: flex → 배경+카드가 화면 위에 고정됨)
    backdrop.style.display = 'flex';

    // PopupStack 등록: 뒤로가기 버튼으로 모달 닫기 지원
    if (window.PopupStack) {
        PopupStack.push('cctv-popup', closeCctvPopup);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 닫기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 모달 팝업을 닫습니다.
 *
 * [iframe src를 먼저 비우는 이유]
 *   innerHTML을 지우기 전에 iframe src를 ''으로 바꿔야
 *   백그라운드 스트림 수신이 즉시 중단됩니다.
 *
 * [연계]
 *   - showCctvPopup() — 닫기 버튼 onclick, 배경 onclick
 *   - handleCctvMapClick() — 빈 지도 클릭 시
 *   - PopupStack — 뒤로가기 시 자동 호출
 */
function closeCctvPopup() {
    const backdrop = document.getElementById('cctv-modal-backdrop');
    if (!backdrop || backdrop.style.display === 'none') return;

    // iframe 스트림 즉시 중단
    const iframe = backdrop.querySelector('iframe');
    if (iframe) iframe.src = '';

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
 * [연계]
 *   - cctv6.js CctvFavorites.add() / remove() / has() — 실제 저장/삭제 처리
 *   - showCctvPopup() innerHTML — 버튼의 onclick에 직접 지정됨
 *
 * @param {number} cctvId   — 토글할 CCTV ID
 * @param {string} name     — CCTV 지점명
 * @param {string} subtitle — 상세 위치
 * @param {string} shareUrl — KBS cctvShare URL
 */
function toggleCctvFavorite(cctvId, name, subtitle, shareUrl) {
    if (!window.CctvFavorites) return;

    const btn = document.getElementById('cctv-fav-toggle-btn');
    if (!btn) return;

    if (CctvFavorites.has(cctvId)) {
        // ─── 이미 등록됨 → 제거 ───
        CctvFavorites.remove(cctvId);
        btn.title = '즐겨찾기 추가';
        btn.innerHTML = `<i class="fa-regular fa-star" style="color: rgba(255,255,255,0.6);"></i>`;
    } else {
        // ─── 미등록 → 추가 ───
        const added = CctvFavorites.add({ cctvId, name, subtitle, shareUrl });
        if (added) {
            btn.title = '즐겨찾기 해제';
            btn.innerHTML = `<i class="fa-solid fa-star" style="color: #fbbf24;"></i>`;
        }
    }
}
