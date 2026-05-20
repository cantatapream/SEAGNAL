// ===========================
// 조석 예측 지도 (tide.js)
// index.html 스타일에 맞춘 통합 버전
// ===========================

// 전역 변수
let tideMap = null;
let tidePopupOverlay = null;
let tideStationLayer = null;
let favoriteLayer = null; // 즐겨찾기 마커 레이어
let myLocationLayer = null;
let searchResultLayer = null; // 검색 결과 마커 레이어

// 마지막 클릭 위치 저장 (날짜 변경 시 팝업 업데이트용)
let lastClickedCoordinate = null;
let lastClickedLonLat = null;
let currentTideDate = new Date(); // 초기 날짜를 오늘로 설정

// 즐겨찾기 모달 제어 함수
window.openTideFavModal = function (type, options) {
    const modal = document.getElementById('tide-fav-modal');
    const title = document.getElementById('tide-fav-modal-title');
    const message = document.getElementById('tide-fav-modal-message');
    const inputContainer = document.getElementById('tide-fav-input-container');
    const nameInput = document.getElementById('tide-fav-name-input');
    const confirmBtn = document.getElementById('tide-fav-modal-confirm');

    if (!modal) return;

    modal.classList.remove('hidden');

    if (type === 'add') {
        title.innerHTML = '<i class="fa-solid fa-star" style="color: #FFD700;"></i> 즐겨찾기 추가';
        message.innerText = '이 위치를 즐겨찾기에 등록하시겠습니까? 이름을 입력해주세요.';
        inputContainer.style.display = 'block';
        if (nameInput) {
            nameInput.value = '';
            setTimeout(() => nameInput.focus(), 100);
            nameInput.onkeydown = (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') window.closeTideFavModal();
            };
        }

        confirmBtn.onclick = () => {
            const name = nameInput ? nameInput.value.trim() : '';
            if (!name) {
                alert('즐겨찾기 이름을 입력해주세요.');
                if (nameInput) nameInput.focus();
                return;
            }
            if (options.onConfirm) options.onConfirm(name);
            window.closeTideFavModal();
        };
    } else if (type === 'remove') {
        title.innerHTML = '<i class="fa-solid fa-trash-can" style="color: #ff5252;"></i> 즐겨찾기 해제';
        message.innerText = `'${options.name}' 즐겨찾기를 삭제하시겠습니까?`;
        inputContainer.style.display = 'none';

        confirmBtn.focus();
        confirmBtn.onclick = () => {
            if (options.onConfirm) options.onConfirm();
            window.closeTideFavModal();
        };
    }
};

window.closeTideFavModal = function () {
    const modal = document.getElementById('tide-fav-modal');
    if (modal) modal.classList.add('hidden');
};

// [New] 내 위치 버튼 최적화용 캐시 변수
let _lastKnownLocation = null;
let _lastLocationTimestamp = 0;
const LOCATION_CACHE_LIMIT = 10000; // 10초

// ===== 조석 즐겨찾기 관리 =====
const TideFavorites = {
    STORAGE_KEY: 'tide_favorites_v1',
    maxCount: 4,
    items: [],

    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                this.items = JSON.parse(saved);
            }
        } catch (e) {
            console.error('즐겨찾기 로드 실패:', e);
        }
        this.render();
    },

    save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
        this.render();
    },

    add(name, lat, lon) {
        if (this.items.length >= this.maxCount) {
            alert(`즐겨찾기는 최대 ${this.maxCount}개까지만 등록할 수 있습니다.`);
            return false;
        }
        this.items.push({ name, lat, lon });
        this.save();
        return true;
    },

    remove(index, askConfirm = true) {
        if (askConfirm) {
            confirmTideFavoriteDelete(index);
            return;
        }
        this.items.splice(index, 1);
        this.save();
    },

    render() {
        const container = document.getElementById('tide-favorites-container');

        // 지도 마커 업데이트 (지도가 초기화된 상태라면)
        if (typeof updateFavoriteMarkers === 'function') {
            updateFavoriteMarkers();
        }

        if (!container) return;

        if (this.items.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = '';

        this.items.forEach((item, index) => {
            const btn = document.createElement('div');
            btn.className = 'tide-fav-btn';
            btn.onclick = () => TideFavorites.moveTo(item.lat, item.lon);
            btn.innerHTML = `
                <i class="fa-solid fa-map-pin" style="color: #f87171; font-size: 0.8rem;"></i>
                <span>${item.name}</span>
            `;
            container.appendChild(btn);
        });
    },

    moveTo(lat, lon) {
        if (!tideMap) return;

        // 기존 팝업 닫기 (새로운 팝업이 열리도록 보장)
        if (tidePopupOverlay) {
            tidePopupOverlay.setPosition(undefined);
        }

        // 지도 이동
        const center = ol.proj.fromLonLat([parseFloat(lon), parseFloat(lat)]);
        tideMap.getView().animate({ center: center, zoom: 10, duration: 500 });

        // 팝업 열기 (약간의 지연 후)
        setTimeout(() => {
            const coordinate = center;
            // 시뮬레이션: handleTideMapClick 로직 재사용
            handleTideMapClick({ coordinate: coordinate });
        }, 600);
    }
};

// 전역 노출
window.TideFavorites = TideFavorites;

// ===== 조석 데이터 동적 로딩 =====
const loadedYears = new Set();
async function loadTideData(year) {
    if (!year) return false;
    if (window.TIDE_DATA_STORAGE && window.TIDE_DATA_STORAGE[year]) return true;
    if (loadedYears.has(year)) return false; // 이미 시도했으나 실패한 경우 등 중복 방지

    return new Promise((resolve) => {
        console.log(`📡 ${year}년 조석 데이터를 불러옵니다...`);
        const script = document.createElement('script');
        script.src = `tide_data/tide_data_${year}.js`;
        script.onload = () => {
            loadedYears.add(year);
            console.log(`✅ ${year}년 데이터 로드 완료`);
            resolve(true);
        };
        script.onerror = () => {
            loadedYears.add(year);
            console.warn(`❌ ${year}년 데이터를 찾을 수 없습니다.`);
            resolve(false);
        };
        document.head.appendChild(script);
    });
}
window.loadTideData = loadTideData;

// 표준항 목록 (tide_map_fixed.html에서 복사)
const TIDE_REFERENCE_STATIONS = [
    { code: "DT_0001", name: "인천", lat: 37.451, lon: 126.592 },
    { code: "DT_0002", name: "평택", lat: 36.966, lon: 126.822 },
    { code: "DT_0003", name: "영광", lat: 35.426, lon: 126.42 },
    { code: "DT_0004", name: "제주", lat: 33.527, lon: 126.543 },
    { code: "DT_0005", name: "부산", lat: 35.096, lon: 129.035 },
    { code: "DT_0006", name: "묵호", lat: 37.55, lon: 129.116 },
    { code: "DT_0007", name: "목포", lat: 34.779, lon: 126.375 },
    { code: "DT_0008", name: "안산", lat: 37.192, lon: 126.647 },
    { code: "DT_0010", name: "서귀포", lat: 33.24, lon: 126.561 },
    { code: "DT_0011", name: "후포", lat: 36.677, lon: 129.453 },
    { code: "DT_0012", name: "속초", lat: 38.207, lon: 128.594 },
    { code: "DT_0013", name: "울릉도", lat: 37.491, lon: 130.913 },
    { code: "DT_0014", name: "통영", lat: 34.827, lon: 128.434 },
    { code: "DT_0016", name: "여수", lat: 34.747, lon: 127.765 },
    { code: "DT_0017", name: "대산", lat: 37.007, lon: 126.352 },
    { code: "DT_0018", name: "군산", lat: 35.975, lon: 126.563 },
    { code: "DT_0020", name: "울산", lat: 35.501, lon: 129.387 },
    { code: "DT_0021", name: "추자도", lat: 33.961, lon: 126.3 },
    { code: "DT_0022", name: "성산포", lat: 33.474, lon: 126.927 },
    { code: "DT_0023", name: "모슬포", lat: 33.214, lon: 126.251 },
    { code: "DT_0024", name: "장항", lat: 36.006, lon: 126.687 },
    { code: "DT_0025", name: "보령", lat: 36.406, lon: 126.486 },
    { code: "DT_0026", name: "고흥발포", lat: 34.481, lon: 127.342 },
    { code: "DT_0027", name: "완도", lat: 34.315, lon: 126.759 },
    { code: "DT_0028", name: "진도", lat: 34.9667, lon: 127.9667 },
    { code: "DT_0029", name: "거제도", lat: 34.801, lon: 128.699 },
    { code: "DT_0031", name: "거문도", lat: 34.027, lon: 127.308 },
    { code: "DT_0032", name: "강화대교", lat: 37.75, lon: 126.5 },
    { code: "DT_0035", name: "흑산도", lat: 34.6833, lon: 125.4333 },
    { code: "DT_0036", name: "대청도", lat: 37.8333, lon: 124.7 },
    { code: "DT_0037", name: "어청도", lat: 36.117, lon: 125.984 },
    { code: "DT_0038", name: "굴업도", lat: 37.2000, lon: 126.0000 },
    { code: "DT_0039", name: "왕돌초", lat: 36.7167, lon: 129.7167 },
    { code: "DT_0040", name: "독도", lat: 37.2333, lon: 131.8667 },
    { code: "DT_0041", name: "복사초", lat: 34.0833, lon: 126.1667 },
    { code: "DT_0042", name: "교본초", lat: 34.7000, lon: 128.3000 },
    { code: "DT_0043", name: "영흥도", lat: 37.25, lon: 126.4833 },
    { code: "DT_0044", name: "영종대교", lat: 37.5667, lon: 126.5833 },
    { code: "DT_0046", name: "쌍정초", lat: 37.5500, lon: 130.9333 },
    { code: "DT_0047", name: "도농탄", lat: 33.1500, lon: 126.2667 },
    { code: "DT_0048", name: "속초등표", lat: 38.2167, lon: 128.6 },
    { code: "DT_0049", name: "광양", lat: 34.9, lon: 127.7 },
    { code: "DT_0050", name: "태안", lat: 36.9167, lon: 126.2333 },
    { code: "DT_0051", name: "서천마량", lat: 36.1333, lon: 126.5 },
    { code: "DT_0052", name: "인천송도", lat: 37.338, lon: 126.586 },
    { code: "DT_0054", name: "진해", lat: 35.15, lon: 128.6667 },
    { code: "DT_0056", name: "부산항신항", lat: 35.0833, lon: 128.8333 },
    { code: "DT_0057", name: "동해항", lat: 37.5, lon: 129.1333 },
    { code: "DT_0058", name: "경인항", lat: 37.5667, lon: 126.6 },
    { code: "DT_0059", name: "백령도", lat: 37.955, lon: 124.736 },
    { code: "DT_0060", name: "연평도", lat: 37.657, lon: 125.714 },
    { code: "DT_0061", name: "삼천포", lat: 34.9167, lon: 128.0667 },
    { code: "DT_0062", name: "마산", lat: 35.2, lon: 128.5833 },
    { code: "DT_0063", name: "가덕도", lat: 35.0167, lon: 128.8333 },
    { code: "DT_0064", name: "교동대교", lat: 37.789, lon: 126.339 },
    { code: "DT_0065", name: "덕적도", lat: 37.2333, lon: 126.15 },
    { code: "DT_0067", name: "안흥", lat: 36.6833, lon: 126.1167 },
    { code: "DT_0068", name: "위도", lat: 35.618, lon: 126.301 },
    { code: "DT_0091", name: "포항", lat: 36.05, lon: 129.3833 },
    { code: "DT_0092", name: "여호항", lat: 34.6667, lon: 127.4667 },
    { code: "DT_0093", name: "소무의도", lat: 37.373, lon: 126.44 },
    { code: "DT_0094", name: "서거차도", lat: 34.251, lon: 125.915 },
    { code: "IE_0061", name: "신안가거초", lat: 33.9500, lon: 124.6000 },
    { code: "IE_0062", name: "옹진소청초", lat: 37.4167, lon: 124.7333 },
    { code: "SO_0326", name: "미조항", lat: 34.7167, lon: 128.05 },
    { code: "SO_0537", name: "벽파진", lat: 34.539, lon: 126.346 },
    { code: "SO_0538", name: "안마도", lat: 35.3500, lon: 126.0167 },
    { code: "SO_0539", name: "강화외포", lat: 37.7, lon: 126.3833 },
    { code: "SO_0540", name: "호산항", lat: 37.176, lon: 129.342 },
    { code: "SO_0547", name: "말도", lat: 35.855, lon: 126.318 },
    { code: "SO_0548", name: "우이도", lat: 34.6167, lon: 125.8500 },
    { code: "SO_0549", name: "초도", lat: 34.2167, lon: 127.25 },
    { code: "SO_0550", name: "나로도", lat: 34.463, lon: 127.453 },
    { code: "SO_0551", name: "여서도", lat: 33.988, lon: 126.923 },
    { code: "SO_0552", name: "고현항", lat: 34.901, lon: 128.622 },
    { code: "SO_0553", name: "해운대", lat: 35.16, lon: 129.191 },
    { code: "SO_0554", name: "영종왕산", lat: 37.45, lon: 126.3667 },
    { code: "SO_0555", name: "서망항", lat: 34.366, lon: 126.134 },
    { code: "SO_0562", name: "승봉도", lat: 37.169, lon: 126.29 },
    { code: "SO_0563", name: "울도", lat: 37.035, lon: 125.995 },
    { code: "SO_0564", name: "국화도", lat: 37.06, lon: 126.56 },
    { code: "SO_0565", name: "향화도항", lat: 35.167, lon: 126.359 },
    { code: "SO_0566", name: "송공항", lat: 34.848, lon: 126.225 },
    { code: "SO_0567", name: "쉬미항", lat: 34.504, lon: 126.183 },
    { code: "SO_0568", name: "백야도", lat: 34.624, lon: 127.632 },
    { code: "SO_0569", name: "남포항", lat: 34.9500, lon: 128.3167 },
    { code: "SO_0570", name: "광암항", lat: 35.1000, lon: 128.5000 },
    { code: "SO_0571", name: "거제외포", lat: 34.939, lon: 128.718 },
    { code: "SO_0572", name: "읍천항", lat: 35.6833, lon: 129.4833 },
    { code: "SO_0573", name: "양포항", lat: 35.881, lon: 129.527 },
    { code: "SO_0574", name: "백사장항", lat: 36.586, lon: 126.315 },
    { code: "SO_0576", name: "화봉리", lat: 34.661, lon: 126.256 },
    { code: "SO_0577", name: "가거도", lat: 34.05, lon: 125.128 },
    { code: "SO_0578", name: "소매물도", lat: 34.621, lon: 128.548 },
    { code: "SO_0581", name: "강양항", lat: 35.39, lon: 129.344 },
    { code: "SO_0631", name: "암태도", lat: 34.853, lon: 126.071 },
    { code: "SO_0699", name: "천리포항", lat: 36.8, lon: 126.15 },
    { code: "SO_0700", name: "호도", lat: 36.303, lon: 126.264 },
    { code: "SO_0701", name: "홍도항", lat: 34.681, lon: 125.195 },
    { code: "SO_0702", name: "진도옥도", lat: 34.35, lon: 126.018 },
    { code: "SO_0703", name: "땅끝항", lat: 34.3000, lon: 126.5333 },
    { code: "SO_0704", name: "소안항", lat: 34.1500, lon: 127.6333 },
    { code: "SO_0705", name: "마량항", lat: 34.448, lon: 126.821 },
    { code: "SO_0706", name: "청산도", lat: 34.18, lon: 126.856 },
    { code: "SO_0707", name: "시산항", lat: 34.394, lon: 127.261 },
    { code: "SO_0708", name: "안도항", lat: 34.479, lon: 127.797 },
    { code: "SO_0709", name: "두문포", lat: 34.643, lon: 127.797 },
    { code: "SO_0710", name: "봉우항", lat: 34.9333, lon: 127.9333 },
    { code: "SO_0711", name: "창선도", lat: 34.8333, lon: 128.0167 },
    { code: "SO_0712", name: "능양항", lat: 34.8167, lon: 128.2500 },
    { code: "SO_0731", name: "대진항", lat: 38.501, lon: 128.426 },
    { code: "SO_0732", name: "남애항", lat: 37.944, lon: 128.788 },
    { code: "SO_0733", name: "강릉항", lat: 37.772, lon: 128.951 },
    { code: "SO_0734", name: "궁촌항", lat: 37.327, lon: 129.27 },
    { code: "SO_0735", name: "죽변항", lat: 37.054, lon: 129.423 },
    { code: "SO_0736", name: "축산항", lat: 36.509, lon: 129.448 },
    { code: "SO_0737", name: "강구항", lat: 36.358, lon: 129.391 },
    { code: "SO_0739", name: "도장항", lat: 34.3667, lon: 127.0167 },
    { code: "SO_0740", name: "보옥항", lat: 34.1333, lon: 126.5167 },
    { code: "SO_0752", name: "검산항", lat: 35.0000, lon: 126.1000 },
    { code: "SO_0753", name: "하의도웅곡", lat: 34.608, lon: 126.038 },
    { code: "SO_0754", name: "평호리", lat: 34.448, lon: 126.455 },
    { code: "SO_0755", name: "원동항", lat: 34.393, lon: 126.648 },
    { code: "SO_0756", name: "사초항", lat: 34.4667, lon: 126.7667 },
    { code: "SO_0757", name: "안남리", lat: 34.73, lon: 127.264 },
    { code: "SO_0758", name: "달천도", lat: 34.7667, lon: 127.5667 },
    { code: "SO_0759", name: "장문리", lat: 34.873, lon: 128.424 },
    { code: "SO_0760", name: "오산항", lat: 36.888, lon: 129.416 },
    { code: "SO_0761", name: "녹동항", lat: 34.5333, lon: 127.1333 },
    { code: "SO_1248", name: "신안옥도", lat: 34.683, lon: 126.064 },
    { code: "SO_1249", name: "독거도", lat: 34.2333, lon: 126.1667 },
    { code: "SO_1250", name: "평도", lat: 34.2500, lon: 127.4500 },
    { code: "SO_1251", name: "낙월도", lat: 35.2, lon: 126.145 },
    { code: "SO_1252", name: "외연도항", lat: 36.225, lon: 126.081 },
    { code: "SO_1253", name: "상왕등도", lat: 35.6667, lon: 126.1167 },
    { code: "SO_1254", name: "만재도", lat: 34.2, lon: 125.4667 },
    { code: "SO_1255", name: "상태도", lat: 34.4333, lon: 125.2833 },
    { code: "SO_1256", name: "어류정항", lat: 37.643, lon: 126.342 },
    { code: "SO_1257", name: "강화하리", lat: 37.78, lon: 126.43 },
    { code: "SO_1258", name: "잠진도", lat: 37.4167, lon: 126.4167 },
    { code: "SO_1259", name: "자월도", lat: 37.25, lon: 126.3167 },
    { code: "SO_1260", name: "방포항", lat: 36.5, lon: 126.3333 },
    { code: "SO_1261", name: "무창포항", lat: 36.25, lon: 126.5333 },
    { code: "SO_1262", name: "격포항", lat: 35.6167, lon: 126.4667 },
    { code: "SO_1263", name: "구시포항", lat: 35.4333, lon: 126.4333 },
    { code: "SO_1264", name: "계마항", lat: 35.4, lon: 126.4 },
    { code: "SO_1265", name: "송이도", lat: 35.271, lon: 126.15 },
    { code: "SO_1266", name: "남열항", lat: 34.576, lon: 127.48 },
    { code: "SO_1267", name: "구룡포항", lat: 35.99, lon: 129.555 },
    { code: "SO_1268", name: "궁평항", lat: 37.117, lon: 126.68 },
    { code: "SO_1269", name: "연도항", lat: 36.0833, lon: 126.4500 },
    { code: "SO_1270", name: "삼길포항", lat: 37.004, lon: 126.452 },
    { code: "SO_1271", name: "어은돌항", lat: 36.7500, lon: 126.1333 },
    { code: "SO_1272", name: "다대포항", lat: 35.0500, lon: 128.9833 },
    { code: "SO_1273", name: "장호항", lat: 37.288, lon: 129.317 },
    { code: "SO_1274", name: "거진항", lat: 38.446, lon: 128.456 },
    { code: "SO_1275", name: "공현진항", lat: 38.355, lon: 128.513 },
    { code: "SO_1276", name: "아야진항", lat: 38.27, lon: 128.557 },
    { code: "SO_1277", name: "화순항", lat: 33.2333, lon: 126.3333 },
    { code: "SO_1278", name: "원평항", lat: 34.7833, lon: 125.9167 },
    { code: "SO_1279", name: "어란진항", lat: 34.348, lon: 126.475 },
    { code: "SO_1280", name: "덕산항", lat: 37.377, lon: 129.253 },
    { code: "SO_1281", name: "임원항", lat: 37.228, lon: 129.343 },
    { code: "SO_1282", name: "선재도", lat: 37.253, lon: 126.509 },
    { code: "SO_1283", name: "사천진항", lat: 37.875, lon: 128.875 }
];

let stationData = TIDE_REFERENCE_STATIONS;

// ===== 내 위치 마커 업데이트 =====
function updateMyLocationMarker(lat, lon) {
    if (!tideMap) return;

    if (!myLocationLayer) {
        myLocationLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            zIndex: 1000,
            style: function (feature) {
                return [
                    // 1. 가장 바깥쪽 은은한 글로우 (Blur 효과)
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 15,
                            fill: new ol.style.Fill({ color: 'rgba(0, 123, 255, 0.15)' })
                        })
                    }),
                    // 2. 중간 단계 글로우
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 12,
                            fill: new ol.style.Fill({ color: 'rgba(0, 123, 255, 0.25)' })
                        })
                    }),
                    // 3. 두꺼운 흰색 테두리 (이미지 2 핵심 스타일)
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 9,
                            fill: new ol.style.Fill({ color: '#ffffff' }),
                            stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 0, 0.05)', width: 1 })
                        })
                    }),
                    // 4. 중심 파란색 점
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 6,
                            fill: new ol.style.Fill({ color: '#007bff' })
                        })
                    })
                ];
            }
        });
        tideMap.addLayer(myLocationLayer);
    }

    const source = myLocationLayer.getSource();
    source.clear();

    const feature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([parseFloat(lon), parseFloat(lat)]))
    });
    source.addFeature(feature);

    // [New] 깜빡이는 효과를 위한 애니메이션 클래스 추가 (Overlay 방식 권장되나 스타일로 먼저 구현)
    // 실제 CSS 애니메이션 효과를 위해 지도 컨테이너에 클래스 부여 가능
}

// ===== 조석 지도 위치 검색 (서버 프록시 방식) =====

// 검색 타이머 (과도한 API 호출 방지용 - 0.3초 대기)
let _tideSearchTimer = null;

/**
 * 조석 지도 위치 검색 초기화
 * - Kakao Maps SDK를 로드하고
 * - 검색 입력창에 이벤트를 연결합니다
 * - initTideMap()에서 호출됩니다
 */
function initTideSearch() {
    const input = document.getElementById('tide-search-input');
    const clearBtn = document.getElementById('tide-search-clear');
    if (!input) return;

    // 검색 입력 이벤트: 글자를 입력할 때마다 0.3초 후 검색 실행
    input.addEventListener('input', function () {
        const query = input.value.trim();

        // X(지우기) 버튼 표시/숨김 제어
        if (clearBtn) {
            clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        }

        // 기존 대기 중인 검색 취소 (과도한 호출 방지)
        if (_tideSearchTimer) clearTimeout(_tideSearchTimer);

        // 2글자 미만이면 드롭다운 닫기
        if (query.length < 2) {
            closeTideSearchDropdown();
            return;
        }

        // 0.3초 후 검색 실행 (빠르게 연속 입력 시 마지막 입력만 실행)
        _tideSearchTimer = setTimeout(function () {
            searchKakaoPlaces(query);
        }, 300);
    });

    // X(지우기) 버튼 클릭 시 검색어 초기화
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            clearTideSearch();
        });
    }

    // ESC 키로 드롭다운 닫기
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeTideSearchDropdown();
            input.blur();
        }
    });

    // 검색창 외부 클릭 시 드롭다운 닫기
    document.addEventListener('click', function (e) {
        const container = document.querySelector('.tide-search-container');
        if (container && !container.contains(e.target)) {
            closeTideSearchDropdown();
        }
    });
}

/**
 * 위치 검색 실행 (서버 프록시 방식)
 * - 브라우저가 직접 Kakao에 요청하지 않고 우리 서버를 통해 검색합니다
 * - 이 방식은 도메인 인증 문제 없이 어떤 환경(로컬/배포/앱)에서도 동작합니다
 * @param {string} query - 사용자가 입력한 검색어 (예: "속초항")
 */
async function searchKakaoPlaces(query) {
    // 드롭다운에 "검색 중..." 표시
    renderTideSearchMessage('검색 중...');

    try {
        // 서버의 검색 프록시 엔드포인트 호출
        const res = await fetch(`/api/search-place?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!res.ok) {
            // 서버가 오류 응답을 보낸 경우 (예: API 키 미설정)
            renderTideSearchMessage(data.error || '검색 서비스를 사용할 수 없습니다');
            return;
        }

        if (!data.documents || data.documents.length === 0) {
            // 검색 결과 없음
            renderTideSearchMessage('검색 결과가 없습니다');
            return;
        }

        // 검색 결과 드롭다운에 표시
        renderTideSearchResults(data.documents);

    } catch (err) {
        // 네트워크 오류 등
        console.error('[tide-search] 검색 오류:', err.message);
        renderTideSearchMessage('검색 중 오류가 발생했습니다');
    }
}

/**
 * 검색 결과를 드롭다운 목록에 표시
 * - 각 장소를 클릭 가능한 항목으로 만듭니다
 * - 장소명과 주소를 "도 > 시 > 구 > 동" 형태로 표시합니다
 * @param {Array} places - Kakao API가 반환한 장소 배열
 */
function renderTideSearchResults(places) {
    const dropdown = document.getElementById('tide-search-dropdown');
    if (!dropdown) return;

    // 드롭다운 내용 비우기
    dropdown.innerHTML = '';

    places.forEach(function (place) {
        // 주소를 "도 > 시 > 구 > 동" 형태로 변환
        // 예: "강원특별자치도 속초시 중앙동" → "강원특별자치도 > 속초시 > 중앙동"
        const addr = place.address_name || '';
        const addrFormatted = addr.split(' ').join(' > ');

        // 클릭 가능한 항목 생성
        const item = document.createElement('div');
        item.className = 'tide-search-item';
        item.innerHTML = `
            <div class="tide-search-item-name"><i class="fa-solid fa-location-dot"></i>${place.place_name}</div>
            <div class="tide-search-item-addr">${addrFormatted}</div>
        `;

        // 항목 클릭 시 해당 위치로 지도 이동
        item.addEventListener('click', function () {
            selectTideSearchResult(
                parseFloat(place.y),  // 위도
                parseFloat(place.x),  // 경도
                place.place_name      // 장소명
            );
        });

        dropdown.appendChild(item);
    });

    // 드롭다운 열기
    dropdown.style.display = 'block';
}

/**
 * 드롭다운에 메시지 표시 (검색 중, 결과 없음 등)
 * @param {string} msg - 표시할 메시지
 */
function renderTideSearchMessage(msg) {
    const dropdown = document.getElementById('tide-search-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = `<div class="tide-search-empty">${msg}</div>`;
    dropdown.style.display = 'block';
}

/**
 * 검색 결과 항목 클릭 시 호출
 * - 지도를 해당 위치로 부드럽게 이동합니다
 * - 검색창에 선택한 장소명을 표시합니다
 * @param {number} lat - 위도 (예: 38.207)
 * @param {number} lon - 경도 (예: 128.593)
 * @param {string} name - 장소명 (예: "속초항")
 */
function showTideToast(message, anchorCoord, duration = 3000) {
    let toast = document.getElementById('tide-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'tide-toast';
        toast.style.cssText = [
            'position:fixed', 'background:rgba(30,30,30,0.88)', 'color:#fff',
            'padding:10px 20px', 'border-radius:20px', 'font-size:13px',
            'z-index:9999', 'pointer-events:none', 'transition:opacity 0.3s',
            'white-space:nowrap', 'transform:translateX(-50%)'
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.textContent = message;

    // 마커 좌표가 주어지면 마커 아래에 배치, 아니면 화면 하단 기본 위치
    if (anchorCoord && tideMap) {
        const pixel = tideMap.getPixelFromCoordinate(anchorCoord);
        // pixel이 null이면 좌표가 현재 뷰포트 밖이거나 지도가 아직 렌더링되지 않은 상태
        // → fallback으로 화면 중앙 하단에 표시
        if (pixel) {
            const mapEl = tideMap.getTargetElement();
            const mapRect = mapEl.getBoundingClientRect();
            const screenX = mapRect.left + pixel[0];
            const screenY = mapRect.top + pixel[1];
            toast.style.left = screenX + 'px';
            toast.style.top = (screenY + 50) + 'px'; // 마커에서 50px 아래
            toast.style.bottom = '';
        } else {
            // 지도 뷰포트 밖이거나 미렌더링 상태: 화면 중앙 하단 fallback
            toast.style.left = '50%';
            toast.style.top = '';
            toast.style.bottom = '80px';
        }
    } else {
        toast.style.left = '50%';
        toast.style.top = '';
        toast.style.bottom = '80px';
    }

    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

/**
 * 조석 검색 결과 항목 클릭 시 — 검색창 텍스트 갱신 + 지도 이동 + 조석 팝업 표출.
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @param {string} name - 표시명 (예: 부산항)
 */
function selectTideSearchResult(lat, lon, name) {
    // 검색창에 선택한 장소명 표시
    const input = document.getElementById('tide-search-input');
    if (input) input.value = name;

    // 드롭다운 닫기
    closeTideSearchDropdown();

    // 지도가 없으면 중단
    if (!tideMap) return;

    // OpenLayers 좌표로 변환 후 부드럽게 이동 (약 0.8초 애니메이션)
    const targetCenter = ol.proj.fromLonLat([lon, lat]);
    tideMap.getView().animate({
        center: targetCenter,
        zoom: 13,       // 해안가 세부 지역이 잘 보이는 줌 레벨
        duration: 800    // 이동 애니메이션 0.8초
    });

    // 검색 결과 마커 표시
    if (!searchResultLayer) {
        searchResultLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            zIndex: 900,
            style: function (feature) {
                const label = feature.get('name') || '';
                return [
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 14,
                            fill: new ol.style.Fill({ color: 'rgba(255, 80, 80, 0.15)' })
                        })
                    }),
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 10,
                            fill: new ol.style.Fill({ color: '#ffffff' }),
                            stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.08)', width: 1 })
                        })
                    }),
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 6,
                            fill: new ol.style.Fill({ color: '#ff4444' })
                        }),
                        text: new ol.style.Text({
                            text: label,
                            offsetY: -22,
                            font: 'bold 12px sans-serif',
                            fill: new ol.style.Fill({ color: '#ffffff' }),
                            backgroundFill: new ol.style.Fill({ color: 'rgba(255,68,68,0.85)' }),
                            padding: [2, 6, 2, 6],
                            backgroundStroke: new ol.style.Stroke({ color: 'rgba(255,68,68,0.9)', width: 1 })
                        })
                    })
                ];
            }
        });
        tideMap.addLayer(searchResultLayer);
    }

    const source = searchResultLayer.getSource();
    source.clear();
    const searchFeature = new ol.Feature({ geometry: new ol.geom.Point(targetCenter) });
    searchFeature.set('name', name);
    source.addFeature(searchFeature);

    // 토스트 안내 메시지 (마커 아래에 표시)
    showTideToast('인근 바다를 눌러서 조석을 확인해보세요!', targetCenter);
}

/**
 * 드롭다운 닫기 (결과 목록 숨기기)
 */
function closeTideSearchDropdown() {
    const dropdown = document.getElementById('tide-search-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
    }
}

/**
 * 검색어 초기화 (X 버튼 클릭 시)
 * - 입력창 비우기, X 버튼 숨기기, 드롭다운 닫기
 */
function clearTideSearch() {
    const input = document.getElementById('tide-search-input');
    const clearBtn = document.getElementById('tide-search-clear');

    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) clearBtn.style.display = 'none';

    closeTideSearchDropdown();
}

// ===== 조석 지도 초기화 =====
function initTideMap() {
    if (tideMap) {
        tideMap.updateSize();
        return;
    }

    try {
        // 즐겨찾기 먼저 로드 (초기 중심 좌표 설정을 위해)
        TideFavorites.init();

        // 팝업 요소 생성 (지도 컨테이너에 직접 추가)
        const popupElement = document.createElement('div');
        popupElement.id = 'tide-popup-container';
        popupElement.style.display = 'none';

        // [UI Change] 팝업 전체 위치 하향 조정 (안내 문구와 겹침 방지 - 과도하지 않게 조정)
        popupElement.style.marginTop = '20px'; // 지도 상단에서 살짝만 떨어뜨림

        const mapContainer = document.getElementById('tide-map');
        if (!mapContainer) return;

        mapContainer.appendChild(popupElement);

        // OpenLayers 오버레이
        tidePopupOverlay = {
            element: popupElement,
            getElement: () => popupElement,
            setPosition: (pos) => {
                if (pos) {
                    popupElement.style.display = 'block';
                    // 뒤로가기 버튼으로 팝업 닫기 지원
                    if (window.PopupStack) {
                        PopupStack.push('tide-popup', function () {
                            stopGaugeAutoRefresh();
                            tidePopupOverlay.setPosition(undefined);
                        });
                    }
                } else {
                    popupElement.style.display = 'none';
                    if (window.PopupStack) {
                        PopupStack.remove('tide-popup');
                    }
                }
            },
            getPosition: () => popupElement.style.display === 'block' ? true : undefined
        };

        // OpenStreetMap 레이어
        const baseLayer = new ol.layer.Tile({
            source: new ol.source.OSM()
        });

        // 초기 중심 좌표 설정 (첫 번째 즐겨찾기가 있으면 거기로, 없으면 기본값)
        let initialCenter = [127.5, 36.5];
        let initialZoom = 7;

        if (TideFavorites.items && TideFavorites.items.length > 0) {
            const firstFav = TideFavorites.items[0];
            initialCenter = [parseFloat(firstFav.lon), parseFloat(firstFav.lat)];
            initialZoom = 10;
        }

        // 지도 생성
        tideMap = new ol.Map({
            target: 'tide-map',
            layers: [baseLayer],
            view: new ol.View({
                center: ol.proj.fromLonLat(initialCenter),
                zoom: initialZoom,
                minZoom: 5,
                maxZoom: 18
            })
        });

        // 클릭 이벤트
        tideMap.on('click', handleTideMapClick);

        // 표준항 마커 추가
        addTideStationMarkers();

        // 커스텀 컨트롤 추가
        addTideMapControls();

        // 초기 날짜 표시 업데이트
        updateTideDateDisplay();

        // 즐겨찾기 마커 초기화
        updateFavoriteMarkers();

        // 현재 연도 데이터 미리 로드
        const currentYear = new Date().getFullYear();
        loadTideData(currentYear);

        // 위치 검색 초기화 (Kakao SDK 로드 + 검색창 이벤트 연결)
        initTideSearch();

        // console.log('✅ 조석 지도 초기화 완료');
    } catch (error) {
        console.error('조석 지도 초기화 오류:', error);
    }
}

// ===== 표준항 마커 추가 =====
function addTideStationMarkers() {
    if (!tideMap || stationData.length === 0) return;

    // 기존 마커 레이어 제거
    if (tideStationLayer) {
        tideMap.removeLayer(tideStationLayer);
    }

    // 마커 피처 생성
    const features = stationData.map(station => {
        const feature = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([station.lon, station.lat])),
            name: station.name,
            code: station.code
        });
        return feature;
    });

    // 벡터 소스 및 레이어 생성
    tideStationLayer = new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: function (feature) {
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#ff5252' }),
                    stroke: new ol.style.Stroke({ color: 'white', width: 2 })
                }),
                text: new ol.style.Text({
                    text: feature.get('name'),
                    offsetY: -15,
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                    font: 'bold 12px Inter, sans-serif'
                })
            });
        }
    });

    tideMap.addLayer(tideStationLayer);
}

// ===== 즐겨찾기 마커 업데이트 =====
function updateFavoriteMarkers() {
    if (!tideMap) return;

    // 기존 레이어 제거
    if (favoriteLayer) {
        tideMap.removeLayer(favoriteLayer);
    }

    if (!TideFavorites.items || TideFavorites.items.length === 0) return;

    // 마커 피처 생성
    const features = TideFavorites.items.map(item => {
        const feature = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([parseFloat(item.lon), parseFloat(item.lat)])),
            name: item.name,
            type: 'favorite' // 클릭 핸들러 식별용
        });
        return feature;
    });

    // 벡터 레이어 생성
    favoriteLayer = new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        zIndex: 999, // 표준항 마커보다 위에 표시
        style: function (feature) {
            return new ol.style.Style({
                image: new ol.style.Icon({
                    src: 'data:image/svg+xml,' + encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">' +
                        '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#ef4444" stroke="#991b1b" stroke-width="1"/>' +
                        '<circle cx="12" cy="11" r="5" fill="white"/>' +
                        '</svg>'
                    ),
                    anchor: [0.5, 1],
                    scale: 0.6
                }),
                text: new ol.style.Text({
                    text: feature.get('name'),
                    offsetY: 12,
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                    font: 'bold 12px "Noto Sans KR", sans-serif'
                })
            });
        }
    });

    tideMap.addLayer(favoriteLayer);
}

// ===== 지도 클릭 처리 =====
// TideBED 폴링 타이머 (중복 방지)
let _tidePollTimer = null;
// 게이지 실시간 갱신 타이머
let _gaugeUpdateTimer = null;
// 마지막 표시 데이터 (게이지 갱신용)
let _lastTideDisplayData = null;

function stopGaugeAutoRefresh() {
    if (_gaugeUpdateTimer) {
        clearInterval(_gaugeUpdateTimer);
        _gaugeUpdateTimer = null;
    }
}

/**
 * 조석 게이지(현재 시점 만조/간조 진행도) 자동 갱신 타이머 시작.
 * 1분 간격으로 게이지 갱신. 시작 전 기존 타이머 정리하여 중복 방지.
 */
function startGaugeAutoRefresh() {
    stopGaugeAutoRefresh();
    _gaugeUpdateTimer = setInterval(() => {
        if (!_lastTideDisplayData || !tidePopupOverlay || !tidePopupOverlay.getPosition()) {
            stopGaugeAutoRefresh();
            return;
        }
        const d = _lastTideDisplayData;
        // 현재 시각 기준으로 게이지 재계산
        let currentTideLevel = null;
        const now = new Date();
        const isToday = now.getFullYear() === currentTideDate.getFullYear() &&
            now.getMonth() === currentTideDate.getMonth() &&
            now.getDate() === currentTideDate.getDate();

        if (isToday && d.todayData && d.todayData.tideBedData && d.todayData.tideBedData.length > 0) {
            const nowHH = String(now.getHours()).padStart(2, '0');
            const nowMM = String(now.getMinutes()).padStart(2, '0');
            const nowTimeStr = `${nowHH}:${nowMM}`;
            let closestItem = null;
            let closestDiff = Infinity;
            for (const item of d.todayData.tideBedData) {
                const itemTime = item.slctdDt ? item.slctdDt.split(' ')[1] : null;
                if (!itemTime) continue;
                const diff = Math.abs(timeToMinutes(itemTime) - timeToMinutes(nowTimeStr));
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestItem = item;
                }
            }
            if (closestItem) {
                currentTideLevel = parseFloat(closestItem.slctdHgt);
            }
        }

        const tideProgress = getTideProgress(d.allTides, currentTideDate, d.prevDayLastTide, d.nextDayFirstTide, currentTideLevel);
        if (tideProgress) {
            const gaugeWrapper = document.querySelector('.tide-progress-wrapper');
            if (gaugeWrapper) {
                // d.mulddaeInfo를 함께 전달해 1분 갱신 후에도 물때 텍스트가 유지되도록 함
                const newHtml = getTideProgressHTML(tideProgress, d.mulddaeInfo);
                const temp = document.createElement('div');
                temp.innerHTML = newHtml;
                if (temp.firstElementChild) {
                    gaugeWrapper.replaceWith(temp.firstElementChild);
                }
            }
        }
    }, 60000); // 1분마다 갱신
}

// [New] 동해 북부 예외 처리 함수 (북위 36도 이북 & 동해)
async function processEastSeaNorthException(lat, lon, coord) {
    showTidePopup(coord, { clickedLat: lat.toFixed(6), clickedLon: lon.toFixed(6), loading: true });

    const y = currentTideDate.getFullYear();
    const loaded = await loadTideData(String(y)); // 올해 데이터 로드
    // 연말연시 3일치 처리를 위해 전년/내년 데이터도 로드 필요할 수 있음 (getClientAdjacentDates 활용)
    const dates = getClientAdjacentDates(currentTideDate);
    const years = new Set([
        dates.yesterdayObj.getFullYear(),
        dates.todayObj.getFullYear(),
        dates.tomorrowObj.getFullYear()
    ]);
    for (const yr of years) {
        if (yr !== y) await loadTideData(String(yr));
    }

    if (!window.TIDE_DATA_STORAGE || !window.TIDE_DATA_STORAGE[y]) {
        showTidePopup(coord, { clickedLat: lat.toFixed(6), clickedLon: lon.toFixed(6), error: `${y}년 조석 데이터(표준항)를 불러올 수 없습니다.` });
        return;
    }

    const keyMap = { yesterday: dates.yesterday, today: dates.today, tomorrow: dates.tomorrow };
    const result = {
        yesterday: null, today: null, tomorrow: null
    };

    try {
        for (const [key, dateInt] of Object.entries(keyMap)) {
            const stations = findNearestStationsWithData(lat, lon, dateInt, 3);
            if (stations.length === 0) throw new Error('근거 데이터 부족');
            const idw = interpolateTideByIDW(stations);
            result[key] = convertIDWToTideBedFormat(idw, dateInt);
            // [UI Hint] IDW 결과임을 명시
            result[key].isInterpolated = true;
        }

        console.log('⚡ 동해 북부 예외 처리: IDW 결과 표출 (표준항 보간)');
        showTidePopup(coord, {
            clickedLat: lat.toFixed(6),
            clickedLon: lon.toFixed(6),
            tideBed: result
        });
    } catch (e) {
        showTidePopup(coord, {
            clickedLat: lat.toFixed(6),
            clickedLon: lon.toFixed(6),
            error: '동해 북부 예보를 위한 근거 데이터가 부족합니다.'
        });
    }
}

/**
 * 조석 지도 클릭 핸들러 — 즐겨찾기 마커 / 표준항 마커 hit 검사 후 조석 팝업.
 * 마커가 hit 되면 그 위치로, 빈 해역이면 IDW 보간으로 인근 표준항 평균 데이터 표출.
 */
async function handleTideMapClick(event) {
    // 클릭한 위치에 즐겨찾기 마커나 표준항 마커가 있는지 확인
    let feature = null;
    if (event.pixel) {
        feature = tideMap.forEachFeatureAtPixel(event.pixel, function (feature) {
            return feature;
        });
    }

    // 즐겨찾기 마커 클릭 시 해당 위치로 정확히 스냅
    let coordinate = event.coordinate;
    let clickLat, clickLon;

    if (feature && feature.get('type') === 'favorite') {
        const geometry = feature.getGeometry();
        coordinate = geometry.getCoordinates();
        const lonLat = ol.proj.toLonLat(coordinate);
        clickLat = lonLat[1];
        clickLon = lonLat[0];
    } else {
        const lonLat = ol.proj.toLonLat(coordinate);
        clickLat = lonLat[1];
        clickLon = lonLat[0];
    }

    const selectedDate = getSelectedTideDate();
    const longitude = clickLon;
    const latitude = clickLat;

    lastClickedCoordinate = coordinate;
    lastClickedLonLat = { lat: latitude, lon: longitude };

    // [Exception] 동해 북부 (북위 36도 이북 & 동경 128도 이상)
    if (latitude >= 36.0 && longitude >= 128.0) {
        stopGaugeAutoRefresh(); // 게이지 타이머 중지
        await processEastSeaNorthException(latitude, longitude, coordinate);
        return;
    }

    // 1단계: 로딩 스피너 팝업 즉시 표시
    stopGaugeAutoRefresh();
    showTidePopup(coordinate, {
        clickedLat: latitude.toFixed(6),
        clickedLon: longitude.toFixed(6),
        loading: true
    });

    // 2단계: 서버에 수집 요청
    const now = new Date();
    const timeString = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join(':');

    let serverResponse;
    try {
        const res = await fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: selectedDate,
                time: timeString,
                lat: latitude,
                lon: longitude
            })
        });
        serverResponse = await res.json();
        if (!serverResponse.success) {
            if (serverResponse.error === 'Grid hash unavailable') {
                throw new Error('국립해양조사원 조석 예측정보가 제공되지 않는 해역입니다.');
            } else {
                throw new Error('서버 요청에 실패했습니다.');
            }
        }
        console.log(`✅ 격자: ${serverResponse.gridHash}, 캐시: ${serverResponse.cached}건, 수집: ${serverResponse.collecting}건`);
    } catch (err) {
        console.error('❌ TideBED 수집 요청 실패:', err);
        showTidePopup(coordinate, {
            clickedLat: latitude.toFixed(6),
            clickedLon: longitude.toFixed(6),
            error: err.message
        });
        return;
    }

    const files = serverResponse.files;

    // 3단계: 모두 캐시 히트인 경우 즉시 렌더링
    if (serverResponse.collecting === 0) {
        console.log('⚡ 3일치 모두 캐시 히트! 즉시 렌더링');
        try {
            const [yesterdayRes, todayRes, tomorrowRes] = await Promise.all([
                fetch(`/data/${files.yesterday}?` + Date.now()),
                fetch(`/data/${files.today}?` + Date.now()),
                fetch(`/data/${files.tomorrow}?` + Date.now())
            ]);
            const [yesterdayData, todayData, tomorrowData] = await Promise.all([
                yesterdayRes.json(), todayRes.json(), tomorrowRes.json()
            ]);
            showTidePopup(coordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                tideBed: { yesterday: yesterdayData, today: todayData, tomorrow: tomorrowData }
            });
        } catch (err) {
            showTidePopup(coordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: '캐시 데이터 로드에 실패했습니다.'
            });
        }
        return;
    }

    // 4단계: 폴링 - 동적 파일명 사용 (3개 병렬 체크 + 프로그레스)
    if (_tidePollTimer) clearInterval(_tidePollTimer);

    let pollCount = 0;
    const MAX_POLL = 120; // 500ms 간격이므로 60초
    const completedData = {};

    _tidePollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLL) {
            clearInterval(_tidePollTimer);
            _tidePollTimer = null;
            showTidePopup(coordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: '데이터 수집 시간이 초과되었습니다.\n다시 시도해 주세요.'
            });
            return;
        }

        try {
            // 아직 완료되지 않은 파일만 체크 (병렬)
            const checks = [];
            if (!completedData.today) checks.push(
                fetch(`/data/${files.today}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.today = d; }).catch(() => {})
            );
            if (!completedData.tomorrow) checks.push(
                fetch(`/data/${files.tomorrow}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.tomorrow = d; }).catch(() => {})
            );
            if (!completedData.yesterday) checks.push(
                fetch(`/data/${files.yesterday}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.yesterday = d; }).catch(() => {})
            );

            await Promise.all(checks);

            // 프로그레스 업데이트
            const done = (completedData.today ? 1 : 0) + (completedData.tomorrow ? 1 : 0) + (completedData.yesterday ? 1 : 0);

            // 3개 모두 완료
            if (done === 3) {
                clearInterval(_tidePollTimer);
                _tidePollTimer = null;
                console.log('✅ 3일치 TideBED 데이터 수신 완료');

                showTidePopup(coordinate, {
                    clickedLat: latitude.toFixed(6),
                    clickedLon: longitude.toFixed(6),
                    tideBed: { yesterday: completedData.yesterday, today: completedData.today, tomorrow: completedData.tomorrow }
                });
            }
        } catch (err) {
            console.log(`⏳ 폴링 ${pollCount}/${MAX_POLL}...`);
        }
    }, 500);
}

// ===== 조석 팝업 표시 =====
function showTidePopup(coordinate, data) {
    const element = tidePopupOverlay.getElement();
    element.className = 'tide-popup';

    const lat = parseFloat(data.clickedLat);
    const lon = parseFloat(data.clickedLon);
    const astroInfo = getAstronomyInfo(lat, lon, currentTideDate);

    // 즐겨찾기 상태 확인
    const existingFavIndex = TideFavorites.items.findIndex(item => {
        return Math.abs(parseFloat(item.lat) - lat) < 0.0001 && Math.abs(parseFloat(item.lon) - lon) < 0.0001;
    });

    let favButtonHtml = '';
    if (existingFavIndex !== -1) {
        const favName = TideFavorites.items[existingFavIndex].name;
        favButtonHtml = `
            <div class="tide-popup-fav-btn" style="
                margin-top: 5px;
                background-color: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.3);
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: default;
            ">
                <span style="font-weight: bold; color: #f87171; font-size: 1rem;">
                    <i class="fa-solid fa-map-pin" style="margin-right: 4px;"></i> ${favName}
                </span>
                <button onclick="removeCurrentLocationFromFavorites(${existingFavIndex})" style="
                    background-color: rgba(239, 68, 68, 0.15); 
                    border: 1px solid rgba(239, 68, 68, 0.3); 
                    color: #ef4444; 
                    border-radius: 4px; 
                    padding: 4px 10px; 
                    font-size: 0.8rem; 
                    cursor: pointer;
                    margin-left: 8px;
                    font-weight: 500;
                    white-space: nowrap;
                ">
                    해제
                </button>
            </div>
        `;
    } else {
        favButtonHtml = `
            <button class="tide-popup-fav-btn" onclick="addCurrentLocationToFavorites('${data.clickedLat}', '${data.clickedLon}')" style="margin-top: 5px;">
                <i class="fa-solid fa-map-pin"></i> 즐겨찾기 추가
            </button>
        `;
    }

    let html = `
        <button class="tide-popup-close-x" onclick="stopGaugeAutoRefresh(); tidePopupOverlay.setPosition(undefined)" title="닫기">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="tide-popup-body" style="padding-top: 15px;">
            ${data.loading ? '' : favButtonHtml}
    `;

    // 즐겨찾기 추가/해제 함수 (전역)
    window.addCurrentLocationToFavorites = (latStr, lonStr) => {
        openTideFavModal('add', {
            onConfirm: (name) => {
                if (TideFavorites.add(name, latStr, lonStr)) {
                    showTidePopup(coordinate, data);
                }
            }
        });
    };
    window.removeCurrentLocationFromFavorites = (index) => {
        const name = TideFavorites.items[index].name;
        openTideFavModal('remove', {
            name: name,
            onConfirm: () => {
                TideFavorites.remove(index, false);
                showTidePopup(coordinate, data);
            }
        });
    };

    // 하위 리스트(즐겨찾기 바)에서 삭제 시 호출
    window.confirmTideFavoriteDelete = (index) => {
        const name = TideFavorites.items[index].name;
        openTideFavModal('remove', {
            name: name,
            onConfirm: () => {
                TideFavorites.remove(index, false);
            }
        });
    };

    // === 로딩 상태 ===
    if (data.loading) {
        html += `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 10px;">
                <div style="
                    width: 36px; height: 36px;
                    border: 3px solid rgba(255,255,255,0.1);
                    border-top: 3px solid #3b82f6;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <div style="margin-top: 12px; color: #94a3b8; font-size: 0.85rem; text-align: center;">
                    국립해양조사원으로부터 TideBED 기반 조석 예측정보를 불러오고 있습니다.
                </div>
                <div style="margin-top: 4px; color: #64748b; font-size: 0.7rem;">
                    약 3~5초 소요됩니다
                </div>
            </div>
            <style>
                @keyframes spin { to { transform: rotate(360deg); } }
            </style>
        `;
        html += `
            <div class="tide-location-bottom" style="text-align: center; margin-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; justify-content: center; opacity: 0.8;">
                <i class="fa-solid fa-location-dot" style="margin-right: 6px; font-size: 0.7rem;"></i>
                <span style="font-family: 'Roboto Mono', monospace;">${data.clickedLat}°N, ${data.clickedLon}°E</span>
            </div>
        `;

        // === 에러 상태 ===
    } else if (data.error) {
        html += `
            <div class="tide-error">
                <i class="fa-solid fa-circle-exclamation"></i>
                <p>${data.error}</p>
            </div>
        `;
        html += getAstronomyInfoHTML(astroInfo);
        html += `
            <div class="tide-location-bottom" style="text-align: center; margin-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; justify-content: center; opacity: 0.8;">
                <i class="fa-solid fa-location-dot" style="margin-right: 6px; font-size: 0.7rem;"></i>
                <span style="font-family: 'Roboto Mono', monospace;">${data.clickedLat}°N, ${data.clickedLon}°E</span>
            </div>
        `;

        // === TideBED 데이터 표출 ===
    } else if (data.tideBed) {
        const today = data.tideBed.today;
        const yesterday = data.tideBed.yesterday;
        const tomorrow = data.tideBed.tomorrow;

        // 고조/저조 목록 구성
        let allTides = [];
        if (today.highTide1) allTides.push({ type: 'high', timeRaw: today.highTide1.time, time: today.highTide1.time, level: today.highTide1.height });
        if (today.highTide2) allTides.push({ type: 'high', timeRaw: today.highTide2.time, time: today.highTide2.time, level: today.highTide2.height });
        if (today.lowTide1) allTides.push({ type: 'low', timeRaw: today.lowTide1.time, time: today.lowTide1.time, level: today.lowTide1.height });
        if (today.lowTide2) allTides.push({ type: 'low', timeRaw: today.lowTide2.time, time: today.lowTide2.time, level: today.lowTide2.height });

        // 시간순 정렬
        allTides.sort((a, b) => timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw));

        // 전일 마지막 고조/저조 (변화량 계산용)
        let prevDayLastHigh = null;
        let prevDayLastLow = null;
        let prevDayLastTide = null; // 게이지용

        if (yesterday.highTide2) prevDayLastHigh = yesterday.highTide2.height;
        else if (yesterday.highTide1) prevDayLastHigh = yesterday.highTide1.height;

        if (yesterday.lowTide2) prevDayLastLow = yesterday.lowTide2.height;
        else if (yesterday.lowTide1) prevDayLastLow = yesterday.lowTide1.height;

        // 전일 마지막 피크 (시간순으로 가장 늦은 것)
        const yesterdayPeaks = [];
        if (yesterday.highTide1) yesterdayPeaks.push({ type: 'high', timeRaw: yesterday.highTide1.time, level: yesterday.highTide1.height });
        if (yesterday.highTide2) yesterdayPeaks.push({ type: 'high', timeRaw: yesterday.highTide2.time, level: yesterday.highTide2.height });
        if (yesterday.lowTide1) yesterdayPeaks.push({ type: 'low', timeRaw: yesterday.lowTide1.time, level: yesterday.lowTide1.height });
        if (yesterday.lowTide2) yesterdayPeaks.push({ type: 'low', timeRaw: yesterday.lowTide2.time, level: yesterday.lowTide2.height });
        yesterdayPeaks.sort((a, b) => timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw));
        if (yesterdayPeaks.length > 0) {
            const last = yesterdayPeaks[yesterdayPeaks.length - 1];
            prevDayLastTide = { type: last.type, timeRaw: last.timeRaw, time: last.timeRaw, level: last.level };
        }

        // 익일 첫 피크 (게이지용)
        let nextDayFirstTide = null;
        const tomorrowPeaks = [];
        if (tomorrow.highTide1) tomorrowPeaks.push({ type: 'high', timeRaw: tomorrow.highTide1.time, level: tomorrow.highTide1.height });
        if (tomorrow.highTide2) tomorrowPeaks.push({ type: 'high', timeRaw: tomorrow.highTide2.time, level: tomorrow.highTide2.height });
        if (tomorrow.lowTide1) tomorrowPeaks.push({ type: 'low', timeRaw: tomorrow.lowTide1.time, level: tomorrow.lowTide1.height });
        if (tomorrow.lowTide2) tomorrowPeaks.push({ type: 'low', timeRaw: tomorrow.lowTide2.time, level: tomorrow.lowTide2.height });
        tomorrowPeaks.sort((a, b) => timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw));
        if (tomorrowPeaks.length > 0) {
            const first = tomorrowPeaks[0];
            nextDayFirstTide = { type: first.type, timeRaw: first.timeRaw, time: first.timeRaw, level: first.level };
        }

        // 현재 조위 (1분 데이터에서 직접 참조)
        let currentTideLevel = null;
        const now = new Date();
        const isToday = now.getFullYear() === currentTideDate.getFullYear() &&
            now.getMonth() === currentTideDate.getMonth() &&
            now.getDate() === currentTideDate.getDate();

        if (isToday && today.tideBedData && today.tideBedData.length > 0) {
            const nowHH = String(now.getHours()).padStart(2, '0');
            const nowMM = String(now.getMinutes()).padStart(2, '0');
            const nowTimeStr = `${nowHH}:${nowMM}`;

            // slctdDt에서 현재 시각에 가장 가까운 데이터 찾기
            let closestItem = null;
            let closestDiff = Infinity;
            for (const item of today.tideBedData) {
                const itemTime = item.slctdDt ? item.slctdDt.split(' ')[1] : null;
                if (!itemTime) continue;
                const diff = Math.abs(timeToMinutes(itemTime) - timeToMinutes(nowTimeStr));
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestItem = item;
                }
            }
            if (closestItem) {
                currentTideLevel = parseFloat(closestItem.slctdHgt);
            }
        }

        // 게이지 표시 (getTideProgress) - 데이터가 온전하고(complete), 일조부등(2회 이하)이 아닐 경우만 표시
        // 동해 해역 등 타이드배드 미제공 구역 대응
        const totalTideCount = allTides.length;
        const isTideBedProvided = (today.tideBedStatus === 'complete' || today.tideBedStatus === 'complete-quick');

        if (totalTideCount > 2 && isTideBedProvided) {
            const tideProgress = getTideProgress(allTides, currentTideDate, prevDayLastTide, nextDayFirstTide, currentTideLevel);

            // [API 보정] API 데이터가 NaN이거나 없을 경우, 게이지에서 계산된 보간 조위 사용
            if (tideProgress && (currentTideLevel === null || isNaN(currentTideLevel))) {
                currentTideLevel = tideProgress.currentLevel;
            }

            // 물때 산출: 3일치 피크 데이터와 조화상수(M2/S2) 활용
            // computeMulddae()는 tide.js에 전역 함수로 선언되어 있음
            const tbRow = (today.tideBedData && today.tideBedData.length > 0)
                ? today.tideBedData[0]
                : null;
            const mulddaeInfo = computeMulddae(
                allTides,           // 오늘 피크 (type, level)
                yesterdayPeaks,     // 어제 피크 (방향 판단용)
                tomorrowPeaks,      // 내일 피크 (평균 대조차 추정 보조)
                tbRow,              // M2/S2 조화상수
                currentTideDate,    // 기준 날짜 (월령 계산용)
                lat,                // 위도 (서해 판별)
                lon                 // 경도 (서해 판별)
            );

            if (tideProgress) {
                // 두 번째 인자로 물때 정보 전달 → 게이지 라벨 행 중앙에 표시
                html += getTideProgressHTML(tideProgress, mulddaeInfo);
            }

            // 게이지 실시간 갱신용 데이터 저장 및 타이머 시작
            // mulddaeInfo도 함께 저장해 1분 자동갱신 시 물때 텍스트가 유지되도록 함
            _lastTideDisplayData = { allTides, prevDayLastTide, nextDayFirstTide, todayData: today, mulddaeInfo };
            startGaugeAutoRefresh();
        }

        // 변화량 계산 (▲▼)
        for (let i = 0; i < allTides.length; i++) {
            let tidalRange = null;

            // 당일 내에서 직전 반대 피크 찾기
            for (let j = i - 1; j >= 0; j--) {
                if (allTides[j].type !== allTides[i].type) {
                    tidalRange = allTides[i].level - allTides[j].level;
                    break;
                }
            }

            // 당일 내 직전이 없으면 전일 마지막 피크 사용
            if (tidalRange === null) {
                if (allTides[i].type === 'high' && prevDayLastLow !== null) {
                    tidalRange = allTides[i].level - prevDayLastLow;
                } else if (allTides[i].type === 'low' && prevDayLastHigh !== null) {
                    tidalRange = allTides[i].level - prevDayLastHigh;
                }
            }

            allTides[i].tidalRange = tidalRange !== null ? Math.abs(tidalRange) : null;
        }

        const highTides = allTides.filter(t => t.type === 'high');
        const lowTides = allTides.filter(t => t.type === 'low');

        // 고조 그룹
        html += `<div class="tide-group">`;
        html += `<div class="tide-group-label high">고<br>조</div>`;
        html += `<div class="tide-group-items">`;
        if (highTides.length > 0) {
            highTides.forEach(t => {
                const rangeText = t.tidalRange !== null ? `+${t.tidalRange}` : '';
                html += `<div class="tide-row high">
                    <span class="tide-time">${t.time}</span>
                    <span class="tide-level">(${t.level}cm)</span>
                    <span class="tide-arrow">▲</span>
                    <span class="tide-value-signed">${rangeText}</span>
                </div>`;
            });
        } else {
            html += `<div class="tide-row empty">--:-- (--cm)</div>`;
        }
        html += `</div></div>`;

        html += `<div class="tide-divider"></div>`;

        // 저조 그룹
        html += `<div class="tide-group">`;
        html += `<div class="tide-group-label low">저<br>조</div>`;
        html += `<div class="tide-group-items">`;
        if (lowTides.length > 0) {
            lowTides.forEach(t => {
                const rangeText = t.tidalRange !== null ? `${t.tidalRange}` : '';
                html += `<div class="tide-row low">
                    <span class="tide-time">${t.time}</span>
                    <span class="tide-level">(${t.level}cm)</span>
                    <span class="tide-arrow">▼</span>
                    <span class="tide-value-signed">-${rangeText}</span>
                </div>`;
            });
        } else {
            html += `<div class="tide-row empty">--:-- (--cm)</div>`;
        }
        html += `</div></div>`;

        // 일조부등 안내
        if (totalTideCount > 0 && totalTideCount <= 2) {
            html += `
                <div style="font-size: 0.65rem; color: #94a3b8; text-align: center; margin-top: 8px; margin-bottom: 4px; padding: 2px 0; width: 100%;">
                    [일조부등으로 인한 조석정보 생략]
                </div>
            `;
        }

        html += getAstronomyInfoHTML(astroInfo);

        // 좌표 정보 하단
        html += `
            <div class="tide-location-bottom" style="text-align: center; margin-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; justify-content: center; opacity: 0.8;">
                <i class="fa-solid fa-location-dot" style="margin-right: 6px; font-size: 0.7rem;"></i>
                <span style="font-family: 'Roboto Mono', monospace;">${data.clickedLat}°N, ${data.clickedLon}°E</span>
            </div>
        `;
    }

    html += `</div>`;

    element.innerHTML = html;
    tidePopupOverlay.setPosition(coordinate);
}

// ===== 유틸리티 함수들 =====

function getSelectedTideDate() {
    return parseInt(formatYMD(currentTideDate));
}

/**
 * Date → "YYYYMMDD" 형식 문자열. TideBED API 의 reqDate 파라미터 등에 사용.
 * @param {Date} dateObj
 * @returns {string} - 예: "20260430"
 */
function formatYMD(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const date = String(dateObj.getDate()).padStart(2, '0');
    return `${year}${month}${date}`;
}

// [New] IDW 결과를 TideBED 데이터 형식으로 변환 (어댑터)
function convertIDWToTideBedFormat(idwResult, dateInt) {
    if (!idwResult) return {};
    const obj = {
        requestDate: dateInt,
        tideBedStatus: 'complete (IDW)',
        tideBedData: [] // 1분 데이터는 없음 (보간으로 채움)
    };

    // HHMM -> HH:MM 변환 헬퍼
    const formatTimeHHMM = (timeVal) => {
        if (!timeVal && timeVal !== 0) return '';
        const s = String(timeVal).padStart(4, '0');
        if (s.includes(':')) return s;
        return `${s.substring(0, 2)}:${s.substring(2, 4)}`;
    };

    for (let i = 1; i <= 4; i++) {
        // High Tides
        if (idwResult[`highTide${i}Time`] && idwResult[`highTide${i}Level`] !== undefined) {
            obj[`highTide${i}`] = {
                time: formatTimeHHMM(idwResult[`highTide${i}Time`]),
                height: String(idwResult[`highTide${i}Level`])
            };
        }
        // Low Tides
        if (idwResult[`lowTide${i}Time`] && idwResult[`lowTide${i}Level`] !== undefined) {
            obj[`lowTide${i}`] = {
                time: formatTimeHHMM(idwResult[`lowTide${i}Time`]),
                height: String(idwResult[`lowTide${i}Level`])
            };
        }
    }
    return obj;
}

// [New] 클라이언트용 전일/익일 날짜 계산
function getClientAdjacentDates(baseDateObj) {
    const prev = new Date(baseDateObj);
    prev.setDate(prev.getDate() - 1);

    const next = new Date(baseDateObj);
    next.setDate(next.getDate() + 1);

    return {
        yesterday: parseInt(formatYMD(prev)),
        today: parseInt(formatYMD(baseDateObj)),
        tomorrow: parseInt(formatYMD(next)),
        yesterdayObj: prev,
        todayObj: baseDateObj,
        tomorrowObj: next
    };
}

/**
 * 주어진 좌표에서 가까운 표준항 N개 반환 (거리 기준 오름차순).
 * 데이터 보유 여부와 무관하게 순수 거리 기준 — 데이터 없는 항도 포함될 수 있음.
 * @param {number} count - 반환 개수 (기본 3)
 */
function findNearestStations(lat, lon, count = 3) {
    const stationsWithDist = stationData.map(station => ({
        ...station,
        distance: calculateDistance(lat, lon, station.lat, station.lon)
    }));

    stationsWithDist.sort((a, b) => a.distance - b.distance);
    return stationsWithDist.slice(0, count);
}

/**
 * 주어진 좌표 + 일자에 대해, 그 날짜의 조석 데이터를 보유한 표준항만
 * 가까운 순으로 N개 반환. IDW 보간의 "유효" 표준항 선정 함수.
 * @param {number} selectedDate - "YYYYMMDD" 정수
 * @param {number} count - 반환 개수 (기본 3)
 */
function findNearestStationsWithData(lat, lon, selectedDate, count = 3) {
    const stationsWithDataAndDist = stationData.map(station => ({
        ...station,
        distance: calculateDistance(lat, lon, station.lat, station.lon),
        tideInfo: getTideDataForDate(station.name, selectedDate)
    }))
        .filter(s => s.tideInfo)
        .sort((a, b) => a.distance - b.distance);

    return stationsWithDataAndDist.slice(0, count);
}

/**
 * 두 위경도 좌표 사이 거리 계산 (Haversine 공식). 단위: km.
 * 평균 지구 반지름 R=6371km 사용. 표준항 거리 정렬 + IDW 가중치 산출 입력.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/** 도(°) 단위 각도를 라디안으로 변환. Haversine 공식의 sin/cos 입력에 사용. */
function toRad(degrees) {
    return degrees * Math.PI / 180;
}

/**
 * 표준항 이름과 날짜 정수(YYYYMMDD) 로 그 날짜의 조석 데이터(만조/간조 4개) 조회.
 * 연도별로 분리 적재된 stationData 에서 stationName.tideInfoByYear[year][dateNum] 접근.
 *
 * @param {string} stationName
 * @param {number} dateNum - "YYYYMMDD" 정수
 */
function getTideDataForDate(stationName, dateNum) {
    const year = String(dateNum).substring(0, 4);

    if (!window.TIDE_DATA_STORAGE || !window.TIDE_DATA_STORAGE[year]) {
        console.warn(`${year}년 조석 데이터가 로드되지 않았습니다.`);
        return null;
    }

    const currentYearData = window.TIDE_DATA_STORAGE[year];
    const station = stationData.find(s => s.name === stationName);

    if (station && station.code) {
        const byCode = currentYearData.find(row =>
            row.stationCode === station.code && row.date === dateNum
        );
        if (byCode) return byCode;
    }

    const byName = currentYearData.find(row =>
        row.stationName === stationName && row.date === dateNum
    );
    if (byName) return byName;

    const partialMatch = currentYearData.find(row =>
        row.date === dateNum && (
            row.stationName?.includes(stationName) ||
            stationName?.includes(row.stationName)
        )
    );

    return partialMatch || null;
}

/**
 * 가까운 표준항 N곳의 조석 데이터를 IDW(Inverse Distance Weighting) 로 보간.
 *
 * [공식]
 *   각 항의 가중치 = 1 / distance^2
 *   보간값 = Σ(가중치 × 값) / Σ(가중치)
 *
 * [반환] 보간된 만조/간조 4개 + method 표시 + sourceStations 배열.
 *
 * [특수 케이스] stationsWithData.length === 1 → 단일 표준항 그대로 사용.
 */
function interpolateTideByIDW(stationsWithData) {
    if (stationsWithData.length === 1) {
        return { ...stationsWithData[0].tideInfo, method: 'single', sourceStations: [stationsWithData[0].name] };
    }

    const nearestStation = stationsWithData[0];

    const weights = stationsWithData.map(s => {
        if (s.distance < 0.1) return 1000000;
        return 1 / Math.pow(s.distance, 2);
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);

    const result = {
        method: 'idw',
        sourceStations: stationsWithData.map(s => s.name),
        weights: normalizedWeights
    };

    // [Fix] 가장 가까운 항구(primaryStation)를 기준으로 조석 횟수를 결정합니다.
    // 다른 항구에서 추가로 발생하는 비정상적인 중복 조석은 무시합니다.
    const primaryStation = nearestStation;

    for (let i = 1; i <= 4; i++) {
        const timeKey = `highTide${i}Time`;
        const levelKey = `highTide${i}Level`;

        // 기준 항구에 해당 순번의 조석이 없으면 계산하지 않음
        if (primaryStation.tideInfo[timeKey] === undefined) continue;

        // [시각 보간]
        const stationsWithTime = stationsWithData.filter(s => s.tideInfo[timeKey] !== undefined);
        if (stationsWithTime.length > 0) {
            const timeWeights = stationsWithTime.map(s => {
                if (s.distance < 0.1) return 1000000;
                return 1 / Math.pow(s.distance, 2);
            });
            const totalTimeWeight = timeWeights.reduce((sum, w) => sum + w, 0);

            const avgMinutes = stationsWithTime.reduce((sum, station, idx) => {
                const mins = timeToMinutes(station.tideInfo[timeKey]);
                return sum + mins * (timeWeights[idx] / totalTimeWeight);
            }, 0);
            result[timeKey] = minutesToTime(avgMinutes);
        }

        // [조고 보간]
        const stationsWithLevel = stationsWithData.filter(s => s.tideInfo[levelKey] !== undefined);
        if (stationsWithLevel.length > 0) {
            const levelWeights = stationsWithLevel.map(s => {
                if (s.distance < 0.1) return 1000000;
                return 1 / Math.pow(s.distance, 2);
            });
            const totalLevelWeight = levelWeights.reduce((sum, w) => sum + w, 0);

            const avgLevel = stationsWithLevel.reduce((sum, station, idx) => {
                return sum + station.tideInfo[levelKey] * (levelWeights[idx] / totalLevelWeight);
            }, 0);
            result[levelKey] = Math.round(avgLevel);
        }
    }

    for (let i = 1; i <= 4; i++) {
        const timeKey = `lowTide${i}Time`;
        const levelKey = `lowTide${i}Level`;

        // 기준 항구에 해당 순번의 조석이 없으면 계산하지 않음
        if (primaryStation.tideInfo[timeKey] === undefined) continue;

        // [시각 보간]
        const stationsWithTime = stationsWithData.filter(s => s.tideInfo[timeKey] !== undefined);
        if (stationsWithTime.length > 0) {
            const timeWeights = stationsWithTime.map(s => {
                if (s.distance < 0.1) return 1000000;
                return 1 / Math.pow(s.distance, 2);
            });
            const totalTimeWeight = timeWeights.reduce((sum, w) => sum + w, 0);

            const avgMinutes = stationsWithTime.reduce((sum, station, idx) => {
                const mins = timeToMinutes(station.tideInfo[timeKey]);
                return sum + mins * (timeWeights[idx] / totalTimeWeight);
            }, 0);
            result[timeKey] = minutesToTime(avgMinutes);
        }

        // [조고 보간]
        const stationsWithLevel = stationsWithData.filter(s => s.tideInfo[levelKey] !== undefined);
        if (stationsWithLevel.length > 0) {
            const levelWeights = stationsWithLevel.map(s => {
                if (s.distance < 0.1) return 1000000;
                return 1 / Math.pow(s.distance, 2);
            });
            const totalLevelWeight = levelWeights.reduce((sum, w) => sum + w, 0);

            const avgLevel = stationsWithLevel.reduce((sum, station, idx) => {
                return sum + station.tideInfo[levelKey] * (levelWeights[idx] / totalLevelWeight);
            }, 0);
            result[levelKey] = Math.round(avgLevel);
        }
    }

    return result;
}

/**
 * 시각 문자열(또는 정수) 을 0시 0분 기준 분 단위로 변환.
 * 입력 형식: "HHMM" 또는 "HH:MM" 모두 허용. 잘못되면 0.
 * @returns {number} - 0~1439
 */
function timeToMinutes(timeStr) {
    if (!timeStr && timeStr !== 0) return 0;
    const s = String(timeStr);
    if (s.includes(':')) {
        const parts = s.split(':');
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    const str = s.padStart(4, '0');
    const hours = parseInt(str.substring(0, 2));
    const minutes = parseInt(str.substring(2, 4));
    return hours * 60 + minutes;
}

/**
 * 분(0~1439) 을 "HH:MM" 형식 문자열로 변환. 24h 모듈로 처리하여 24:00 같은 값 정상화.
 */
function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = Math.round(totalMinutes % 60);
    return parseInt(String(hours).padStart(2, '0') + String(minutes).padStart(2, '0'));
}

/**
 * "HHMM" 정수/문자열 을 "HH:MM" 으로 포맷. 빈값/null 은 '--:--' 로 fallback.
 * 화면 표시용 시각 라벨링.
 */
function formatTime(timeInt) {
    if (timeInt === undefined || timeInt === null || timeInt === '') return '--:--';
    const str = String(timeInt).padStart(4, '0');
    return `${str.substring(0, 2)}:${str.substring(2, 4)}`;
}

// ===== 날짜 네비게이션 =====

function updateTideDateDisplay() {
    const year = currentTideDate.getFullYear();
    const month = currentTideDate.getMonth() + 1;
    const date = currentTideDate.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = dayNames[currentTideDate.getDay()];

    const solarText = `${year}년 ${month}월 ${date}일(${dayOfWeek})`;
    const solarElem = document.getElementById('tide-solar-date');
    if (solarElem) solarElem.textContent = solarText;

    const lunarText = getLunarDate(year, month, date);
    const lunarElem = document.getElementById('tide-lunar-date');
    if (lunarElem) lunarElem.textContent = `(음력 ${lunarText})`;

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    const hiddenPicker = document.getElementById('tide-date-picker-hidden');
    if (hiddenPicker) {
        hiddenPicker.value = dateStr;
    }
}

/** 조석 날짜를 하루 전으로 이동. 화면/팝업 자동 갱신. */
function prevTideDate() {
    currentTideDate.setDate(currentTideDate.getDate() - 1);
    updateTideDateDisplay();
    refreshPopupIfOpen();
}

/** 조석 날짜를 다음 날로 이동. 화면/팝업 자동 갱신. */
function nextTideDate() {
    currentTideDate.setDate(currentTideDate.getDate() + 1);
    updateTideDateDisplay();
    refreshPopupIfOpen();
}

/** 숨겨진 native 날짜 picker(<input type="date">) 를 프로그래밍으로 열기. 모바일 친화적 입력. */
function showTideDatePicker() {
    const hiddenPicker = document.getElementById('tide-date-picker-hidden');
    if (hiddenPicker) {
        hiddenPicker.showPicker();
    }
}

/** 날짜 picker 의 change 이벤트 핸들러 — 선택된 일자로 currentTideDate 갱신 + 화면/팝업 갱신. */
function onTideDatePickerChange() {
    const hiddenPicker = document.getElementById('tide-date-picker-hidden');
    if (hiddenPicker && hiddenPicker.value) {
        const parts = hiddenPicker.value.split('-');
        currentTideDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        updateTideDateDisplay();
        refreshPopupIfOpen();
    }
}

/**
 * 조석 팝업이 떠 있다면 마지막 클릭 좌표 기준으로 다시 fetch + 재렌더.
 * 날짜 변경/팝업 새로고침 등에서 호출 — 사용자가 같은 위치를 다시 클릭할 필요 없게.
 */
async function refreshPopupIfOpen() {
    if (!lastClickedCoordinate || !lastClickedLonLat || !tidePopupOverlay || !tidePopupOverlay.getPosition()) return;

    const latitude = lastClickedLonLat.lat;
    const longitude = lastClickedLonLat.lon;

    const y = currentTideDate.getFullYear();
    const m = String(currentTideDate.getMonth() + 1).padStart(2, '0');
    const d = String(currentTideDate.getDate()).padStart(2, '0');
    const dateInt = parseInt(`${y}${m}${d}`);

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hh}:${mm}:${ss}`;

    // 게이지 타이머 중지
    stopGaugeAutoRefresh();

    // [Exception] 동해 북부 (북위 36도 이북 & 동경 128도 이상)
    if (latitude >= 36.0 && longitude >= 128.0) {
        await processEastSeaNorthException(latitude, longitude, lastClickedCoordinate);
        return;
    }

    // 1단계: 로딩 스피너 표시
    showTidePopup(lastClickedCoordinate, {
        clickedLat: latitude.toFixed(6),
        clickedLon: longitude.toFixed(6),
        loading: true
    });

    let serverResponse;
    try {
        const res = await fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: dateInt,
                time: timeStr,
                lat: latitude,
                lon: longitude
            })
        });
        serverResponse = await res.json();
        if (!serverResponse.success) {
            if (serverResponse.error === 'Grid hash unavailable') {
                throw new Error('국립해양조사원 조석 예측정보가 제공되지 않는 해역입니다.');
            } else {
                throw new Error('서버 요청에 실패했습니다.');
            }
        }
        console.log(`✅ 날짜변경 격자: ${serverResponse.gridHash}, 캐시: ${serverResponse.cached}건, 수집: ${serverResponse.collecting}건`);
    } catch (err) {
        console.error('서버 요청 실패:', err);
        showTidePopup(lastClickedCoordinate, {
            clickedLat: latitude.toFixed(6),
            clickedLon: longitude.toFixed(6),
            error: err.message
        });
        return;
    }

    const files = serverResponse.files;

    // 3단계: 모두 캐시 히트인 경우 즉시 렌더링
    if (serverResponse.collecting === 0) {
        console.log('⚡ 날짜변경: 3일치 모두 캐시 히트! 즉시 렌더링');
        try {
            const [yesterdayRes, todayRes, tomorrowRes] = await Promise.all([
                fetch(`/data/${files.yesterday}?` + Date.now()),
                fetch(`/data/${files.today}?` + Date.now()),
                fetch(`/data/${files.tomorrow}?` + Date.now())
            ]);
            const [yesterdayData, todayData, tomorrowData] = await Promise.all([
                yesterdayRes.json(), todayRes.json(), tomorrowRes.json()
            ]);
            showTidePopup(lastClickedCoordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                tideBed: { yesterday: yesterdayData, today: todayData, tomorrow: tomorrowData }
            });
        } catch (err) {
            showTidePopup(lastClickedCoordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: '캐시 데이터 로드에 실패했습니다.'
            });
        }
        return;
    }

    // 4단계: 폴링 (3개 병렬 체크 + 프로그레스)
    if (_tidePollTimer) clearInterval(_tidePollTimer);
    let pollCount = 0;
    const MAX_POLL = 120; // 500ms 간격이므로 60초
    const completedData = {};

    _tidePollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLL) {
            clearInterval(_tidePollTimer);
            _tidePollTimer = null;
            showTidePopup(lastClickedCoordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: '데이터 수집 시간이 초과되었습니다.'
            });
            return;
        }

        try {
            const checks = [];
            if (!completedData.today) checks.push(
                fetch(`/data/${files.today}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.today = d; }).catch(() => {})
            );
            if (!completedData.tomorrow) checks.push(
                fetch(`/data/${files.tomorrow}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.tomorrow = d; }).catch(() => {})
            );
            if (!completedData.yesterday) checks.push(
                fetch(`/data/${files.yesterday}?` + Date.now()).then(r => r.json()).then(d => { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.yesterday = d; }).catch(() => {})
            );

            await Promise.all(checks);

            const done = (completedData.today ? 1 : 0) + (completedData.tomorrow ? 1 : 0) + (completedData.yesterday ? 1 : 0);

            if (done === 3) {
                clearInterval(_tidePollTimer);
                _tidePollTimer = null;
                console.log('✅ 날짜 변경 후 3일치 TideBED 데이터 수신 완료');

                showTidePopup(lastClickedCoordinate, {
                    clickedLat: latitude.toFixed(6),
                    clickedLon: longitude.toFixed(6),
                    tideBed: { yesterday: completedData.yesterday, today: completedData.today, tomorrow: completedData.tomorrow }
                });
            }
        } catch (err) {
            console.log(`폴링 중... (${pollCount}/${MAX_POLL})`);
        }
    }, 500);
}

// ===== 지도 컨트롤 추가 =====
function addTideMapControls() {
    if (!tideMap) return;

    // 모바일 기기 여부 확인 (간단한 정규식 체크)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // [UI Change] 내 위치 버튼 표시 여부 결정
    const buttonStyle = isMobile ? '' : 'display: none !important;';

    const instructionControl = document.createElement('div');
    instructionControl.className = 'tide-map-control-instruction';
    // [UI Change] 내 위치 버튼 추가 (모바일에서만 보임)
    instructionControl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span class="tide-instruction-text">물 때를 확인할 위치를 클릭하세요</span>
            <button id="tide-my-location-btn" onclick="handleMyLocationClick()" style="
                background-color: #3b82f6; 
                color: white; 
                border: none; 
                border-radius: 4px; 
                padding: 4px 8px; 
                font-size: 0.8rem; 
                cursor: pointer; 
                font-weight: 500;
                box-shadow: 0 1px 2px rgba(0,0,0,0.2);
                ${buttonStyle}
            ">
                내 위치
            </button>
        </div>
    `;

    const instructionOverlay = new ol.control.Control({
        element: instructionControl
    });
    tideMap.addControl(instructionOverlay);

    // 내 위치 버튼 핸들러 (전역 노출)
    window.handleMyLocationClick = async function () {
        const btn = document.getElementById('tide-my-location-btn');
        if (!btn || btn.disabled) return;

        const originalText = btn.innerText;
        const now = Date.now();

        // 1. 10초 이내에 다시 누른 경우 캐시된 위치 즉시 사용
        if (_lastKnownLocation && (now - _lastLocationTimestamp < LOCATION_CACHE_LIMIT)) {
            const { lat, lon } = _lastKnownLocation;
            const center = ol.proj.fromLonLat([lon, lat]);

            // 팝업 없이 마커 표시 및 고배율 확대 (Zoom 17)
            updateMyLocationMarker(lat, lon);
            tideMap.getView().animate({ center: center, zoom: 17, duration: 500 });
            return;
        }

        // 2. 캐시가 없거나 만료된 경우 새로 조회
        btn.innerText = "확인 중...";
        btn.disabled = true;

        try {
            const position = await window.getCurrentPositionViaCapacitor();
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            // 캐시 업데이트
            _lastKnownLocation = { lat, lon };
            _lastLocationTimestamp = Date.now();

            const center = ol.proj.fromLonLat([lon, lat]);

            // 마커 표시 및 고배율 확대 (Zoom 17) - 팝업(handleTideMapClick) 제거
            updateMyLocationMarker(lat, lon);
            tideMap.getView().animate({ center: center, zoom: 17, duration: 500 });

            btn.innerText = originalText;
            btn.disabled = false;
        } catch (error) {
            console.error("위치 정보 오류:", error);
            let msg = "위치 정보를 가져올 수 없습니다.\n잠시 후 다시 시도해 주세요.";
            if (error.message === 'location_permission_denied') {
                msg = "위치 정보 사용 승인이 거부되었습니다.\n설정에서 권한을 허용해주세요.";
            } else if (error.code === 3) {
                // Timeout error
                msg = "위치 확인 시간이 초과되었습니다.\n수신 환경이 좋은 곳에서 다시 시도해 주세요.";
            } else if (error.code === 1) {
                msg = "위치 정보 사용 승인이 필요합니다.";
            }

            if (typeof window.showSeagnalModal === 'function') {
                window.showSeagnalModal('위치 확인 실패', msg, 'error');
            } else {
                alert(msg);
            }

            btn.innerText = originalText;
            btn.disabled = false;
        }
    };
}

// ===== 유틸리티: 음력 및 천문 =====

function getLunarDate(year, month, date) {
    const lunarNewYears = {
        2024: { solar: new Date(2024, 1, 10), lunarYear: 2024 },
        2025: { solar: new Date(2025, 0, 29), lunarYear: 2025 },
        2026: { solar: new Date(2026, 1, 17), lunarYear: 2026 },
        2027: { solar: new Date(2027, 1, 6), lunarYear: 2027 },
        2028: { solar: new Date(2028, 0, 26), lunarYear: 2028 },
    };

    const lunarMonthDays = {
        2024: [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29],
        2025: [30, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29],
        2026: [30, 29, 30, 30, 29, 30, 29, 29, 30, 29, 30, 29],
        2027: [30, 29, 30, 29, 30, 30, 29, 30, 29, 30, 29, 30],
    };

    const leapMonths = { 2025: 6 };

    const targetDate = new Date(year, month - 1, date);
    targetDate.setHours(0, 0, 0, 0);

    let baseYear = year;
    let baseInfo = lunarNewYears[baseYear];

    if (!baseInfo || targetDate < baseInfo.solar) {
        baseYear = year - 1;
        baseInfo = lunarNewYears[baseYear];
    }

    if (!baseInfo) return getLunarDateApprox(year, month, date);

    const diffDays = Math.floor((targetDate - baseInfo.solar) / (1000 * 60 * 60 * 24));

    let lunarYear = baseInfo.lunarYear;
    let lunarMonth = 1;
    let lunarDay = 1 + diffDays;
    let isLeapMonth = false;

    const monthDays = lunarMonthDays[lunarYear] || [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 30];
    const leapMonth = leapMonths[lunarYear];

    let monthIndex = 0;
    let realMonth = 1;

    while (lunarDay > monthDays[monthIndex]) {
        lunarDay -= monthDays[monthIndex];
        monthIndex++;

        if (leapMonth && realMonth === leapMonth && !isLeapMonth) {
            isLeapMonth = true;
        } else {
            isLeapMonth = false;
            realMonth++;
        }

        if (realMonth > 12) {
            lunarYear++;
            realMonth = 1;
            monthIndex = 0;
            if (!lunarMonthDays[lunarYear]) break;
        }

        if (monthIndex >= monthDays.length) break;
    }

    lunarMonth = realMonth;
    const leapText = isLeapMonth ? '(윤)' : '';
    return `${lunarYear}년 ${leapText}${lunarMonth}월 ${Math.floor(lunarDay)}일`;
}

/**
 * 양력 일자를 음력으로 근사 변환 — 정밀 음력 계산 라이브러리 부재 시 fallback.
 * 2024-01-01 을 기준점으로 평균 음력 주기(29.53일) 사용.
 *
 * [한계] 윤달/대소월 변화 미반영 → 약 ±1일 오차 가능. 정확한 음력은 getLunarDate 사용.
 */
function getLunarDateApprox(year, month, date) {
    const baseDate = new Date(2024, 0, 1);
    const baseLunarYear = 2023;
    const baseLunarMonth = 11;
    const baseLunarDay = 20;

    const currentDate = new Date(year, month - 1, date);
    const diffDays = Math.floor((currentDate - baseDate) / (1000 * 60 * 60 * 24));

    let lunarYear = baseLunarYear;
    let lunarMonth = baseLunarMonth;
    let lunarDay = baseLunarDay + diffDays;

    while (lunarDay > 29) {
        lunarDay -= 29;
        lunarMonth++;
        if (lunarMonth > 12) {
            lunarMonth = 1;
            lunarYear++;
        }
    }

    while (lunarDay < 1) {
        lunarDay += 29;
        lunarMonth--;
        if (lunarMonth < 1) {
            lunarMonth = 12;
            lunarYear--;
        }
    }

    return `${lunarYear}년 ${lunarMonth}월 ${Math.floor(lunarDay)}일`;
}

/**
 * 주어진 좌표·일자의 천문 정보(일출·일몰·월출·월몰·월령·달밝기) 반환.
 * SunCalc 라이브러리에 의존 — 미로드 시 null 반환.
 *
 * [반환] { sunrise, sunset, moonrise, moonset, moonPhase, moonIllumination, lunar }
 * [연계] 조석 팝업 + ocean_bottom_sheet4.js 천문 카드.
 */
function getAstronomyInfo(lat, lon, date) {
    if (typeof SunCalc === 'undefined') {
        console.warn('SunCalc 라이브러리가 로드되지 않았습니다.');
        return null;
    }

    try {
        const sunTimes = SunCalc.getTimes(date, lat, lon);
        const moonTimes = SunCalc.getMoonTimes(date, lat, lon);
        const moonIllumination = SunCalc.getMoonIllumination(date);

        const formatTimeHHMM = (d) => {
            if (!d || isNaN(d.getTime())) return '--:--';
            return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
        };

        const lunarAge = moonIllumination.phase * 29.53;
        let moonPhaseName = '', moonPhaseIcon = '';
        const phase = moonIllumination.phase;

        if (phase < 0.03 || phase >= 0.97) { moonPhaseName = '삭(신월)'; moonPhaseIcon = '🌑'; }
        else if (phase < 0.22) { moonPhaseName = '초승달'; moonPhaseIcon = '🌒'; }
        else if (phase < 0.28) { moonPhaseName = '상현달'; moonPhaseIcon = '🌓'; }
        else if (phase < 0.47) { moonPhaseName = '상현망간'; moonPhaseIcon = '🌔'; }
        else if (phase < 0.53) { moonPhaseName = '보름달'; moonPhaseIcon = '🌕'; }
        else if (phase < 0.72) { moonPhaseName = '망하현간'; moonPhaseIcon = '🌖'; }
        else if (phase < 0.78) { moonPhaseName = '하현달'; moonPhaseIcon = '🌗'; }
        else { moonPhaseName = '그믐달'; moonPhaseIcon = '🌘'; }

        return {
            sunrise: formatTimeHHMM(sunTimes.sunrise),
            sunset: formatTimeHHMM(sunTimes.sunset),
            moonrise: formatTimeHHMM(moonTimes.rise),
            moonset: formatTimeHHMM(moonTimes.set),
            lunarAge: lunarAge.toFixed(1),
            moonPhaseName,
            moonPhaseIcon,
            moonIllumination: Math.round(moonIllumination.fraction * 100)
        };
    } catch (error) {
        console.error('천문정보 계산 오류:', error);
        return null;
    }
}

/**
 * 물때 번호(1~15) 산출 함수
 *
 * [역할]
 * 오늘/어제/내일 조석 피크 데이터와 조화상수(M2/S2)를 이용해
 * 물때 번호(1물~14물·조금)를 계산합니다.
 * tide.js와 ocean_bottom_sheet3.js 양쪽에서 호출할 수 있도록
 * 전역 함수로 선언합니다.
 *
 * [계산 원리]
 * ① 오늘 조차 = 오늘 최고조위 - 오늘 최저조위
 * ② 평균 대조차 = 2 × (M2 + S2)  [없으면 3일치 최대로 추정]
 * ③ 조차 비율 = ① ÷ ② × 100%
 * ④ 방향 = 어제보다 조차가 크면 사리 방향, 작으면 조금 방향
 *          (변화량 5cm 미만이면 월령으로 보완)
 * ⑤ 비율 + 방향 → 물때 번호 결정 (레퍼런스 표 기반)
 *
 * [연계]
 * - tide.js showTidePopup() → getTideProgressHTML() 게이지 라벨 행
 * - ocean_bottom_sheet3.js renderTideData() → 조석 타이틀 옆 배지
 *
 * @param {Array}  todayPeaks      - 오늘 피크 [{type:'high'|'low', level:number}, ...]
 * @param {Array}  yesterdayPeaks  - 어제 피크 (방향 판단용, 없으면 null)
 * @param {Array}  tomorrowPeaks   - 내일 피크 (평균 대조차 추정 보조, 없으면 null)
 * @param {Object} tideBedDataRow  - TideBED 조화상수 행 {m2TconstAmp, s2TconstAmp, ...}
 * @param {Date}   dateObj         - 기준 날짜 (월령 계산용)
 * @param {number} [lat]           - 위치 위도 (서해 판별용, 생략 시 남해 기준)
 * @param {number} [lon]           - 위치 경도 (서해 판별용, 생략 시 남해 기준)
 * @returns {Object|null} { number, label, direction } 또는 null(계산 불가)
 */

/**
 * 서해(Yellow Sea) 해역 여부 판별
 * - 서해안은 무시(無市) 포함 16단계 사이클로 남해보다 물때 번호가 1 낮음
 * 검증 데이터: 인천·태안·군산·목포·진도 → 서해, 해남·완도·여수·통영·부산·제주 → 남해
 */
function isWestSea(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    // ① 경기/충남/전북/전남북부 서해안: 위도 35°N 이상, 경도 128°E 미만
    if (lat >= 35.0 && lon < 128.0) return true;
    // ② 전남 서부 (목포·진도·신안 등): 위도 34.3°N 이상, 경도 126.5°E 미만
    if (lat >= 34.3 && lon < 126.5) return true;
    return false;
}

/**
 * 음력(월령) 기반 물때(만조·간조 강도) 계산 — 바다타임과 동일 방식.
 * SunCalc 월령으로 가장 가까운 조금(neap) 까지의 거리로 물때 결정.
 *
 * [반환] { mul, name, descr } — 1~15 사이 정수 + "조금"/"한사리" 등 명칭.
 * [연계] 조석 팝업 카드 + 어업 정보 표출.
 */
function computeMulddae(todayPeaks, yesterdayPeaks, tomorrowPeaks, tideBedDataRow, dateObj, lat, lon) {
    // ── 음력(월령) 기반 물때 계산 ─────────────────────────────────────────
    // 바다타임과 동일한 방식: SunCalc 월령으로 가장 가까운 조금까지의
    // 거리를 구하여 물때 번호를 산출한다.
    //
    // 물때 주기 구조 (한 반주기 ≈ 14.77일):
    //   조금(15물) → 1물 → ... → 7물 → 8물(한사리) → 9물 → ... → 14물 → 조금
    //
    // 조금 기준점: 상현 직후 ≈ 월령 7.38일, 하현 직후 ≈ 월령 22.14일
    // ─────────────────────────────────────────────────────────────────────

    if (!dateObj || typeof SunCalc === 'undefined') return null;

    try {
        // 1. SunCalc으로 월령(lunar age) 산출 (0 ~ 29.53일)
        var moonIllum = SunCalc.getMoonIllumination(dateObj);
        var lunarAge  = moonIllum.phase * 29.53;

        // 2. 조금 기준점 목록 (상현 후·하현 후)
        var JOGEOM_POINTS = [7.38, 22.14];
        var HALF_CYCLE    = 14.765;          // 29.53 / 2 (반주기, 일)
        var STEP_SIZE     = HALF_CYCLE / 15; // 물때 1단계 ≈ 0.984일

        // 3. 가장 가까운 조금까지의 부호 있는 거리 계산
        //    양수: 조금 이후(사리 방향), 음수: 조금 이전(한사리→조금 방향)
        var nearestDist = null;
        JOGEOM_POINTS.forEach(function(jp) {
            var d = lunarAge - jp;
            // 29.53일 주기로 정규화 → [-HALF_CYCLE, +HALF_CYCLE] 범위
            while (d >  HALF_CYCLE) d -= 29.53;
            while (d < -HALF_CYCLE) d += 29.53;
            if (nearestDist === null || Math.abs(d) < Math.abs(nearestDist)) {
                nearestDist = d;
            }
        });

        if (nearestDist === null) return null;

        // 4. 물때 단계(step) 계산
        //    step 범위: -7(한사리) ~ 0(조금) ~ +7(한사리 직전)
        var step = Math.round(nearestDist / STEP_SIZE);
        step = Math.max(-7, Math.min(7, step));

        // 5. 물때 번호 결정
        //    남해/동해 기준 (공통):
        //      step =  0       → 15 (조금)
        //      step =  1 ~  7  → 1물 ~ 7물  (조금 후, 사리 방향)
        //      step = -1 ~ -7  → 14물 ~ 8물 (사리 후, 조금 방향)
        //    서해 보정 (-1 shift, 무시 포함):
        //      step =  0       → 조금 (동일)
        //      step =  1       → 무시 (조류 극히 약해 조업 의미 없는 날)
        //      step =  2 ~  7  → 1물 ~ 6물
        //      step = -1 ~ -7  → 13물 ~ 7물
        var westSea = isWestSea(lat, lon);
        var number, label;

        if (step === 0) {
            // 조금: 서해/남해 동일
            number = 15;
            label  = '조금';
        } else if (westSea) {
            // ── 서해 사이클 (무시 포함) ────────────────────────────────
            if (step === 1) {
                number = 0;
                label  = '무시';                   // 조금 다음날 = 조류 극소
            } else if (step > 1) {
                number = step - 1;                 // 2→1물, 3→2물, ..., 7→6물
                label  = number + '물';
            } else {
                number = 14 + step;                // -1→13물, -2→12물, ..., -7→7물
                label  = number + '물';
            }
        } else {
            // ── 남해/동해 사이클 (표준) ───────────────────────────────
            if (step > 0) {
                number = step;                     // 1물 ~ 7물
            } else {
                number = 15 + step;                // 8물 ~ 14물
            }
            label = number + '물';
        }

        // 6. 결과 반환
        var direction = nearestDist >= 0 ? 'rising' : 'falling'; // 사리 방향 or 조금 방향
        return {
            number:    number,
            label:     label,       // '7물', '조금', '무시' 등 화면 표시 문자열
            direction: direction,
            westSea:   westSea,     // 디버그용 해역 구분
            lunarAge:  Math.round(lunarAge * 10) / 10  // 디버그용 월령(일)
        };

    } catch (e) {
        return null;
    }
}

/**
 * getAstronomyInfo 결과 객체를 카드형 HTML 문자열로 변환.
 * 일출/일몰/월령/달밝기 + 음력 일자 표시. 빈 입력은 빈 문자열.
 */
function getAstronomyInfoHTML(astro) {
    if (!astro) return '';

    return `
        <div class="astronomy-info">
            <div class="astronomy-section-title">
                <i class="fa-solid fa-sun"></i> 태양 / <i class="fa-solid fa-moon"></i> 달 정보
            </div>
            <div class="astronomy-row">
                <div class="astronomy-item"><span class="astro-label">🌅 일출</span><span class="astro-value">${astro.sunrise}</span></div>
                <div class="astronomy-item"><span class="astro-label">🌇 일몰</span><span class="astro-value">${astro.sunset}</span></div>
            </div>
            <div class="astronomy-row">
                <div class="astronomy-item"><span class="astro-label">🌙 월출</span><span class="astro-value">${astro.moonrise}</span></div>
                <div class="astronomy-item"><span class="astro-label">🌑 월몰</span><span class="astro-value">${astro.moonset}</span></div>
            </div>
            <div class="astronomy-row moon-phase-row">
                <div class="astronomy-item moon-phase"><span class="moon-phase-icon">${astro.moonPhaseIcon}</span></div>
                <div class="astronomy-item"><span class="astro-label">월령</span><span class="astro-value">${astro.lunarAge}일</span></div>
                <div class="astronomy-item"><span class="astro-label">밝기</span><span class="astro-value">${astro.moonIllumination}%</span></div>
            </div>
        </div>
    `;
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', function () {
    const tideTabs = document.querySelectorAll('.tab-btn[data-target="tide-section"]');
    tideTabs.forEach(btn => {
        btn.addEventListener('click', function () {
            // 탭 전환 애니메이션 시간 등을 고려하여 약간의 지연 후 초기화
            setTimeout(() => {
                initTideMap();
            }, 100);
        });
    });

    // 만약 초기 접속 시 바로 물때 탭인 경우를 대비해
    if (document.getElementById('tide-section') &&
        document.getElementById('tide-section').classList.contains('active')) {
        initTideMap();
    }
});

// ===== 실시간 조석 게이지 로직 =====

function getTideProgress(sortedTides, currentDate, prevDayTide = null, nextDayTide = null, currentTideLevel = null) {
    if (!sortedTides || sortedTides.length === 0) return null;

    const now = new Date();
    const isToday = now.getFullYear() === currentDate.getFullYear() &&
        now.getMonth() === currentDate.getMonth() &&
        now.getDate() === currentDate.getDate();

    if (!isToday) return null;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let prevTide = null;
    let nextTide = null;

    // 현재 시각 기준 이전/다음 물때 찾기
    for (let i = 0; i < sortedTides.length; i++) {
        const tMinutes = timeToMinutes(sortedTides[i].timeRaw);
        if (tMinutes > currentMinutes) {
            nextTide = sortedTides[i];
            if (i > 0) {
                prevTide = sortedTides[i - 1];
            } else if (prevDayTide) {
                prevTide = { ...prevDayTide };
                prevTide.timeRawAdjusted = timeToMinutes(prevDayTide.timeRaw) - 1440;
            }
            break;
        }
    }

    // 다음 물때가 없으면 다음날 첫 물때 활용
    if (!nextTide) {
        if (nextDayTide) {
            prevTide = sortedTides[sortedTides.length - 1];
            nextTide = { ...nextDayTide };
            nextTide.timeRawAdjusted = timeToMinutes(nextDayTide.timeRaw) + 1440;
        } else {
            return null;
        }
    }

    if (!prevTide || !nextTide) return null;

    const prevMinutes = prevTide.timeRawAdjusted !== undefined ? prevTide.timeRawAdjusted : timeToMinutes(prevTide.timeRaw);
    const nextMinutes = nextTide.timeRawAdjusted !== undefined ? nextTide.timeRawAdjusted : timeToMinutes(nextTide.timeRaw);
    const totalDuration = nextMinutes - prevMinutes;

    // 조석 주기 상한을 10시간(600분)에서 13시간(780분)으로 완화 (동해 등 일조부등 대응)
    if (totalDuration > 780 || totalDuration <= 0) {
        return null;
    }

    const elapsed = currentMinutes - prevMinutes;
    let percent = (elapsed / totalDuration) * 100;
    percent = Math.min(100, Math.max(0, percent));

    // 현재 조위: TideBED 1분 데이터가 있으면 직접 사용, 없으면 코사인 보간
    let currentLevel;
    if (currentTideLevel !== null && !isNaN(currentTideLevel)) {
        currentLevel = Math.round(currentTideLevel);
    } else {
        const t = elapsed / totalDuration;
        const cosFactor = (1 - Math.cos(t * Math.PI)) / 2;
        currentLevel = Math.round(prevTide.level + (nextTide.level - prevTide.level) * cosFactor);
    }

    const status = nextTide.type === 'high' ? 'rising' : 'falling';
    const statusText = status === 'rising' ? '밀물 (들물)' : '썰물 (날물)';

    return {
        prev: prevTide,
        next: nextTide,
        percent: percent.toFixed(1),
        currentLevel: currentLevel,
        status: status,
        statusText: statusText,
        remainingMinutes: nextMinutes - currentMinutes
    };
}

/**
 * 조석 진행 게이지 HTML 생성 함수
 *
 * [역할]
 * getTideProgress()가 계산한 진행 상태를 화면 HTML로 변환합니다.
 * - 상단 라벨행: 고조(좌) / 물때 번호(중앙, 흰색·볼드·+2pt) / 저조(우)
 * - 진행 바: 색상 그라데이션 + 원형 마커 + 남은시간
 * - 현재 예상 조위 표시
 *
 * [연계]
 * - showTidePopup()에서 직접 호출 (최초 렌더)
 * - startGaugeAutoRefresh()에서 1분마다 재호출 (실시간 갱신)
 *
 * @param {Object}      progress    - getTideProgress() 반환값
 * @param {Object|null} mulddaeInfo - computeMulddae() 반환값 (없으면 null → 중앙 공백)
 * @returns {string} HTML 문자열
 */
function getTideProgressHTML(progress, mulddaeInfo) {
    if (!progress) return '';

    const { prev, next, percent, currentLevel, status } = progress;

    // 색상 테마: 밀물(Rising/Red), 썰물(Falling/Blue)
    const colorRising = '#ef4444'; // Red 500
    const colorFalling = '#3b82f6'; // Blue 500

    const themeColor = status === 'rising' ? colorRising : colorFalling;
    const gradient = status === 'rising'
        ? `linear-gradient(90deg, #991b1b 0%, ${colorRising} 100%)`
        : `linear-gradient(90deg, #1e3a8a 0%, ${colorFalling} 100%)`;

    // 좌우 라벨 스타일링 (고조-빨강 / 저조-파랑)
    const getLabel = (t) => {
        const color = t.type === 'high' ? '#f87171' : '#60a5fa';
        const typeText = t.type === 'high' ? '고조' : '저조';
        return `<div style="color: ${color}; font-weight: 600;">${typeText} ${t.time}</div>`;
    };

    // 물때 중앙 라벨: 고조/저조 폰트(0.75rem)보다 약 +2pt 크게(≈0.92rem), 흰색·볼드
    // mulddaeInfo가 없으면 빈 div로 공간만 유지해 좌우 라벨 위치 고정
    const mulddaeCenterHtml = mulddaeInfo
        ? `<div style="
                color: #ffffff;
                font-weight: 700;
                font-size: 0.92rem;
                white-space: nowrap;
                text-align: center;
                flex: 1;
                padding: 0 4px;
            ">${mulddaeInfo.label}</div>`
        : `<div style="flex: 1;"></div>`;

    return `
        <div class="tide-progress-wrapper" style="
            margin-top: 4px;
            margin-bottom: 2px;
            background: rgba(15, 23, 42, 0.4);
            border-radius: 8px;
            padding: 4px 10px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        ">
            <!-- 타임라인 라벨: 고조(좌) / 물때(중앙) / 저조(우) -->
            <!-- space-between + 3자녀 → 자동으로 양끝·중앙 균등 배치 -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; margin-bottom: 6px;">
                ${getLabel(prev)}
                ${mulddaeCenterHtml}
                ${getLabel(next)}
            </div>

            <!-- 프로그레스 바 트랙 -->
            <div style="position: relative; height: 6px; background: #334155; border-radius: 3px; margin: 0 1px;">
                <!-- 진행 바 -->
                <div style="
                    position: absolute;
                    top: 0; left: 0; bottom: 0;
                    width: ${percent}%;
                    background: ${gradient};
                    border-radius: 3px;
                    transition: width 1s ease-in-out;
                "></div>

                <!-- [New] 회색 영역 중앙에 남은 시간 표시 (##:##) -->
                ${progress.remainingMinutes > 0 ? `
                <div style="
                    position: absolute;
                    left: ${(parseFloat(percent) + 100) / 2}%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 0.65rem;
                    font-weight: 700;
                    color: rgba(255, 255, 255, 0.5);
                    white-space: nowrap;
                    pointer-events: none;
                    font-family: 'Roboto Mono', monospace;
                    letter-spacing: -0.5px;
                ">
                    ${Math.floor(progress.remainingMinutes / 60).toString().padStart(2, '0')}:${(progress.remainingMinutes % 60).toString().padStart(2, '0')}
                </div>
                ` : ''}
            </div>

            <!-- 현재 예상 조위 정보 (여백 최소화) -->
            <div style="
                text-align: center; 
                margin-top: 6px; 
                font-size: 0.8rem; 
                color: #94a3b8;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
            ">
                <span>현재 예상 조위</span>
                <span style="
                    font-size: 1rem; 
                    font-weight: 700; 
                    color: ${themeColor};
                ">
                    ${currentLevel}cm
                </span>
                <span style="font-size: 0.75rem; opacity: 0.9; color: ${themeColor}; font-weight: bold;">
                    ${status === 'rising' ? '▲' : '▼'}
                </span>
            </div>
        </div>
    `;
}

// ========================================================================
// 외부 모듈용: 조석 상세 팝업 (바다낚시 등에서 호출)
// ========================================================================

/**
 * 특정 경위도의 조석 현황을 독립 모달 팝업으로 표시합니다.
 * 바다낚시 예보 팝업에서 [조석상세] 버튼 클릭 시 호출됩니다.
 *
 * [동작 흐름]
 * 1. 로딩 모달 표시
 * 2. /api/save_tide_input API 호출 (경위도 기반 격자 수집 요청)
 * 3. 데이터 폴링 (3일치: 어제/오늘/내일)
 * 4. 조석 현황 렌더링 (고조/저조, 현재조위, 게이지, 태양/달 정보)
 * 5. 즐겨찾기 버튼은 미표시
 *
 * [연계 파일]
 * - js/fishing.js → _buildTimeBlock()에서 [조석상세] 버튼으로 호출
 * - tide.js 내부 → timeToMinutes(), getAstronomyInfo/HTML(), getTideProgress/HTML() 재사용
 *
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @param {string} placeName - 지역명 (팝업 헤더에 표시)
 */
/**
 * TideBED 방식 낚시 지점의 좌표 보정 맵
 * 육지/해안 경계에 있는 낚시 포인트를 0.5해리(≈926m ≈ 0.00833°) 해상으로 이동
 * 키: 지역명에 포함되는 문자열, 값: { dlat, dlon } (위경도 오프셋)
 */
const TIDE_COORD_OFFSETS = {
    '국화도':  { dlat:  0.00833, dlon: 0 },        // 북쪽으로 0.5해리
    '어청도':  { dlat: 0, dlon: -0.00833 },         // 서쪽으로 0.5해리
    '신시도':  { dlat: -0.00833, dlon: 0 },          // 남쪽으로 0.5해리
    '비금도':  { dlat:  0.00833, dlon: 0 },          // 북쪽으로 0.5해리
    '상태도':  { dlat: 0, dlon: -0.00833 },         // 서쪽으로 0.5해리
    '하조도':  { dlat: 0, dlon: -0.00833 },         // 서쪽으로 0.5해리
    '가거도':  { dlat: 0, dlon: -0.00833 },         // 서쪽으로 0.5해리
    '추자도':  { dlat: 0.01667, dlon: 0 },           // 북쪽으로 1해리
    '신지도':  { dlat:  0.00833, dlon: 0 },          // 북쪽으로 0.5해리
    '연도':    { dlat: -0.00833, dlon: 0 },          // 남쪽으로 0.5해리
    '욕지도':  { dlat: -0.00833, dlon: 0 },          // 남쪽으로 0.5해리
    '울산':    { dlat: 0, dlon:  0.00833 }           // 동쪽으로 0.5해리
};

/**
 * 기준항 IDW 보간법으로 조석을 산출하는 지점 목록
 * TideBED 데이터가 제공되지 않는 동해안 지점에서 사용
 */
const IDW_CALC_PLACES = ['포항', '후포', '울진', '후정', '대진항', '남애항', '외옹치항', '아야진항', '울릉도', '공현진항', '강릉항', '임원항', '양포항'];

window.showTideDetailForLocation = async function (lat, lon, placeName) {
    // 기존 조석상세 모달이 있으면 제거
    _closeTideDetailModal();

    // 1단계: 로딩 모달 즉시 표시
    _showTideDetailModal(placeName, _buildTideDetailLoading(lat, lon));

    // IDW 보간법 사용 여부 판별 (동해안 자체 산출 지점)
    var useIDW = IDW_CALC_PLACES.some(function (keyword) {
        return placeName && placeName.indexOf(keyword) !== -1;
    });

    if (useIDW) {
        // === IDW 보간법 경로 (기준항 기반 자체 산출) ===
        try {
            var now = new Date();
            var y = now.getFullYear();
            await loadTideData(String(y));
            var dates = getClientAdjacentDates(now);
            // 연말연시 전후년 데이터 로드
            var years = new Set([dates.yesterdayObj.getFullYear(), dates.todayObj.getFullYear(), dates.tomorrowObj.getFullYear()]);
            for (var yr of years) {
                if (yr !== y) await loadTideData(String(yr));
            }

            var keyMap = { yesterday: dates.yesterday, today: dates.today, tomorrow: dates.tomorrow };
            var result = { yesterday: null, today: null, tomorrow: null };

            for (var key in keyMap) {
                var stations = findNearestStationsWithData(lat, lon, keyMap[key], 3);
                if (stations.length === 0) throw new Error('근거 데이터 부족');
                var idw = interpolateTideByIDW(stations);
                result[key] = convertIDWToTideBedFormat(idw, keyMap[key]);
                result[key].isInterpolated = true;
            }

            console.log('⚡ 조석상세: IDW 보간법 적용 -', placeName);
            _showTideDetailModal(placeName, _buildTideDetailContent(lat, lon, result));
        } catch (e) {
            console.error('조석상세 IDW 오류:', e);
            _showTideDetailModal(placeName, _buildTideDetailError('조석 예보를 위한 근거 데이터가 부족합니다.', lat, lon));
        }
        return;
    }

    // === TideBED API 경로 ===

    // 좌표 보정 적용 (육지/해안 경계 지점 → 해상으로 0.5해리 이동)
    var adjustedLat = lat;
    var adjustedLon = lon;
    for (var keyword in TIDE_COORD_OFFSETS) {
        if (placeName && placeName.indexOf(keyword) !== -1) {
            var offset = TIDE_COORD_OFFSETS[keyword];
            adjustedLat = lat + offset.dlat;
            adjustedLon = lon + offset.dlon;
            console.log('⚡ 조석상세: 좌표 보정 적용 -', placeName, '→', adjustedLat.toFixed(5), adjustedLon.toFixed(5));
            break;
        }
    }

    // 오늘 날짜 (YYYYMMDD 형식)
    var now = new Date();
    var dateNum = parseInt(
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0')
    );
    var timeString = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join(':');

    // 서버에 수집 요청 (보정된 좌표 사용)
    var serverResponse;
    try {
        var res = await fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateNum, time: timeString, lat: adjustedLat, lon: adjustedLon })
        });
        serverResponse = await res.json();
        if (!serverResponse.success) {
            var errMsg = serverResponse.error === 'Grid hash unavailable'
                ? '국립해양조사원 조석 예측정보가 제공되지 않는 해역입니다.'
                : '서버 요청에 실패했습니다.';
            _showTideDetailModal(placeName, _buildTideDetailError(errMsg, lat, lon));
            return;
        }
    } catch (err) {
        _showTideDetailModal(placeName, _buildTideDetailError(err.message, lat, lon));
        return;
    }

    var files = serverResponse.files;

    // 캐시 히트 → 즉시 렌더링
    if (serverResponse.collecting === 0) {
        try {
            var responses = await Promise.all([
                fetch('/data/' + files.yesterday + '?' + Date.now()),
                fetch('/data/' + files.today + '?' + Date.now()),
                fetch('/data/' + files.tomorrow + '?' + Date.now())
            ]);
            var data = await Promise.all(responses.map(function (r) { return r.json(); }));
            _showTideDetailModal(placeName, _buildTideDetailContent(lat, lon, { yesterday: data[0], today: data[1], tomorrow: data[2] }));
        } catch (err) {
            _showTideDetailModal(placeName, _buildTideDetailError('캐시 데이터 로드에 실패했습니다.', lat, lon));
        }
        return;
    }

    // 폴링 (500ms 간격, 최대 120회 = 60초)
    var pollCount = 0;
    var completedData = {};
    var pollTimer = setInterval(async function () {
        pollCount++;
        if (pollCount > 120) {
            clearInterval(pollTimer);
            _showTideDetailModal(placeName, _buildTideDetailError('데이터 수집 시간이 초과되었습니다.', lat, lon));
            return;
        }
        try {
            var checks = [];
            if (!completedData.today) checks.push(fetch('/data/' + files.today + '?' + Date.now()).then(function (r) { return r.json(); }).then(function (d) { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.today = d; }).catch(function () {}));
            if (!completedData.tomorrow) checks.push(fetch('/data/' + files.tomorrow + '?' + Date.now()).then(function (r) { return r.json(); }).then(function (d) { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.tomorrow = d; }).catch(function () {}));
            if (!completedData.yesterday) checks.push(fetch('/data/' + files.yesterday + '?' + Date.now()).then(function (r) { return r.json(); }).then(function (d) { if ((d.tideBedStatus === 'complete' || d.tideBedStatus === 'complete-quick')) completedData.yesterday = d; }).catch(function () {}));
            await Promise.all(checks);
            var done = (completedData.today ? 1 : 0) + (completedData.tomorrow ? 1 : 0) + (completedData.yesterday ? 1 : 0);
            if (done === 3) {
                clearInterval(pollTimer);
                _showTideDetailModal(placeName, _buildTideDetailContent(lat, lon, completedData));
            }
        } catch (err) { /* 폴링 진행 중 */ }
    }, 500);
};

/**
 * 조석상세 모달을 생성하고 화면에 표시합니다.
 * 기존 모달이 있으면 내용만 업데이트합니다.
 * @param {string} placeName - 지역명 (헤더에 표시)
 * @param {string} bodyHtml - 모달 본문 HTML
 */
function _showTideDetailModal(placeName, bodyHtml) {
    var overlay = document.getElementById('tide-detail-overlay');
    var popup = document.getElementById('tide-detail-popup');

    // 오버레이가 없으면 새로 생성
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tide-detail-overlay';
        overlay.className = 'tide-detail-overlay';
        overlay.addEventListener('click', function () { _closeTideDetailModal(); });
        document.body.appendChild(overlay);
    }

    // 팝업이 없으면 새로 생성
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'tide-detail-popup';
        popup.className = 'tide-detail-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });
        document.body.appendChild(popup);

        // PopupStack 등록 (뒤로가기 버튼 지원)
        if (window.PopupStack) {
            window.PopupStack.push('tide-detail-popup', function () {
                _closeTideDetailModal();
            });
        }
    }

    // 팝업 내용 렌더링 (헤더 + 본문)
    popup.innerHTML =
        '<div class="tide-detail-header">' +
            '<span>조석 현황 - ' + (placeName || '') + '</span>' +
            '<button class="tide-detail-close" onclick="window._closeTideDetailModal()"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="tide-detail-body">' + bodyHtml + '</div>';
}

/**
 * 조석상세 모달을 닫고 DOM에서 제거합니다.
 * PopupStack에서도 제거하여 뒤로가기 순서를 유지합니다.
 */
function _closeTideDetailModal() {
    var overlay = document.getElementById('tide-detail-overlay');
    var popup = document.getElementById('tide-detail-popup');
    if (overlay) overlay.remove();
    if (popup) popup.remove();
    if (window.PopupStack) {
        window.PopupStack.remove('tide-detail-popup');
    }
}
window._closeTideDetailModal = _closeTideDetailModal;

/**
 * 로딩 상태 HTML을 생성합니다 (스피너 + 안내 메시지).
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @returns {string} 로딩 HTML
 */
function _buildTideDetailLoading(lat, lon) {
    return '<div style="display:flex;flex-direction:column;align-items:center;padding:30px 10px;">' +
        '<div style="width:36px;height:36px;border:3px solid rgba(255,255,255,0.1);border-top:3px solid #3b82f6;border-radius:50%;animation:spin 1s linear infinite;"></div>' +
        '<div style="margin-top:12px;color:#94a3b8;font-size:0.85rem;text-align:center;">조석 예측정보를 불러오고 있습니다.</div>' +
        '<div style="margin-top:4px;color:#64748b;font-size:0.7rem;">약 3~5초 소요됩니다</div>' +
        '</div>' +
        '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>';
}

/**
 * 에러 상태 HTML을 생성합니다.
 * @param {string} msg - 에러 메시지
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @returns {string} 에러 HTML
 */
function _buildTideDetailError(msg, lat, lon) {
    return '<div class="tide-error" style="padding:20px;text-align:center;">' +
        '<i class="fa-solid fa-circle-exclamation"></i>' +
        '<p>' + msg + '</p>' +
        '</div>' +
        '<div style="text-align:center;font-size:0.7rem;color:#94a3b8;padding:8px;">' +
        lat.toFixed(4) + '°N, ' + lon.toFixed(4) + '°E</div>';
}

/**
 * 조석 데이터 기반 본문 HTML을 생성합니다.
 * showTidePopup()의 렌더링 로직을 재사용하되, 즐겨찾기 제외.
 *
 * [표시 항목]
 * - 조석 게이지 (밀물/썰물 진행률, 현재 조위)
 * - 고조/저조 시각·조고·변화량
 * - 태양/달 정보 (일출몰, 월출몰, 월령)
 * - 좌표 정보
 *
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @param {Object} tideBed - { yesterday, today, tomorrow } 3일치 조석 데이터
 * @returns {string} 조석 현황 HTML
 */
function _buildTideDetailContent(lat, lon, tideBed) {
    var html = '';
    var today = tideBed.today;
    var yesterday = tideBed.yesterday;
    var tomorrow = tideBed.tomorrow;

    // 천문 정보 (일출몰, 달 등)
    var astroInfo = getAstronomyInfo(lat, lon, new Date());

    // 고조/저조 목록 구성 + 시간순 정렬
    var allTides = [];
    if (today.highTide1) allTides.push({ type: 'high', timeRaw: today.highTide1.time, time: today.highTide1.time, level: today.highTide1.height });
    if (today.highTide2) allTides.push({ type: 'high', timeRaw: today.highTide2.time, time: today.highTide2.time, level: today.highTide2.height });
    if (today.lowTide1) allTides.push({ type: 'low', timeRaw: today.lowTide1.time, time: today.lowTide1.time, level: today.lowTide1.height });
    if (today.lowTide2) allTides.push({ type: 'low', timeRaw: today.lowTide2.time, time: today.lowTide2.time, level: today.lowTide2.height });
    allTides.sort(function (a, b) { return timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw); });

    // 전일 마지막 고조/저조 (변화량 계산용)
    var prevDayLastHigh = null, prevDayLastLow = null, prevDayLastTide = null;
    if (yesterday.highTide2) prevDayLastHigh = yesterday.highTide2.height;
    else if (yesterday.highTide1) prevDayLastHigh = yesterday.highTide1.height;
    if (yesterday.lowTide2) prevDayLastLow = yesterday.lowTide2.height;
    else if (yesterday.lowTide1) prevDayLastLow = yesterday.lowTide1.height;

    var yesterdayPeaks = [];
    if (yesterday.highTide1) yesterdayPeaks.push({ type: 'high', timeRaw: yesterday.highTide1.time, level: yesterday.highTide1.height });
    if (yesterday.highTide2) yesterdayPeaks.push({ type: 'high', timeRaw: yesterday.highTide2.time, level: yesterday.highTide2.height });
    if (yesterday.lowTide1) yesterdayPeaks.push({ type: 'low', timeRaw: yesterday.lowTide1.time, level: yesterday.lowTide1.height });
    if (yesterday.lowTide2) yesterdayPeaks.push({ type: 'low', timeRaw: yesterday.lowTide2.time, level: yesterday.lowTide2.height });
    yesterdayPeaks.sort(function (a, b) { return timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw); });
    if (yesterdayPeaks.length > 0) {
        var last = yesterdayPeaks[yesterdayPeaks.length - 1];
        prevDayLastTide = { type: last.type, timeRaw: last.timeRaw, time: last.timeRaw, level: last.level };
    }

    // 익일 첫 피크 (게이지용)
    var nextDayFirstTide = null;
    var tomorrowPeaks = [];
    if (tomorrow.highTide1) tomorrowPeaks.push({ type: 'high', timeRaw: tomorrow.highTide1.time, level: tomorrow.highTide1.height });
    if (tomorrow.highTide2) tomorrowPeaks.push({ type: 'high', timeRaw: tomorrow.highTide2.time, level: tomorrow.highTide2.height });
    if (tomorrow.lowTide1) tomorrowPeaks.push({ type: 'low', timeRaw: tomorrow.lowTide1.time, level: tomorrow.lowTide1.height });
    if (tomorrow.lowTide2) tomorrowPeaks.push({ type: 'low', timeRaw: tomorrow.lowTide2.time, level: tomorrow.lowTide2.height });
    tomorrowPeaks.sort(function (a, b) { return timeToMinutes(a.timeRaw) - timeToMinutes(b.timeRaw); });
    if (tomorrowPeaks.length > 0) {
        var first = tomorrowPeaks[0];
        nextDayFirstTide = { type: first.type, timeRaw: first.timeRaw, time: first.timeRaw, level: first.level };
    }

    // 현재 조위 (1분 데이터에서 추출)
    var currentTideLevel = null;
    var now = new Date();
    if (today.tideBedData && today.tideBedData.length > 0) {
        var nowTimeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var closestDiff = Infinity;
        for (var i = 0; i < today.tideBedData.length; i++) {
            var itemTime = today.tideBedData[i].slctdDt ? today.tideBedData[i].slctdDt.split(' ')[1] : null;
            if (!itemTime) continue;
            var diff = Math.abs(timeToMinutes(itemTime) - timeToMinutes(nowTimeStr));
            if (diff < closestDiff) {
                closestDiff = diff;
                currentTideLevel = parseFloat(today.tideBedData[i].slctdHgt);
            }
        }
    }

    // 게이지 표시 (데이터 충분 + complete 상태)
    var totalTideCount = allTides.length;
    var isTideBedProvided = (today.tideBedStatus === 'complete' || today.tideBedStatus === 'complete-quick');
    if (totalTideCount > 2 && isTideBedProvided) {
        var tideProgress = getTideProgress(allTides, new Date(), prevDayLastTide, nextDayFirstTide, currentTideLevel);
        if (tideProgress && (currentTideLevel === null || isNaN(currentTideLevel))) {
            currentTideLevel = tideProgress.currentLevel;
        }
        if (tideProgress) {
            html += getTideProgressHTML(tideProgress);
        }
    }

    // 변화량 계산 (▲▼)
    for (var i = 0; i < allTides.length; i++) {
        var tidalRange = null;
        for (var j = i - 1; j >= 0; j--) {
            if (allTides[j].type !== allTides[i].type) {
                tidalRange = allTides[i].level - allTides[j].level;
                break;
            }
        }
        if (tidalRange === null) {
            if (allTides[i].type === 'high' && prevDayLastLow !== null) {
                tidalRange = allTides[i].level - prevDayLastLow;
            } else if (allTides[i].type === 'low' && prevDayLastHigh !== null) {
                tidalRange = allTides[i].level - prevDayLastHigh;
            }
        }
        allTides[i].tidalRange = tidalRange !== null ? Math.abs(tidalRange) : null;
    }

    var highTides = allTides.filter(function (t) { return t.type === 'high'; });
    var lowTides = allTides.filter(function (t) { return t.type === 'low'; });

    // 고조 그룹
    html += '<div class="tide-group"><div class="tide-group-label high">고<br>조</div><div class="tide-group-items">';
    if (highTides.length > 0) {
        highTides.forEach(function (t) {
            var rangeText = t.tidalRange !== null ? '+' + t.tidalRange : '';
            html += '<div class="tide-row high"><span class="tide-time">' + t.time + '</span><span class="tide-level">(' + t.level + 'cm)</span><span class="tide-arrow">▲</span><span class="tide-value-signed">' + rangeText + '</span></div>';
        });
    } else {
        html += '<div class="tide-row empty">--:-- (--cm)</div>';
    }
    html += '</div></div>';

    html += '<div class="tide-divider"></div>';

    // 저조 그룹
    html += '<div class="tide-group"><div class="tide-group-label low">저<br>조</div><div class="tide-group-items">';
    if (lowTides.length > 0) {
        lowTides.forEach(function (t) {
            var rangeText = t.tidalRange !== null ? '' + t.tidalRange : '';
            html += '<div class="tide-row low"><span class="tide-time">' + t.time + '</span><span class="tide-level">(' + t.level + 'cm)</span><span class="tide-arrow">▼</span><span class="tide-value-signed">-' + rangeText + '</span></div>';
        });
    } else {
        html += '<div class="tide-row empty">--:-- (--cm)</div>';
    }
    html += '</div></div>';

    // 일조부등 안내
    if (totalTideCount > 0 && totalTideCount <= 2) {
        html += '<div style="font-size:0.65rem;color:#94a3b8;text-align:center;margin-top:8px;padding:2px 0;">[일조부등으로 인한 조석정보 생략]</div>';
    }

    // 태양/달 정보
    html += getAstronomyInfoHTML(astroInfo);

    // 좌표 정보
    html += '<div style="text-align:center;margin-top:8px;font-size:0.7rem;color:#94a3b8;opacity:0.8;">' +
        '<i class="fa-solid fa-location-dot" style="margin-right:4px;"></i>' +
        lat.toFixed(4) + '°N, ' + lon.toFixed(4) + '°E</div>';

    return html;
}