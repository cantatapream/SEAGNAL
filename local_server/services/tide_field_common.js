/**
 * ============================================================================
 * 파일명: services/tide_field_common.js
 * 역할: "서해·남해 시간별 물빠짐(갯벌 노출) 예측 시스템" 공용 상수·유틸 모듈
 * ============================================================================
 *
 * [한 줄 설명]
 *   물빠짐 예측 파이프라인(전처리 build_tide_field.js → 배치 수집
 *   tide_field_collector.js → 예측 라우트 routes/tide_field.js → 프론트
 *   js/tide_field.js)이 공통으로 쓰는 상수와 순수 함수를 한 곳에 모은다.
 *   API 계약·물리 모델·해역 게이팅을 단일 소스로 유지하기 위함.
 *
 * [핵심 물리 모델 — 확정]
 *   - KHOA 조위(조석표/TideBED η)는 약최저저조면(chart datum) 기준(위로 +cm).
 *   - BADA2024 수심 d 는 평균해수면(MSL) 기준(아래로 +m).
 *   - 두 기준면 차이 = Z₀(평균해면고). Z₀ ≈ MTL(표준항 고조·저조 평균).
 *   - 결합식(m): 물깊이(t) = d + η(t) − Z₀.
 *   - 드러남(노출) 조건: η(t) < Z₀ − d.   (η, Z₀ 는 m 단위)
 *
 * [대상 해역] 서해 + 남해만. 동해·제주·북한 제외. 위경도 박스 + 제외 규칙.
 *   상수로 분리해 운영 중 조정 가능하게 했다.
 *
 * [연계]
 *   - scripts/build_tide_field.js   → 격자/앵커/Z₀ 전처리
 *   - services/tide_field_collector.js → 앵커 곡선 배치 수집
 *   - routes/tide_field.js          → 예측 엔진 API
 *   - js/tide_field.js              → 프론트 레이어 (bbox 만 별도 응답으로 받음)
 *   - tide.js (프론트)              → TIDE_REFERENCE_STATIONS 원본 (여기 부분집합)
 * ============================================================================
 */

'use strict';

const path = require('path');
// [의존성 최소화] server_config 는 dotenv/express 등을 끌어와 오프라인 스크립트
//   (build_tide_field.js) 단독 실행 시 node_modules 미설치면 로드가 실패할 수
//   있다. DATA_DIR 은 server_config 와 동일하게 ../data 로 직접 계산하여
//   순수 path 모듈만 의존하도록 한다 (server_config.DATA_DIR = path.join(__dirname,'..','data')).
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================================
// 산출물 경로
// ============================================================================
const TIDE_FIELD_DIR = path.join(DATA_DIR, 'tide_field');
const GRID_META_PATH = path.join(TIDE_FIELD_DIR, 'grid_meta.json');
const ANCHORS_PATH = path.join(TIDE_FIELD_DIR, 'anchors.json');
const CURVES_DIR = path.join(TIDE_FIELD_DIR, 'curves');
const BATHYMETRY_DIR = path.join(DATA_DIR, 'bathymetry');

// ============================================================================
// 대상 해역 게이팅 (서해 + 남해)
// ============================================================================
//
// [방식] 보수적 위경도 박스(REGION_BBOX) 로 1차 게이팅 후, 제외 규칙
//   (isExcludedSea) 으로 동해·제주를 빼낸다. tide.js 의 동해북부 예외
//   (lat>=36 & lon>=128) 와 정합되도록 동일 임계값을 재사용한다.
//
// [박스] 서해·남해 전체를 넉넉히 감싸는 사각형.
//   - lon: 124.0 ~ 129.6  (서해 먼바다 ~ 부산 동단)
//   - lat: 33.8 ~ 38.7    (남해 남단 ~ 서해 북단; 북한 영해는 제외 규칙으로 컷)
const REGION_BBOX = {
    lonMin: 124.0,
    lonMax: 129.6,
    latMin: 33.8,
    latMax: 38.7
};

// 동해 게이팅 임계값 (tide.js: lat>=36 & lon>=128 → 동해북부 IDW 예외와 동일)
const EAST_SEA_LAT = 36.0;
const EAST_SEA_LON = 128.0;

// 제주 박스 (제주도 + 주변 근해 제외). 추자도(33.96)는 남해로 포함하기 위해
// 위도 상한을 33.65 로 둔다.
const JEJU_BBOX = {
    lonMin: 126.0,
    lonMax: 127.3,
    latMin: 33.0,
    latMax: 33.65
};

// 북한 영해 대략 컷: 서해 북단은 백령도(37.95)·강화(37.8) 까지가 우리 운영 범위.
// REGION_BBOX.latMax(38.7) 안에서도 lon < 125.0 && lat > 38.0 인 셀은 제외(북한 서해).
function isExcludedSea(lat, lon) {
    // 동해(부산 동쪽~동해안): lat>=36 & lon>=128
    if (lat >= EAST_SEA_LAT && lon >= EAST_SEA_LON) return true;
    // 부산 이남 남해 동단 경계: lon>=129.2 는 동해/외해로 간주
    if (lon >= 129.2) return true;
    // 제주 근해
    if (lat >= JEJU_BBOX.latMin && lat <= JEJU_BBOX.latMax &&
        lon >= JEJU_BBOX.lonMin && lon <= JEJU_BBOX.lonMax) return true;
    // 북한 서해(추정)
    if (lat > 38.0 && lon < 125.0) return true;
    return false;
}

/**
 * 좌표가 서해·남해 대상 해역 안인지 판정.
 * @returns {boolean} true 면 물빠짐 예측 대상.
 */
function isWestSouthSea(lat, lon) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return false;
    if (lon < REGION_BBOX.lonMin || lon > REGION_BBOX.lonMax) return false;
    if (lat < REGION_BBOX.latMin || lat > REGION_BBOX.latMax) return false;
    if (isExcludedSea(lat, lon)) return false;
    return true;
}

// ============================================================================
// 표준항(앵커 seed) — tide.js TIDE_REFERENCE_STATIONS 의 서해·남해 부분집합
// ============================================================================
//
// [주의] 원본은 tide.js(브라우저 전역) 의 TIDE_REFERENCE_STATIONS(약166개).
//   tide.js 는 window 의존이라 Node 에서 require 불가 → 여기 좌표만 복제한다.
//   isWestSouthSea 로 필터한 결과만 앵커 seed 로 사용하므로, 원본 전체를
//   적어두고 런타임에 게이팅한다. (원본 갱신 시 이 배열도 동기화 필요 —
//   build_tide_field.js 가 stationCount 를 로그로 남겨 누락 감지에 도움.)
const ALL_REFERENCE_STATIONS = [
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
    { code: "SO_1268", name: "궁평항", lat: 37.117, lon: 126.68 },
    { code: "SO_1269", name: "연도항", lat: 36.0833, lon: 126.4500 },
    { code: "SO_1270", name: "삼길포항", lat: 37.004, lon: 126.452 },
    { code: "SO_1271", name: "어은돌항", lat: 36.7500, lon: 126.1333 },
    { code: "SO_1272", name: "다대포항", lat: 35.0500, lon: 128.9833 },
    { code: "SO_1277", name: "화순항", lat: 33.2333, lon: 126.3333 },
    { code: "SO_1278", name: "원평항", lat: 34.7833, lon: 125.9167 },
    { code: "SO_1279", name: "어란진항", lat: 34.348, lon: 126.475 },
    { code: "SO_1282", name: "선재도", lat: 37.253, lon: 126.509 }
];

/**
 * 서해·남해 표준항만 필터링한 앵커 seed 목록 반환.
 * @returns {Array<{code,name,lat,lon}>}
 */
function getRegionStations() {
    return ALL_REFERENCE_STATIONS.filter(s => isWestSouthSea(s.lat, s.lon));
}

// ============================================================================
// 순수 유틸 함수
// ============================================================================

/** 도(°) → 라디안 */
function toRad(d) { return d * Math.PI / 180; }

/**
 * Haversine 거리 (km). tide.js calculateDistance 와 동일한 공식·반지름.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * 표준항 연간 조석표 1행에서 MTL(고조·저조 평균, cm) 산출.
 *   MTL ≈ Z₀ (평균해면고). 고조 4개·저조 4개 중 존재하는 값만 평균.
 * @param {Object} row - tide_data 연간 조석표 행
 * @returns {number|null} MTL(cm) 또는 null(레벨 데이터 없음)
 */
function rowMTL(row) {
    if (!row) return null;
    const levels = [];
    for (const k of ['highTide1Level', 'highTide2Level', 'highTide3Level', 'highTide4Level',
        'lowTide1Level', 'lowTide2Level', 'lowTide3Level', 'lowTide4Level']) {
        const v = row[k];
        if (v != null && !isNaN(v)) levels.push(Number(v));
    }
    if (levels.length === 0) return null;
    return levels.reduce((a, b) => a + b, 0) / levels.length;
}

// ============================================================================
// 격자 설정 (build·route 공통)
// ============================================================================
//
// [설계 — 앵커를 연결성 그래프에서 완전히 분리]
//   과거(100m + 8m 사전필터)에서 갯벌(얕은 셀)이 깊은 수로로 끊겨 연결성
//   컴포넌트가 5만 개로 파편화 → "컴포넌트마다 앵커 1개 + 그리디 커버링"이
//   앵커를 5만 개로 폭발시켰다(작업 166k). 이를 막기 위해:
//     - 렌더 셀: CELL_DEG(~100m) 미세 격자, 얕은 연안(수심 ≤ SHALLOW_MAX_M)만.
//     - Z₀: 표준항 MTL 의 "직선거리 IDW" (물길 BFS 제거).
//     - 앵커: 드러남 셀을 ANCHOR_BUCKET_DEG(~10km) 버킷으로 묶어 버킷마다 1개.
//       → 앵커 수 = 버킷 수 ≈ 수백 개. 격자 파편화와 무관(폭발 불가).
//     - η 보간: 직선거리 ≤ INTERP_MAX_KM 이내 가까운 앵커 최대 INTERP_MAX_ANCHORS개.
const TIDE_FIELD_CONFIG = {
    // [재빌드 가드] 운영 볼륨에 남은 옛 100m/5만앵커 산출물을 자동 교체하기 위한
    //   스키마 버전. ensureBuilt 가 grid_meta.build_version ≠ 이 값이면 강제 재빌드.
    BUILD_VERSION: 3,
    // 렌더 셀 해상도 (도). 0.0015° ≈ 150m — BADA 수심 데이터 간격에 맞춤.
    //   (100m로 더 잘게 하면 데이터 없는 칸이 생겨 체커보드 격자가 됨)
    CELL_DEG: 0.0015,
    // BADA 로드 사전필터: 수심이 이보다 깊은 셀은 버린다(드러날 수 있는 얕은 연안만).
    //   셀 수 통제 + 깊은 수로 제거.
    SHALLOW_MAX_M: 8,
    // 드러남 가능 셀 판정 여유(m): depth < z0 + DRY_MARGIN_M 이면 후보(드러날 수 있음).
    DRY_MARGIN_M: 1.0,
    // 앵커 버킷 크기 (도). 0.1° ≈ 10km. 드러남 셀을 이 버킷으로 묶어 버킷마다 대표 1개.
    ANCHOR_BUCKET_DEG: 0.1,
    // η(t) 보간 시 한 셀이 참조할 최대 직선거리 (km). 이 안의 앵커만 사용.
    INTERP_MAX_KM: 25,
    // η(t) 보간에 사용할 최대 앵커 개수 (가까운 순)
    INTERP_MAX_ANCHORS: 4,
    // 수집/예측 윈도우 (오늘 ~ +N일). 3일.
    WINDOW_DAYS: 3,
    // 예측 step (분). 서해 갯벌은 빠르게 들고 나서(중간조 ~1.5m/h), 1시간 간격이면
    //   빠른 전환을 건너뛰어 "1시간 만에 급변"처럼 보인다 → 30분으로 촘촘히.
    STEP_MINUTES: 30

    // [제거됨 — 더 이상 사용 안 함] 연결성 그래프/물길 BFS 기반 상수:
    //   NEIGHBOR_TOL_FACTOR, ANCHOR_COVER_KM, INTERP_MAX_WATERWAY_KM.
    //   앵커가 버킷 기반으로 바뀌어 컴포넌트·물길거리 개념이 사라졌다.
};

module.exports = {
    // 경로
    TIDE_FIELD_DIR, GRID_META_PATH, ANCHORS_PATH, CURVES_DIR, BATHYMETRY_DIR,
    // 해역 게이팅
    REGION_BBOX, isWestSouthSea, isExcludedSea,
    // 표준항
    ALL_REFERENCE_STATIONS, getRegionStations,
    // 유틸
    toRad, haversineKm, rowMTL,
    // 설정
    TIDE_FIELD_CONFIG
};
