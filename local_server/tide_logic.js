
// [경고] 이 파일은 삭제하지 마세요.
// tide_integrated_generator2.html과 연계되어 조석 데이터 수집 로직을 담당합니다.
// index.html의 실행과는 무관하지만, 데이터 생성기에 필수적입니다.

// ===================================
// GLOBAL & CONSTANTS
// ===================================
const OLD_REF_STATIONS = [
    { code: "SO_0732", name: "남애항", lat: 37.944, lon: 128.788 },
    { code: "SO_0733", name: "강릉항", lat: 37.772, lon: 128.951 },
    { code: "SO_0734", name: "궁촌항", lat: 37.327, lon: 129.27 },
    { code: "SO_0735", name: "죽변항", lat: 37.054, lon: 129.423 },
    { code: "SO_0736", name: "축산항", lat: 36.509, lon: 129.448 },
    { code: "SO_0737", name: "강구항", lat: 36.358, lon: 129.391 },
    { code: "SO_0555", name: "서망항", lat: 34.366, lon: 126.134 },
    { code: "DT_0054", name: "진해", lat: 35.147, lon: 128.643 },
    { code: "SO_0739", name: "도장항", lat: 34.367, lon: 127.011 },
    { code: "SO_0740", name: "보옥항", lat: 34.129, lon: 126.513 },
    { code: "SO_0699", name: "천리포항", lat: 36.803, lon: 126.146 },
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
    { code: "SO_0703", name: "땅끝항", lat: 34.298, lon: 126.531 },
    { code: "SO_0704", name: "소안항", lat: 34.15, lon: 126.631 },
    { code: "DT_0040", name: "독도", lat: 37.238, lon: 131.867 },
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
    { code: "DT_0032", name: "강화대교", lat: 37.731, lon: 126.522 },
    { code: "DT_0036", name: "대청도", lat: 37.825, lon: 124.718 },
    { code: "SO_0553", name: "해운대", lat: 35.16, lon: 129.191 },
    { code: "SO_0540", name: "호산항", lat: 37.176, lon: 129.342 },
    { code: "DT_0020", name: "울산", lat: 35.501, lon: 129.387 },
    { code: "DT_0022", name: "성산포", lat: 33.474, lon: 126.927 },
    { code: "DT_0024", name: "장항", lat: 36.006, lon: 126.687 },
    { code: "DT_0026", name: "고흥발포", lat: 34.481, lon: 127.342 },
    { code: "DT_0027", name: "완도", lat: 34.315, lon: 126.759 },
    { code: "DT_0029", name: "거제도", lat: 34.801, lon: 128.699 },
    { code: "DT_0031", name: "거문도", lat: 34.028, lon: 127.308 },
    { code: "DT_0035", name: "흑산도", lat: 34.684, lon: 125.435 },
    { code: "DT_0044", name: "영종대교", lat: 37.545, lon: 126.584 },
    { code: "DT_0047", name: "도농탄", lat: 33.158, lon: 126.274 },
    { code: "DT_0050", name: "태안", lat: 36.913, lon: 126.238 },
    { code: "DT_0048", name: "속초등표", lat: 38.199, lon: 128.613 },
    { code: "DT_0051", name: "서천마량", lat: 36.128, lon: 126.495 },
    { code: "SO_0549", name: "초도", lat: 34.24, lon: 127.245 },
    { code: "DT_0049", name: "광양", lat: 34.903, lon: 127.754 },
    { code: "DT_0056", name: "부산항신항", lat: 35.077, lon: 128.784 },
    { code: "DT_0057", name: "동해항", lat: 37.494, lon: 129.143 },
    { code: "SO_0538", name: "안마도", lat: 35.345, lon: 126.016 },
    { code: "SO_0539", name: "강화외포", lat: 37.7, lon: 126.372 },
    { code: "DT_0058", name: "경인항", lat: 37.56, lon: 126.601 },
    { code: "SO_0554", name: "영종왕산", lat: 37.458, lon: 126.358 },
    { code: "SO_0326", name: "미조항", lat: 34.706, lon: 128.048 },
    { code: "IE_0060", name: "이어도", lat: 32.122, lon: 125.182 },
    { code: "DT_0038", name: "굴업도", lat: 37.194, lon: 125.995 },
    { code: "DT_0025", name: "보령", lat: 36.406, lon: 126.486 },
    { code: "DT_0001", name: "인천", lat: 37.451, lon: 126.592 },
    { code: "DT_0052", name: "인천송도", lat: 37.338, lon: 126.586 },
    { code: "DT_0014", name: "통영", lat: 34.827, lon: 128.434 },
    { code: "DT_0037", name: "어청도", lat: 36.117, lon: 125.984 },
    { code: "DT_0046", name: "쌍정초", lat: 37.556, lon: 130.939 },
    { code: "DT_0039", name: "왕돌초", lat: 36.719, lon: 129.732 },
    { code: "DT_0041", name: "복사초", lat: 34.098, lon: 126.168 },
    { code: "DT_0042", name: "교본초", lat: 34.704, lon: 128.306 },
    { code: "DT_0043", name: "영흥도", lat: 37.238, lon: 126.428 },
    { code: "DT_0061", name: "삼천포", lat: 34.924, lon: 128.069 },
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
    { code: "IE_0061", name: "신안가거초", lat: 33.941, lon: 124.592 },
    { code: "SO_0548", name: "우이도", lat: 34.62, lon: 125.856 },
    { code: "SO_0572", name: "읍천항", lat: 35.69, lon: 129.475 },
    { code: "SO_0569", name: "남포항", lat: 34.957, lon: 128.321 },
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
    { code: "SO_1249", name: "독거도", lat: 34.256, lon: 126.178 },
    { code: "SO_1250", name: "평도", lat: 34.245, lon: 127.447 },
    { code: "SO_1253", name: "상왕등도", lat: 35.658, lon: 126.11 },
    { code: "SO_1254", name: "만재도", lat: 34.21, lon: 125.472 },
    { code: "SO_1248", name: "신안옥도", lat: 34.683, lon: 126.064 },
    { code: "SO_0759", name: "장문리", lat: 34.873, lon: 128.424 },
    { code: "DT_0068", name: "위도", lat: 35.618, lon: 126.301 },
    { code: "SO_0760", name: "오산항", lat: 36.888, lon: 129.416 },
    { code: "SO_0753", name: "하의도웅곡", lat: 34.608, lon: 126.038 },
    { code: "SO_0631", name: "암태도", lat: 34.853, lon: 126.071 },
    { code: "SO_0752", name: "검산항", lat: 35.0, lon: 126.107 },
    { code: "SO_0761", name: "녹동항", lat: 34.527, lon: 127.134 },
    { code: "DT_0065", name: "덕적도", lat: 37.226, lon: 126.156 },
    { code: "DT_0067", name: "안흥", lat: 36.674, lon: 126.129 },
    { code: "DT_0091", name: "포항", lat: 36.051, lon: 129.376 },
    { code: "SO_1255", name: "상태도", lat: 34.435, lon: 125.285 },
    { code: "SO_0758", name: "달천도", lat: 34.761, lon: 127.563 },
    { code: "SO_0756", name: "사초항", lat: 34.47, lon: 126.761 },
    { code: "DT_0063", name: "가덕도", lat: 35.024, lon: 128.81 },
    { code: "DT_0062", name: "마산", lat: 35.197, lon: 128.576 },
    { code: "SO_1257", name: "강화하리", lat: 37.728, lon: 126.286 },
    { code: "DT_0092", name: "여호항", lat: 34.661, lon: 127.469 },
    { code: "SO_1258", name: "잠진도", lat: 37.415, lon: 126.415 },
    { code: "SO_1259", name: "자월도", lat: 37.243, lon: 126.318 },
    { code: "SO_1260", name: "방포항", lat: 36.502, lon: 126.325 },
    { code: "SO_1261", name: "무창포항", lat: 36.249, lon: 126.534 },
    { code: "SO_1262", name: "격포항", lat: 35.62, lon: 126.463 },
    { code: "SO_1263", name: "구시포항", lat: 35.447, lon: 126.425 },
    { code: "SO_1264", name: "계마항", lat: 35.39, lon: 126.401 },
    { code: "SO_1265", name: "송이도", lat: 35.271, lon: 126.15 },
    { code: "SO_1266", name: "남열항", lat: 34.576, lon: 127.48 },
    { code: "SO_1267", name: "구룡포항", lat: 35.99, lon: 129.555 },
    { code: "DT_0093", name: "소무의도", lat: 37.373, lon: 126.44 },
    { code: "DT_0094", name: "서거차도", lat: 34.251, lon: 125.915 },
    { code: "SO_1268", name: "궁평항", lat: 37.117, lon: 126.68 },
    { code: "SO_1270", name: "삼길포항", lat: 37.004, lon: 126.452 },
    { code: "SO_1271", name: "어은돌항", lat: 36.748, lon: 126.129 },
    { code: "SO_1269", name: "연도항", lat: 36.081, lon: 126.442 },
    { code: "SO_1272", name: "다대포항", lat: 35.054, lon: 128.972 },
    { code: "SO_1277", name: "화순항", lat: 33.237, lon: 126.334 },
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
// User provided list for tideFcstHghLw
const NEW_API_TARGETS_RAW = `DT_0001
인천
SO_0566
송공항
DT_0002
평택
SO_0567
쉬미항
DT_0003
영광
SO_0568
백야도
DT_0004
제주
SO_0569
남포항
DT_0005
부산
SO_0570
광암항
DT_0006
묵호
SO_0571
거제외포
DT_0007
목포
SO_0572
읍천항
DT_0008
안산
SO_0573
양포항
DT_0010
서귀포
SO_0574
백사장항
DT_0011
후포
SO_0576
화봉리
DT_0012
속초
SO_0577
가거도
DT_0013
울릉도
SO_0578
소매물도
DT_0014
통영
SO_0581
강양항
DT_0016
여수
SO_0631
암태도
DT_0017
대산
SO_0699
천리포항
DT_0018
군산
SO_0700
호도
DT_0020
울산
SO_0701
홍도항
DT_0021
추자도
SO_0702
진도옥도
DT_0022
성산포
SO_0703
땅끝항
DT_0023
모슬포
SO_0704
소안항
DT_0024
장항
SO_0705
마량항
DT_0025
보령
SO_0706
청산도
DT_0026
고흥발포
SO_0707
시산항
DT_0027
완도
SO_0708
안도항
DT_0028
진도
SO_0709
두문포
DT_0029
거제도
SO_0710
봉우항
DT_0031
거문도
SO_0711
창선도
DT_0032
강화대교
SO_0712
능양항
DT_0035
흑산도
SO_0731
대진항
DT_0036
대청도
SO_0732
남애항
DT_0037
어청도
SO_0733
강릉항
DT_0038
굴업도
SO_0734
궁촌항
DT_0039
왕돌초
SO_0735
죽변항
DT_0040
독도
SO_0736
축산항
DT_0041
복사초
SO_0737
강구항
DT_0042
교본초
SO_0739
도장항
DT_0043
영흥도
SO_0740
보옥항
DT_0044
영종대교
SO_0752
검산항
DT_0046
쌍정초
SO_0753
하의도웅곡
DT_0047
도농탄
SO_0754
평호리
DT_0048
속초등표
SO_0755
원동항
DT_0049
광양
SO_0756
사초항
DT_0050
태안
SO_0757
안남리
DT_0051
서천마량
SO_0758
달천도
DT_0052
인천송도
SO_0759
장문리
DT_0054
진해
SO_0760
오산항
DT_0056
부산항신항
SO_0761
녹동항
DT_0057
동해항
SO_1248
신안옥도
DT_0058
경인항
SO_1249
독거도
DT_0059
백령도
SO_1250
평도
DT_0060
연평도
SO_1251
낙월도
DT_0061
삼천포
SO_1252
외연도항
DT_0062
마산
SO_1253
상왕등도
DT_0063
가덕도
SO_1254
만재도
DT_0064
교동대교
SO_1255
상태도
DT_0065
덕적도
SO_1256
어류정항
DT_0067
안흥
SO_1257
강화하리
DT_0068
위도
SO_1258
잠진도
DT_0091
포항
SO_1259
자월도
DT_0092
여호항
SO_1260
방포항
DT_0093
소무의도
SO_1261
무창포항
DT_0094
서거차도
SO_1262
격포항
IE_0060
이어도
SO_1263
구시포항
IE_0061
신안가거초
SO_1264
계마항
IE_0062
옹진소청초
SO_1265
송이도
SO_0326
미조항
SO_1266
남열항
SO_0537
벽파진
SO_1267
구룡포항
SO_0538
안마도
SO_1268
궁평항
SO_0539
강화외포
SO_1269
연도항
SO_0540
호산항
SO_1270
삼길포항
SO_0547
말도
SO_1271
어은돌항
SO_0548
우이도
SO_1272
다대포항
SO_0549
초도
SO_1273
장호항
SO_0550
나로도
SO_1274
거진항
SO_0551
여서도
SO_1275
공현진항
SO_0552
고현항
SO_1276
아야진항
SO_0553
해운대
SO_1277
화순항
SO_0554
영종왕산
SO_1278
원평항
SO_0555
서망항
SO_1279
어란진항
SO_0562
승봉도
SO_1280
덕산항
SO_0563
울도
SO_1281
임원항
SO_0564
국화도
SO_1282
선재도
SO_0565
향화도항
SO_1283
사천진항`;

const REF_STATIONS = [];
{
    const lines = NEW_API_TARGETS_RAW.split('\n').map(s => s.trim()).filter(s => s);
    const oldMap = {};
    OLD_REF_STATIONS.forEach(s => oldMap[s.code] = s);

    for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 >= lines.length) break;
        const code = lines[i];
        const name = lines[i + 1];
        const old = oldMap[code];
        REF_STATIONS.push({
            code: code,
            name: name,
            lat: old ? old.lat : null,
            lon: old ? old.lon : null
        });
    }
}

// Map for quick lookup
const REF_MAP = {};
REF_STATIONS.forEach(s => REF_MAP[s.code] = s);

// STATE Variables
let targetList = [];
let extractedData = {}; // Cache for standard tide data
let astroData = {};     // Cache for astro data
let stopFlag = false;   // To pause/stop processing

// Logger
const logEl = document.getElementById('logConsole');
function log(msg, type = '') {
    const div = document.createElement('div');
    if (type) div.className = type;
    div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (logEl) {
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    } else {
        console.log(msg); // Fallback
    }
}

function loadDefaultPorts() {
    if (typeof DEFAULT_TARGET_PORTS !== 'undefined') {
        const el = document.getElementById('targetPorts');
        if (el) el.value = DEFAULT_TARGET_PORTS;
    } else {
        alert('기본 목록 파일을 불러오지 못했습니다. (target_ports_list.js)');
    }
}
window.onload = function () { loadDefaultPorts(); };

// ===================================
// UTILS
// ===================================
function getDates(sDate, eDate) {
    const dates = [];
    let cur = new Date(sDate);
    let end = new Date(eDate);
    while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10).replace(/-/g, ''));
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
}

// Pause/Stop Control
function togglePause() {
    stopFlag = !stopFlag;
    const btn = document.getElementById('btnPause');
    if (btn) {
        btn.innerText = stopFlag ? "일시정지됨 (재개하려면 클릭)" : "❚❚ 일시정지";
        btn.style.background = stopFlag ? "#fbbf24" : "#64748b";
        btn.style.color = stopFlag ? "#000" : "#fff";
    }
    if (stopFlag) {
        log("사용자에 의해 작업이 일시정지되었습니다.", "log-warn");
    } else {
        log("작업을 재개합니다.");
    }
}

async function checkPause() {
    while (stopFlag) {
        await new Promise(r => setTimeout(r, 500));
    }
}

// CSV Escape Helper (Critical for JSON Strings)
function escapeCsv(str) {
    if (str == null) return "";
    str = String(str);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}


// ===================================
// STEP 1. TIDE COLLECTION (공공데이터포털 surveyTideLevel API)
// ===================================
async function startTideCollection() {
    const apiKeyRaw = document.getElementById('apiKey').value || "";
    const apiKey = apiKeyRaw.trim();
    const sDate = document.getElementById('tideStartDate').value;
    const eDate = document.getElementById('tideEndDate').value;

    if (!apiKey) { alert("조석 API Key를 입력하세요."); return; }

    const dates = getDates(sDate, eDate);

    log(`[Step 1] 표준항 ${REF_STATIONS.length}개소 전체에 대한 조석예보(고/저조) 수집 시작 (${dates.length}일치)`);
    log(`[INFO] 국립해양조사원 조석예보 API (tideFcstHghLw) 사용`);

    let total = REF_STATIONS.length * dates.length;
    let curr = 0;
    let successCount = 0;

    document.getElementById('btnTideStep').disabled = true;

    for (let i = 0; i < REF_STATIONS.length; i++) {
        const st = REF_STATIONS[i];
        log(`[${i + 1}/${REF_STATIONS.length}] ${st.name}(${st.code}) 조회 중...`);

        for (const date of dates) {
            await checkPause();
            curr++;
            updateProgress(curr, total, `${st.name} | ${date}`);

            if (extractedData[`${st.code}_${date}`] && extractedData[`${st.code}_${date}`].length > 0) continue;

            try {
                // Endpoint Strategy:
                // 1. Correct Operation Name: GetTideFcstHghLwApiService
                // 2. Fallback: KHOA Direct Server
                // 3. Date Params: Send ALL aliases (date, reqDate, searchDate) to be safe

                const qParams = `&date=${date}&reqDate=${date}&searchDate=${date}`;

                const tryUrls = [
                    {
                        // Gateway Standard (PascalCase Operation)
                        url: `https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService?serviceKey=${encodeURIComponent(apiKey)}&type=json&obsCode=${st.code}${qParams}`,
                        name: 'Gateway'
                    },
                    {
                        // Gateway Fallback (HTTP)
                        url: `http://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService?serviceKey=${encodeURIComponent(apiKey)}&type=json&obsCode=${st.code}${qParams}`,
                        name: 'GatewayHTTP'
                    },
                    {
                        // KHOA Direct Server (Absolute Fallback)
                        url: `http://www.khoa.go.kr/oceangrid/khoa/takepart/openapi/openApiObsTidePreTabDataInfo.do?ServiceKey=${encodeURIComponent(apiKey)}&ResultType=json&ObsCode=${st.code}&Date=${date}&ReqDate=${date}`,
                        name: 'KHOA'
                    }
                ];

                let validJson = null;
                let finalUrl = "";

                for (const t of tryUrls) {
                    try {
                        let res = await fetch(t.url);
                        if (res.status === 404) continue; // Wrong URL
                        if (!res.ok) continue; // Server Error

                        const text = await res.text();
                        // Validation: If it returns HTML error page, skip
                        if (text.trim().startsWith("<") && !text.includes("<resultCode>")) {
                            continue;
                        }

                        try {
                            validJson = JSON.parse(text);
                            finalUrl = t.url;
                            if (validJson) break;
                        } catch (e) {
                            // JSON Parse Error
                        }
                    } catch (netErr) {
                        // Network Error
                    }
                }

                if (!validJson) {
                    if (curr <= 3) log(`[API Fail] 모든 경로 시도 실패 (${st.name})`, 'log-warn');
                    log(`[DEBUG] Final Attempt: ${tryUrls[0].url}`, 'log-info');
                    continue;
                }

                let json = validJson;

                // [DEBUG] Log the structure of the first successful response
                if (curr === 1) {
                    console.log(`[DEBUG] JSON Response for ${st.name}:`, json);
                    const debugMsg = JSON.stringify(json).substring(0, 500);
                    log(`[API Response Preview] ${debugMsg}...`, 'log-info');
                }

                // Continue with existing JSON processing logic...

                // Check Result Code (Portal: resultCode="0", KHOA: result.meta.code? or resultCode?)
                // Allow "0" or "200"
                const rCode = json.resultCode || (json.response && json.response.header ? json.response.header.resultCode : null) || (json.result ? json.result.code : null);

                if (rCode && rCode !== "0" && rCode !== "00" && rCode !== "200") {
                    // Check KHOA direct error sometimes in result.msg
                    if (curr <= 3) log(`[API Error] Code:${rCode}, Msg:${json.resultMsg || (json.result ? json.result.msg : 'Unknown')}`, 'log-warn');
                    continue;
                }

                // Extract Data (Robust)
                let dataList = null;

                // 1. Root 'body' structure (Found in Logs: { header:..., body: { items: { item: [...] } } })
                if (json.body && json.body.items) {
                    dataList = json.body.items;
                }
                // 2. Standard Portal structure ({ response: { body: { items: ... } } })
                else if (json.response && json.response.body && json.response.body.items) {
                    dataList = json.response.body.items;
                }
                // 3. KHOA Direct structure ({ result: { data: ... } })
                else if (json.result && json.result.data) {
                    dataList = json.result.data;
                }
                // 4. Root items (Legacy)
                else if (json.items) {
                    dataList = json.items;
                }

                if (dataList) {
                    /* Handle 'item' wrapper */
                    if (dataList.item) dataList = dataList.item;
                    else if (!Array.isArray(dataList)) dataList = [dataList];
                }

                dataList = dataList || [];
                if (!Array.isArray(dataList)) dataList = [dataList];



                if (dataList.length === 0) {
                    if (curr <= 3) log(`[No Data] ${st.name}: 데이터가 비어있습니다. (ResultCode: ${rCode})`, 'log-warn');
                }

                if (dataList.length > 0) {
                    if (successCount === 0) log(`데이터 수신 성공! (${st.name}) - ${dataList.length}건`, 'log-success');
                    successCount++;

                    // Map Data
                    const transformed = dataList.map(item => {
                        // KHOA Direct: tph_time (YYYY-MM-DD HH:mm:ss), tph_level, hl_code (고조/저조)
                        // Portal: predcDt, predcTdlVl, extrSe (1,2,3,4)

                        let time = item.predcDt || item.tph_time;
                        // Check 'predcTdlvVl' (Tyrol/Typo observed in log) as well as 'predcTdlVl'
                        let level = item.predcTdlVl || item.predcTdlvVl || item.tph_level;
                        let typeRaw = item.extrSe || item.hl_code;

                        // Normalize Type if needed
                        return { time, level, type: typeRaw };
                    });

                    extractedData[`${st.code}_${date}`] = transformed;
                }


            } catch (e) {
                console.error(e);
            }
            await new Promise(r => setTimeout(r, 60)); // Throttle
        }
    }

    log(`[Step 1] 수집 완료. (총 ${successCount}건)`);
    enableButton('btnTideStep');
    checkReadyForFinal();
}





// ===================================
// STEP 2. MATCHING (Nominatim)
// ===================================
async function startMatching() {
    const text = document.getElementById('targetPorts').value.trim();
    if (!text) { alert('임의항 목록을 입력하세요.'); return; }

    // Parse Region & List
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    targetList = [];
    let currentRegion = "미분류";

    lines.forEach(line => {
        if (line.startsWith('<') && line.endsWith('>')) {
            currentRegion = line.replace(/[<>]/g, '');
        } else if (!line.startsWith('참고')) {
            targetList.push({
                id: Math.random().toString(36).substr(2, 9),
                region: currentRegion,
                name: line,
                lat: null, lon: null,
                note: '',
                status: 'pending',
                match: null
            });
        }
    });

    renderTable();
    disableButton('btnMatchStep');
    log(`[Step 2] ${targetList.length}개 임의항 위치 매칭 시작...`);

    // Batch
    for (let i = 0; i < targetList.length; i++) {
        await checkPause();

        const item = targetList[i];

        try {
            let searchName = item.name.replace(/(선착장|포구|나루터|등대|항)$/g, "");
            const q = encodeURIComponent(searchName);
            // Korea bias
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=kr&limit=1`);
            const data = await res.json();

            if (data && data.length > 0) {
                item.lat = parseFloat(data[0].lat);
                item.lon = parseFloat(data[0].lon);
                item.status = 'ok';
                findNearest(item);
            } else {
                item.status = 'fail';
                item.note = '검색실패';
                log(` -> 위치검색 실패: ${item.name}`, 'log-err');
            }
        } catch (e) {
            item.status = 'error';
        }

        updateRow(item);
        updateProgress(i + 1, targetList.length, "위치매칭");
        await new Promise(r => setTimeout(r, 800)); // Rate limit
    }

    log("[Step 2] 매칭 완료.");
    enableButton('btnMatchStep');
    enableButton('btnAstroStep');
    checkReadyForFinal();
}

function findNearest(item) {
    if (!item.lat || !item.lon) return;
    let minD = Infinity;
    let best = null;
    REF_STATIONS.forEach(st => {
        const d = getDistance(item.lat, item.lon, st.lat, st.lon);
        if (d < minD) { minD = d; best = st; }
    });
    if (best) {
        item.match = { ...best, dist: minD };
        item.status = 'ok';
    }
}

// DMS & Manual Input Helper
function parseDms(str) {
    if (str.includes(':')) {
        const parts = str.split(':');
        return parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
    }
    if (str.includes('도')) {
        const parts = str.split('도');
        const deg = parseFloat(parts[0]);
        const min = parseFloat(parts[1].replace('분', ''));
        return deg + (min / 60);
    }
    return parseFloat(str.replace(/[^0-9\.\-]/g, ''));
}

function manualInput(id, val) {
    const item = targetList.find(x => x.id === id);
    if (!item) return;

    let rawLon, rawLat;
    if (val.includes("동경") && val.includes("북위")) {
        const parts = val.replace(/,/g, ' ').split(' ');
        parts.forEach(p => {
            if (p.includes("동경")) rawLon = p.replace("동경", "");
            if (p.includes("북위")) rawLat = p.replace("북위", "");
        });
    } else {
        const chunks = val.replace(/,/g, ' ').split(' ').filter(s => s.trim().length > 0);
        if (chunks.length >= 2) {
            const v1 = parseFloat(chunks[0]), v2 = parseFloat(chunks[1]);
            if (v1 > 100 || chunks[0].startsWith('1')) { rawLon = chunks[0]; rawLat = chunks[1]; }
            else { rawLat = chunks[0]; rawLon = chunks[1]; }
        }
    }

    if (rawLon && rawLat) {
        item.lon = parseDms(rawLon);
        item.lat = parseDms(rawLat);

        if (!isNaN(item.lon) && !isNaN(item.lat)) {
            item.status = 'ok';
            findNearest(item);
            updateRow(item);
            checkReadyForFinal();
        }
    }
}


// ===================================
// STEP 3. ASTRO COLLECTION
// ===================================
async function startAstroCollection() {
    const astroKey = document.getElementById('astroKey').value;
    const sDate = document.getElementById('genStartDate').value;
    const eDate = document.getElementById('genEndDate').value;

    if (!astroKey) { alert("천문 API Key를 입력하세요."); return; }
    if (targetList.length === 0) { alert("매칭된 임의항 목록이 없습니다. Step 2를 먼저 하세요."); return; }

    const dates = getDates(sDate, eDate);

    log(`[Step 3] 천문 정보 수집 시작 (${targetList.length}개 항구 x ${dates.length}일)`);
    disableButton('btnAstroStep');

    let total = targetList.length * dates.length;
    let curr = 0;

    for (const target of targetList) {
        await checkPause();

        const lat = target.lat || (target.match ? target.match.lat : null);
        const lon = target.lon || (target.match ? target.match.lon : null);

        if (!lat || !lon) { curr += dates.length; continue; }

        log(`천문 데이터 수집: ${target.name} (${curr}/${total})`);

        const locKey = `${lat.toFixed(4)}_${lon.toFixed(4)}`;

        for (const date of dates) {
            curr++;
            updateProgress(curr, total, "천문 수집");

            const cacheId = `${locKey}_${date}`;
            if (astroData[cacheId]) continue;

            try {
                let sKey = astroKey.trim();
                // Simple Logic:
                // If key has '%', it is Encoding Key. DO NOT encode again.
                // If key has NO '%', it is Decoding Key. Encode it.
                if (!sKey.includes('%')) {
                    sKey = encodeURIComponent(sKey);
                }

                // HTTPS, ServiceKey First. 
                // Using CORS Proxy to bypass potential CORS/Forbidden issues in local environment.
                const proxy = 'https://cors-anywhere.herokuapp.com/';
                const targetUrl = `https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo?ServiceKey=${sKey}&locdate=${date}&longitude=${lon}&latitude=${lat}&dnYn=Y`;
                const url = proxy + targetUrl;

                const res = await fetch(url);
                const text = await res.text();
                // FORCE LOG
                if (!res.ok) {
                    console.log("[DEBUG] API Raw Response:", text);
                    log(`[API 응답 원본] ${text.substring(0, 100)}...`, 'log-err');
                }

                const parser = new DOMParser();
                const xml = parser.parseFromString(text, "text/xml");

                // ERROR HANDLING: Check for API Error Messages
                const returnAuthMsg = xml.querySelector('returnAuthMsg');
                const returnReasonCode = xml.querySelector('returnReasonCode');

                if (returnAuthMsg || returnReasonCode) {
                    const msg = returnAuthMsg ? returnAuthMsg.textContent : returnReasonCode.textContent;
                    // Log error if not 00 or OK
                    if (msg !== '00' && msg !== 'NORMAL SERVICE') {
                        if (curr <= 2) log(`[API 오류] ${msg} (URL: ${url})`, 'log-err');
                        // Don't continue, let it fail so user sees it
                    }
                }

                const item = xml.querySelector('item');

                if (item) {
                    const getVal = (tag) => item.querySelector(tag)?.textContent?.trim() || "-";
                    const fmt = (s) => (s && s.length === 4 && !isNaN(s)) ? `${s.slice(0, 2)}:${s.slice(2)}` : s;

                    astroData[cacheId] = {
                        sunrise: fmt(getVal('sunrise')),
                        sunset: fmt(getVal('sunset')),
                        moonrise: fmt(getVal('moonrise')),
                        moonset: fmt(getVal('moonset')),
                        civilStart: fmt(getVal('civilTwilightStart')),
                        civilEnd: fmt(getVal('civilTwilightEnd')),
                        nautiStart: fmt(getVal('nauticalTwilightStart')),
                        nautiEnd: fmt(getVal('nauticalTwilightEnd')),
                        astroStart: fmt(getVal('astronTwilightStart')),
                        astroEnd: fmt(getVal('astronTwilightEnd')),
                        solarNoon: fmt(getVal('sunTransitTime')), // 일남중 (태양남중)
                        lunarNoon: fmt(getVal('moonTransitTime')) // 월남중 (달남중)
                    };
                }
            } catch (e) { }

            await new Promise(r => setTimeout(r, 80));
        }
    }

    log("[Step 3] 천문 정보 수집 완료.");
    enableButton('btnAstroStep');
    checkReadyForFinal();
}


// ===================================
// STEP 4 & 5. INTEGRATION & DOWNLOAD
// ===================================
function checkReadyForFinal() {
    if (targetList.length > 0) {
        enableButton('btnFinal');
    }
}

function processAndDownloadFinal() {
    log("[Step 4] 데이터 통합 및 생성 중...");

    const header = [
        "날짜", "지역", "임의항명", "임의항위도", "임의항경도",
        "매칭표준항", "표준항위도", "표준항경도", "거리(km)",
        // Astro
        "일출", "일남중", "일몰", "월출", "월남중", "월몰",
        "시민박명(아침)", "시민박명(저녁)",
        "항해박명(아침)", "항해박명(저녁)",
        "천문박명(아침)", "천문박명(저녁)",
        // Tide
        "1물", "2물", "3물", "4물"
    ];

    const rows = [];
    const dateList = getDates(
        document.getElementById('genStartDate').value, // Use Generation Period
        document.getElementById('genEndDate').value
    );

    targetList.forEach(target => {
        const refCode = target.match ? target.match.code : null;
        const lat = target.lat || (target.match ? target.match.lat : null);
        const lon = target.lon || (target.match ? target.match.lon : null);

        dateList.forEach(date => {
            // 1. Astro
            let a = { sunrise: '-', socialNoon: '-', sunset: '-', moonrise: '-', lunarNoon: '-', moonset: '-', civilStart: '-', civilEnd: '-', nautiStart: '-', nautiEnd: '-', astroStart: '-', astroEnd: '-' };

            if (lat && lon) {
                const locKey = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
                const ad = astroData[`${locKey}_${date}`];
                if (ad) {
                    if (ad.sunrise) a.sunrise = ad.sunrise;
                    if (ad.solarNoon) a.socialNoon = ad.solarNoon;
                    if (ad.sunset) a.sunset = ad.sunset;
                    if (ad.moonrise) a.moonrise = ad.moonrise;
                    if (ad.lunarNoon) a.lunarNoon = ad.lunarNoon;
                    if (ad.moonset) a.moonset = ad.moonset;
                    if (ad.civilStart) a.civilStart = ad.civilStart;
                    if (ad.civilEnd) a.civilEnd = ad.civilEnd;
                    if (ad.nautiStart) a.nautiStart = ad.nautiStart;
                    if (ad.nautiEnd) a.nautiEnd = ad.nautiEnd;
                    if (ad.astroStart) a.astroStart = ad.astroStart;
                    if (ad.astroEnd) a.astroEnd = ad.astroEnd;
                }
            }

            // 2. Tide (High/Low)
            let tideCols = [];
            if (refCode) {
                const tData = extractedData[`${refCode}_${date}`];
                if (tData && tData.length) {
                    // Sort by time
                    tData.sort((x, y) => x.time.localeCompare(y.time));

                    tData.forEach(t => {
                        const typeStr = (t.type === "1" || t.type === "3") ? "고" : "저";
                        tideCols.push(`${t.time.substring(11, 16)} (${typeStr}:${t.level})`);
                    });
                } else {
                    tideCols.push("데이터 없음");
                }
            } else {
                tideCols.push("표준항 미매칭");
            }


            // Format date for Final CSV (YYYY-MM-DD)
            const yyyy_mm_dd = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
            const m = target.match || { name: '-', lat: '-', lon: '-', dist: '-' };

            rows.push([
                yyyy_mm_dd, target.region, target.name, target.lat, target.lon,
                m.name, m.lat, m.lon, m.dist,
                a.sunrise, a.socialNoon, a.sunset, a.moonrise, a.lunarNoon, a.moonset,
                a.civilStart, a.civilEnd, a.nautiStart, a.nautiEnd, a.astroStart, a.astroEnd,
                ...tideCols
            ]);
        });
    });

    saveCsv(header, rows, "4_통합대상조석천문정보.csv");
    alert("데이터 통합 및 파일 생성이 완료되었습니다. (다운로드 폴더 확인)");
}


// ===================================
// UI HELPERS
// ===================================
function updateProgress(curr, total, label) {
    const pct = Math.floor((curr / total) * 100);
    const pBar = document.getElementById('pBar');
    const pText = document.getElementById('pText');
    if (pBar) pBar.style.width = pct + '%';
    if (pText) pText.innerText = `${label} (${curr}/${total}) ${pct}%`;
}

function enableButton(id) {
    const btn = document.getElementById(id);
    if (btn) { btn.disabled = false; btn.classList.add('success'); }
}
function disableButton(id) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
}

function renderTable() {
    const tbody = document.querySelector('#matchTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    targetList.forEach(item => {
        const tr = document.createElement('tr');
        tr.id = `row-${item.id}`;
        tbody.appendChild(tr);
        updateRow(item);
    });
}

function updateRow(item) {
    const tr = document.getElementById(`row-${item.id}`);
    if (!tr) return;

    let badge = item.status === 'ok' ? '<span class="badge ok" title="완료">●</span>' :
        item.status === 'fail' ? '<span class="badge err" title="실패">X</span>' :
            '<span class="badge pend">...</span>';

    let matchStr = '-';
    if (item.match) matchStr = `${item.match.name} (${item.match.dist}km)`;

    tr.innerHTML = `
        <td>${item.region}</td>
        <td>${item.name}</td>
        <td style="text-align:center;">${badge}</td>
        <td>
            <input type="text" class="coord-input" 
                   value="${item.lat !== null ? item.lat.toFixed(5) + ', ' + item.lon.toFixed(5) : ''}"
                   placeholder="위도, 경도"
                   onchange="manualInput('${item.id}', this.value)">
        </td>
        <td style="font-size:0.75rem; color:#94a3b8;">${item.note}</td>
        <td>${matchStr}</td>
    `;
}

// RAW SAVE (새 API용 - 시간별 조위 데이터)
// RAW SAVE (조석예보 - 고조/저조)
function downloadRawData() {
    if (Object.keys(extractedData).length === 0) { alert('데이터가 없습니다.'); return; }

    // User requested format:
    // 기준일자 / 표준항명 / 표준항 경도 / 표준항 위도 / 표준항 코드 / 
    // 고조1 예측일시 / 고조1 예측조위 / 저조 1 예측일시 / 저조1 예측조위 / 
    // 고조2 예측일시 / 고조2 예측조위 / 저조2 예측일시 / 저조2 예측조위

    const header = [
        "기준일자", "표준항명", "표준항 경도", "표준항 위도", "표준항 코드",
        "고조1 예측일시", "고조1 예측조위", "저조1 예측일시", "저조1 예측조위",
        "고조2 예측일시", "고조2 예측조위", "저조2 예측일시", "저조2 예측조위"
    ];

    const rows = [];
    const typeMap = { "1": "High", "3": "High", "2": "Low", "4": "Low" };

    Object.keys(extractedData).forEach(k => {
        const lastUnderscore = k.lastIndexOf('_');
        const code = k.substring(0, lastUnderscore);
        const dateRaw = k.substring(lastUnderscore + 1);
        const dateFormatted = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6)}`;

        const st = REF_MAP[code];
        const stName = st ? st.name : code;
        const stLon = st ? st.lon : "";
        const stLat = st ? st.lat : "";

        const dataArr = extractedData[k];
        if (!Array.isArray(dataArr)) return;

        // Sort by time just in case
        dataArr.sort((a, b) => a.time.localeCompare(b.time));

        let highs = [], lows = [];
        dataArr.forEach(item => {
            // Check '1'/'2' code or text '고조'/'저조'
            let t = typeMap[item.type] || item.type;
            // Normalize logic
            if (t === "High" || (typeof t === 'string' && t.includes("고조")) || item.type == "1" || item.type == "3") highs.push(item);
            else if (t === "Low" || (typeof t === 'string' && t.includes("저조")) || item.type == "2" || item.type == "4") lows.push(item);
        });

        // Fill Row (H1, L1, H2, L2)
        const row = [
            dateFormatted, stName, stLon, stLat, code,
            highs[0] ? highs[0].time : "", highs[0] ? highs[0].level : "",
            lows[0] ? lows[0].time : "", lows[0] ? lows[0].level : "",
            highs[1] ? highs[1].time : "", highs[1] ? highs[1].level : "",
            lows[1] ? lows[1].time : "", lows[1] ? lows[1].level : ""
        ];
        rows.push(row);
    });

    // Sort: 1. Station Order, 2. Date
    const stOrder = {};
    REF_STATIONS.forEach((s, i) => stOrder[s.code] = i);

    rows.sort((a, b) => {
        const idxA = stOrder[a[4]] !== undefined ? stOrder[a[4]] : 9999;
        const idxB = stOrder[b[4]] !== undefined ? stOrder[b[4]] : 9999;
        if (idxA !== idxB) return idxA - idxB;
        return a[0].localeCompare(b[0]);
    });

    saveCsv(header, rows, "1_조석예보_가로형_Pivot.csv");
    log(`[다운로드] ${rows.length}건 저장됨 (가로형 포맷)`);
}


function downloadMatchInfo() {
    if (targetList.length === 0) { alert('데이터가 없습니다.'); return; }
    const header = ["지역", "임의항", "상태", "위도", "경도", "비고", "매칭표준항", "매칭거리"];
    const rows = targetList.map(x => [
        x.region, x.name, x.status, x.lat, x.lon, x.note,
        x.match ? `${x.match.name}(${x.match.code})` : '-',
        x.match ? x.match.dist : '-'
    ]);
    saveCsv(header, rows, "2_매칭결과.csv");
}

function downloadAstroData() {
    if (Object.keys(astroData).length === 0) { alert('데이터가 없습니다.'); return; }
    const header = ["위_경도_날짜", "위도", "경도", "날짜", "일출", "일몰", "월출", "월몰", "전체JSON"];
    const rows = [];
    Object.keys(astroData).forEach(k => {
        const parts = k.split('_');
        const date = parts[parts.length - 1];
        const lat = parts[0];
        const lon = parts[1];
        const d = astroData[k];
        rows.push([
            k, lat, lon, date,
            d.sunrise, d.sunset, d.moonrise, d.moonset,
            JSON.stringify(d)
        ]);
    });
    saveCsv(header, rows, "3_천문_원본데이터.csv");
}

function saveCsv(header, rows, filename) {
    let csvContent = "\uFEFF" + header.join(",") + "\n";
    rows.forEach(r => {
        const line = r.map(v => {
            const val = escapeCsv(v);
            return val;
        });
        csvContent += line.join(",") + "\n";
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
