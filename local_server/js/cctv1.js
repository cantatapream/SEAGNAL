// ====================================================================
// cctv1.js — CCTV 제공기관별 데이터 정의
//
// [역할] CCTV 제공기관(KBS, 거제시, 추후 지자체·중앙부처)을 키로 구분하여
//        각 지점의 cctvId, 이름, 상세위치, 좌표(lat/lng)를 관리합니다.
//
// [설계 의도]
//   제공기관이 달라도 동일한 구조를 유지하여
//   cctv2~4.js 의 마커·팝업 로직이 어떤 기관 데이터든 동일하게 처리합니다.
//   → 새 기관 추가 시 이 파일에 블록만 추가하면 됩니다.
//
// [provider 공통 구조]
//   type      {string}   — 'iframe' | 'hls'
//                           iframe: shareUrl() 결과를 iframe src로 임베드
//                           hls:    streamUrl() 결과를 HLS.js video로 재생
//   name      {string}   — 팝업 출처 표기용 기관명
//   shareUrl  {Function} — (iframe 전용) cctvId → 영상 공유 페이지 URL
//   streamUrl {Function} — (hls 전용)   cctvId → HLS .m3u8 스트림 URL
//   links     {Array}    — 팝업 헤더 외부 링크 버튼 목록 [{ label, url }]
//   color     {string}   — 지도 마커 색상 (#rrggbb)
//   items     {Array}    — CCTV 지점 목록
//     ├ cctvId   {number} — 기관 고유 식별자 (스트림 URL에 사용)
//     ├ name     {string} — 지점 이름 (마커 라벨, 팝업 제목)
//     ├ subtitle {string} — 상세 위치 (팝업 부제목)
//     ├ lat      {string} — 위도  (WGS84)
//     └ lng      {string} — 경도  (WGS84)
//
// [연계]
//   - cctv3.js  addCctvMarkers()    — items 배열 순회
//   - cctv4.js  showCctvPopup()     — type, links, shareUrl/streamUrl 사용
// ====================================================================

/**
 * CCTV_PROVIDERS
 * 제공기관을 키(key)로 구분한 최상위 데이터 객체.
 */
const CCTV_PROVIDERS = {

    // ─────────────────────────────────────────────────────────────────
    // KBS 파노라마 CCTV
    // 출처: KBS 재난포털 (https://d.kbs.co.kr/special/cctv)
    // 영상 방식: iframe (KBS cctvShare 공개 공유 페이지)
    // 영상 URL 패턴: https://md.kbs.co.kr/special/cctvShare?cctvId={id}
    // ─────────────────────────────────────────────────────────────────
    kbs: {
        /** 팝업 출처 표기용 기관명 */
        name: 'KBS 파노라마 CCTV',

        /** 임베드 방식: KBS cctvShare 페이지를 iframe으로 로드 */
        type: 'iframe',

        /**
         * cctvId를 받아 KBS 모바일 공유 페이지 URL을 반환합니다.
         * @param {number} cctvId
         * @returns {string}
         */
        shareUrl: (cctvId) => `https://md.kbs.co.kr/special/cctvShare?cctvId=${cctvId}`,

        /** 팝업 헤더 외부 링크 버튼 목록 */
        links: [
            { label: 'KBS재난포털', url: 'https://d.kbs.co.kr/special/cctv' },
            { label: 'CCTV더보기', url: 'https://d.kbs.co.kr/special/cctv' }
        ],

        /**
         * iframe 클리핑 설정 (KBS cctvShare 페이지 전용)
         * KBS 내부 상단 타이틀(65px) + 하단 버튼(약 55px)을 숨깁니다.
         * iframeTopClip  — 상단에서 잘라낼 픽셀 (iframe을 위로 이동)
         * iframeWrapHeight — 팝업에 표시될 영상 영역 높이
         */
        iframeTopClip: 65,
        iframeWrapHeight: 310,

        /** 마커 아이콘 색상 — KBS 파란 계열 */
        color: '#1565c0',

        /** KBS 해안/해양 CCTV 지점 목록 */
        items: [
            // 동해 북부 ─────────────────────────────────────────────
            { cctvId: 9986,  name: '속초 등대전망대',      subtitle: '강원 속초 등대전망대',              lat: '38.2133900', lng: '128.6001000' },
            { cctvId: 9995,  name: '강릉 주문진방파제',    subtitle: '강원 강릉 주문진방파제',            lat: '37.8934100', lng: '128.8335000' },
            // 동해 남부 ─────────────────────────────────────────────
            { cctvId: 9987,  name: '울릉 저동항',          subtitle: '경북 울릉 저동항',                  lat: '37.4913200', lng: '130.9121900' },
            { cctvId: 9957,  name: '독도',                 subtitle: '독도',                              lat: '37.2393600', lng: '131.8686000' },
            { cctvId: 9988,  name: '포항 두호동',          subtitle: '경북 포항 두호동 해안로',           lat: '36.0626900', lng: '129.3895900' },
            { cctvId: 9991,  name: '부산 수영만',          subtitle: '부산 수영 민락항 앞',               lat: '35.1537600', lng: '129.1312100' },
            // 서해 북부 ─────────────────────────────────────────────
            { cctvId: 32020, name: '소청초 옥상',          subtitle: '서해 옹진소청초 해양과학기지 1',    lat: '37.4063870', lng: '124.7380500' },
            { cctvId: 32021, name: '소청초 접안',          subtitle: '서해 옹진소청초 해양과학기지 2',    lat: '37.4230540', lng: '124.7380500' },
            { cctvId: 32022, name: '소청초 북',            subtitle: '서해 옹진소청초 해양과학기지 북쪽', lat: '37.4250000', lng: '124.7547200' },
            { cctvId: 9958,  name: '연평도',               subtitle: '인천 옹진 연평도',                  lat: '37.6620000', lng: '125.6945000' },
            { cctvId: 9981,  name: '인천 연안부두',        subtitle: '인천 중구 연안부두',                lat: '37.4541400', lng: '126.5986200' },
            // 서해 중부 ─────────────────────────────────────────────
            { cctvId: 9980,  name: '태안 신진항',          subtitle: '충남 태안 근흥면 신진항',           lat: '36.6778800', lng: '126.1365300' },
            { cctvId: 9979,  name: '군산 비응항',          subtitle: '전북 군산 비응항',                  lat: '35.9353100', lng: '126.5265400' },
            // 서해 남부 ─────────────────────────────────────────────
            { cctvId: 9992,  name: '목포 북항',            subtitle: '전남 목포 죽교동 북항',             lat: '34.8042000', lng: '126.3652000' },
            { cctvId: 9983,  name: '가거도',               subtitle: '전남 신안 가거도',                  lat: '34.0529300', lng: '125.1292700' },
            { cctvId: 46058, name: '흑산도',               subtitle: '전남 신안 흑산도 흑산항',           lat: '34.6831600', lng: '125.4408500' },
            { cctvId: 46059, name: '홍도',                 subtitle: '전남 신안 홍도 홍도항',             lat: '34.6834300', lng: '125.1921000' },
            // 남해 ───────────────────────────────────────────────────
            { cctvId: 9985,  name: '창원 마산항',          subtitle: '경남 창원 마산항',                  lat: '35.1978500', lng: '128.5760000' },
            { cctvId: 9994,  name: '여수 오동도',          subtitle: '전남 여수 오동도 앞',               lat: '34.7409800', lng: '127.7557000' },
            { cctvId: 9993,  name: '여수 거문도',          subtitle: '전남 여수 거문도',                  lat: '34.0231600', lng: '127.3073800' },
            { cctvId: 9984,  name: '완도 완도항',          subtitle: '전남 완도 완도항',                  lat: '34.3209100', lng: '126.7488560' },
            { cctvId: 32008, name: '진도',                 subtitle: '전남 진도 의신면 수품항',           lat: '34.3777770', lng: '126.3086100' },
            { cctvId: 46050, name: '진도항',               subtitle: '전남 진도 임회면 진도항',           lat: '34.3739400', lng: '126.1345700' },
            { cctvId: 46051, name: '신비의바닷길',         subtitle: '전남 진도 신비의바닷길',            lat: '34.4271200', lng: '126.3514300' },
            // 제주 ───────────────────────────────────────────────────
            { cctvId: 49996, name: '성산일출봉',           subtitle: '제주 서귀포 성산일출봉',            lat: '33.4613880', lng: '126.9344500' },
            { cctvId: 32003, name: '모슬포항',             subtitle: '제주 서귀포 모슬포항',              lat: '33.2144430', lng: '126.2511140' },
            { cctvId: 44907, name: '모슬포항(해경)',       subtitle: '제주 서귀포 모슬포항 남쪽',         lat: '33.2144300', lng: '126.2520450' },
            { cctvId: 44912, name: '신도포구',             subtitle: '제주 서귀포 신도포구',              lat: '33.2764400', lng: '126.1710100' },
            { cctvId: 9982,  name: '마라도',               subtitle: '제주 서귀포 마라도',                lat: '33.1139220', lng: '126.2683800' },
            // 원해 ───────────────────────────────────────────────────
            { cctvId: 32017, name: '이어도 북',            subtitle: '이어도 해양과학기지 북쪽',          lat: '32.1236100', lng: '125.1816600' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────
    // 거제시 재난 CCTV
    // 출처: 거제시 대시민서비스 (https://www.geoje.go.kr/safety/cctv.do)
    // 영상 방식: HLS 스트림 직접 재생 (Vurix VMS, HLS.js 사용)
    // 영상 URL 패턴:
    //   https://www.geoje.go.kr/safety/stream/v1/hls/vurix/100001/{cameraId}/0/0
    // 데이터 출처: https://www.geoje.go.kr/safety/assets/xml/cctv.xml
    // ─────────────────────────────────────────────────────────────────
    geoje: {
        /** 팝업 출처 표기용 기관명 */
        name: '거제시 재난 CCTV',

        /** 임베드 방식: HLS 스트림을 HLS.js video 엘리먼트로 직접 재생 */
        type: 'hls',

        /**
         * cameraId를 받아 거제시 HLS 스트림 URL을 반환합니다.
         * @param {number} cameraId
         * @returns {string}
         */
        streamUrl: (cameraId) =>
            `https://www.geoje.go.kr/safety/stream/v1/hls/vurix/100001/${cameraId}/0/0`,

        /** 팝업 헤더 외부 링크 버튼 목록 */
        links: [
            { label: '거제시 대시민서비스', url: 'https://www.geoje.go.kr/safety/cctv.do' }
        ],

        /** 마커 아이콘 색상 — 거제시 초록 계열 */
        color: '#1b7340',

        /** 거제시 해상/재난 CCTV 지점 목록 (cctv.xml 기준, 2026년 4월) */
        items: [
            // 사등면 ─────────────────────────────────────────────────
            { cctvId: 101693, name: '후포',         subtitle: '경남 거제 사등면 오량리',      lat: '34.895799', lng: '128.490896' },
            { cctvId: 101697, name: '견내량',        subtitle: '경남 거제 사등면 덕호리',      lat: '34.886796', lng: '128.479707' },
            { cctvId: 101698, name: '광리',          subtitle: '경남 거제 사등면 덕호리',      lat: '34.877298', lng: '128.473098' },
            { cctvId: 102333, name: '창호리',        subtitle: '경남 거제 사등면 창호리',      lat: '34.940012', lng: '128.525896' },
            // 둔덕면 ─────────────────────────────────────────────────
            { cctvId: 101699, name: '내평',          subtitle: '경남 거제 둔덕면 술역리',      lat: '34.850100', lng: '128.478703' },
            { cctvId: 101700, name: '호곡',          subtitle: '경남 거제 둔덕면 술역리',      lat: '34.837302', lng: '128.490504' },
            { cctvId: 101701, name: '구바지락살포장', subtitle: '경남 거제 둔덕면 어구리',      lat: '34.812687', lng: '128.509917' },
            // 거제면 ─────────────────────────────────────────────────
            { cctvId: 101705, name: '아지랑마을',    subtitle: '경남 거제 거제면 법동리',      lat: '34.809314', lng: '128.515887' },
            { cctvId: 101706, name: '법동',          subtitle: '경남 거제 거제면 법동리',      lat: '34.823317', lng: '128.520441' },
            { cctvId: 101707, name: '소랑',          subtitle: '경남 거제 거제면 소랑리',      lat: '34.831610', lng: '128.539127' },
            { cctvId: 101715, name: '죽림',          subtitle: '경남 거제 거제면 오수리',      lat: '34.840996', lng: '128.578196' },
            // 동부면 ─────────────────────────────────────────────────
            { cctvId: 101703, name: '동호',          subtitle: '경남 거제 동부면 오송리',      lat: '34.809820', lng: '128.586511' },
            { cctvId: 101708, name: '함박금길',       subtitle: '경남 거제 동부면 가배리',      lat: '34.786865', lng: '128.545826' },
            { cctvId: 101709, name: '가배리 수산',    subtitle: '경남 거제 동부면 가배리',      lat: '34.785499', lng: '128.541596' },
            { cctvId: 101710, name: '가배',          subtitle: '경남 거제 동부면 가배리',      lat: '34.780676', lng: '128.562890' },
            { cctvId: 102331, name: '학동',          subtitle: '경남 거제 동부면 학동리',      lat: '34.775329', lng: '128.641669' },
            // 남부면 ─────────────────────────────────────────────────
            { cctvId: 101711, name: '쌍근',          subtitle: '경남 거제 남부면 탑포리',      lat: '34.764257', lng: '128.583907' },
            { cctvId: 101712, name: '명사',          subtitle: '경남 거제 남부면 저구리',      lat: '34.726799', lng: '128.600800' },
            { cctvId: 101713, name: '홍포',          subtitle: '경남 거제 남부면 저구리',      lat: '34.706726', lng: '128.600094' },
            { cctvId: 102332, name: '다대',          subtitle: '경남 거제 남부면 다대7길',     lat: '34.732800', lng: '128.630503' },
            { cctvId: 100152, name: '남부면',        subtitle: '경남 거제 남부면',             lat: '34.739770', lng: '128.662572' },
            // 일운면 ─────────────────────────────────────────────────
            { cctvId: 102364, name: '구조라',        subtitle: '경남 거제 일운면 구조라리',    lat: '34.807914', lng: '128.692204' },
            { cctvId: 102366, name: '서이말',        subtitle: '경남 거제 일운면 서이말길',    lat: '34.787398', lng: '128.738503' },
            // 장목면 ─────────────────────────────────────────────────
            { cctvId: 102328, name: '옥포대첩로',    subtitle: '경남 거제 장목면 옥포대첩로',  lat: '34.956500', lng: '128.714200' },
            { cctvId: 102327, name: '송진포',        subtitle: '경남 거제 장목면 송진포리',    lat: '35.000987', lng: '128.701653' },
            // 고현동·장승포·옥포 ──────────────────────────────────────
            // 고현 중곡(101704), 고현동(101714), 연사리(101717) — 해안 아님, 제외
            { cctvId: 102329, name: '덕포동',        subtitle: '경남 거제 덕포동',             lat: '34.911084', lng: '128.710439' },
            { cctvId: 102330, name: '장승포',        subtitle: '경남 거제 장승포동 장승로',    lat: '34.866397', lng: '128.723900' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────
    // 옹진군 재난 CCTV
    // 출처: 옹진군 재난안전 CCTV (http://218.148.169.193)
    // 영상 방식: iframe (channelView.hu 페이지 임베드)
    // 영상 URL 패턴:
    //   http://218.148.169.193/content/channelView.hu?cctv_idx={id}
    // 데이터 출처: cctv.xml 및 채널 페이지 탐색 (2026년 4월 기준)
    // ※ HTTP 전용 서버 — HTTPS 환경에서 Mixed Content 차단 발생 가능
    // ─────────────────────────────────────────────────────────────────
    ongjin: {
        /** 팝업 출처 표기용 기관명 */
        name: '옹진군 재난 CCTV',

        /** 임베드 방식: channelView.hu 페이지를 iframe으로 로드 */
        type: 'iframe',

        /**
         * cctv_idx를 받아 옹진군 채널 뷰 URL을 반환합니다.
         * @param {number} cctvIdx
         * @returns {string}
         */
        shareUrl: (cctvIdx) =>
            `http://218.148.169.193/content/channelView.hu?cctv_idx=${cctvIdx}`,

        /** 팝업 헤더 외부 링크 버튼 목록 (안내 패널 내 버튼과 중복되므로 비움) */
        links: [],

        /**
         * iframe 클리핑 설정
         * channelView.hu 페이지는 별도 상단 타이틀 클리핑이 필요하지 않음
         * (KBS와 달리 클리핑 없이 전체 영상 페이지를 표출)
         */
        iframeTopClip: 0,
        iframeWrapHeight: 420,

        /** 마커 아이콘 색상 — 옹진군 청록 계열 */
        color: '#0891b2',

        /** 옹진군 도서 해안 CCTV 지점 목록 (cctv_idx 2~99, 2026년 4월 기준) */
        items: [
            // 백령도 ────────────────────────────────────────────────
            { cctvId: 22, name: '두무진항-1',        subtitle: '인천 옹진 백령도',  lat: '37.9747408', lng: '124.6191804' },
            { cctvId: 30, name: '두무진항-2',        subtitle: '인천 옹진 백령도',  lat: '37.9747944', lng: '124.6190084' },
            { cctvId: 65, name: '사항포구',          subtitle: '인천 옹진 백령도',  lat: '37.9722058', lng: '124.6471211' },
            { cctvId: 35, name: '고봉포-1',          subtitle: '인천 옹진 백령도',  lat: '37.9825136', lng: '124.6983184' },
            { cctvId: 36, name: '고봉포-2',          subtitle: '인천 옹진 백령도',  lat: '37.9829262', lng: '124.6973252' },
            { cctvId: 82, name: '중앙배수로 인근',   subtitle: '인천 옹진 백령도',  lat: '37.9542',    lng: '124.6955'    },
            { cctvId: 58, name: '아진포항',          subtitle: '인천 옹진 백령도',  lat: '37.7720958', lng: '124.7401581' },
            { cctvId: 50, name: '중화동 포구',       subtitle: '인천 옹진 백령도',  lat: '37.9232732', lng: '124.6565717' },
            { cctvId: 64, name: '오군포구',          subtitle: '인천 옹진 백령도',  lat: '37.9234150', lng: '124.6981552' },
            { cctvId: 47, name: '용기포신항',        subtitle: '인천 옹진 백령도',  lat: '37.9560765', lng: '124.7350533' },
            { cctvId: 21, name: '구용기포항①',      subtitle: '인천 옹진 백령도',  lat: '37.9518660', lng: '124.7312710' },
            { cctvId: 41, name: '구용기포항②',      subtitle: '인천 옹진 백령도',  lat: '37.9520064', lng: '124.7314590' },
            { cctvId: 23, name: '장촌항-1',          subtitle: '인천 옹진 백령도',  lat: '37.9222559', lng: '124.6731069' },
            { cctvId: 34, name: '장촌항-2',          subtitle: '인천 옹진 백령도',  lat: '37.9216376', lng: '124.6732300' },
            { cctvId: 81, name: '백령대교 인근',     subtitle: '인천 옹진 백령도',  lat: '37.9400208', lng: '124.7028054' },
            // 연평도 ────────────────────────────────────────────────
            { cctvId: 78, name: '동방파제',          subtitle: '인천 옹진 연평도',  lat: '37.6590959', lng: '125.7127233' },
            { cctvId: 76, name: '아리까리 삼거리',   subtitle: '인천 옹진 연평도',  lat: '37.6586194', lng: '125.7004968' },
            { cctvId: 79, name: '연평발전소',        subtitle: '인천 옹진 연평도',  lat: '37.6665',    lng: '125.6945'    },
            { cctvId: 19, name: '대연평항',          subtitle: '인천 옹진 연평도',  lat: '37.6605',    lng: '125.7011'    },
            { cctvId: 17, name: '대연평 내항',       subtitle: '인천 옹진 연평도',  lat: '37.6607860', lng: '125.7038243' },
            { cctvId: 18, name: '대연평 외항',       subtitle: '인천 옹진 연평도',  lat: '37.6549639', lng: '125.7111006' },
            { cctvId: 77, name: '메드라까리',        subtitle: '인천 옹진 연평도',  lat: '37.6562948', lng: '125.6838924' },
            { cctvId: 80, name: '새마을리',          subtitle: '인천 옹진 연평도',  lat: '37.6710483', lng: '125.7115035' },
            { cctvId: 24, name: '소연평항',          subtitle: '인천 옹진 연평도',  lat: '37.6123032', lng: '125.7090329' },
            // 대청도 ────────────────────────────────────────────────
            { cctvId: 61, name: '답동 부잔교',       subtitle: '인천 옹진 대청도',  lat: '37.7758993', lng: '124.7436863' },
            { cctvId: 14, name: '선진포항②',        subtitle: '인천 옹진 대청도',  lat: '37.8257861', lng: '124.7162039' },
            { cctvId: 13, name: '선진포항①',        subtitle: '인천 옹진 대청도',  lat: '37.8278853', lng: '124.7174823' },
            { cctvId: 15, name: '수협공판장①',      subtitle: '인천 옹진 대청도',  lat: '37.8269157', lng: '124.7147770' },
            { cctvId: 31, name: '수협공판장②',      subtitle: '인천 옹진 대청도',  lat: '37.8269960', lng: '124.7147066' },
            { cctvId: 44, name: '수협공판장③',      subtitle: '인천 옹진 대청도',  lat: '37.8270696', lng: '124.7146223' },
            { cctvId: 45, name: '수협공판장④',      subtitle: '인천 옹진 대청도',  lat: '37.8271672', lng: '124.7145343' },
            { cctvId: 67, name: '대청 선외기①',     subtitle: '인천 옹진 대청도',  lat: '37.8278',    lng: '124.7092'    },
            { cctvId: 68, name: '대청 선외기②',     subtitle: '인천 옹진 대청도',  lat: '37.8276',    lng: '124.7088'    },
            { cctvId: 70, name: '대청 여객선착장',   subtitle: '인천 옹진 대청도',  lat: '37.8286628', lng: '124.7180865' },
            // 소청도 ────────────────────────────────────────────────
            { cctvId: 57, name: '노화동 방파제',     subtitle: '인천 옹진 소청도',  lat: '37.7663',    lng: '124.7335'    },
            { cctvId: 11, name: '소청항',            subtitle: '인천 옹진 소청도',  lat: '37.7758990', lng: '124.7456954' },
            { cctvId: 12, name: '소청 매표소',       subtitle: '인천 옹진 소청도',  lat: '37.7760230', lng: '124.7478619' },
            // 덕적도 ────────────────────────────────────────────────
            { cctvId: 42, name: '북2리 물량장①',    subtitle: '인천 옹진 덕적도',  lat: '37.2527738', lng: '126.1180924' },
            { cctvId: 43, name: '북2리 물량장②',    subtitle: '인천 옹진 덕적도',  lat: '37.2534872', lng: '126.1186628' },
            { cctvId: 83, name: '대부해운 매표소',   subtitle: '인천 옹진 덕적도',  lat: '37.2283847', lng: '126.1576324' },
            { cctvId: 33, name: '소야대교',          subtitle: '인천 옹진 덕적도',  lat: '37.2245329', lng: '126.1592120' },
            { cctvId: 32, name: '진말선착장',        subtitle: '인천 옹진 덕적도',  lat: '37.2277515', lng: '126.1552374' },
            { cctvId: 28, name: '도우 선착장',       subtitle: '인천 옹진 덕적도',  lat: '37.2262940', lng: '126.1563380' },
            { cctvId: 20, name: '진리항',            subtitle: '인천 옹진 덕적도',  lat: '37.2275548', lng: '126.1549087' },
            { cctvId: 84, name: '밧지름 해변',       subtitle: '인천 옹진 덕적도',  lat: '37.2153154', lng: '126.1404120' },
            { cctvId: 85, name: '서포1리 해수욕장',  subtitle: '인천 옹진 덕적도',  lat: '37.2202121', lng: '126.1152843' },
            { cctvId: 86, name: '여객선 선착장',     subtitle: '인천 옹진 덕적도',  lat: '37.2141628', lng: '126.1110215' },
            { cctvId: 87, name: '헬기장 인근',       subtitle: '인천 옹진 덕적도',  lat: '37.2219217', lng: '126.1102010' },
            // 소야도·울도·문갑도·백아도·굴업도·지도 ─────────────────
            { cctvId: 29, name: '소야 선착장',       subtitle: '인천 옹진 소야도',  lat: '37.2240082', lng: '126.1608037' },
            { cctvId: 37, name: '소야 큰말',         subtitle: '인천 옹진 소야도',  lat: '37.2148764', lng: '126.1798191' },
            { cctvId: 88, name: '떼뿌루 해안',       subtitle: '인천 옹진 소야도',  lat: '37.2121898', lng: '126.1757554' },
            { cctvId: 40, name: '울도항',            subtitle: '인천 옹진 울도',    lat: '37.0260753', lng: '125.9972724' },
            { cctvId: 89, name: '문갑 선착장',       subtitle: '인천 옹진 문갑도',  lat: '37.1707231', lng: '126.1130293' },
            { cctvId: 91, name: '보건소 선착장',     subtitle: '인천 옹진 백아도',  lat: '37.0846241', lng: '125.9564360' },
            { cctvId: 90, name: '굴업도 부두',       subtitle: '인천 옹진 굴업도',  lat: '37.1914134', lng: '125.9823788' },
            { cctvId: 92, name: '지도 선착장',       subtitle: '인천 옹진 지도',    lat: '37.0658435', lng: '126.0126991' },
            // 자월도·대이작도·소이작도·승봉도 ─────────────────────────
            { cctvId: 10, name: '자월 선착장',       subtitle: '인천 옹진 자월도',  lat: '37.2450653', lng: '126.3185259' },
            { cctvId: 38, name: '다싯물 선착장',     subtitle: '인천 옹진 자월도',  lat: '37.2530519', lng: '126.3013728' },
            { cctvId: 27, name: '대이작 선착장',     subtitle: '인천 옹진 이작도',  lat: '37.1785171', lng: '126.2478196' },
            { cctvId: 59, name: '대이작 부잔교①',   subtitle: '인천 옹진 이작도',  lat: '37.1784608', lng: '126.2488265' },
            { cctvId: 60, name: '대이작 부잔교②',   subtitle: '인천 옹진 이작도',  lat: '37.1782043', lng: '126.2488619' },
            { cctvId: 25, name: '소이작 큰마을',     subtitle: '인천 옹진 이작도',  lat: '37.1811418', lng: '126.2396949' },
            { cctvId: 26, name: '소이작 벌안①',     subtitle: '인천 옹진 이작도',  lat: '37.1770874', lng: '126.2498371' },
            { cctvId: 66, name: '소이작 벌안②',     subtitle: '인천 옹진 이작도',  lat: '37.1770874', lng: '126.2523273' },
            { cctvId: 39, name: '승봉 선착장',       subtitle: '인천 옹진 승봉도',  lat: '37.1702417', lng: '126.2913597' },
            { cctvId: 93, name: '승봉대합실',        subtitle: '인천 옹진 승봉도',  lat: '37.1705097', lng: '126.2910682' },
            { cctvId: 94, name: '이일레 해수욕장',   subtitle: '인천 옹진 승봉도',  lat: '37.1653727', lng: '126.3031663' },
            // 영흥도·선재도 ─────────────────────────────────────────
            { cctvId: 99, name: '십리포 해수욕장',   subtitle: '인천 옹진 영흥도',  lat: '37.2818349', lng: '126.4857470' },
            { cctvId: 16, name: '진두 구철탑',       subtitle: '인천 옹진 영흥도',  lat: '37.2547139', lng: '126.4966765' },
            { cctvId: 95, name: '영흥 파출소 앞',    subtitle: '인천 옹진 영흥도',  lat: '37.2547015', lng: '126.4983060' },
            { cctvId: 56, name: '연육교 어선선착장', subtitle: '인천 옹진 영흥도',  lat: '37.2545',    lng: '126.4955'    },
            { cctvId:  5, name: '진두항-1',          subtitle: '인천 옹진 영흥도',  lat: '37.2535',    lng: '126.4965'    },
            { cctvId:  2, name: '진두항-2',          subtitle: '인천 옹진 영흥도',  lat: '37.2535',    lng: '126.4967'    },
            { cctvId:  6, name: '진두항-3',          subtitle: '인천 옹진 영흥도',  lat: '37.2535',    lng: '126.4969'    },
            { cctvId: 96, name: '중앙천 배수갑문',   subtitle: '인천 옹진 영흥도',  lat: '37.2526832', lng: '126.4711326' },
            { cctvId: 98, name: '장경리 해수욕장',   subtitle: '인천 옹진 영흥도',  lat: '37.2728010', lng: '126.4502706' },
            { cctvId: 97, name: '노가리 해변',       subtitle: '인천 옹진 영흥도',  lat: '37.2398296', lng: '126.4715343' },
            { cctvId:  9, name: '선재 어촌계',       subtitle: '인천 옹진 선재도',  lat: '37.2356315', lng: '126.5363464' },
            // 신도·시도·장봉 (북도면) ───────────────────────────────
            { cctvId: 72, name: '시도 선착장',       subtitle: '인천 옹진 시도',    lat: '37.5368330', lng: '126.4194836' },
            { cctvId:  7, name: '신도 선착장①',     subtitle: '인천 옹진 신도',    lat: '37.5145894', lng: '126.4392719' },
            { cctvId: 71, name: '신도 선착장②',     subtitle: '인천 옹진 신도',    lat: '37.5147573', lng: '126.4384081' },
            { cctvId:  8, name: '장봉 선착장',       subtitle: '인천 옹진 장봉도',  lat: '37.5304168', lng: '126.3845863' },
            { cctvId: 73, name: '장봉 매표소',       subtitle: '인천 옹진 장봉도',  lat: '37.5308993', lng: '126.3843264' },
            { cctvId: 74, name: '야달 선착장',       subtitle: '인천 옹진 장봉도',  lat: '37.5234872', lng: '126.3272442' },
            { cctvId: 75, name: '대빈창 입구',       subtitle: '인천 옹진 장봉도',  lat: '37.5458',    lng: '126.2925'    },
        ]
    },

    // ─────────────────────────────────────────────────────────────────
    // 부산시 안전 CCTV (해안·해양)
    // 출처: 부산시 안전ON (https://safecity.busan.go.kr)
    // 영상 방식: iframe (safecity 공유 페이지 임베드)
    // 영상 URL 패턴:
    //   https://safecity.busan.go.kr/#/cctv?cnt={cnt}&cctv_cd={cctvCd}&sensorName={name}
    // 데이터 출처: https://safecity.busan.go.kr/iots/vmap/sensor_cctv2.do
    //              (gbcd=800 재난감시 카테고리 중 해안·해양 키워드 필터)
    // ─────────────────────────────────────────────────────────────────
    busan: {
        /** 팝업 출처 표기용 기관명 */
        name: '부산시 안전 CCTV',

        /** 임베드 방식: safecity 페이지를 iframe으로 로드 */
        type: 'iframe',

        /**
         * cctvCd를 받아 부산시 안전ON CCTV 페이지 URL을 반환합니다.
         * ※ cnt, sensorName은 각 item에 별도 저장 — cctv3.js에서 조합 필요
         * @param {string} cctvCd
         * @returns {string}
         */
        shareUrl: (cctvCd, item) =>
            `https://safecity.busan.go.kr/#/cctv?cnt=${item && item.cnt || '1'}&cctv_cd=${cctvCd}&sensorName=${encodeURIComponent((item && item.sensorName) || '')}`,

        /** 팝업 헤더 외부 링크 버튼 목록 */
        links: [
            { label: '부산시 안전 ON', url: 'https://safecity.busan.go.kr/#/map' }
        ],

        /**
         * iframe 클리핑 설정
         * safecity 페이지 상단 자체 헤더(카메라명+타이머 바)를 숨김
         */
        iframeTopClip: 60,
        iframeWrapHeight: 340,

        /** 마커 아이콘 색상 — 부산시 주황 계열 */
        color: '#e65100',

        /**
         * 부산시 해안·해양 CCTV 지점 목록 (gbcd=800, 2026년 4월 기준)
         *
         * ※ API 좌표 주의: 원본 API의 lat/lon 필드가 뒤바뀌어 있음
         *   - API "lat" → 실제 경도(lng, ~128-129)
         *   - API "lon" → 실제 위도(lat, ~35)
         *
         * ※ 추가 필드:
         *   - cnt: 카메라 채널 수 ('1' 또는 '2')
         *   - sensorName: 원본 sensor_name (URL 구성에 필요)
         */
        items: [
            // 강서구 ───────────────────────────────────────────────
            { cctvId: '00-800-0001,00-800-0002', name: '가덕도동주민센터 인근', subtitle: '부산 강서구', lat: '35.054816', lng: '128.835462', cnt: '2', sensorName: '강서구_가덕도동주민센터_인근_고1,강서구_가덕도동주민센터_인근_고2' },
            { cctvId: '00-800-0003,00-800-0004', name: '선창마을회관 앞', subtitle: '부산 강서구', lat: '35.065635', lng: '128.835087', cnt: '2', sensorName: '강서구_선창마을회관_앞(고정1),강서구_선창마을회관_앞(고정2)' },
            { cctvId: '00-800-0009', name: '대항마을', subtitle: '부산 강서구', lat: '35.01266638', lng: '128.8284644', cnt: '1', sensorName: '강서구_대항마을' },
            { cctvId: '00-800-0010', name: '대항새바지', subtitle: '부산 강서구', lat: '35.016605', lng: '128.835064', cnt: '1', sensorName: '강서구_대항새바지' },
            { cctvId: '00-800-0011', name: '동선방조제 상', subtitle: '부산 강서구', lat: '35.06218988', lng: '128.847965', cnt: '1', sensorName: '강서구_동선방조제_상' },
            { cctvId: '00-800-0012', name: '동선방조제 하', subtitle: '부산 강서구', lat: '35.0547008', lng: '128.847521', cnt: '1', sensorName: '강서구_동선방조제_하' },
            { cctvId: '00-800-0013', name: '두문방파제', subtitle: '부산 강서구', lat: '35.033511', lng: '128.809993', cnt: '1', sensorName: '강서구_두문방파제' },
            { cctvId: '00-800-0018', name: '천성항', subtitle: '부산 강서구', lat: '35.02736258', lng: '128.815801', cnt: '1', sensorName: '강서구_천성항' },
            // 사하구 ───────────────────────────────────────────────
            { cctvId: '00-800-0106', name: '감천항방파제', subtitle: '부산 사하구', lat: '35.04852', lng: '129.0027', cnt: '1', sensorName: '사하구_감천항방파제' },
            { cctvId: '00-800-0115', name: '낫개방파제', subtitle: '부산 사하구', lat: '35.05742', lng: '128.978774', cnt: '1', sensorName: '사하구_낫개방파제' },
            { cctvId: '00-800-0117,00-800-0118', name: '다대포해수욕장(해안) 고1', subtitle: '부산 사하구', lat: '35.04373', lng: '128.9682', cnt: '2', sensorName: '사하구_다대포해수욕장(해안)_고1,사하구_다대포해수욕장(해안)_고2' },
            { cctvId: '00-800-0119', name: '다대포해수욕장 임해봉사', subtitle: '부산 사하구', lat: '35.046138', lng: '128.968182', cnt: '1', sensorName: '사하구_다대포해수욕장_임해봉사' },
            { cctvId: '00-800-0120', name: '다대항', subtitle: '부산 사하구', lat: '35.057191', lng: '128.973924', cnt: '1', sensorName: '사하구_다대항' },
            { cctvId: '00-800-0132,00-800-0133', name: '해양보호구역홍보관 고1', subtitle: '부산 사하구', lat: '35.08126', lng: '128.955695', cnt: '2', sensorName: '사하구_해양보호구역홍보관_고1,사하구_해양보호구역홍보관_고2' },
            { cctvId: '00-800-0234', name: '두송방파제 테트라포트 인근(2) 고2', subtitle: '부산 사하구', lat: '35.058123', lng: '128.987356', cnt: '1', sensorName: '두송방파제_테트라포트_인근(2)_고2' },
            // 서구 ────────────────────────────────────────────────
            { cctvId: '00-800-0137', name: '남항대교 아래', subtitle: '부산 서구', lat: '35.078623', lng: '129.024968', cnt: '1', sensorName: '서구_남항대교_아래' },
            { cctvId: '00-800-0140', name: '백년송도골목 앞', subtitle: '부산 서구', lat: '35.077676', lng: '129.021019', cnt: '1', sensorName: '서구_백년송도골목_앞' },
            { cctvId: '00-800-0141', name: '암남공원', subtitle: '부산 서구', lat: '35.063056', lng: '129.020265', cnt: '1', sensorName: '서구_암남공원' },
            { cctvId: '00-800-0142', name: '항만관리사업소', subtitle: '부산 서구', lat: '35.085707', lng: '129.02635', cnt: '1', sensorName: '서구_항만관리사업소' },
            // 영도구 ───────────────────────────────────────────────
            { cctvId: '00-800-0149', name: '감지해변', subtitle: '부산 영도구', lat: '35.0603068', lng: '129.0778258', cnt: '1', sensorName: '영도구_감지해변' },
            { cctvId: '00-800-0150,00-800-0151', name: '부산항대교 아래 고1', subtitle: '부산 영도구', lat: '35.101334', lng: '129.060419', cnt: '2', sensorName: '영도구_부산항대교_아래_고1,영도구_부산항대교_아래_고2' },
            { cctvId: '00-800-0153,00-800-0175', name: '영도해양파출소 옥상 고1', subtitle: '부산 영도구', lat: '35.069954', lng: '129.0817', cnt: '2', sensorName: '영도구_영도해양파출소_옥상_고1,영도구_영도해양파출소_옥상' },
            { cctvId: '00-800-0155', name: '조도방파제', subtitle: '부산 영도구', lat: '35.07963333', lng: '129.0958361', cnt: '1', sensorName: '영도구_조도방파제' },
            { cctvId: '00-800-0156', name: '중리방파제', subtitle: '부산 영도구', lat: '35.06831', lng: '129.065467', cnt: '1', sensorName: '영도구_중리방파제' },
            // 남구 ────────────────────────────────────────────────
            { cctvId: '00-800-0063', name: '백운포체육공원', subtitle: '부산 남구', lat: '35.102765', lng: '129.112015', cnt: '1', sensorName: '남구_백운포체육공원' },
            { cctvId: '00-800-0066', name: '오륙도선착장 공영주차장', subtitle: '부산 남구', lat: '35.099878', lng: '129.122949', cnt: '1', sensorName: '남구_오륙도선착장_공영주차장' },
            { cctvId: '00-800-0068', name: '용호만매립부두', subtitle: '부산 남구', lat: '35.134875', lng: '129.112779', cnt: '1', sensorName: '남구_용호만매립부두' },
            { cctvId: '00-800-0069', name: '용호어촌계', subtitle: '부산 남구', lat: '35.13206317', lng: '129.1199991', cnt: '1', sensorName: '남구_용호어촌계' },
            // 수영구 ───────────────────────────────────────────────
            { cctvId: '00-800-0143,00-800-0144', name: '광안대교 아래 고1', subtitle: '부산 수영구', lat: '35.136408', lng: '129.113423', cnt: '2', sensorName: '수영구_광안대교_아래_고1,수영구_광안대교_아래_고2' },
            { cctvId: '00-800-0145', name: '광안리해수욕장', subtitle: '부산 수영구', lat: '35.14674', lng: '129.11386', cnt: '1', sensorName: '수영구_광안리해수욕장' },
            // 해운대구 ──────────────────────────────────────────────
            { cctvId: '00-800-0168', name: '송정방파제', subtitle: '부산 해운대구', lat: '35.179833', lng: '129.206608', cnt: '1', sensorName: '해운대구_송정방파제' },
            { cctvId: '00-800-0177', name: '해운대해수욕장', subtitle: '부산 해운대구', lat: '35.1591325816557', lng: '129.16030889422', cnt: '1', sensorName: '(재난)해운대해수욕장' },
            { cctvId: '00-800-0178', name: '미포방파제 고', subtitle: '부산 해운대구', lat: '35.1578966326756', lng: '129.172177364545', cnt: '1', sensorName: '(재난)미포방파제_고' },
            { cctvId: '00-800-0179', name: '청사포4(회전형)', subtitle: '부산 해운대구', lat: '35.159717', lng: '129.190121', cnt: '1', sensorName: '해운대구_청사포4(회전형)' },
            { cctvId: '00-800-0180', name: '테트라포드 청사포1 회전', subtitle: '부산 해운대구', lat: '35.1604121697263', lng: '129.192638919134', cnt: '1', sensorName: '(재난)테트라포드_청사포1_회전' },
            { cctvId: '00-800-0181', name: '구덕포방파제 고2', subtitle: '부산 해운대구', lat: '35.1692432666056', lng: '129.197310092866', cnt: '1', sensorName: '(재난)구덕포방파제_고2' },
            // 기장군 ───────────────────────────────────────────────
            { cctvId: '00-800-0036', name: '공수마을', subtitle: '부산 기장군', lat: '35.18363', lng: '129.211782', cnt: '1', sensorName: '기장군_공수마을' },
            { cctvId: '00-800-0038', name: '동암마을', subtitle: '부산 기장군', lat: '35.19617708', lng: '129.2246987', cnt: '1', sensorName: '기장군_동암마을' },
            { cctvId: '00-800-0039', name: '두호마을', subtitle: '부산 기장군', lat: '35.242008', lng: '129.24676', cnt: '1', sensorName: '기장군_두호마을' },
            { cctvId: '00-800-0040,00-800-0041', name: '바다애펜션 옆', subtitle: '부산 기장군', lat: '35.18573803', lng: '129.2132232', cnt: '2', sensorName: '기장군_바다애펜션_옆_고1,기장군_바다애펜션_옆_고2' },
            { cctvId: '00-800-0042', name: '서암방파제', subtitle: '부산 기장군', lat: '35.214704', lng: '129.224797', cnt: '1', sensorName: '기장군_서암방파제' },
            { cctvId: '00-800-0043', name: '온정방파제', subtitle: '부산 기장군', lat: '35.282443', lng: '129.258618', cnt: '1', sensorName: '기장군_온정방파제' },
            { cctvId: '00-800-0047', name: '이동어촌계', subtitle: '부산 기장군', lat: '35.27258403', lng: '129.2471611', cnt: '1', sensorName: '기장군_이동어촌계' },
            { cctvId: '00-800-0049', name: '임랑방파제', subtitle: '부산 기장군', lat: '35.320553', lng: '129.266504', cnt: '1', sensorName: '기장군_임랑방파제' },
            { cctvId: '00-800-0050', name: '임랑해수욕장1', subtitle: '부산 기장군', lat: '35.31600242', lng: '129.2620669', cnt: '1', sensorName: '기장군_임랑해수욕장1' },
            { cctvId: '00-800-0052', name: '죽성방파제', subtitle: '부산 기장군', lat: '35.239711', lng: '129.247837', cnt: '1', sensorName: '기장군_죽성방파제' },
            { cctvId: '00-800-0054', name: '칠암마을', subtitle: '부산 기장군', lat: '35.29742585', lng: '129.2593381', cnt: '1', sensorName: '기장군_칠암마을' },
            { cctvId: '00-800-0237', name: '학리방파제1(회전형)', subtitle: '부산 기장군', lat: '35.260641', lng: '129.24738', cnt: '1', sensorName: '기장군_학리방파제1(회전형)' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────
    // 국립해양조사원 연안침식 모니터링
    // 출처: 연안포털 (https://coast.mof.go.kr/coastScene/coastMediaService.do)
    // 영상 방식: image — proxy.jsp를 통해 이미지 직접 로드 (3초마다 갱신)
    // 이미지 URL 패턴:
    //   https://coast.mof.go.kr/proxy.jsp?
    //   http://10.176.62.134:9001/tilemapApi.do?url=
    //   http://220.95.232.18/camera/{beach_code}_{cam_idx}.jpg?{timestamp(ms)}
    // 데이터 출처: json_camera_info.do API (2026년 4월 기준, 38개 지점)
    // ─────────────────────────────────────────────────────────────────
    coastal: {
        /** 팝업 출처 표기용 기관명 */
        name: '연안침식 모니터링',

        /** 임베드 방식: 이미지 직접 로드 (3초마다 타임스탬프 갱신) */
        type: 'image',

        /**
         * beach_code와 카메라 인덱스를 받아 이미지 기본 URL을 반환합니다.
         * (실제 요청 시 끝에 '?{timestamp}' 를 추가해야 합니다.)
         * @param {number|string} beachCode — beach_code
         * @param {number} [camIdx=0] — 카메라 인덱스 (하맹방=2대)
         * @returns {string}
         */
        imageBaseUrl: (beachCode, camIdx) =>
            `https://coast.mof.go.kr/proxy.jsp?http://10.176.62.134:9001/tilemapApi.do?url=http://220.95.232.18/camera/${beachCode}_${camIdx || 0}.jpg`,

        /** 팝업 헤더 외부 링크 버튼 목록 */
        links: [
            { label: '연안포털', org: '해양수산부', url: 'https://coast.mof.go.kr/coastScene/coastMediaService.do' }
        ],

        /** 마커 아이콘 색상 — 청록 계열 */
        color: '#0d9488',

        /** 연안침식 모니터링 지점 목록 (beach_code = cctvId) */
        items: [
            // 동해 북부 (강원 고성) ──────────────────────────────────
            { cctvId: 60, name: '초도',       subtitle: '강원 고성',    lat: '38.490699', lng: '128.430379' },
            { cctvId: 57, name: '공현진',     subtitle: '강원 고성',    lat: '38.358173', lng: '128.509054' },
            { cctvId: 58, name: '교암',       subtitle: '강원 고성',    lat: '38.291047', lng: '128.546972' },
            { cctvId: 59, name: '봉포',       subtitle: '강원 고성',    lat: '38.252750', lng: '128.566292' },
            // 강원 속초 ──────────────────────────────────────────────
            { cctvId: 69, name: '영랑',       subtitle: '강원 속초',    lat: '38.213461', lng: '128.598305' },
            { cctvId: 87, name: '장사',       subtitle: '강원 속초',    lat: '38.219300', lng: '128.592000' },
            // 강원 양양·강릉 ─────────────────────────────────────────
            { cctvId: 53, name: '소돌',       subtitle: '강원 양양',    lat: '37.907017', lng: '128.825085' },
            { cctvId: 55, name: '영진',       subtitle: '강원 강릉',    lat: '37.869160', lng: '128.845279' },
            { cctvId: 52, name: '경포',       subtitle: '강원 강릉',    lat: '37.805453', lng: '128.907841' },
            { cctvId: 51, name: '강문',       subtitle: '강원 강릉',    lat: '37.794617', lng: '128.917325' },
            { cctvId: 54, name: '염전',       subtitle: '강원 강릉',    lat: '37.741978', lng: '128.984260' },
            { cctvId: 56, name: '정동진',     subtitle: '강원 강릉',    lat: '37.686185', lng: '129.040039' },
            { cctvId:  4, name: '남항진',     subtitle: '강원 강릉',    lat: '37.762963', lng: '128.956515' },
            // 강원 삼척 ──────────────────────────────────────────────
            { cctvId: 62, name: '하맹방',     subtitle: '강원 삼척',    lat: '37.394157', lng: '129.225396', cameraCount: 2 },
            { cctvId: 65, name: '원평',       subtitle: '강원 삼척',    lat: '37.319878', lng: '129.272220' },
            { cctvId: 88, name: '문암·초곡', subtitle: '강원 삼척',    lat: '37.310000', lng: '129.285900' },
            // 경북 울진·영덕 ─────────────────────────────────────────
            { cctvId: 76, name: '월송정',     subtitle: '경북 울진',    lat: '36.740940', lng: '129.472092' },
            { cctvId: 84, name: '금음리',     subtitle: '경북 울진',    lat: '36.673700', lng: '129.440800' },
            { cctvId: 82, name: '봉평',       subtitle: '경북 울진',    lat: '37.044500', lng: '129.413800' },
            { cctvId:  0, name: '고래불',     subtitle: '경북 영덕',    lat: '36.599389', lng: '129.411395' },
            // 경북 경주·울산 ─────────────────────────────────────────
            { cctvId: 17, name: '전촌·나정', subtitle: '경북 경주',    lat: '35.784886', lng: '129.491279' },
            { cctvId: 74, name: '정자',       subtitle: '경북 경주',    lat: '35.628359', lng: '129.441832' },
            { cctvId: 75, name: '진하',       subtitle: '울산 울주',    lat: '35.383418', lng: '129.346104' },
            // 부산 ───────────────────────────────────────────────────
            { cctvId: 81, name: '해운대',     subtitle: '부산 해운대',  lat: '35.158649', lng: '129.159872' },
            { cctvId: 80, name: '송도',       subtitle: '부산 서구',    lat: '35.075450', lng: '129.016758' },
            // 경남 거제·남해 ─────────────────────────────────────────
            { cctvId:  2, name: '구조라',     subtitle: '경남 거제',    lat: '34.808553', lng: '128.690672' },
            { cctvId:  9, name: '상주',       subtitle: '경남 남해',    lat: '34.720783', lng: '127.988046' },
            { cctvId: 86, name: '온동',       subtitle: '경남 통영',    lat: '34.892400', lng: '127.726900' },
            // 제주 ───────────────────────────────────────────────────
            { cctvId: 67, name: '중문',       subtitle: '제주 서귀포',  lat: '33.244975', lng: '126.411703' },
            { cctvId: 66, name: '신양',       subtitle: '제주 성산',    lat: '33.434996', lng: '126.923134' },
            // 전남 ───────────────────────────────────────────────────
            { cctvId: 85, name: '대반동',     subtitle: '전남 진도',    lat: '34.788800', lng: '126.366000' },
            { cctvId: 71, name: '대광',       subtitle: '전남 무안',    lat: '35.103071', lng: '126.069566' },
            // 전북 군산 ──────────────────────────────────────────────
            { cctvId: 61, name: '선유도',     subtitle: '전북 군산',    lat: '35.816204', lng: '126.411228' },
            // 충남 태안·보령 ─────────────────────────────────────────
            { cctvId: 78, name: '꽃지',       subtitle: '충남 태안',    lat: '36.496939', lng: '126.335205' },
            { cctvId: 79, name: '만리포',     subtitle: '충남 태안',    lat: '36.786420', lng: '126.133595' },
            { cctvId: 63, name: '대천',       subtitle: '충남 보령',    lat: '36.305630', lng: '126.516048' },
            // 경기 화성 ──────────────────────────────────────────────
            { cctvId: 72, name: '방아머리',   subtitle: '경기 화성',    lat: '37.283919', lng: '126.568053' },
            { cctvId: 73, name: '장골',       subtitle: '경기 화성',    lat: '37.248880', lng: '126.315907' },
        ]
    }
    ,

    // ─────────────────────────────────────────────────────────────────
    // 국립해양조사원 해무 CCTV 스틸컷
    // 출처: 공공데이터포털 "해양수산부 국립해양조사원_해무 CCTV 스틸컷 조회"
    // 영상 방식: image (서버에서 10분마다 수집한 스틸컷 이미지 슬라이드)
    // 서버 API: GET /api/seafog-cctv?obs={obsName}
    // 이미지 URL: https://khoa.go.kr/oceandata/openapi/odmi/odmiImage.do?fileKey=...
    //
    // [cctvId 범위: 9001~9009]
    //   다른 프로바이더(KBS, 거제, 부산, 옹진, coastal)와 cctvId 충돌을 피하기 위해
    //   9001번대 ID를 할당합니다.
    //
    // [obsName 필드]
    //   공공API의 sfogObsvtrNm(관측소명)과 정확히 일치해야 합니다.
    //   팝업에서 /api/seafog-cctv?obs={obsName} 으로 해당 지점의 이미지를 요청합니다.
    // ─────────────────────────────────────────────────────────────────
    seafog: {
        /** 팝업 출처 표기용 기관명 */
        name: '국립해양조사원 해무 CCTV',

        /**
         * 영상 방식: seafog
         * 서버 캐시 API에서 이미지 URL을 받아 슬라이드로 표시합니다.
         * (iframe/hls/image와 달리 별도 fetch가 필요한 비동기 방식)
         */
        type: 'seafog',

        /** 팝업 헤더 외부 링크 버튼 */
        links: [
            {
                label: '해양데이터포털',
                org:   '국립해양조사원',
                url:   'https://khoa.go.kr/oceangrid/khoa/koofs/main/koofs.do'
            }
        ],

        /** 지도 마커 색상 — 해무 특성을 반영한 회청색 */
        color: '#607d8b',

        /**
         * 해무 관측 항구 9개 지점
         *
         * [obsName] 공공API sfogObsvtrNm 값과 정확히 일치해야 합니다.
         *           팝업에서 이 값으로 /api/seafog-cctv?obs= 쿼리를 만듭니다.
         */
        items: [
            // 서해 ─────────────────────────────────────────────────────
            {
                cctvId:  9001,
                name:    '대산항',
                subtitle:'충남 서산 대산항',
                obsName: '대산항',
                lat:     '37.0021',
                lng:     '126.4398'
            },
            {
                cctvId:  9002,
                name:    '인천항',
                subtitle:'인천 인천항',
                obsName: '인천항',
                lat:     '37.4591',
                lng:     '126.5912'
            },
            {
                cctvId:  9003,
                name:    '평택당진항',
                subtitle:'충남 당진 평택당진항',
                obsName: '평택당진항',
                lat:     '36.9761',
                lng:     '126.7764'
            },
            // 남해 ─────────────────────────────────────────────────────
            {
                cctvId:  9004,
                name:    '목포항',
                subtitle:'전남 목포항',
                obsName: '목포항',
                lat:     '34.7781',
                lng:     '126.3718'
            },
            {
                cctvId:  9005,
                name:    '여수항',
                subtitle:'전남 여수항',
                obsName: '여수항',
                lat:     '34.7436',
                lng:     '127.7443'
            },
            {
                cctvId:  9006,
                name:    '부산항(북항)',
                subtitle:'부산 북항',
                obsName: '부산항(북항)',
                lat:     '35.1057',
                lng:     '129.0362'
            },
            {
                cctvId:  9007,
                name:    '부산항(신항서측)',
                subtitle:'부산 강서 신항',
                obsName: '부산항(신항서측)',
                lat:     '35.0839',
                lng:     '128.7978'
            },
            // 동해 ─────────────────────────────────────────────────────
            {
                cctvId:  9008,
                name:    '울산항',
                subtitle:'울산 울산항',
                obsName: '울산항',
                lat:     '35.5139',
                lng:     '129.3873'
            },
            {
                cctvId:  9009,
                name:    '포항항',
                subtitle:'경북 포항항',
                obsName: '포항항',
                lat:     '36.0211',
                lng:     '129.3636'
            }
        ]
    }
};

// 다른 파일(cctv4.js 등)에서 window.CCTV_PROVIDERS로 참조할 수 있도록 전역 노출
window.CCTV_PROVIDERS = CCTV_PROVIDERS;
