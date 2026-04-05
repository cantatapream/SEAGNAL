// ====================================================================
// cctv6.js — CCTV 즐겨찾기 관리 모듈
//
// [역할]
//   팝업 헤더의 별(★) 버튼으로 CCTV 지점을 즐겨찾기에 등록/해제하고,
//   지도 오른쪽에 즐겨찾기 버튼 목록을 표시합니다.
//   클릭하면 해당 CCTV 팝업이 바로 열립니다.
//
// [데이터 저장]
//   localStorage 'cctv_favorites_v1' 키에 JSON 배열로 저장합니다.
//   브라우저를 닫았다 열어도 즐겨찾기가 유지됩니다.
//
// [UI 구조]
//   지도 오른쪽 (position: absolute, right: 8px):
//   ┌──────────────┐
//   │ 📷 가거도    │  ← 클릭 시 해당 CCTV 팝업 열기
//   │ 📷 속초      │
//   │ 📷 독도      │
//   └──────────────┘
//
// [연계]
//   - cctv2.js initCctvMap()  — 지도 초기화 시 CctvFavorites.init() 호출
//   - cctv4.js showCctvPopup() — 팝업 헤더의 별 버튼 상태 반영
//   - cctv4.js toggleCctvFavorite() — 별 버튼 클릭 시 add/remove 처리
//   - index.html #cctv-favorites-container — 버튼 목록이 렌더링되는 DOM
// ====================================================================

const CctvFavorites = {
    /** localStorage 저장 키 (tide_favorites_v1과 구분) */
    STORAGE_KEY: 'cctv_favorites_v1',

    /** 최대 즐겨찾기 개수 */
    MAX_COUNT: 6,

    /**
     * 각 항목: { cctvId, name, subtitle, providerKey, shareUrl, streamUrl, lat, lng }
     * providerKey — CCTV_PROVIDERS 키 (팝업 재열 시 type·links 조회용)
     * shareUrl    — iframe 방식 URL (KBS), HLS 방식이면 null
     * streamUrl   — HLS 방식 URL (거제시 등), iframe 방식이면 null
     * lat, lng    — 좌표 (즐겨찾기 클릭 시 지도 이동용)
     */
    items: [],

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 초기화: 페이지 로드 / 지도 초기화 시 1회 호출
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * localStorage에서 저장된 즐겨찾기를 불러오고 지도 오른쪽 목록을 렌더링합니다.
     * [연계] cctv2.js initCctvMap() — 지도 초기화 완료 직후 호출
     */
    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                this.items = JSON.parse(saved);
            }
        } catch (e) {
            console.error('[CCTV 즐겨찾기] 로드 실패:', e);
            this.items = [];
        }
        this.render();
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 저장: items 배열을 localStorage에 기록하고 화면을 갱신
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * 현재 items 배열을 localStorage에 저장하고 버튼 목록을 다시 그립니다.
     * add() / remove() 내부에서 호출됩니다.
     */
    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
        } catch (e) {
            console.error('[CCTV 즐겨찾기] 저장 실패:', e);
        }
        this.render();
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 추가
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * CCTV 지점을 즐겨찾기에 추가합니다.
     * [연계] cctv4.js toggleCctvFavorite() — 팝업 헤더 별 버튼 클릭 시 호출
     *
     * @param {{ cctvId, name, subtitle, shareUrl }} item — 추가할 CCTV 정보
     * @returns {boolean} — 추가 성공 여부 (최대 개수 초과 시 false)
     */
    add(item) {
        if (this.items.length >= this.MAX_COUNT) {
            alert(`즐겨찾기는 최대 ${this.MAX_COUNT}개까지 등록할 수 있습니다.`);
            return false;
        }
        // 이미 등록된 경우 중복 방지
        if (this.has(item.cctvId)) return false;

        this.items.push({
            cctvId:      item.cctvId,
            name:        item.name,
            subtitle:    item.subtitle,
            // 제공기관 키: 팝업 재열 시 CCTV_PROVIDERS[key] 로 type/links 조회
            providerKey: item.providerKey  || null,
            // KBS iframe URL (KBS면 값, HLS 제공기관이면 null)
            shareUrl:    item.shareUrl     || null,
            // HLS 스트림 URL (거제시 등이면 값, KBS면 null)
            streamUrl:   item.streamUrl    || null,
            // 카메라 채널 수 (부산 cnt=2, 연안침식 하맹방 cameraCount=2 등)
            cnt:         item.cnt          || '1',
            sensorName:  item.sensorName   || null,
            cameraCount: item.cameraCount  || 1,
            // 좌표: 즐겨찾기 클릭 시 지도 이동용
            lat:         item.lat  || null,
            lng:         item.lng  || null,
            // obsName: seafog(해무 CCTV) 전용 관측소명
            // 즐겨찾기에서 팝업 재열 시 /api/seafog-cctv?obs={obsName} 쿼리에 사용
            // seafog 이외 프로바이더는 null로 저장됨
            obsName:     item.obsName || null
        });
        this.save();
        return true;
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 제거
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * cctvId에 해당하는 즐겨찾기를 제거합니다.
     * [연계] cctv4.js toggleCctvFavorite() — 이미 등록된 경우 별 버튼 재클릭 시 호출
     *
     * @param {number} cctvId — 제거할 CCTV ID
     */
    remove(cctvId) {
        const idx = this.items.findIndex(i => i.cctvId === cctvId);
        if (idx === -1) return;
        this.items.splice(idx, 1);
        this.save();
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 등록 여부 확인
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * 해당 cctvId가 즐겨찾기에 등록되어 있는지 확인합니다.
     * [연계] cctv4.js showCctvPopup() — 팝업 열 때 별 버튼 채움/빔 상태 결정
     *
     * @param {number} cctvId
     * @returns {boolean}
     */
    has(cctvId) {
        return this.items.some(i => i.cctvId === cctvId);
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 렌더링: 지도 오른쪽 즐겨찾기 버튼 목록 갱신
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * 지도 오른쪽 #cctv-favorites-container에 즐겨찾기 버튼 목록을 다시 그립니다.
     * - 즐겨찾기가 없으면 컨테이너를 숨깁니다.
     * - 버튼 클릭 시 해당 CCTV 팝업이 열립니다.
     * [연계] save() — 추가/제거 후 자동 호출
     * [연계] init() — 초기 로드 후 호출
     */
    render() {
        const container = document.getElementById('cctv-favorites-container');
        if (!container) return;

        if (this.items.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = '';

        this.items.forEach((item) => {
            const btn = document.createElement('div');
            btn.className = 'cctv-fav-btn';

            // 버튼 클릭 → 지도 부드럽게 이동 후 팝업 등장
            btn.onclick = () => {
                // 열린 팝업이 있으면 먼저 닫기
                if (typeof closeCctvPopup === 'function') closeCctvPopup();

                // lat/lng 없으면 (이전에 저장된 즐겨찾기) 벡터소스에서 Feature 좌표 보완
                if ((!item.lat || !item.lng) && typeof _cctvClusterSource !== 'undefined' && _cctvClusterSource) {
                    const vectorSource = _cctvClusterSource.getSource ? _cctvClusterSource.getSource() : null;
                    if (vectorSource) {
                        const match = vectorSource.getFeatures().find(f => String(f.get('cctvId')) === String(item.cctvId));
                        if (match) {
                            const coords = ol.proj.toLonLat(match.getGeometry().getCoordinates());
                            item.lng = coords[0];
                            item.lat = coords[1];
                        }
                    }
                }

                if (cctvMap && item.lat && item.lng) {
                    const dest = ol.proj.fromLonLat([parseFloat(item.lng), parseFloat(item.lat)]);
                    const view = cctvMap.getView();
                    const curZoom = view.getZoom() || 6;
                    const targetZoom = 13;

                    // 현재 위치에서 멀면 2단계: 먼저 이동, 그다음 확대
                    if (curZoom < 9) {
                        view.animate(
                            { center: dest, duration: 700 },
                            { zoom: targetZoom, duration: 700 },
                            function () {
                                if (typeof showCctvPopup === 'function') showCctvPopup(item);
                            }
                        );
                    } else {
                        // 이미 확대된 상태: 이동+줌 동시
                        view.animate(
                            { center: dest, zoom: targetZoom, duration: 800 },
                            function () {
                                if (typeof showCctvPopup === 'function') showCctvPopup(item);
                            }
                        );
                    }
                } else if (typeof showCctvPopup === 'function') {
                    showCctvPopup(item);
                }
            };

            // 별 아이콘(★) + 지점명 표시
            btn.innerHTML = `
                <i class="fa-solid fa-star" style="color: #fbbf24; font-size: 0.75rem;"></i>
                <span>${item.name}</span>
            `;
            container.appendChild(btn);
        });
    }
};

// 전역으로 노출 (cctv4.js에서 toggleCctvFavorite 등으로 접근)
window.CctvFavorites = CctvFavorites;
