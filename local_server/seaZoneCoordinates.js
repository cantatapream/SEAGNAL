// 해상 기상특보구역 좌표 정보
// 각 구역의 대표 중심점 좌표 (위도, 경도)

const SEA_ZONE_COORDINATES = {
    // ===== 동해남부 =====
    '12C10101': {
        code: '12C10101',
        name: '울산앞바다',
        lat: 35.35,
        lon: 129.84,
        region: '동해남부',
        type: 'I' // 해상국지
    },
    '12C10102': {
        code: '12C10102',
        name: '경북남부앞바다',
        lat: 36.35,
        lon: 129.78,
        region: '동해남부',
        type: 'I'
    },
    '12C10103': {
        code: '12C10103',
        name: '경북북부앞바다',
        lat: 36.91,
        lon: 129.87,
        region: '동해남부',
        type: 'I'
    },
    '12C10100': {
        code: '12C10100',
        name: '동해남부남쪽안쪽먼바다',
        lat: 36.00,
        lon: 131.00,
        region: '동해남부',
        type: 'H' // 해상광역
    },
    '12C10200': {
        code: '12C10200',
        name: '동해남부남쪽바깥먼바다',
        lat: 35.60,
        lon: 132.50,
        region: '동해남부',
        type: 'H'
    },
    '12C10201': {
        code: '12C10201',
        name: '동해남부북쪽안쪽먼바다',
        lat: 37.00,
        lon: 131.00,
        region: '동해남부',
        type: 'H'
    },
    '12C10202': {
        code: '12C10202',
        name: '동해남부북쪽바깥먼바다',
        lat: 37.20,
        lon: 132.50,
        region: '동해남부',
        type: 'H'
    },

    // ===== 동해중부 =====
    '12C20101': {
        code: '12C20101',
        name: '강원남부앞바다',
        lat: 37.54,
        lon: 130.00,
        region: '동해중부',
        type: 'I'
    },
    '12C20102': {
        code: '12C20102',
        name: '강원중부앞바다',
        lat: 37.80,
        lon: 129.06,
        region: '동해중부',
        type: 'I'
    },
    '12C20103': {
        code: '12C20103',
        name: '강원북부앞바다',
        lat: 38.32,
        lon: 128.64,
        region: '동해중부',
        type: 'I'
    },
    '12C20100': {
        code: '12C20100',
        name: '동해중부안쪽먼바다',
        lat: 37.90,
        lon: 130.00,
        region: '동해중부',
        type: 'H'
    },
    '12C20200': {
        code: '12C20200',
        name: '동해중부바깥먼바다',
        lat: 38.00,
        lon: 131.80,
        region: '동해중부',
        type: 'H'
    },

    // ===== 동해북부 =====
    '12C30100': {
        code: '12C30100',
        name: '동해북부앞바다',
        lat: 38.70,
        lon: 129.00,
        region: '동해북부',
        type: 'H'
    },
    '12C30200': {
        code: '12C30200',
        name: '동해북부먼바다',
        lat: 39.00,
        lon: 130.50,
        region: '동해북부',
        type: 'H'
    },

    // ===== 서해북부 =====
    '12A10100': {
        code: '12A10100',
        name: '서해북부앞바다',
        lat: 38.00,
        lon: 125.50,
        region: '서해북부',
        type: 'H'
    },
    '12A10200': {
        code: '12A10200',
        name: '서해북부먼바다',
        lat: 38.50,
        lon: 124.50,
        region: '서해북부',
        type: 'H'
    },

    // ===== 서해중부 =====
    '12A20101': {
        code: '12A20101',
        name: '인천·경기북부앞바다',
        lat: 37.62,
        lon: 125.65,
        region: '서해중부',
        type: 'I'
    },
    '12A20102': {
        code: '12A20102',
        name: '인천·경기남부앞바다',
        lat: 37.24,
        lon: 126.02,
        region: '서해중부',
        type: 'I'
    },
    '12A20103': {
        code: '12A20103',
        name: '충남북부앞바다',
        lat: 36.45,
        lon: 126.24,
        region: '서해중부',
        type: 'I'
    },
    '12A20104': {
        code: '12A20104',
        name: '충남남부앞바다',
        lat: 36.17,
        lon: 126.33,
        region: '서해중부',
        type: 'I'
    },
    '12A20100': {
        code: '12A20100',
        name: '서해중부안쪽먼바다',
        lat: 37.00,
        lon: 125.80,
        region: '서해중부',
        type: 'H'
    },
    '12A20200': {
        code: '12A20200',
        name: '서해중부바깥먼바다',
        lat: 37.00,
        lon: 124.50,
        region: '서해중부',
        type: 'H'
    },

    // ===== 서해남부 =====
    '22A30101': {
        code: '22A30101',
        name: '전북북부앞바다',
        lat: 35.89,
        lon: 126.43,
        region: '서해남부',
        type: 'I'
    },
    '22A30102': {
        code: '22A30102',
        name: '전북남부앞바다',
        lat: 35.66,
        lon: 125.81,
        region: '서해남부',
        type: 'I'
    },
    '22A30103': {
        code: '22A30103',
        name: '전남북부서해앞바다',
        lat: 35.44,
        lon: 126.18,
        region: '서해남부',
        type: 'I'
    },
    '22A30104': {
        code: '22A30104',
        name: '전남중부서해앞바다',
        lat: 34.92,
        lon: 125.87,
        region: '서해남부',
        type: 'I'
    },
    '22A30105': {
        code: '22A30105',
        name: '전남남부서해앞바다',
        lat: 34.50,
        lon: 125.50,
        region: '서해남부',
        type: 'I'
    },
    '12A30101': {
        code: '12A30101',
        name: '서해남부북쪽안쪽먼바다',
        lat: 35.60,
        lon: 125.50,
        region: '서해남부',
        type: 'H'
    },
    '12A30102': {
        code: '12A30102',
        name: '서해남부남쪽안쪽먼바다',
        lat: 34.80,
        lon: 125.40,
        region: '서해남부',
        type: 'H'
    },
    '12A30201': {
        code: '12A30201',
        name: '서해남부북쪽바깥먼바다',
        lat: 35.50,
        lon: 124.00,
        region: '서해남부',
        type: 'H'
    },
    '12A30202': {
        code: '12A30202',
        name: '서해남부남쪽바깥먼바다',
        lat: 34.50,
        lon: 124.00,
        region: '서해남부',
        type: 'H'
    },

    // ===== 남해동부 =====
    '12B20103': {
        code: '12B20103',
        name: '부산앞바다',
        lat: 35.10,
        lon: 129.13,
        region: '남해동부',
        type: 'I'
    },
    '12B20102': {
        code: '12B20102',
        name: '경남중부남해앞바다',
        lat: 34.97,
        lon: 128.76,
        region: '남해동부',
        type: 'I'
    },
    '12B20101': {
        code: '12B20101',
        name: '경남서부남해앞바다',
        lat: 34.62,
        lon: 128.54,
        region: '남해동부',
        type: 'I'
    },
    '12B20104': {
        code: '12B20104',
        name: '거제시동부앞바다',
        lat: 34.77,
        lon: 128.90,
        region: '남해동부',
        type: 'I'
    },
    '12B20100': {
        code: '12B20100',
        name: '남해동부안쪽먼바다',
        lat: 34.80,
        lon: 128.50,
        region: '남해동부',
        type: 'H'
    },
    '12B20200': {
        code: '12B20200',
        name: '남해동부바깥먼바다',
        lat: 34.30,
        lon: 129.00,
        region: '남해동부',
        type: 'H'
    },

    // ===== 남해서부 =====
    '12B10101': {
        code: '12B10101',
        name: '전남서부남해앞바다',
        lat: 34.23,
        lon: 126.11,
        region: '남해서부',
        type: 'I'
    },
    '12B10102': {
        code: '12B10102',
        name: '전남동부남해앞바다',
        lat: 34.38,
        lon: 127.50,
        region: '남해서부',
        type: 'I'
    },
    '12B10201': {
        code: '12B10201',
        name: '남해서부서쪽먼바다',
        lat: 33.80,
        lon: 126.14,
        region: '남해서부',
        type: 'H'
    },
    '12B10202': {
        code: '12B10202',
        name: '남해서부동쪽먼바다',
        lat: 33.80,
        lon: 127.80,
        region: '남해서부',
        type: 'H'
    },

    // ===== 제주도 =====
    '12B10302': {
        code: '12B10302',
        name: '제주도북부앞바다',
        lat: 33.70,
        lon: 126.50,
        region: '제주',
        type: 'I'
    },
    '12B10303': {
        code: '12B10303',
        name: '제주도남부앞바다',
        lat: 33.13,
        lon: 126.50,
        region: '제주',
        type: 'I'
    },
    '12B10301': {
        code: '12B10301',
        name: '제주도동부앞바다',
        lat: 33.52,
        lon: 126.97,
        region: '제주',
        type: 'I'
    },
    '12B10304': {
        code: '12B10304',
        name: '제주도서부앞바다',
        lat: 33.37,
        lon: 126.11,
        region: '제주',
        type: 'I'
    },
    '12B10400': {
        code: '12B10400',
        name: '제주도남서쪽안쪽먼바다',
        lat: 32.80,
        lon: 126.30,
        region: '제주',
        type: 'H'
    },
    '12B10401': {
        code: '12B10401',
        name: '제주도남동쪽안쪽먼바다',
        lat: 32.80,
        lon: 127.50,
        region: '제주',
        type: 'H'
    },
    '12B10402': {
        code: '12B10402',
        name: '제주도남쪽바깥먼바다',
        lat: 31.80,
        lon: 126.50,
        region: '제주',
        type: 'H'
    }
};

// 구역코드로 좌표 정보 가져오기
function getZoneCoordinates(zoneCode) {
    return SEA_ZONE_COORDINATES[zoneCode] || null;
}

// 구역명으로 좌표 정보 가져오기
function getZoneCoordinatesByName(zoneName) {
    for (const [code, info] of Object.entries(SEA_ZONE_COORDINATES)) {
        if (info.name === zoneName || zoneName.includes(info.name) || info.name.includes(zoneName)) {
            return info;
        }
    }
    return null;
}

// 지역별로 구역 목록 가져오기
function getZonesByRegion(region) {
    return Object.values(SEA_ZONE_COORDINATES).filter(zone => zone.region === region);
}

// 모든 해상국지 구역 가져오기
function getLocalSeaZones() {
    return Object.values(SEA_ZONE_COORDINATES).filter(zone => zone.type === 'I');
}

// 모든 해상광역 구역 가져오기
function getWideSeaZones() {
    return Object.values(SEA_ZONE_COORDINATES).filter(zone => zone.type === 'H');
}

// 사용 예시:
// const ulsan = getZoneCoordinates('12C10101');
// console.log(ulsan); // { code: '12C10101', name: '울산앞바다', lat: 35.35, lon: 129.84, ... }

// const jejuZones = getZonesByRegion('제주');
// console.log(jejuZones); // 제주 지역의 모든 구역

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SEA_ZONE_COORDINATES,
        getZoneCoordinates,
        getZoneCoordinatesByName,
        getZonesByRegion,
        getLocalSeaZones,
        getWideSeaZones
    };
}
