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
 *  - 나를 쓰는 곳  : client/js/admin/admin_collect.js (window.USAGE_FEATURE_LABELS — 이름표의 「묶음 · 」 앞말이 화면의 묶음 표시) ·
 *                    local_server/routes/usage.js (module.exports) ·
 *                    local_server/scripts/test_usage_keys.js (키 누락 검사)
 * [로드 순서] admin/pagination_helper.js 다음 · admin/admin.js 이전 — 순서 변경 금지
 * ----------------------------------------------------------------------------
 * [규칙]
 *  - ★이름표 꼴(사용자 확정 2026-11-23 「기능별로 묶어서 통계 네이밍 … 정돈되고 어떤 기능을 말하는지 정확하게」):
 *      「묶음 · 기능 · 무엇을 했나」  예: '해양기상정보 · 파고·파향 · 켬'
 *    · 묶음 = 지금 앱 화면의 자리(아래 GROUPS 순서 — 새 메뉴 화면의 사이드바 폴더와 같은 이름).
 *    · 영어·줄임말을 쓰지 않는다. 「무엇을 했나」는 켬 / 화면 열기 / ○○ 보기 / 펼침 처럼 사람이 한 일로 적는다.
 *    · 관리자 화면은 묶음별로 모아 보여 주고, 막대 이름에는 묶음을 뺀 뒷부분만 쓴다(admin_collect.js).
 *    · 키(영문)는 바꾸지 않는다 — 서버에 쌓인 과거 기록이 그 키로 저장돼 있어, 키를 바꾸면 이전 기록과 끊긴다.
 *  - 새 기능에 window.trackUsage('키') 를 달면 같은 커밋에서 여기에 이름을 적는다.
 *    안 적으면 test_usage_keys.js(verify_all.sh)가 실패한다.
 *  - 지금은 안 세지만 과거 데이터에 남아 있는 키는 묶음 「옛 기능(지금은 안 셈)」에 이름을 남긴다(표 호환).
 *  - 집계 규칙(사용자 확정 2026-09-10): 사람이 직접 누른 것만 센다. 프로그램이 대신 누르는
 *    동안(화면 전환 복원·묶음 버튼)은 utils.js 의 window.withUsageSuppressed 로 세지 않는다.
 * ============================================================================
 */
(function (root, TABLE, GROUPS) {
    // 묶음 순서 — 관리자 화면·CSV 가 이 순서로 모아 보여 준다. 열거되지 않게 붙여 Object.keys(이름표)에는 안 섞인다.
    Object.defineProperty(TABLE, '__groups', { value: GROUPS, enumerable: false });
    if (typeof module !== 'undefined' && module.exports) module.exports = TABLE;   // 서버(Node)
    else root.USAGE_FEATURE_LABELS = TABLE;                                         // 브라우저
})(this, {
    // ── 특보정보 (첫 탭 「특보 및 전망」) ──────────────────────────────────
    'main.kma_marine_outlook_open': '특보정보 · 해상 기상 전망 · 펼침',
    'main.warn_region_open': '특보정보 · 해역별 특보현황 · 펼침',
    'main.weather_region_open': '특보정보 · 해역별 기상현황 · 펼침',
    'main.region_btn.forecast': '특보정보 · 해역별 기상현황 · 기상예보 버튼',
    'main.region_btn.gugu': '특보정보 · 해역별 기상현황 · 해구기상 버튼',
    'main.region_btn.windy': '특보정보 · 해역별 기상현황 · 윈디 버튼',
    'main.region_btn.overview': '특보정보 · 해역별 기상현황 · 종합정보 버튼',

    // ── 연안 안전 브리핑 (특보정보 탭의 아코디언) — 사용자 확정 집계 규칙 2026-10-18 ──
    //    아코디언을 펼칠 때마다 1건(접을 때는 세지 않는다). 브리핑 글 속 링크 중 위험예측 자료가 없는 지도·창은 이 묶음.
    //    (station_briefing.js toggle · station_briefing_render.js usageOf)
    'briefing.open': '연안 안전 브리핑 · 펼침',
    'briefing.haegu_map': '연안 안전 브리핑 · 대해구 지도',
    'briefing.warn_popup': '연안 안전 브리핑 · 특보 현황 창',
    'briefing.rocks_map': '연안 안전 브리핑 · 잠기는 바위 지도',
    // 위험예측 배경 부품이 없을 때(모듈 로드 실패)만 쓰는 종전 지도 — 위험예측 자료가 없어 브리핑 묶음
    'briefing.ships_map': '연안 안전 브리핑 · 선박 지도(배경 없음)',
    'briefing.busiest_map': '연안 안전 브리핑 · 붐비는 해역(배경 없음)',
    'briefing.basis_map': '연안 안전 브리핑 · 근거 지도(배경 없음)',

    // ── 해상일기도 (특보정보 탭의 하위 화면) ─────────────────────────────
    'chart.load': '해상일기도 · 그림 불러오기',
    'chart.play': '해상일기도 · 재생',

    // ── 해양기상정보 (해양종합정보 > 전체 메뉴 > 해양기상정보 — 스위치) ──────
    //    켜면 1건(끌 때는 세지 않는다). 지도에서 눌러 정보를 보면 「○○ 보기」 1건.
    'ocean.warn_zone': '해양기상정보 · 특보구역·현황 · 켬',
    'ocean.wave': '해양기상정보 · 파고·파향 · 켬',
    'ocean.wind': '해양기상정보 · 풍향·풍속 · 켬',
    'ocean.current': '해양기상정보 · 유향·유속 · 켬',
    'ocean.buoy': '해양기상정보 · 기상부이 · 켬',                         // 2026-11-23 신설(그 전에는 켜는 것을 안 셌다)
    'buoy.info_view': '해양기상정보 · 기상부이 · 관측값 보기',             // 지도의 부이 · 특보정보 탭의 부이 버튼 공통
    'ocean.marine_zone': '해양기상정보 · 해구기상 · 켬',                   // 2026-11-23 신설
    'ocean.gugu_forecast': '해양기상정보 · 해구기상 · 전망표 보기',
    'shrt.temp_air': '해양기상정보 · 천기 · 기온',
    'shrt.rain_amount': '해양기상정보 · 천기 · 강수량',
    'shrt.rain_type': '해양기상정보 · 천기 · 강수형태',                    // 2026-11-23 신설(그 전에는 강수확률에 합쳐 셌다)
    'shrt.rain_prob': '해양기상정보 · 천기 · 강수확률',
    'shrt.snow': '해양기상정보 · 천기 · 적설',
    'shrt.sky': '해양기상정보 · 천기 · 하늘상태',
    'shrt.vsby': '해양기상정보 · 천기 · 시정예측',
    'ocean.typhoon': '해양기상정보 · 태풍 · 켬',

    // ── 해양안전정보 (해양종합정보 > 전체 메뉴 > 해양안전정보 — [보기]) ────────
    //    사용자 확정 집계 규칙 2026-09-10: 켜면(=[보기]를 누르면) 1건, 지도에서 마커·구역을 눌러 정보를 보면 각 1건. 끌 때는 세지 않는다.
    'safety.navwarn': '해양안전정보 · 항행경보 현황 · 켬',
    'safety.navwarn.date': '해양안전정보 · 항행경보 현황 · 날짜 넘기기',
    'safety.navwarn.zone': '해양안전정보 · 항행경보 현황 · 구역 보기',
    'ocean.accident_info': '해양안전정보 · 사고발생 이력·분석 · 켬',
    'safety.accident.ship': '해양안전정보 · 사고발생 이력·분석 · 사고이력(선박) 열기',     // 2026-11-23 신설 — 사이드바의 세 갈래를 가른다
    'safety.accident.person': '해양안전정보 · 사고발생 이력·분석 · 사고이력(인명) 열기',   // 2026-11-23 신설
    'safety.accident.stats': '해양안전정보 · 사고발생 이력·분석 · 사고분석 열기',          // 2026-11-23 신설
    'safety.accident.zone': '해양안전정보 · 사고발생 이력·분석 · 구역(칸) 보기',
    'safety.accident.marker': '해양안전정보 · 사고발생 이력·분석 · 사고 지점 보기',
    'safety.terrain': '해양안전정보 · 위험지형 · 켬',
    'safety.terrain.marker': '해양안전정보 · 위험지형 · 바위 지점 보기',
    'safety.mudflat': '해양안전정보 · 갯벌 수위 예측 · 켬',
    'safety.ban_zone': '해양안전정보 · 출입통제·낚시금지 · 켬',
    'safety.ban_zone.area': '해양안전정보 · 출입통제·낚시금지 · 구역 보기',
    'safety.vts': '해양안전정보 · 관제구역·항로 · 관제구역 켬',
    'safety.vts.zone': '해양안전정보 · 관제구역·항로 · 관제구역 보기',
    'safety.seaway': '해양안전정보 · 관제구역·항로 · 항로 켬',
    'safety.seaway.zone': '해양안전정보 · 관제구역·항로 · 항로 보기',
    'ocean.cctv': '해양안전정보 · CCTV · 켬',                              // 2026-11-23 신설
    'ocean.cctv_open': '해양안전정보 · CCTV · 영상 보기',

    // ── 위험예측 (해양안전정보의 [위험예측]) — 사용자 확정 집계 규칙 2026-10-18 ──
    //    켜면 1건, 안의 스위치를 켜면 각 1건, 지도에서 칸·관광지를 눌러 바텀시트가 열리면 1건(끌 때는 세지 않는다).
    //    (risk_forecast.js usage — 브리핑 바로가기가 대신 누르는 버튼·스위치는 withUsageSuppressed 로 세지 않는다)
    'risk.on': '위험예측 · 켬',
    'risk.layer.coast': '위험예측 · 연안 스위치 켬',
    'risk.layer.sea': '위험예측 · 해상 스위치 켬',
    'risk.marine_mode.congestion': '위험예측 · 해상 혼잡도 선택',
    'risk.marine_mode.risk': '위험예측 · 해상 위험 예측 선택',
    'risk.sheet.sea': '위험예측 · 해상 칸 시트',
    'risk.sheet.coast': '위험예측 · 관광지 시트',
    //    브리핑에서 위험예측으로 — 「위험예측에서 보기」 바로가기·위험예측 지도 층(또는 위험예측 위험구역 자료)을 여는 링크·그 지도 칸 시트.
    //    사용자 원문: *"브리핑에서 위험예측 기능과 관련된 지도가 열리면 위험예측으로 반영되어야하는거야"*
    'risk.goto_sea_from_briefing': '위험예측 · 브리핑 바로가기(해역)',
    'risk.goto_coast_from_briefing': '위험예측 · 브리핑 바로가기(관광지)',
    'risk.ships_map_from_briefing': '위험예측 · 브리핑 선박 지도',
    'risk.busiest_map_from_briefing': '위험예측 · 브리핑 붐비는 해역',
    'risk.spot_map_from_briefing': '위험예측 · 브리핑 관광지 지도',
    'risk.basis_map_from_briefing': '위험예측 · 브리핑 근거 지도',
    'risk.hazard_map_from_briefing': '위험예측 · 브리핑 위험구역 지도',
    'risk.sheet.sea_from_briefing': '위험예측 · 브리핑 해상 칸 시트',
    'risk.sheet.coast_from_briefing': '위험예측 · 브리핑 관광지 시트',

    // ── 해양생활지수 (해양종합정보 > 전체 메뉴 > 해양생활지수 — [보기]) ────────
    //    [보기]를 누르면 「화면 열기」 1건, 그 화면 지도에서 지점을 누르면 「지점 보기」 1건.
    'life.fishing.tab': '해양생활지수 · 바다낚시 · 화면 열기',
    'life.fishing.point.갯바위': '해양생활지수 · 바다낚시 · 지점 보기(갯바위)',
    'life.fishing.point.선상': '해양생활지수 · 바다낚시 · 지점 보기(선상)',
    'life.surfing.tab': '해양생활지수 · 서핑 · 화면 열기',
    'life.surfing.point': '해양생활지수 · 서핑 · 지점 보기',
    'life.scuba.tab': '해양생활지수 · 스킨스쿠버 · 화면 열기',
    'life.scuba.point': '해양생활지수 · 스킨스쿠버 · 지점 보기',
    'life.mudflat.tab': '해양생활지수 · 갯벌체험 · 화면 열기',
    'life.mudflat.point': '해양생활지수 · 갯벌체험 · 지점 보기',
    'life.parting.tab': '해양생활지수 · 바다갈라짐 · 화면 열기',
    'life.parting.region': '해양생활지수 · 바다갈라짐 · 지역 고르기',
    'life.swell.tab': '해양생활지수 · 너울 · 화면 열기',
    'life.swimming.tab': '해양생활지수 · 해수욕 · 화면 열기',
    'life.swimming.point': '해양생활지수 · 해수욕 · 지점 보기',
    'life.ripcurrent.tab': '해양생활지수 · 이안류 · 화면 열기',            // 화면은 지금 메뉴에 없다(코드는 남아 있음)
    'life.ripcurrent.point': '해양생활지수 · 이안류 · 지점 보기',

    // ── 지도 공통 (해양종합정보 지도 어디서나) ───────────────────────────
    'menu.open': '지도 공통 · 전체 메뉴 · 열기',                           // 2026-11-23 신설
    'menu.fav_add': '지도 공통 · 전체 메뉴 · 즐겨찾기에 담기',             // 2026-11-23 신설(푸는 것은 세지 않는다)
    'sheet.bottom_sheet': '지도 공통 · 해점 정보 창 · 열기',               // 지도를 눌렀을 때 뜨는 창 — 통합 1건
    'ocean.basemap.rltm': '지도 공통 · 배경지도 · 기본맵',
    'ocean.basemap.enc': '지도 공통 · 배경지도 · 전자해도',
    'ocean.basemap.coast': '지도 공통 · 배경지도 · 해안도',
    'ocean.basemap.osm': '지도 공통 · 배경지도 · 세계지도',
    'ocean.basemap.vworld': '지도 공통 · 배경지도 · 위성지도',

    // ── 뉴스·공지·어황 (셋째 탭) — 2026-11-23 신설. 안쪽 탭을 사람이 누르면 1건 ──
    'hub.news': '뉴스·공지·어황 · 오늘의 뉴스 · 보기',
    'hub.notice': '뉴스·공지·어황 · 공지사항 · 보기',
    'hub.fishcond': '뉴스·공지·어황 · 어황정보 · 보기',

    // ── 탭 밖 기능 — 2026-11-23 신설. 버튼을 사람이 누르면 1건 ──
    'chat.open': '탭 밖 기능 · AI 챗봇 · 열기',
    'settings.open': '탭 밖 기능 · 앱 설정 · 열기',

    // ── 옛 기능(지금은 안 셈) — 과거 기록에만 남아 있는 키. 표가 끊기지 않게 이름만 남긴다 ──
    'main.advisory_prediction_toggle': '옛 기능(지금은 안 셈) · 특보 예측 · 펼침',        // 기능 2026-11-03 삭제
    'ocean.mudflat': '옛 기능(지금은 안 셈) · 물빠짐 · 켬(옛 해양종합정보 화면)',          // 지금은 해양안전정보의 「갯벌 수위 예측」
    'ocean.hazard_exposed': '옛 기능(지금은 안 셈) · 노출암 · 켬',                        // 2026-09-10 위험지형으로 통합
    'ocean.hazard_rock': '옛 기능(지금은 안 셈) · 간출암 등 · 켬',
    'ocean.hazard_rocks': '옛 기능(지금은 안 셈) · 위험지형(통합 직후) · 켬',             // 운영 기록에 7건 — 이름표가 없어 영문 키가 그대로 보였다
    'life.mudflat.region': '옛 기능(지금은 안 셈) · 갯벌체험 · 지역 고르기',              // 운영 기록에 13건 — 위와 같다
    'sheet.tide': '옛 기능(지금은 안 셈) · 해점 정보 창 · 조석', 'sheet.astro': '옛 기능(지금은 안 셈) · 해점 정보 창 · 일출몰·월출몰',
    'sheet.moon': '옛 기능(지금은 안 셈) · 해점 정보 창 · 달 모양', 'sheet.depth': '옛 기능(지금은 안 셈) · 해점 정보 창 · 수심', 'sheet.water_temp': '옛 기능(지금은 안 셈) · 해점 정보 창 · 수온'
}, ['특보정보', '연안 안전 브리핑', '해상일기도', '해양기상정보', '해양안전정보', '위험예측', '해양생활지수', '지도 공통', '뉴스·공지·어황', '탭 밖 기능', '옛 기능(지금은 안 셈)']);
