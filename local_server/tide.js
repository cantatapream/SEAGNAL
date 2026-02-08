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

// 마지막 클릭 위치 저장 (날짜 변경 시 팝업 업데이트용)
let lastClickedCoordinate = null;
let lastClickedLonLat = null;
let currentTideDate = new Date(); // 초기 날짜를 오늘로 설정

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

    remove(index) {
        if (confirm(`'${this.items[index].name}' 즐겨찾기를 삭제하시겠습니까?`)) {
            this.items.splice(index, 1);
            this.save();
        }
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
            btn.innerHTML = `
                <i class="fa-solid fa-star" style="color: #FFD700; font-size: 0.8rem;"></i>
                <span onclick="TideFavorites.moveTo('${item.lat}', '${item.lon}')">${item.name}</span>
                <span class="tide-fav-delete" onclick="TideFavorites.remove(${index})"><i class="fa-solid fa-xmark"></i></span>
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
    { code: "SO_0732", name: "남애항", lat: 37.944, lon: 128.788 },
    { code: "SO_0733", name: "강릉항", lat: 37.772, lon: 128.951 },
    { code: "SO_0734", name: "궁촌항", lat: 37.327, lon: 129.27 },
    { code: "SO_0735", name: "죽변항", lat: 37.054, lon: 129.423 },
    { code: "SO_0736", name: "축산항", lat: 36.509, lon: 129.448 },
    { code: "SO_0737", name: "강구항", lat: 36.358, lon: 129.391 },
    { code: "SO_0555", name: "서망항", lat: 34.366, lon: 126.134 },
    { code: "SO_0559", name: "완도항", lat: 34.261, lon: 126.759 },
    { code: "SO_0558", name: "법성포", lat: 35.569, lon: 126.427 },
    { code: "SO_0557", name: "오도항", lat: 35.035, lon: 126.433 },
    { code: "SO_0560", name: "나포항", lat: 35.464, lon: 126.324 },
    { code: "SO_0562", name: "승봉도", lat: 37.169, lon: 126.29 },
    { code: "SO_0573", name: "양포항", lat: 35.881, lon: 129.527 },
    { code: "SO_0581", name: "강양항", lat: 35.39, lon: 129.344 },
    { code: "SO_0571", name: "거제외포", lat: 34.939, lon: 128.718 },
    { code: "SO_0578", name: "소매물도", lat: 34.621, lon: 128.548 },
    { code: "SO_0567", name: "쉬미항", lat: 34.504, lon: 126.183 },
    { code: "SO_0576", name: "화봉리", lat: 34.661, lon: 126.256 },
    { code: "SO_0564", name: "국화도", lat: 37.06, lon: 126.56 },
    { code: "SO_0563", name: "울도", lat: 37.035, lon: 125.995 },
    { code: "SO_0706", name: "청산도", lat: 34.18, lon: 126.856 },
    { code: "SO_0708", name: "안도항", lat: 34.479, lon: 127.797 },
    { code: "SO_0712", name: "능양항", lat: 34.812, lon: 128.245 },
    { code: "SO_0701", name: "홍도항", lat: 34.681, lon: 125.195 },
    { code: "SO_0702", name: "진도옥도", lat: 34.35, lon: 126.018 },
    { code: "SO_0703", name: "제주한림", lat: 33.412, lon: 126.265 },
    { code: "SO_0704", name: "보령항", lat: 36.329, lon: 126.335 },
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
    { code: "DT_0016", name: "여수", lat: 34.747, lon: 127.765 },
    { code: "DT_0017", name: "대산", lat: 37.007, lon: 126.352 },
    { code: "DT_0018", name: "군산", lat: 35.975, lon: 126.563 },
    { code: "DT_0021", name: "추자도", lat: 33.961, lon: 126.3 },
    { code: "DT_0023", name: "모슬포", lat: 33.214, lon: 126.251 },
    { code: "DT_0028", name: "진도", lat: 34.377, lon: 126.308 },
    { code: "SO_0553", name: "해운대", lat: 35.16, lon: 129.191 },
    { code: "SO_0540", name: "호산항", lat: 37.176, lon: 129.342 },
    { code: "DT_0020", name: "울산", lat: 35.501, lon: 129.387 },
    { code: "DT_0022", name: "성산포", lat: 33.474, lon: 126.927 },
    { code: "DT_0024", name: "장항", lat: 36.006, lon: 126.687 },
    { code: "DT_0026", name: "고흥발포", lat: 34.481, lon: 127.342 },
    { code: "DT_0027", name: "완도", lat: 34.315, lon: 126.759 },
    { code: "DT_0029", name: "거제도", lat: 34.801, lon: 128.699 },
    { code: "DT_0025", name: "보령", lat: 36.406, lon: 126.486 },
    { code: "DT_0001", name: "인천", lat: 37.451, lon: 126.592 },
    { code: "DT_0052", name: "인천송도", lat: 37.338, lon: 126.586 },
    { code: "DT_0014", name: "통영", lat: 34.827, lon: 128.434 },
    { code: "DT_0037", name: "어청도", lat: 36.117, lon: 125.984 },
    { code: "DT_0046", name: "쌍정초", lat: 37.556, lon: 130.939 },
    { code: "DT_0039", name: "왕돌초", lat: 36.719, lon: 129.732 },
    { code: "DT_0041", name: "복사초", lat: 34.098, lon: 126.168 },
    { code: "DT_0047", name: "도농탄", lat: 33.287, lon: 126.104 },
    { code: "SO_0537", name: "벽파진", lat: 34.539, lon: 126.346 },
    { code: "SO_0547", name: "말도", lat: 35.855, lon: 126.318 },
    { code: "SO_0550", name: "나로도", lat: 34.463, lon: 127.453 },
    { code: "SO_0705", name: "마량항", lat: 34.448, lon: 126.821 },
    { code: "SO_0707", name: "시산항", lat: 34.394, lon: 127.261 },
    { code: "SO_0709", name: "두문포", lat: 34.643, lon: 127.797 },
    { code: "SO_0710", name: "봉우항", lat: 34.932, lon: 127.927 },
    { code: "SO_0711", name: "창선도", lat: 34.84, lon: 128.019 },
    { code: "SO_0700", name: "호도", lat: 36.303, lon: 126.264 },
    { code: "DT_0059", name: "백령도", lat: 37.955, lon: 124.736 },
    { code: "DT_0060", name: "연평도", lat: 37.657, lon: 125.714 },
    { code: "SO_0551", name: "여서도", lat: 33.988, lon: 126.923 },
    { code: "SO_0552", name: "고현항", lat: 34.901, lon: 128.622 },
    { code: "IE_0062", name: "옹진소청초", lat: 37.423, lon: 124.738 },
    { code: "SO_0572", name: "갈두", lat: 34.549, lon: 127.589 },
    { code: "SO_0575", name: "하태도", lat: 34.403, lon: 127.122 },
    { code: "SO_0561", name: "거문도", lat: 34.027, lon: 127.308 },
    { code: "SO_0570", name: "광암항", lat: 35.102, lon: 128.498 },
    { code: "SO_0568", name: "백야도", lat: 34.624, lon: 127.632 },
    { code: "SO_0577", name: "가거도", lat: 34.05, lon: 125.128 },
    { code: "SO_0566", name: "송공항", lat: 34.848, lon: 126.225 },
    { code: "SO_0565", name: "향화도항", lat: 35.167, lon: 126.359 },
    { code: "SO_0574", name: "백사장항", lat: 36.586, lon: 126.315 },
    { code: "SO_0731", name: "대진항", lat: 38.501, lon: 128.426 },
    { code: "SO_1251", name: "낙월도", lat: 35.2, lon: 126.145 },
    { code: "SO_1252", name: "외연도항", lat: 36.225, lon: 126.081 },
    { code: "SO_0757", name: "안남리", lat: 34.73, lon: 127.264 },
    { code: "SO_0755", name: "원동항", lat: 34.393, lon: 126.648 },
    { code: "SO_0754", name: "평호리", lat: 34.448, lon: 126.455 },
    { code: "SO_1256", name: "어류정항", lat: 37.643, lon: 126.342 },
    { code: "DT_0064", name: "교동대교", lat: 37.789, lon: 126.339 },
    { code: "SO_1249", name: "오도항", lat: 35.035, lon: 126.433 },
    { code: "SO_1247", name: "여자만", lat: 34.762, lon: 127.403 },
    { code: "SO_1246", name: "법성포", lat: 35.569, lon: 126.427 },
    { code: "SO_1248", name: "신안옥도", lat: 34.683, lon: 126.064 },
    { code: "SO_0759", name: "장문리", lat: 34.873, lon: 128.424 },
    { code: "DT_0068", name: "위도", lat: 35.618, lon: 126.301 },
    { code: "SO_0760", name: "오산항", lat: 36.888, lon: 129.416 },
    { code: "SO_0753", name: "하의도웅곡", lat: 34.608, lon: 126.038 },
    { code: "SO_0631", name: "암태도", lat: 34.853, lon: 126.071 },
    { code: "SO_0752", name: "검산항", lat: 35.0, lon: 126.107 },
    { code: "SO_1265", name: "송이도", lat: 35.271, lon: 126.15 },
    { code: "SO_1266", name: "남열항", lat: 34.576, lon: 127.48 },
    { code: "SO_1267", name: "구룡포항", lat: 35.99, lon: 129.555 },
    { code: "DT_0093", name: "소무의도", lat: 37.373, lon: 126.44 },
    { code: "DT_0094", name: "서거차도", lat: 34.251, lon: 125.915 },
    { code: "SO_1268", name: "궁평항", lat: 37.117, lon: 126.68 },
    { code: "SO_1270", name: "삼길포항", lat: 37.004, lon: 126.452 },
    { code: "SO_1271", name: "풍도", lat: 37.072, lon: 126.436 },
    { code: "SO_1272", name: "초산리", lat: 35.023, lon: 126.262 },
    { code: "SO_1277", name: "화순항", lat: 33.215, lon: 126.315 },
    { code: "SO_1274", name: "거진항", lat: 38.446, lon: 128.456 },
    { code: "SO_1275", name: "공현진항", lat: 38.355, lon: 128.513 },
    { code: "SO_1276", name: "아야진항", lat: 38.27, lon: 128.557 },
    { code: "SO_1273", name: "장호항", lat: 37.288, lon: 129.317 },
    { code: "SO_1283", name: "사천진항", lat: 37.875, lon: 128.875 },
    { code: "SO_1279", name: "어란진항", lat: 34.348, lon: 126.475 },
    { code: "SO_1280", name: "덕산항", lat: 37.377, lon: 129.253 },
    { code: "SO_1281", name: "임원항", lat: 37.228, lon: 129.343 },
    { code: "SO_1282", name: "선재도", lat: 37.253, lon: 126.509 },
    { code: "SO_1278", name: "원평항", lat: 34.781, lon: 125.908 },
    { code: "SO_1284", name: "월포리", lat: 36.209, lon: 129.381 },
    { code: "SO_1285", name: "구계항", lat: 36.318, lon: 129.379 },
    { code: "SO_1286", name: "영덕대진항", lat: 36.557, lon: 129.431 },
    { code: "SO_1287", name: "구산항", lat: 36.76, lon: 129.472 },
    { code: "SO_1288", name: "기사문항", lat: 38.007, lon: 128.73 }
];

let stationData = TIDE_REFERENCE_STATIONS;

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
                } else {
                    popupElement.style.display = 'none';
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
                image: new ol.style.RegularShape({
                    fill: new ol.style.Fill({ color: '#FFD700' }), // 노란색 채우기
                    stroke: new ol.style.Stroke({ color: '#e65100', width: 2 }), // 주황색 테두리
                    points: 5,
                    radius: 12, // 크기
                    radius2: 6, // 안쪽 반지름 (별 모양 깊이)
                    angle: 0
                }),
                text: new ol.style.Text({
                    text: feature.get('name'),
                    offsetY: 24, // 별 아래에 텍스트 표시
                    fill: new ol.style.Fill({ color: '#FFD700' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }), // 가독성을 위한 검은 테두리
                    font: 'bold 12px "Noto Sans KR", sans-serif'
                })
            });
        }
    });

    tideMap.addLayer(favoriteLayer);
}

// ===== 지도 클릭 처리 =====
async function handleTideMapClick(event) {
    // 팝업이 열려있어도 다른 곳을 클릭하면 이동하도록 변경 (닫기 로직 제거)
    // if (tidePopupOverlay && tidePopupOverlay.getPosition()) { ... } 제거

    // 클릭한 위치에 즐겨찾기 마커나 표준항 마커가 있는지 확인
    const feature = tideMap.forEachFeatureAtPixel(event.pixel, function (feature) {
        return feature;
    });

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

    // ... 나머지 로직 계속 진행
    const selectedDate = getSelectedTideDate();
    const year = String(selectedDate).substring(0, 4);

    // 데이터 로딩 체크 및 시도
    if (!window.TIDE_DATA_STORAGE || !window.TIDE_DATA_STORAGE[year]) {
        const success = await loadTideData(year);
        if (!success) {
            alert(`${year}년 조석 데이터가 준비되지 않았습니다.`);
            return;
        }
    }

    // 좌표 사용
    const longitude = clickLon;
    const latitude = clickLat;

    lastClickedCoordinate = coordinate;
    lastClickedLonLat = { lat: latitude, lon: longitude };

    const nearest3Stations = findNearestStations(latitude, longitude, 3);


    let stationsWithData = nearest3Stations.map(station => ({
        ...station,
        tideInfo: getTideDataForDate(station.name, selectedDate)
    })).filter(s => s.tideInfo);

    if (stationsWithData.length === 0) {
        console.warn('⚠️ 가까운 표준항에 데이터 없음. 모든 표준항 재검색...');
        stationsWithData = findNearestStationsWithData(latitude, longitude, selectedDate, 3);
    }

    if (stationsWithData.length === 0) {
        showTidePopup(coordinate, {
            clickedLat: latitude.toFixed(6),
            clickedLon: longitude.toFixed(6),
            error: `해당 날짜의 조석 데이터가 없습니다.\n\n📅 선택 날짜: ${selectedDate}`
        });
        return;
    }

    const interpolatedTide = interpolateTideByIDW(stationsWithData);

    showTidePopup(coordinate, {
        clickedLat: latitude.toFixed(6),
        clickedLon: longitude.toFixed(6),
        stations: stationsWithData,
        tideInfo: interpolatedTide,
        method: stationsWithData.length > 1 ? 'idw' : 'single'
    });
}

// ===== 조석 팝업 표시 =====
function showTidePopup(coordinate, data) {
    const element = tidePopupOverlay.getElement();
    element.className = 'tide-popup';

    const lat = parseFloat(data.clickedLat);
    const lon = parseFloat(data.clickedLon);
    const astroInfo = getAstronomyInfo(lat, lon, currentTideDate);

    let html = `
        <button class="tide-popup-close-x" onclick="tidePopupOverlay.setPosition(undefined)" title="닫기">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="tide-popup-body" style="padding-top: 15px;">
            <!-- [UI Change] 좌표 정보 하단 이동으로 제거 -->
            
            <button class="tide-popup-fav-btn" onclick="addCurrentLocationToFavorites('${data.clickedLat}', '${data.clickedLon}')" style="margin-top: 5px;">
                <i class="fa-solid fa-star"></i> 즐겨찾기 추가
            </button>
    `;

    // 즐겨찾기 추가 함수 (전역)
    window.addCurrentLocationToFavorites = (lat, lon) => {
        const name = prompt('즐겨찾기 이름을 입력해주세요:', '');
        if (name) {
            if (TideFavorites.add(name, lat, lon)) {
                alert('즐겨찾기에 추가되었습니다.');
            }
        }
    };

    if (data.error) {
        html += `
            <div class="tide-error">
                <i class="fa-solid fa-circle-exclamation"></i>
                <p>${data.error}</p>
            </div>
        `;
        html += getAstronomyInfoHTML(astroInfo);

        // [UI Change] 좌표 정보 하단 이동 (에러 상황에서도 표시)
        html += `
            <div class="tide-location-bottom" style="text-align: center; margin-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; justify-content: center; opacity: 0.8;">
                <i class="fa-solid fa-location-dot" style="margin-right: 6px; font-size: 0.7rem;"></i>
                <span style="font-family: 'Roboto Mono', monospace;">${data.clickedLat}°N, ${data.clickedLon}°E</span>
            </div>
        `;
    } else if (data.tideInfo) {
        let allTides = [];

        for (let i = 1; i <= 4; i++) {
            const highTime = data.tideInfo[`highTide${i}Time`];
            const highLevel = data.tideInfo[`highTide${i}Level`];
            const lowTime = data.tideInfo[`lowTide${i}Time`];
            const lowLevel = data.tideInfo[`lowTide${i}Level`];

            if (highTime !== undefined && !isNaN(highLevel) && highLevel !== null) {
                allTides.push({
                    type: 'high',
                    timeRaw: highTime,
                    time: formatTime(highTime),
                    level: highLevel
                });
            }

            if (lowTime !== undefined && !isNaN(lowLevel) && lowLevel !== null) {
                allTides.push({
                    type: 'low',
                    timeRaw: lowTime,
                    time: formatTime(lowTime),
                    level: lowLevel
                });
            }
        }

        allTides.sort((a, b) => a.timeRaw - b.timeRaw);

        // [Fix] 물리적으로 불가능한 중복/인접 데이터 제거 (4시간 이내 같은 타입 제거 & 00:00 우선 제거)
        const filteredTides = [];
        // 먼저 0이 아닌 유효한 시간 데이터를 우선적으로 수집
        allTides.forEach(current => {
            // 1. 이미 등록된 데이터와 충돌(4시간 내 같은 타입)하는지 확인
            const conflictIndex = filteredTides.findIndex(t => {
                const timeDiff = Math.abs(timeToMinutes(t.timeRaw) - timeToMinutes(current.timeRaw));
                return t.type === current.type && timeDiff < 240;
            });

            if (conflictIndex === -1) {
                // 충돌 없으면 추가
                filteredTides.push(current);
            } else {
                // 충돌 발생! 더 신뢰할 수 있는 데이터 선택
                const existing = filteredTides[conflictIndex];

                // 현재 데이터가 0이 아니고, 기존 데이터가 0이면 교체 (00:00은 오류일 확률 높음)
                if (current.timeRaw !== '0000' && current.timeRaw !== 0 && (existing.timeRaw === '0000' || existing.timeRaw === 0)) {
                    console.warn(`⚠️ 물리적 중복 교체 (${current.type}): 00:00 제거하고 ${current.timeRaw} 사용`);
                    filteredTides[conflictIndex] = current;
                } else {
                    console.warn(`⚠️ 물리적 중복 제거 (${current.type}): ${current.timeRaw} 무시 (기존: ${existing.timeRaw})`);
                }
            }
        });
        allTides = filteredTides;

        let prevDayLastHigh = null;
        let prevDayLastLow = null;

        const prevDate = new Date(currentTideDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateNum = parseInt(
            `${prevDate.getFullYear()}${String(prevDate.getMonth() + 1).padStart(2, '0')}${String(prevDate.getDate()).padStart(2, '0')}`
        );

        let stationName = null;
        if (data.stations && data.stations.length > 0) {
            stationName = data.stations[0].name;
        } else if (data.tideInfo && data.tideInfo.sourceStations && data.tideInfo.sourceStations.length > 0) {
            stationName = data.tideInfo.sourceStations[0];
        }

        if (stationName) {
            const prevDayData = getTideDataForDate(stationName, prevDateNum);

            if (prevDayData) {
                for (let i = 4; i >= 1; i--) {
                    if (prevDayLastHigh === null && prevDayData[`highTide${i}Level`] !== undefined) {
                        prevDayLastHigh = prevDayData[`highTide${i}Level`];
                    }
                    if (prevDayLastLow === null && prevDayData[`lowTide${i}Level`] !== undefined) {
                        prevDayLastLow = prevDayData[`lowTide${i}Level`];
                    }
                    if (prevDayLastHigh !== null && prevDayLastLow !== null) break;
                }
            }
        }

        for (let i = 0; i < allTides.length; i++) {
            let tidalRange = null;

            for (let j = i - 1; j >= 0; j--) {
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

        const highTides = allTides.filter(t => t.type === 'high');
        const lowTides = allTides.filter(t => t.type === 'low');

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

        html += getAstronomyInfoHTML(astroInfo);

        // [UI Change] 좌표 정보 하단 이동
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
    const year = currentTideDate.getFullYear();
    const month = String(currentTideDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentTideDate.getDate()).padStart(2, '0');
    return parseInt(`${year}${month}${date}`);
}

function findNearestStations(lat, lon, count = 3) {
    const stationsWithDist = stationData.map(station => ({
        ...station,
        distance: calculateDistance(lat, lon, station.lat, station.lon)
    }));

    stationsWithDist.sort((a, b) => a.distance - b.distance);
    return stationsWithDist.slice(0, count);
}

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

function toRad(degrees) {
    return degrees * Math.PI / 180;
}

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

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const str = String(timeStr).padStart(4, '0');
    const hours = parseInt(str.substring(0, 2));
    const minutes = parseInt(str.substring(2, 4));
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = Math.round(totalMinutes % 60);
    return parseInt(String(hours).padStart(2, '0') + String(minutes).padStart(2, '0'));
}

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

function prevTideDate() {
    currentTideDate.setDate(currentTideDate.getDate() - 1);
    updateTideDateDisplay();
    refreshPopupIfOpen();
}

function nextTideDate() {
    currentTideDate.setDate(currentTideDate.getDate() + 1);
    updateTideDateDisplay();
    refreshPopupIfOpen();
}

function showTideDatePicker() {
    const hiddenPicker = document.getElementById('tide-date-picker-hidden');
    if (hiddenPicker) {
        hiddenPicker.showPicker();
    }
}

function onTideDatePickerChange() {
    const hiddenPicker = document.getElementById('tide-date-picker-hidden');
    if (hiddenPicker && hiddenPicker.value) {
        const parts = hiddenPicker.value.split('-');
        currentTideDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        updateTideDateDisplay();
        refreshPopupIfOpen();
    }
}

async function refreshPopupIfOpen() {
    if (lastClickedCoordinate && lastClickedLonLat && tidePopupOverlay && tidePopupOverlay.getPosition()) {
        const latitude = lastClickedLonLat.lat;
        const longitude = lastClickedLonLat.lon;
        const selectedDate = getSelectedTideDate();
        const year = String(selectedDate).substring(0, 4);

        // 데이터 로딩 체크 및 시도
        if (!window.TIDE_DATA_STORAGE || !window.TIDE_DATA_STORAGE[year]) {
            await loadTideData(year); // 로드 시도 (성공 여부에 상관없이 진행)
        }

        const nearest3Stations = findNearestStations(latitude, longitude, 3);

        let stationsWithData = nearest3Stations.map(station => ({
            ...station,
            tideInfo: getTideDataForDate(station.name, selectedDate)
        })).filter(s => s.tideInfo);

        if (stationsWithData.length === 0) {
            stationsWithData = findNearestStationsWithData(latitude, longitude, selectedDate, 3);
        }

        if (stationsWithData.length === 0) {
            showTidePopup(lastClickedCoordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: `해당 날짜의 조석 데이터가 없습니다.\n\n📅 선택 날짜: ${selectedDate}`
            });
            return;
        }

        const interpolatedTide = interpolateTideByIDW(stationsWithData);

        showTidePopup(lastClickedCoordinate, {
            clickedLat: latitude.toFixed(6),
            clickedLon: longitude.toFixed(6),
            stations: stationsWithData,
            tideInfo: interpolatedTide,
            method: stationsWithData.length > 1 ? 'idw' : 'single'
        });
    }
}

// ===== 지도 컨트롤 추가 =====
function addTideMapControls() {
    if (!tideMap) return;

    const instructionControl = document.createElement('div');
    instructionControl.className = 'tide-map-control-instruction';
    instructionControl.innerHTML = `
        <span class="tide-instruction-text">물 때를 확인할 위치를 클릭하세요</span>
    `;

    const instructionOverlay = new ol.control.Control({
        element: instructionControl
    });
    tideMap.addControl(instructionOverlay);
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

    // console.log('✅ 조석 지도 스크립트 로드 완료');
});