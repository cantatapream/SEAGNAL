/**
 * ============================================================================
 * 파일명: client/js/shared/utils/usage_keys.js
 * 역할  : 사용량 통계의 "기능 키 → 한글 이름표" 한 장. 앱이 세는 모든 기능 키는 여기에
 *         이름이 있어야 관리자 화면(기능별 누적 사용)과 CSV 다운로드에 한글로 보인다.
 *         화면용·CSV용을 따로 두다가 어긋난 적이 있어(2026-09-10) 한 장으로 합쳤다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(순수 데이터)
 *  - 서버 API      : 없음 — 서버 routes/usage.js 가 이 파일을 require 해 CSV 이름표로 쓴다
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : client/js/admin/admin_collect.js (window.USAGE_FEATURE_LABELS) ·
 *                    local_server/routes/usage.js (module.exports) ·
 *                    local_server/scripts/test_usage_keys.js (키 누락 검사)
 * [로드 순서] admin/pagination_helper.js 다음 · admin/admin.js 이전 — 순서 변경 금지
 * ----------------------------------------------------------------------------
 * [규칙]
 *  - 새 기능에 window.trackUsage('키') 를 달면 같은 커밋에서 여기에 이름을 적는다.
 *    안 적으면 test_usage_keys.js(verify_all.sh)가 실패한다.
 *  - 지금은 안 세지만 과거 데이터에 남아 있는 키는 "(구)" 를 붙여 이름을 남긴다(표 호환).
 *  - 집계 규칙(사용자 확정 2026-09-10): 사람이 직접 누른 것만 센다. 프로그램이 대신 누르는
 *    동안(화면 전환 복원·묶음 버튼)은 utils.js 의 window.withUsageSuppressed 로 세지 않는다.
 * ============================================================================
 */
(function (root, TABLE) {
    if (typeof module !== 'undefined' && module.exports) module.exports = TABLE;   // 서버(Node)
    else root.USAGE_FEATURE_LABELS = TABLE;                                         // 브라우저
})(this, {
    // A. 메인 화면 (특보 및 전망)
    'main.kma_marine_outlook_open': '기상청 해상기상 전망 펼침',
    'main.warn_region_open': '해역별 특보현황 펼침',
    'main.weather_region_open': '해역별 기상현황 펼침',
    'main.region_btn.forecast': '해역 버튼 · 기상예보',
    'main.region_btn.gugu': '해역 버튼 · 해구기상',
    'main.region_btn.windy': '해역 버튼 · 윈디',
    'main.region_btn.overview': '해역 버튼 · 종합정보',
    'main.advisory_prediction_toggle': '특보 예측 펼침',
    // B. 관측 부위(부이)
    'buoy.info_view': '부이 정보 조회',
    // C. 해상일기도
    'chart.load': '해상일기도 로딩',
    'chart.play': '해상일기도 재생',
    // D. 해양종합정보 오버레이
    'ocean.current': '유향유속(조류)',
    'ocean.wind': '풍향풍속(바람)',
    'ocean.wave': '파고/파향',
    'ocean.warn_zone': '특보 표출',
    'ocean.gugu_forecast': '해구 전망표/그래프',
    'ocean.cctv_open': 'CCTV 마커 클릭',
    'ocean.typhoon': '태풍',
    'ocean.mudflat': '물빠짐(해양종합정보)',
    'ocean.basemap.rltm': '배경 · 기본맵',
    'ocean.basemap.enc': '배경 · 전자해도',
    'ocean.basemap.coast': '배경 · 해안도',
    'ocean.basemap.osm': '배경 · 세계지도',
    'ocean.basemap.vworld': '배경 · 위성지도',
    // (구) 위험지형 통합(2026-09-10) 전 노출암·간출암 개별 집계분 — 표 호환용
    'ocean.hazard_exposed': '(구) 노출암',
    'ocean.hazard_rock': '(구) 간출암 등',
    // 천기 요소 (천기도 + 바텀시트 통합)
    'shrt.rain_prob': '강수확률',
    'shrt.rain_amount': '강수량',
    'shrt.snow': '적설',
    'shrt.sky': '하늘상태',
    'shrt.temp_air': '기온(천기)',
    'shrt.vsby': '시정',
    // E. 해점 바텀시트 — 바텀시트로 얻은 데이터는 통합 1건으로 집계.
    'sheet.bottom_sheet': '해점 바텀시트',
    // (구) 마이그레이션 전 개별 집계분 라벨 — 표시 호환용으로 유지.
    'sheet.tide': '(구) 조석', 'sheet.astro': '(구) 천문(일출몰/월출몰)', 'sheet.moon': '(구) 월령(달 위상)', 'sheet.depth': '(구) 수심', 'sheet.water_temp': '(구) 수온',
    // F. 해양생활(활동)
    'life.fishing.tab': '바다낚시 탭 진입',
    'life.surfing.tab': '서핑 탭 진입',
    'life.parting.tab': '바다갈라짐 탭 진입',
    'life.mudflat.tab': '갯벌체험 탭 진입',
    'life.scuba.tab': '스킨스쿠버 탭 진입',
    'life.ripcurrent.tab': '이안류 탭 진입',
    'life.swimming.tab': '해수욕 탭 진입',
    'life.fishing.point.갯바위': '바다낚시 지점 · 갯바위',
    'life.fishing.point.선상': '바다낚시 지점 · 선상',
    'life.surfing.point': '서핑 지점 클릭',
    'life.parting.region': '바다갈라짐 지역 선택',
    'life.mudflat.point': '갯벌체험 지점 클릭',
    'life.scuba.point': '스킨스쿠버 지점 클릭',
    'life.ripcurrent.point': '이안류 지점 클릭',
    'life.swimming.point': '해수욕 지점 클릭',
    // G. 해양안전(해양안전생활 > 해양안전 지도) — 사용자 확정 집계 규칙 2026-09-10
    //    켜면 1건, 마커·구역·폴리곤을 눌러 정보를 보면 각 1건. 끌 때는 세지 않는다.
    'safety.mudflat': '해양안전 · 물빠짐',
    'safety.terrain': '해양안전 · 위험지형',
    'safety.terrain.marker': '해양안전 · 위험지형 마커 클릭',
    'ocean.accident_info': '해양안전 · 사고정보',
    'safety.accident.zone': '해양안전 · 사고정보 구역(칸) 클릭',
    'safety.accident.marker': '해양안전 · 사고정보 마커 클릭',
    'safety.ban_zone': '해양안전 · 금지구역',
    'safety.ban_zone.area': '해양안전 · 금지구역 영역 클릭',
    'safety.navwarn': '해양안전 · 항행경보',
    'safety.navwarn.date': '해양안전 · 항행경보 날짜 이동',
    'safety.navwarn.zone': '해양안전 · 항행경보 구역 클릭',
    'safety.vts': '해양안전 · 관제구역',
    'safety.vts.zone': '해양안전 · 관제구역 폴리곤 클릭',
    'safety.seaway': '해양안전 · 항로·해역',
    'safety.seaway.zone': '해양안전 · 항로·해역 폴리곤 클릭'
});
