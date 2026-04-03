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
            { cctvId: 21, name: '구용기포항①',      subtitle: '인천 옹진 백령도',  lat: '37.9601', lng: '124.6711' },
            { cctvId: 41, name: '구용기포항②',      subtitle: '인천 옹진 백령도',  lat: '37.9603', lng: '124.6714' },
            { cctvId: 22, name: '두무진항-1',        subtitle: '인천 옹진 백령도',  lat: '37.9731', lng: '124.6194' },
            { cctvId: 30, name: '두무진항-2',        subtitle: '인천 옹진 백령도',  lat: '37.9729', lng: '124.6192' },
            { cctvId: 35, name: '고봉포-1',          subtitle: '인천 옹진 백령도',  lat: '37.9671', lng: '124.6823' },
            { cctvId: 36, name: '고봉포-2',          subtitle: '인천 옹진 백령도',  lat: '37.9512', lng: '124.7183' },
            { cctvId: 47, name: '용기포신항',        subtitle: '인천 옹진 백령도',  lat: '37.9593', lng: '124.6698' },
            { cctvId: 58, name: '아진포항',          subtitle: '인천 옹진 백령도',  lat: '37.9651', lng: '124.6841' },
            { cctvId: 50, name: '중화동 포구',       subtitle: '인천 옹진 백령도',  lat: '37.9621', lng: '124.7053' },
            { cctvId: 64, name: '오군포구',          subtitle: '인천 옹진 백령도',  lat: '37.9583', lng: '124.6782' },
            { cctvId: 65, name: '사항포구',          subtitle: '인천 옹진 백령도',  lat: '37.9681', lng: '124.6848' },
            { cctvId: 23, name: '장촌항-1',          subtitle: '인천 옹진 백령도',  lat: '37.9509', lng: '124.7201' },
            { cctvId: 34, name: '장촌항-2',          subtitle: '인천 옹진 백령도',  lat: '37.9489', lng: '124.7178' },
            { cctvId: 81, name: '백령대교 외수문인근', subtitle: '인천 옹진 백령도', lat: '37.9562', lng: '124.6898' },
            { cctvId: 82, name: '중앙배수로 인근',   subtitle: '인천 옹진 백령도',  lat: '37.9698', lng: '124.7012' },
            // 연평도 ────────────────────────────────────────────────
            { cctvId: 17, name: '대연평 내항',       subtitle: '인천 옹진 연평도',  lat: '37.6678', lng: '125.6918' },
            { cctvId: 18, name: '대연평 외항',       subtitle: '인천 옹진 연평도',  lat: '37.6678', lng: '125.6920' },
            { cctvId: 19, name: '대연평항',          subtitle: '인천 옹진 연평도',  lat: '37.6682', lng: '125.6921' },
            { cctvId: 24, name: '소연평항',          subtitle: '인천 옹진 연평도',  lat: '37.6478', lng: '125.7084' },
            { cctvId: 56, name: '연육교 어선선착장', subtitle: '인천 옹진 연평도',  lat: '37.6621', lng: '125.6872' },
            { cctvId: 76, name: '아리까리 삼거리',   subtitle: '인천 옹진 연평도',  lat: '37.6702', lng: '125.7012' },
            { cctvId: 77, name: '메드라까리',        subtitle: '인천 옹진 연평도',  lat: '37.6651', lng: '125.6978' },
            { cctvId: 78, name: '동방파제',          subtitle: '인천 옹진 연평도',  lat: '37.6723', lng: '125.7038' },
            { cctvId: 79, name: '연평발전소',        subtitle: '인천 옹진 연평도',  lat: '37.6712', lng: '125.7024' },
            { cctvId: 80, name: '새마을리',          subtitle: '인천 옹진 연평도',  lat: '37.6641', lng: '125.6948' },
            // 대청도 ────────────────────────────────────────────────
            { cctvId: 13, name: '선진포항①',        subtitle: '인천 옹진 대청도',  lat: '37.8251', lng: '124.7178' },
            { cctvId: 14, name: '선진포항②',        subtitle: '인천 옹진 대청도',  lat: '37.8253', lng: '124.7182' },
            { cctvId: 15, name: '수협공판장①',      subtitle: '인천 옹진 대청도',  lat: '37.8261', lng: '124.7192' },
            { cctvId: 31, name: '수협공판장②',      subtitle: '인천 옹진 대청도',  lat: '37.8261', lng: '124.7193' },
            { cctvId: 44, name: '수협공판장③',      subtitle: '인천 옹진 대청도',  lat: '37.8261', lng: '124.7194' },
            { cctvId: 45, name: '수협공판장④',      subtitle: '인천 옹진 대청도',  lat: '37.8261', lng: '124.7195' },
            { cctvId: 67, name: '대청 선외기①',     subtitle: '인천 옹진 대청도',  lat: '37.8241', lng: '124.7162' },
            { cctvId: 68, name: '대청 선외기②',     subtitle: '인천 옹진 대청도',  lat: '37.8241', lng: '124.7163' },
            { cctvId: 70, name: '대청 여객선착장',   subtitle: '인천 옹진 대청도',  lat: '37.8241', lng: '124.7164' },
            // 소청도 ────────────────────────────────────────────────
            { cctvId: 11, name: '소청항',            subtitle: '인천 옹진 소청도',  lat: '37.7741', lng: '124.7382' },
            { cctvId: 12, name: '소청 매표소',       subtitle: '인천 옹진 소청도',  lat: '37.7745', lng: '124.7378' },
            { cctvId: 57, name: '노화동 방파제',     subtitle: '인천 옹진 소청도',  lat: '37.7768', lng: '124.7341' },
            { cctvId: 61, name: '답동 부잔교',       subtitle: '인천 옹진 소청도',  lat: '37.7741', lng: '124.7383' },
            // 덕적도 ────────────────────────────────────────────────
            { cctvId: 20, name: '진리항',            subtitle: '인천 옹진 덕적도',  lat: '37.2312', lng: '126.1378' },
            { cctvId: 28, name: '도우 선착장',       subtitle: '인천 옹진 덕적도',  lat: '37.2371', lng: '126.1421' },
            { cctvId: 32, name: '진말선착장',        subtitle: '인천 옹진 덕적도',  lat: '37.2362', lng: '126.1394' },
            { cctvId: 33, name: '소야대교',          subtitle: '인천 옹진 덕적도',  lat: '37.2362', lng: '126.1395' },
            { cctvId: 83, name: '대부해운 매표소',   subtitle: '인천 옹진 덕적도',  lat: '37.2368', lng: '126.1412' },
            { cctvId: 42, name: '북2리 물량장①',    subtitle: '인천 옹진 덕적도',  lat: '37.2518', lng: '126.1623' },
            { cctvId: 43, name: '북2리 물량장②',    subtitle: '인천 옹진 덕적도',  lat: '37.2512', lng: '126.1618' },
            { cctvId: 84, name: '밧지름 해변',       subtitle: '인천 옹진 덕적도',  lat: '37.2178', lng: '126.1284' },
            { cctvId: 85, name: '서포1리 해수욕장',  subtitle: '인천 옹진 덕적도',  lat: '37.2041', lng: '126.1562' },
            { cctvId: 86, name: '여객선 선착장',     subtitle: '인천 옹진 덕적도',  lat: '37.2044', lng: '126.1568' },
            { cctvId: 87, name: '헬기장 인근',       subtitle: '인천 옹진 덕적도',  lat: '37.2021', lng: '126.1592' },
            // 소야도·울도·문갑도·백아도·굴업도·지도 ─────────────────
            { cctvId: 29, name: '소야 선착장',       subtitle: '인천 옹진 소야도',  lat: '37.2518', lng: '126.1288' },
            { cctvId: 37, name: '소야 큰말',         subtitle: '인천 옹진 소야도',  lat: '37.2531', lng: '126.1312' },
            { cctvId: 88, name: '떼뿌루 해안',       subtitle: '인천 옹진 소야도',  lat: '37.2478', lng: '126.1238' },
            { cctvId: 40, name: '울도항',            subtitle: '인천 옹진 울도',    lat: '37.1882', lng: '126.0814' },
            { cctvId: 89, name: '문갑 선착장',       subtitle: '인천 옹진 문갑도',  lat: '37.2288', lng: '126.0894' },
            { cctvId: 91, name: '보건소 선착장',     subtitle: '인천 옹진 백아도',  lat: '37.2194', lng: '126.0724' },
            { cctvId: 90, name: '여객선 부두',       subtitle: '인천 옹진 굴업도',  lat: '37.2124', lng: '126.1638' },
            { cctvId: 92, name: '지도 선착장',       subtitle: '인천 옹진 지도',    lat: '37.2341', lng: '126.1748' },
            // 자월도·대이작도·소이작도·승봉도 ─────────────────────────
            { cctvId: 10, name: '자월 선착장',       subtitle: '인천 옹진 자월도',  lat: '37.2147', lng: '126.2994' },
            { cctvId: 38, name: '다싯물 선착장',     subtitle: '인천 옹진 자월도',  lat: '37.2183', lng: '126.2878' },
            { cctvId: 27, name: '대이작 선착장',     subtitle: '인천 옹진 이작도',  lat: '37.2218', lng: '126.2963' },
            { cctvId: 59, name: '대이작 부잔교①',   subtitle: '인천 옹진 이작도',  lat: '37.2214', lng: '126.2958' },
            { cctvId: 60, name: '대이작 부잔교②',   subtitle: '인천 옹진 이작도',  lat: '37.2214', lng: '126.2959' },
            { cctvId: 25, name: '소이작 큰마을',     subtitle: '인천 옹진 이작도',  lat: '37.2071', lng: '126.2738' },
            { cctvId: 26, name: '소이작 벌안①',     subtitle: '인천 옹진 이작도',  lat: '37.2103', lng: '126.2818' },
            { cctvId: 66, name: '소이작 벌안②',     subtitle: '인천 옹진 이작도',  lat: '37.2089', lng: '126.2781' },
            { cctvId: 39, name: '승봉 선착장',       subtitle: '인천 옹진 승봉도',  lat: '37.1748', lng: '126.3124' },
            { cctvId: 93, name: '승봉대합실',        subtitle: '인천 옹진 승봉도',  lat: '37.1751', lng: '126.3118' },
            { cctvId: 94, name: '이일레 해수욕장',   subtitle: '인천 옹진 승봉도',  lat: '37.1762', lng: '126.3141' },
            // 영흥도·선재도 ─────────────────────────────────────────
            { cctvId:  5, name: '진두항-1',          subtitle: '인천 옹진 영흥도',  lat: '37.2312', lng: '126.4890' },
            { cctvId:  2, name: '진두항-2',          subtitle: '인천 옹진 영흥도',  lat: '37.2312', lng: '126.4892' },
            { cctvId:  6, name: '진두항-3',          subtitle: '인천 옹진 영흥도',  lat: '37.2312', lng: '126.4894' },
            { cctvId: 16, name: '진두 구철탑',       subtitle: '인천 옹진 영흥도',  lat: '37.2553', lng: '126.4601' },
            { cctvId: 95, name: '진두 해안도로',     subtitle: '인천 옹진 영흥도',  lat: '37.2534', lng: '126.4598' },
            { cctvId: 99, name: '십리포 해수욕장',   subtitle: '인천 옹진 영흥도',  lat: '37.2648', lng: '126.4782' },
            { cctvId: 98, name: '장경리 해수욕장',   subtitle: '인천 옹진 영흥도',  lat: '37.2441', lng: '126.5124' },
            { cctvId: 97, name: '노가리 해변',       subtitle: '인천 옹진 영흥도',  lat: '37.2281', lng: '126.4912' },
            { cctvId: 96, name: '중앙천 배수갑문',   subtitle: '인천 옹진 영흥도',  lat: '37.2478', lng: '126.5018' },
            { cctvId:  9, name: '선재 어촌계',       subtitle: '인천 옹진 선재도',  lat: '37.2608', lng: '126.4573' },
            // 신도·시도·장봉 (북도면) ───────────────────────────────
            { cctvId:  7, name: '신도 선착장①',     subtitle: '인천 옹진 신도',    lat: '37.6297', lng: '126.4082' },
            { cctvId: 71, name: '신도 선착장②',     subtitle: '인천 옹진 신도',    lat: '37.6294', lng: '126.4078' },
            { cctvId: 72, name: '시도 선착장',       subtitle: '인천 옹진 시도',    lat: '37.6341', lng: '126.4214' },
            { cctvId:  8, name: '장봉 선착장',       subtitle: '인천 옹진 장봉도',  lat: '37.6423', lng: '126.3638' },
            { cctvId: 73, name: '장봉 매표소',       subtitle: '인천 옹진 장봉도',  lat: '37.6418', lng: '126.3621' },
            { cctvId: 74, name: '야달 선착장',       subtitle: '인천 옹진 장봉도',  lat: '37.6408', lng: '126.3604' },
            { cctvId: 75, name: '대빈창 입구',       subtitle: '인천 옹진 장봉도',  lat: '37.6491', lng: '126.3894' },
        ]
    }
};

// 다른 파일(cctv4.js 등)에서 window.CCTV_PROVIDERS로 참조할 수 있도록 전역 노출
window.CCTV_PROVIDERS = CCTV_PROVIDERS;
