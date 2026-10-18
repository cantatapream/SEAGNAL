/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing_render.js
 * 역할  : 「연안 안전 브리핑」(종전 「활동지점 안전 브리핑」) 본문을 그린다 — 서버가 만든 브리핑(총평과 권고 = 서버 결론 + 연안·해상 분석 문단(AI 또는 규칙) + 접힌 「분석 근거」(근거·권고) + (기상)·(물때)
 *         · 해상 시간 막대·해역 카드·연안 카드·조석·데이터 출처)을 화면 칸으로 옮긴다(2026-10-17 사용자 결정 「가」 모양 — 설계서 §11.10.4).
 *         아코디언 제목 글 「HH:MM AI 연안 안전 브리핑」(titleText)도 여기서 만든다. 서버 글은 모두 textContent 로만 넣는다(계약서 §5 「화면은 textContent 로만」 — HTML 삽입 금지).
 *         HTML 로 넣는 것은 조석 게이지(해양종합정보 OS.tideGaugeHtml 이 숫자·시각만으로 만든 것)뿐이다.
 *         근거 줄 ▸ 펼침(2026-10-17 §11.10.3): 고립 사고 지점 표 · 관할 해역 미니 지도(해당 칸·대해구 테두리 깜빡임 — 접거나 다시 그리면 멈춤).
 *         §11.10.9: 분석 근거 알약 배지 · 「평소보다 위험이 높아진 곳」 표 · 「{구역} 기상 현황」 머리 · 분석 문단 강조 토막(highlightSegments — span textContent 로만) · 마지막 「따라서 …」 → (권고) 줄
 *                   · 대해구 이름·「관할 해역 선박 N척」·붐비는 해역 링크 → 가운데 팝업 지도(openMapPopup — 서버 summary.sea.haegu·now.cells).
 *         §11.10.10: (물때) 「잠기는 바위(간출암) N곳」 링크 → 팝업 지도(관할 경계 + 그 바위 마커 — 서버 summary.rocks) → 마커를 누르면 해양안전 「위험지형」과 같은 간출암 조석 곡선 상자
 *                   (HazardRockTidePanel — hazard_rocks.js 의 같은 함수) · (고립 주의) 「과거 고립 사고(N개소 M건)」 링크(화살표 없음) → 「지점명 | 발생 현황」 표.
 *         §11.10.13: 해상 시간 막대 아래 설명 줄·칸 누르기 없음(칸 = role=img) · 해역 카드 [사고현황('21~'25년)] → [기상 예보] → [그 밖의 근거] → 한 줄 → 맨 끝 [권고](서버 규칙 v14 카드 — 옛 판은 [특성]·[오늘 예상]).
 *         §11.10.14: 「해상 분석」·「연안 분석」 칸 머리 오른쪽 단계별 개수 배지 · 펼친 칸 안 단계 단추(하나만 고름 — 처음 = 가장 높은 단계)로 그 단계 카드만.
 *         §11.10.15: 해역 카드 출처별 배지(「18~24시 해양사고 위험예보 '주의'(KOMSA)」 — 글자 색 = 그 예보 등급 색) + 상세 줄 → [사고현황] → 「… 많이 기록되었습니다」 → [기상 예보] → [권고](서버 규칙 v16 badges — 옛 판은 종전 꼬리표·줄 순서).
 *                    시안 ④판(규칙 v17): 상세는 제목 + 표(srcbTable — 「시각 | 등급」 등, 등급 칸 = 그 등급 색), v16 판의 글 줄 상세는 종전 한 줄.
 *         §11.10.16: 단계 이름에서 「필요」를 뺌(「주의」 — 옛 판의 「주의 필요」도 levelWord 로 줄여 보임) · 배지·단추 「경계 1 · 주의 5 · 관심 1」(단위 없음) · 「관할 해역 N칸 검토 …」·「관광지 N곳 검토 …」 줄 없음
 *                    · 「다.」로 끝난 문장 뒤는 줄바꿈(appendText — 글은 그대로 두고 <br> 만 끼움, textContent 는 서버 글과 같다).
 *                    · 같은 날 추가 결정: 「관광지 N곳 자료 확인 불가」 줄 없음 · 카드 상한 없음(서버) · 처음엔 「총평과 권고」만 펼침 · 「특별 상황」 칸 없음.
 *                    · E(시안 ⑤판): 분석 문단의 특보 말(「풍랑주의보 해제 예고」·「예비특보」 등) → 「기상특보 현황」 창 링크(openWarnPopup — 표 「특보구역 | 특보 | 시각」·발표·해제 뒤 한 문장),
 *                      특보 말이 없으면 문단 아래 「(특보) …」 한 줄 · 해상 근거 안 같은 상자(warnBox) · 표 칸에는 따옴표 없음(서버).
 *         §11.10.20(시안 Land.dc.html ⑥판, 서버 규칙 v19): 연안 카드 — 배지 줄(연안 위험지수·해수욕장) · [위험구역] 「N개소」 → 표 「구역 종류 | 개소 수」 → [위치 보기] 지도(그 종류 위험구역 폴리곤 깜빡임 + 관광지 점)
 *         §11.10.24(2026-10-18): 「관할 해역 선박 N척」·붐비는 해역 팝업 = 위성지도 + 혼잡도 지금(칸 색·선박 수) · 칸을 누르면 그 창 안 해상 분석 바텀시트 · 열린 동안 실시간 갱신(updateNow·popup.live)
 *                    · 해상 근거 「위험이 높아진 해역 N칸」·「위험예보만 해역」 펼침 지도 = 위성지도 + 위험 예측 색, 칸을 누르면 화면 바텀시트(openPageSheet).
 *         §11.10.26(2026-10-18): 연안 근거 「이름 — …」 줄의 관광지 이름(밑줄만) → 팝업(위성지도 + 연안 위험 색 · 그 영역 깜빡임) → 잠깐 뒤 연안 분석 바텀시트 자동.
 *         §11.10.23(서버 규칙 v21): 해역 카드 [최근 14일 선박 동향] 한 줄(「…많이 기록되었습니다」 다음 · [기상 예보] 앞 — 서버 card.traffic, 없으면 줄 없음) · 데이터 출처 한 줄.
 *         §11.10.22(서버 규칙 v20): 해구 표기 「75해구」·「223-9해구」(지도 풀이·링크 경계) · [기상 예보]·분석 문단 「유의파고 …」 굵게(옛 판 「최대 파고 …」도) · 해역 카드 [사고현황('21~'25년)] 내용은 이름표 다음 줄(연안 카드와 같은 모양).
 *                    · [사고현황('20~'24년)] 「총 N건」 → 표 「연도 | 사고 종류 | 건수」 · [오늘 예상] 하나면 점 없이 · [권고]. 맨 아래 노란 안내 한 문장(기준 시각·다루는 시간 줄 없음 · 출처 표는 [기준 상세]에만 — 2026-10-18).
 *         §11.10.29(시안 SbSeaA — 서버 그대로): 해상 시간 막대 = 게이지(timeBar — 이어진 8px 막대 · ⚑ 줄 · 눈금 글자 tickText·tickEnd) · 해역 카드 세로 표 두 개 → 가로 표 하나(seaGrid — 열 = 시각,
 *                    해양사고 위험예보·기상특보 행, 4칸이 같으면 한 칸 「12~24시 주의」, 칸 색 = gridRank 한 곳) · 배지·가로 표 칸 굵게 없음 · 해역 카드 제목 해구 괄호 작게(seaCardName) · AI 이름표 색(ChatGPT 흰·Gemini 파랑).
 *         §11.10.31(2026-10-18 — 화면만): 잠기는 바위 팝업 지도 = 위성지도 바탕(StationBriefingRiskMap.baseLayers — 위험예측 팝업과 같은 브이월드) + 끌기·핀치·휠·더블탭 확대 + 화면 +/− 단추(miniMap opt.sat·opt.zoom)
 *                    · 「○○앞바다 기상 현황」 줄은 머리말(「오늘 오후」) 다음 줄에서 날씨 내용 시작(weatherPart <br>) · 「물때」 머리 = 기상 현황 머리와 같은 모양 + 줄마다 「•」 목록(tidePart).
 *                    · 해역 카드 「KOMSA 혼잡 예보」 표는 한 줄에 두 시각(pairTable — 「시각 | 혼잡지수 | 시각 | 혼잡지수」).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/bottom-sheet/ocean_bottom_sheet3.js(OceanSheet.tideGaugeHtml — 조석 게이지 디자인 그대로)
 *                    · marine-life/risk-forecast/risk_format.js(RiskFormat.BAND_COLORS — 위험예측 4색) · risk_basis.js(RiskBasis.open('briefing') — [기준 상세])
 *                    · style.css(.marine-forecast-sub-accordion·.ocean-tide-*) · station_briefing.css(.sb-*)
 *                    · ol.js(index2 <head> 전역 ol — 미니 지도) · ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 바탕 해아름 바다지도, 관심해역 고르기 지도와 같은 방식, 없으면 선만)
 *                    · marine-life/safety/hazard_rocks.js(window.HazardRockTidePanel — 간출암 조석 곡선 상자·마커 그림, §11.10.10) · index2.html <style>(.hazard-rock-popup.rock-tide-popup 모양)
 *                    · station_briefing_riskmap.js(StationBriefingRiskMap — 위험예측 배경 지도 층·바텀시트, §11.10.24·§11.10.26)
 *  - 서버 API      : 브리핑은 받은 응답만 그린다(받기는 station_briefing.js · admin_station_briefing.js). 간출암 상자는 HazardRockTidePanel 이 /api/hazard-rocks/tide-curve 를 받는다
 *                    · 연안 카드 [위치 보기]를 누를 때만 GET /api/risk-forecast/hazard-zones?ids=(routes/risk_forecast.js — 위험구역 폴리곤, §11.10.20)
 *                    · 위험예측 배경 지도·시트는 StationBriefingRiskMap 이 GET /api/risk-forecast/sea/area-frame·coast/area-frame·sea/analysis·coast/spot·sea/traffic-history 를 받는다(§11.10.24)
 *  - 마크업        : index2.html #station-briefing-content(그 안을 통째로 만든다) · 관리자 미리보기 상자
 *  - 나를 쓰는 곳  : station_briefing.js(아코디언 본문) · admin/admin_station_briefing.js(관할 하나 미리보기)
 *  - 계약          : client/js/ocean-map/coastal-risk/briefing.contract.md §1.2·§2
 * [로드 순서] station_briefing_riskmap.js 다음(그 앞 life_safety.js·risk_*.js) · station_briefing_basis.js·station_briefing.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    // 단계 4색 = 위험예측 관례(RiskFormat.BAND_COLORS 의 평소 수준·다소 높음·높음·매우 높음 순서 — 초록·노랑·주황·빨강).
    // 브리핑 단계 0 평소 수준 · 1 관심 · 2 주의 · 3 경계 를 순서대로 맞춘다. 확인 불가는 회색.
    var BAND_ORDER = ['평소 수준', '다소 높음', '높음', '매우 높음'], FALLBACK = ['#2fb36b', '#f2c230', '#fb923c', '#e0322c'], GREY = '#64748b';
    // 단계 이름 — 2026-10-17 「필요」를 뺐다(설계서 §11.10.16, 사용자 *"경계 필요, 주의 필요 이렇게 하지말고 경계 1, 주의 5, 관심 1 처럼 표출"* · *"전체적으로 필요라는 텍스트는 빼도 될 것 같은데"*). 서버 rules.WORD 와 같은 표.
    var WORDS = ['평소 수준', '관심', '주의', '경계'];
    /**
     * 서버 단계 말을 화면 이름으로 — 규칙 v16 전에 저장된 판의 「관심 필요·주의 필요·경계 필요」를 「관심·주의·경계」로 줄인다(그 밖은 그대로 — 「평소 수준」·「확인 불가(일부)」).
     * 예: levelWord('주의 필요') → '주의' · levelWord('주의') → '주의' · levelWord('확인 불가(일부)') → '확인 불가(일부)'
     * @param {string} word @returns {string} [연계] ← chip·levelGroups(배지·단추 글) · 시험 test_station_briefing_ui.js [§11.10.16]
     */
    function levelWord(word) { return String(word).replace(/^(관심|주의|경계) 필요$/, '$1'); }
    // 원천 열쇠 → 사람이 읽는 이름(서버 station_briefing_rules.SOURCE_LABEL 과 같은 표 + sources 의 tourConcentration).
    // accident = 「해양사고 위험예보」(2026-10-17 사용자 결정 §11.10.3 — 브리핑 안 이름만, 종전 「공식 사고예보」)
    var SOURCE_LABEL = { accident: '해양사고 위험예보', congestion: '혼잡 예보', zoneForecasts: '해구 예보', warnings: '기상특보', concentration: '관광지 사람 집중률', tourConcentration: '관광지 사람 집중률', hazard: '위험구역', events: '행사', rip: '이안류', gale: '강풍 자료', forecast: '해구 예보', detail: '관광지 상세', swell: '너울' };
    // 정시 판 종류(제목·머리 글 시각 = 공개 시각). 판 이름 표(EDITION)·editionLabel 은 꼬리 「기준 시각 … 판」 줄과 함께 없앴다(§11.10.20).
    var SCHEDULED = { morning: 1, evening: 1, night: 1 };
    /**
     * 판 시각 「HH:MM」 — 정시 판은 공개 시각(publishAt — 07:30·17:30·23:00), 특보 변경·관리자 판은 만든 시각(generatedAt).
     * publishAt 이 없는 옛 판(§11.10.4 전)은 만든 시각 — 그때는 만든 시각이 곧 판 시각(08:00·17:30·23:00)이었다.
     * 예: {edition:'morning',publishAt:'…T07:30:00+09:00',generatedAt:'…T07:10:05+09:00'} → '07:30' · {edition:'warning',generatedAt:'…T13:12:40+09:00'} → '13:12' · null → ''
     * @param {Object} b - briefing @returns {string} [연계] ← titleText·subtitleText(editionIso 를 같이 쓴다 — 제목과 머리 글의 시각이 어긋나지 않게)
     */
    function editionTime(b) { var m = /T(\d{2}):(\d{2})/.exec(editionIso(b)); return m ? m[1] + ':' + m[2] : ''; }
    /** 판 시각을 정하는 ISO 한 곳(제목·머리 글 공용). 예: 정시 판 → publishAt · 특보·관리자·옛 판 → generatedAt · null → ''. @param {Object} b @returns {string} [연계] ← editionTime·subtitleText */
    function editionIso(b) { return String((b && SCHEDULED[b.edition] && b.publishAt ? b.publishAt : b && b.generatedAt) || ''); }
    /**
     * 본문 머리 글 — 2026-10-17 사용자 결정(설계서 §11.10.9 ⑦) 원문 *"10월 17일 몇시 브리핑, 몇시 기준 브리핑 이렇게 나왔으면 좋겠고 관리자 즉시 실행판이라고 그런 종류를 써놓을 필요는 없을 것 같아 그리고 몇 시에 생성됐는지도 적힐 필요 없을 것 같아
     * 단 그 오른쪽에 괄호로서 다음 브리핑 갱신 시점 몇 시 … 또는 특보 변경 시 라고 하고 괄호를 닫았으면 좋겠거든."*
     * 날짜·시각 = 제목 「HH:MM AI 연안 안전 브리핑」과 같은 판 시각(editionIso). 다음 갱신 = 서버 nextPublishAt(다음 정시 판 공개 시각) — 오늘이 아니면 「내일 HH:MM」. 없으면 괄호 없이.
     * 예: subtitleText({edition:'evening',publishAt:'2026-10-17T17:30:00+09:00'}, '2026-10-17T23:00:00+09:00', 10-17 18:00) → '10월 17일 17:30 기준 브리핑 (다음 갱신 23:00 또는 특보 변경 시)'
     *     밤 23:05 · next '2026-10-18T07:30…' → '… (다음 갱신 내일 07:30 또는 특보 변경 시)'
     * @param {Object} b @param {string} [nextIso] - resp.nextPublishAt @param {number} nowMs @returns {string} [연계] ← render(.sb-edition)
     */
    function subtitleText(b, nextIso, nowMs) {
        var iso = editionIso(b), d = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso), n = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(nextIso || ''));
        var head = d ? (+d[1]) + '월 ' + (+d[2]) + '일 ' + d[3] + ':' + d[4] + ' 기준 브리핑' : dateText(b && b.targetDate) + ' 브리핑';
        if (!n) return head;
        var today = new Date(nowMs + 9 * 3600000).toISOString().slice(0, 10);
        return head + ' (다음 갱신 ' + (n[1] === today ? '' : '내일 ') + n[2] + ':' + n[3] + ' 또는 특보 변경 시)';   // §11.10.20 덧붙임 16 — 사용자 *"다음 브리핑 00:00 이 아닌 다음 갱신 00:00으로 해줘."*(종전 「다음 브리핑 갱신」)
    }
    /**
     * 아코디언 제목 — 2026-10-17 사용자 *"연안 안전 브리핑 아코디언을 hh:mm AI 연안 안전 브리핑으로 변경해줘."*. 보이는 판의 시각을 앞에, 판이 없으면 시각 없이.
     * 예: titleText({edition:'morning',publishAt:'2026-10-17T07:30:00+09:00'}) → '07:30 AI 연안 안전 브리핑' · titleText(null) → 'AI 연안 안전 브리핑'
     * @param {Object|null} b @returns {string} [연계] ← station_briefing.js setTitle(#station-briefing-title)
     */
    function titleText(b) { var t = editionTime(b); return (t ? t + ' ' : '') + 'AI 연안 안전 브리핑'; }
    var DOW = ['일', '월', '화', '수', '목', '금', '토'];
    // 쓰는 자료와 출처 — [기준 상세] 표(station_briefing_basis.js)와 본문 꼬리 「출처」 줄이 이 한 벌을 같이 쓴다(2단계 검토 B10 — 둘이 어긋나 있었다).
    // [자료, 출처, 쓰는 곳, 구분]. 구분(해상·기상·연안·물때 — 2026-10-18 [기준 상세] 출처 표의 첫 칸, 설계서 §11.10.20)으로 묶어 그 순서대로 둔다. 출처는 수집기·자료 파일 머리 주석으로 확인한 것만(build_accidents.js 개방海 「선박사고(해경)」·「인명사고」, build_coast_accidents.py 유형·500m·2020~2024,
    // marine_fusion.js 선박사고 최근 5년(자료 마지막 해 2025), coastal_events_collector.js 관광공사+Gemini 보충, scheduler.js 이안류 KHOA+기상청, swell_smallzone.js 기상청 MMIS 너울).
    var SOURCES = [
        ['해양사고 위험예보(선박 사고위험 예보, 3시간)', '한국해양교통안전공단 MTIS', '해상 단계', '해상'],
        ['해양교통 혼잡 예보', '한국해양교통안전공단 MTIS', '해상 「충돌·접촉 주의」', '해상'],
        ['실시간 선박 교통', '한국해양교통안전공단 MTIS', '「지금 밀집」 한 줄(오늘 브리핑만)', '해상'],
        ['최근 14일 선박 동향', '한국해양교통안전공단 MTIS 실시간(앱이 30분 단위로 쌓음)', '해역 [최근 14일 선박 동향]', '해상'], // §11.10.23(사용자 확정 「좋아 이렇게 하자.」 — 지시서의 출처 문구 그대로)
        ['해구별 3시간 예보(유의파고·풍속)', '기상청', '해상 단계, 「몇 시부터 높아지는지」', '해상'],
        ['과거 선박사고(2021~2025)', '해양경찰청 선박사고 기록(국립해양조사원 개방海 제공)', '해역 [사고현황]', '해상'], // §11.10.13 — 종전 「해역 [특성]」
        ['해상 특보(풍랑·태풍)·육상 강풍특보·특보 해제 기록', '기상청', '해상·육상 단계, 특별 상황', '기상'],
        ['해상 기상 전망(단기 통보문)', '기상청', '총평을 쓰는 AI 의 원인 참고(그 안의 숫자·지명은 옮기지 않음)', '기상'],
        ['너울 · 이안류', '기상청 · 국립해양조사원', '육상 「오늘 바뀐 요소」', '기상'],
        ['관광지 사람 집중률 예측', '한국관광공사', '육상 「사람 평소의 N배」, 연안 위험지수', '연안'],
        ['지역 행사', '한국관광공사(+ Gemini 보충 검색)', '육상 「오늘 바뀐 요소」', '연안'],
        ['연안사고 위험구역', '해양경찰청', '관광지 [위험구역], 상시 위험 장소', '연안'], // §11.10.20 — 종전 「육상 특성」
        ['과거 연안사고 — 연안 인명사고(익수·추락·고립·표류·기타), 관광지 구역 + 앞바다 500m, 2020~2024', '국립해양조사원 개방海 인명사고', '관광지 [사고현황]', '연안'], // §11.10.20 — 종전 「관광지 [특성]」
        ['조석(고조·저조)·잠기는 바위', '국립해양조사원 조석 예측(앱이 매일 23:30 수집)', '조석 칸', '물때'],
    ];

    /**
     * 단계 순위의 색을 고른다(위험예측 4색). 확인 불가(순위 0 이면서 말이 「확인 불가…」)는 회색.
     * 예: colorOf(2) → '#fb923c'(주황) · colorOf(0,'확인 불가(일부)') → '#64748b'
     * @param {number} rank - 0~3 @param {string} [word] - 서버 단계 말 @returns {string} CSS 색
     * [연계] ← chip·timeBar / → RiskFormat.BAND_COLORS(risk_format.js — 지도·연안 상자와 같은 색)
     */
    function colorOf(rank, word) {
        if (typeof word === 'string' && word.indexOf('확인 불가') === 0) return GREY;
        var r = Number(rank); if (!(r >= 0 && r <= 3)) return GREY;
        var bands = w.RiskFormat && w.RiskFormat.BAND_COLORS;
        return (bands && bands[BAND_ORDER[r]]) || FALLBACK[r];
    }
    /**
     * 요소 하나를 만든다 — 글은 textContent 로만.
     * 예: el('p','sb-note','참고 정보') → <p class="sb-note">참고 정보</p>
     * @param {string} tag @param {string} [cls] @param {*} [text] - 문자열로 바꿔 textContent 에 @returns {HTMLElement}
     * [연계] ← 이 파일의 모든 그리기 함수
     */
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) appendText(e, text);   // 「다.」 문장 끝 줄바꿈(§11.10.16) — 그 밖은 textContent 와 같다
        return e;
    }
    /**
     * 글을 붙이되 「다.」로 끝난 문장 뒤(빈칸 뒤 또는 한글이 바로 이어질 때)에 <br> 을 끼워 다음 문장이 새 줄 첫머리에서 시작하게 한다(2026-10-17 사용자 결정 — 설계서 §11.10.16,
     *   원문 *"~~다. 라고 문장이 끊어지면 줄바꿈 해서 다음 첫줄부터 시작되도록 하고 화면 전체는 어절 단위로 끊어지도록 모든 부분에 적용 필요."*).
     *   글은 텍스트 노드로만 넣는다(HTML 해석 없음 — 계약 §5). 빈칸은 지우지 않고 <br> 앞에 남겨 textContent 가 서버 글과 똑같다(줄 끝 빈칸은 화면에 보이지 않는다).
     *   「다.」만 문장 끝으로 본다 — 「2.4배」·「1.5~3.0m」 같은 숫자의 점, 「다.」 뒤에 닫는 괄호·따옴표·숫자가 오거나 글이 끝나면 자르지 않는다. 「다. 」로 끝난 조각(강조 토막 사이 — 다음 토막이 새 문장)은 끝에 <br>.
     * 예: appendText(p, '물에 잠깁니다. 바위 위 낚시·채취 중 고립에 주의가 요구됩니다.') → p: 「물에 잠깁니다. 」<br>「바위 위 … 요구됩니다.」 · appendText(p, '평소의 2.4배입니다') → 텍스트 하나
     * @param {Node} node @param {*} text - 문자열로 바꿔 붙인다 @returns {Node} node [연계] ← el(모든 칸) · 서버 글을 텍스트 노드로 붙이는 곳(analysisNodes·rocksLine·isolationLine·basisList·adviceLine 등) · 시험 [§11.10.16]
     */
    function appendText(node, text) {
        var t = String(text), re = /다\.(?:\s+|(?=[가-힣]))/g, at = 0, m;
        while ((m = re.exec(t))) {
            var end = m.index + m[0].length;
            node.appendChild(document.createTextNode(t.slice(at, end))); node.appendChild(document.createElement('br')); at = end;
        }
        if (at < t.length || !at) node.appendChild(document.createTextNode(t.slice(at)));
        return node;
    }
    /**
     * 단계 배지(색 상자 + 단계 말). 노랑·주황 위에는 어두운 글자. prefix 가 있으면 배지 글 앞에(「연안 주의」 — 2026-10-17 사용자 *"육상 주의 필요가 아니라 연안 주의 필요라고 명시되도록 해줘."*, §11.10.16 부터 「필요」 없음).
     * 예: chip(2,'주의') → <span class="sb-chip" style="background:#fb923c;color:#111">주의</span> · chip(2,'주의','연안') → 「연안 주의」 · 옛 판 chip(2,'주의 필요') → 「주의」(levelWord)
     * @param {number} rank @param {string} word @param {string} [prefix] @returns {HTMLElement} [연계] ← 총평·카드·분석 머리
     */
    function chip(rank, word, prefix) {
        var c = el('span', 'sb-chip', (prefix ? prefix + ' ' : '') + (word ? levelWord(word) : WORDS[rank] || '—')), bg = colorOf(rank, word);
        c.style.background = bg; c.style.color = bg !== GREY && (Number(rank) === 1 || Number(rank) === 2) ? '#111827' : '#fff';
        c.setAttribute('data-rank', String(rank));
        return c;
    }
    /**
     * KST ISO 시각을 「10월 17일(토) 08:00」으로 쓴다(글자에서 직접 — 기기 시간대와 무관). 모양이 아니면 '—'.
     * 예: kstText('2026-10-17T08:00:00+09:00') → '10월 17일(토) 08:00'
     * @param {string} iso @returns {string} [연계] ← 머리·꼬리·다음 예정
     */
    function kstText(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
        if (!m) return '—';
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return (+m[2]) + '월 ' + (+m[3]) + '일(' + DOW[d.getUTCDay()] + ') ' + m[4] + ':' + m[5];
    }
    /** 날짜만. 예: '2026-10-17' → '10월 17일(토)'. @param {string} date @returns {string} [연계] ← 머리 */
    function dateText(date) { var t = kstText(String(date || '') + 'T00:00'); return t === '—' ? '—' : t.slice(0, -6); }
    /** 「오늘/내일」 — 대상 날짜가 만든 날짜보다 뒤면 내일(서버 rules.dayWordOf 와 같은 규칙, 23시 판). 예: {targetDate:'2026-10-18',generatedAt:'2026-10-17T23:00…'} → '내일'. @param {Object} b @returns {string} [연계] ← 육상 빈 칸 문구(B6) */
    function dayWord(b) { return b && b.generatedAt && b.targetDate > String(b.generatedAt).slice(0, 10) ? '내일' : '오늘'; }
    /** 원천 열쇠들을 이름으로. 예: ['congestion','accident'] → '혼잡 예보·공식 사고예보'. @param {string[]} keys @returns {string} [연계] ← 분석 머리 */
    function sourceNames(keys) { var out = []; (keys || []).forEach(function (k) { var n = SOURCE_LABEL[k] || String(k); if (out.indexOf(n) < 0) out.push(n); }); return out.join('·'); }

    /**
     * 접히는 칸 하나(종합 예보의 하위 아코디언과 같은 모양 .marine-forecast-sub-accordion). 머리를 누르면 펼침/접힘.
     * 처음 상태(2026-10-17 사용자 *"기본적으로 총평과 권고만 아코디언이 펼쳐진 상태로 시작하고, 나머지는 접힌 상태로 시작하도록 해."* — 설계서 §11.10.16 소절):
     *   「총평과 권고」만 펼침(open true), 해상 분석·연안 분석·조석은 접힘. 펼친 상태를 기억하는 곳은 없다 — 본문을 다시 그리면(판이 바뀌면) 다시 이 처음 상태다(종전에도 다시 그리면 모두 펼침으로 돌아왔다).
     * 예: section('총평과 권고', 'overview', true) → {root, body} — body 에 내용을 붙인다 · section('해상 분석', 'sea') → 접힌 칸(aria-expanded="false")
     * @param {string} title @param {string} key - data-sb-sec(시험·스크린샷이 찾는 이름) @param {boolean} [open] - 처음 펼침(없으면 접힘)
     * @returns {{root:HTMLElement, body:HTMLElement, head:HTMLElement}}
     * [연계] ← render / 모양: style.css .marine-forecast-sub-*(해상 기상 전망 아코디언 안 칸)
     */
    function section(title, key, open) {
        var root = el('div', 'marine-forecast-sub-accordion sb-sec' + (open ? ' open' : '')), head = el('div', 'marine-forecast-sub-header'), body = el('div', 'marine-forecast-sub-body sb-sec-body');
        root.setAttribute('data-sb-sec', key);
        head.setAttribute('role', 'button'); head.tabIndex = 0;
        head.appendChild(el('span', 'marine-forecast-sub-title', title));
        var icon = el('i', 'fa-solid fa-chevron-down marine-forecast-sub-icon'); icon.setAttribute('aria-hidden', 'true'); head.appendChild(icon);
        var flip = function () { root.classList.toggle('open'); head.setAttribute('aria-expanded', String(root.classList.contains('open'))); };
        head.setAttribute('aria-expanded', String(!!open));
        head.addEventListener('click', flip);
        head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
        root.appendChild(head); root.appendChild(body);
        return { root: root, body: body, head: head };
    }
    /**
     * 「이름표 + 내용」 줄. 예: row('[특성]', '2021~2025년 선박사고 18건…') → <div class="sb-row"><span class="sb-row-k">[특성]</span><span>…</span></div>
     * @param {string} k @param {string|HTMLElement} v @returns {HTMLElement} [연계] ← 카드
     */
    function row(k, v) {
        var r = el('div', 'sb-row'); r.appendChild(el('span', 'sb-row-k', k));
        if (v && v.nodeType) r.appendChild(v); else { var sv = el('span', 'sb-row-v'); parenText(sv, v); r.appendChild(sv); }   // 긴 괄호 묶음은 통째로 다음 줄(§11.10.20 덧붙임 24)
        return r;
    }
    /**
     * 글을 붙이되 긴 괄호 묶음 「(연안사고 위험구역 1·사망사고 발생구역 1·…)」은 줄을 넘지 않게 한 덩어리(.sb-paren — inline-block)로 — 한 줄에 다 들어가면 그대로,
     *   안 들어가면 괄호부터 다음 줄로 내려가 그 줄이 글 칸 첫 글자 위치에서 시작한다(2026-10-18 사용자 *"괄호까지 한줄에 들어가면 상관없는데 한줄에 들어가지 않으면 괄호부터는 다음줄에 "위" 텍스트가 위치하는 곳부터 괄호가 시작되도록"* — 설계서 §11.10.20 덧붙임 24).
     *   판단 기준: 괄호 안 글이 10자 이상일 때만 묶는다 — 「(예상)」·「(높음, 예상)」 같은 짧은 꼬리는 앞말에 붙어 흐르는 편이 자연스럽고, 묶으면 짧은 줄에서 빈칸만 커진다. 괄호가 겹친 글(괄호 안 괄호)은 묶지 않는다.
     * 예: parenText(span, '위험구역 3곳(연안사고 위험구역 1·사망사고 발생구역 1·연안사고 다발구역 1)') → 「위험구역 3곳」<span class="sb-paren">(연안사고 …)</span>
     * @param {HTMLElement} node @param {*} text @returns {HTMLElement} node [연계] ← row·todayRow / → appendText
     */
    function parenText(node, text, fill) {
        var t = String(text === undefined || text === null ? '' : text), re = /\([^()]{10,}\)/g, at = 0, m, f = fill || appendText;   // fill = 토막 글을 붙이는 함수(numText 등 — 없으면 appendText)
        while ((m = re.exec(t))) { f(node, t.slice(at, m.index)); var ps = el('span', 'sb-paren'); f(ps, m[0]); node.appendChild(ps); at = m.index + m[0].length; }
        if (at < t.length || !at) f(node, t.slice(at));
        return node;
    }
    /**
     * 글 속 정규식 토막만 굵게(나머지는 appendText). 예: boldText(li, '사람 평소의 1.6배', NUM_RE) → 「사람 평소의 」<b class="sb-hl sb-hl-b">1.6배</b>
     * @param {HTMLElement} node @param {string} text @param {RegExp} re - g 깃발 @param {function(string):(string|null)} [cls] - 토막마다 더할 class(색) @returns {HTMLElement} node [연계] ← numText·accText
     */
    function boldText(node, text, re, cls) {
        var t = String(text), at = 0, m; re.lastIndex = 0;
        while ((m = re.exec(t))) { appendText(node, t.slice(at, m.index)); var b = el('b', 'sb-hl ' + ((cls && cls(m[0])) || 'sb-hl-b'), m[0]); node.appendChild(b); at = m.index + m[0].length; }
        appendText(node, t.slice(at)); return node;
    }
    // [오늘 예상] 수치(「1.6배」·「11m/s」·「12초」) 흰 굵게(2026-10-18 사용자 *"수치와 배는 흰색 볼드로 반영"* — 설계서 §11.10.20 덧붙임 28). 「사람 평소의」·「해안 바람」 같은 말은 기본색
    var NUM_RE = /\d+(?:\.\d+)?(?:배|m\/s|초)/g;
    /** [오늘 예상] 글 칠하기. 예: numText(li, '해안 바람 11m/s(…)') @param {HTMLElement} node @param {string} text @returns {HTMLElement} [연계] ← todayRow(parenText fill) */
    function numText(node, text) { return boldText(node, text, NUM_RE); }
    // [사고현황] 내용 줄 — 「충돌 10건」 같은 「유형 N건」 흰 굵게 · 「사망 N명」 빨강 굵게 · 「실종 N명」 주황 굵게(0명이어도 같은 색) — 쉼표·「|」·「인명피해」는 기본색
    //   (2026-10-18 사용자 *"사고와 건수 흰색 텍스트"* · *"여기도 사망, 실종 반영안되었네 스타일 반영"* — 설계서 §11.10.20 덧붙임 26·27)
    var ACC_RE = /사망 \d+명|실종 \d+명|[^\s,|]+ \d+건/g;
    /** [사고현황] 글 칠하기. 예: accText(span, '충돌 5건, 전복 2건 | 인명피해 사망 0명, 실종 0명') @param {HTMLElement} node @param {string} text @returns {HTMLElement} [연계] ← seaCard·seaCardBadged·landCardV19 */
    function accText(node, text) { return boldText(node, text, ACC_RE, function (x) { return /^사망/.test(x) ? 'sb-hl-red sb-acc-death' : /^실종/.test(x) ? 'sb-acc-missing' : 'sb-hl-b sb-acc-n'; }); }
    /**
     * 해역 카드 [사고현황('21~'25년)] — 이름표 한 줄, 그 아래 내용 줄(「충돌 2건, 좌초 1건 | 인명피해 사망 0명, 실종 0명」 — 연안 카드 [사고현황] 아래 줄과 같은 .sb-acc-line).
     *   2026-10-18 사용자 결정(설계서 §11.10.22 B — #39 「해역 카드 [사고현황('21~'25년)] 내용을 다음 줄로, 연안 카드 사고현황과 같은 모양」, 시안 Sea.dc.html·Traffic.dc.html 의 두 줄 모양).
     * 예: seaAccRows(card, {label:"사고현황('21~'25년)", text:'충돌 2건, 좌초 1건 | 인명피해 사망 0명, 실종 0명'}) → [사고현황('21~'25년)] / 충돌 2건, …
     * @param {HTMLElement} card @param {Object} t - card.traits(label·text) @returns {void} [연계] ← seaCard(v14·v15 판)·seaCardBadged / → row·accText
     */
    function seaAccRows(card, t) {
        card.appendChild(row('[' + (t.label || '사고현황') + ']', el('span', 'sb-row-v')));
        var line = accText(el('p', 'sb-acc-line'), t.text); line.setAttribute('data-sb-acc-line', 'sea'); card.appendChild(line);   // 「유형 N건」·사망·실종 칠하기(§11.10.20 덧붙임 26·27)
    }
    /** 글 목록. 예: list(['15~21시 공식 사고예보 \'주의\'']) → <ul class="sb-list"><li>…</li></ul>. @param {string[]} items @returns {HTMLElement} */
    function list(items) { var u = el('ul', 'sb-list'); (items || []).forEach(function (x) { u.appendChild(el('li', '', x)); }); return u; }

    /**
     * 카드 아래 [위험예측에서 보기 ›] 버튼(§11.4). opts.links 가 거짓(관리자 미리보기)이면 만들지 않는다.
     * 예: linkBtn({kind:'coast',id:'50110|협재해수욕장',date:'2026-10-17'}, opts) → <button class="sb-link">위험예측에서 보기 ›</button>
     * @param {Object} target - RiskForecast.openAt 에 넘길 것 @param {Object} opts - render 옵션(onLink) @returns {HTMLElement|null}
     * [연계] ← seaCard·landCard / → opts.onLink(station_briefing.js openInRisk)
     */
    function linkBtn(target, opts) {
        if (!opts || opts.links === false || typeof opts.onLink !== 'function' || !target) return null;
        var b = el('button', 'sb-link', '위험예측에서 보기 ›'); b.type = 'button';
        b.addEventListener('click', function (e) { e.stopPropagation(); opts.onLink(target, b); });
        return b;
    }
    /**
     * 해역 카드 제목 — 끝의 해구 괄호 「(223-9해구)」만 작은 글·굵게 없음(span.sb-card-haegu — 제목보다 2pt 작게, station_briefing.css). 글은 textContent 로만(제목 textContent 는 서버 글 그대로).
     * 2026-10-18 사용자 *"이 브리핑 카드에서도 해구를 표현하는 부분은 2포인트 줄이고 볼드 없애줘"*(설계서 §11.10.29) — 본문 속 해역 링크(「경북북부앞바다(75해구)」)는 대상 아님.
     * 예: seaCardName('성산포 북방 3.9해리 해역(223-9해구)') → <strong class="sb-card-name">성산포 북방 3.9해리 해역<span class="sb-card-haegu">(223-9해구)</span></strong> · 괄호 없으면 글 하나
     * @param {string} name @returns {HTMLElement} [연계] ← seaCard
     */
    function seaCardName(name) {
        var m = /\([^()]*해구\)$/.exec(name), s = el('strong', 'sb-card-name', m ? name.slice(0, m.index) : name);
        if (m) s.appendChild(el('span', 'sb-card-haegu', m[0]));
        return s;
    }
    /**
     * 해역 카드 하나 — 「○○ 방위 N해리 해역(해구)」, 단계·출처 꼬리표, 줄들, 바로가기.
     * 규칙 v14 카드(서버 advice 가 있음 — 2026-10-17 사용자 결정, 설계서 §11.10.13): [사고현황('21~'25년)](traits.label·text) → [기상 예보](today.weatherLines + today.forecast)
     *   → [그 밖의 근거](today.otherLines — 꼬리표와 같은 줄은 서버가 이미 뺌) → 「… 사고가 많이 기록되었습니다」(historyNote) → 맨 끝 [권고](advice).
     *   사용자 원문 *"[사고현황('21~'25년)] 충돌 5건, 전복 2건, 좌초 1건 | 인명피해 사망 0명, 실종 0명"* · *"오늘 예상보다는 [기상 예보] 라고 표현"* · *"[권고] … 이렇게 마지막에 표현"*.
     * 그 전 판(advice 없음)은 종전 [특성]·[오늘 예상]·문장 그대로.
     * 규칙 v16 카드(badges 있음 — §11.10.15)는 seaCardBadged(출처별 배지 → [사고현황] → 한 줄 → [기상 예보] → [권고]), v14·v15 카드는 아래 종전 꼬리표·줄 순서 그대로.
     * 예: seaCard({name:'보령 서방 4.1해리 해역(174-3해구)',rank:2,word:'주의 필요',sourceLabel:"해양사고 위험예보 '주의'",window:'18~24시',traits:{label:"사고현황('21~'25년)",text:'충돌 5건, … | 인명피해 사망 0명, 실종 0명'},
     *            today:{forecast:'최대 파고 0.1m·풍속 7.5m/s로 잔잔한 바다일 것으로 예상됩니다(대해구 174 예보).',weatherLines:[],otherLines:[]},historyNote:'…',advice:'18~24시 이 해역은 …'}, opts)
     * @param {Object} c - briefing.sea.cards[] @param {Object} opts @returns {HTMLElement}
     * [연계] ← render / → seaCardBadged·seaCardLink / 서버: station_briefing_rules.seaSection toCard
     */
    function seaCard(c, opts) {
        var card = el('div', 'sb-card'); card.setAttribute('data-sb-card', 'sea');
        var head = el('div', 'sb-card-head'); head.appendChild(seaCardName(c.name || '이름 없는 해역')); head.appendChild(chip(c.rank, c.word)); card.appendChild(head);
        if (Array.isArray(c.badges) && c.badges.length && typeof c.advice === 'string') { seaCardBadged(card, c); return seaCardLink(card, c, opts); }   // §11.10.15 규칙 v16 카드
        var tags = el('div', 'sb-tags');
        if (c.sourceLabel) tags.appendChild(el('span', 'sb-tag', c.sourceLabel));
        if (c.window) tags.appendChild(el('span', 'sb-tag sb-tag-time', c.window));
        if (tags.childNodes.length) card.appendChild(tags);
        if (typeof c.advice === 'string') {
            var t = c.traits || {}, td = c.today || {}, one = function (xs) { return xs.length === 1 ? xs[0] : list(xs); };
            if (t.text) seaAccRows(card, t);   // 이름표 다음 줄에 내용(§11.10.22 B)
            var wx = (Array.isArray(td.weatherLines) ? td.weatherLines : []).concat(td.forecast ? [td.forecast] : []), other = Array.isArray(td.otherLines) ? td.otherLines : [];
            if (wx.length) card.appendChild(row('[기상 예보]', one(wx)));
            if (other.length) card.appendChild(row('[그 밖의 근거]', one(other)));
            if (c.historyNote) card.appendChild(historyNoteNode(c.historyNote));   // 사고 유형 흰 굵게(§11.10.20 덧붙임 25)
            card.appendChild(adviceRow(c.advice));   // §11.10.20 덧붙임 9 — 총평 (권고)와 같은 상자
        } else {
            if (c.traits && c.traits.text) card.appendChild(row('[특성]', c.traits.text));
            var lines = c.today && Array.isArray(c.today.lines) ? c.today.lines : [];
            if (lines.length) card.appendChild(row('[오늘 예상]', list(lines)));
            if (c.sentence) card.appendChild(el('p', 'sb-sentence', c.sentence));
        }
        return seaCardLink(card, c, opts);
    }
    /**
     * 해역 카드 맨 끝 [위험예측에서 보기 ›] 단추를 붙인다(옛 판·배지 판 공용 — §11.10.15 에서 seaCard 끝부분을 떼어 냄, 동작은 그대로).
     * 예: seaCardLink(card, {link:{gridId:'GR4_1',lon:126.2,lat:33.4,t:'…'}}, opts) → 단추가 붙은 card
     * @param {HTMLElement} card @param {Object} c - 해역 카드 @param {Object} opts @returns {HTMLElement} card [연계] ← seaCard / → linkBtn(GR4 칸 id·좌표·시각)
     */
    function seaCardLink(card, c, opts) {
        var lk = c.link || {}, lon = Number(lk.lon), lat = Number(lk.lat);
        var b = linkBtn(Number.isFinite(lon) && Number.isFinite(lat) ? { kind: 'marine', id: lk.gridId || 'point', location: { lon: lon, lat: lat }, t: lk.t || null } : null, opts);
        if (b) card.appendChild(b);
        return card;
    }
    /**
     * 출처별 배지 묶음 — 배지마다 「18~24시 해양사고 위험예보 '주의'(KOMSA)」(글자 색 = 그 예보 자체 등급의 색) + 바로 아래 상세(서버 detail, 없으면 없음).
     * 2026-10-17 사용자 결정(설계서 §11.10.15) 원문 *"이미지 2는 ##~##시 해양사고 위험예보 '주의'(KOMSA) 라고 표출하고, 색상은 주의 수준의 색상으로 반영(텍스트)"*
     *   · *"혼잡예보도 매우 높음에 해당되는 색상이 노란색이니 ? 뭔가 빨간색으로 반영되어야 할 것 같은데"* — 색 단계(rank)는 서버가 정한다(혼잡 높음 → 주의 색 · 매우높음 → 경계 색 — 위험예측 지도와 같은 대응).
     * 상세는 표(같은 날 시안 ④판 사용자 확정 *"여기도 표로 정리하면 좋겠어. 시간대별로"*): 서버 detail[] = {title, head, rows} → 제목 줄 + 표(srcbTable). 규칙 v16 판의 글 줄(string)은 종전 한 줄 그대로.
     * 글자 색: 관심·주의 = colorOf(rank) 를 글자에, 경계 = .sb-srcb[data-rank="3"](station_briefing.css — 어두운 바탕 위 대비 4.5 이상 밝은 빨강, §11.10.11 분석 문단과 같은 색). 서버 글은 textContent 로만.
     * 예: seaBadges([{source:'accident',text:"18~24시 해양사고 위험예보 '주의'(KOMSA)",rank:2,detail:[]}]) → <div class="sb-srcbs"><span class="sb-srcb" data-rank="2" style="color:#fb923c">18~24시 …</span></div>
     * §11.10.29(시안 A *"이게 낫겠어."*): 해양사고 위험예보·기상특보 상세가 있으면 배지를 모두 먼저 → 가로 표 하나(seaGrid) → 나머지 상세(혼잡·해구 예보 세로 표). 배지 글은 굵게 없음(CSS — *"이런 뱃지는 모두 볼드 빼도록 해자."*).
     * §11.10.31: 혼잡 예보 상세 표는 한 줄에 두 시각(pairTable).
     * @param {Object[]} badges - 해역 카드 badges(서버 station_briefing_rules.seaBadges) @returns {HTMLElement} [연계] ← seaCardBadged / → colorOf·srcbTable·pairTable·gridDetail·seaGrid
     */
    function seaBadges(badges) {
        var box = el('div', 'sb-srcbs'); box.setAttribute('data-sb-badges', String(badges.length));
        var grid = badges.filter(function (g) { return gridDetail(g); });
        var badge = function (g) {
            var r = Number(g.rank), s = el('span', 'sb-srcb', g.text || '');
            s.setAttribute('data-rank', String(r)); s.setAttribute('data-sb-src', String(g.source || ''));
            if (r !== 3) s.style.color = colorOf(r);
            box.appendChild(s);
        };
        var details = function (g) { (Array.isArray(g.detail) ? g.detail : []).forEach(function (d) { if (grid.indexOf(g) >= 0 && d === gridDetail(g)) return; box.appendChild(d && typeof d === 'object' ? (g.sub === 'congestion' ? pairTable(d) : srcbTable(d)) : el('p', 'sb-srcb-det', d)); }); };   // 혼잡 예보 표는 한 줄에 두 시각(§11.10.31)
        // §11.10.29: 가로 표에 들어갈 상세(해양사고 위험예보·기상특보)가 있으면 배지를 모두 먼저 → 가로 표 하나 → 나머지 상세(혼잡·해구 예보 세로 표 — 종전 꼴). 없으면 종전처럼 배지마다 바로 아래 상세.
        if (grid.length) { badges.forEach(badge); box.appendChild(seaGrid(grid)); badges.forEach(details); }
        else badges.forEach(function (g) { badge(g); details(g); });
        return box;
    }
    /**
     * 배지의 상세 중 가로 표 한 행이 될 것 — 해양사고 위험예보(「시각 | 등급」)·기상특보(「시각 | 상태」) 표(서버 seaBadges sub 'accident'·'warning', 머리 두 칸).
     * 혼잡 예보(「시각 | 혼잡지수」)·해구 예보(「시각 | 유의파고 | 풍속」)는 숫자 칸이라 세로 표 그대로(사용자 결정은 위 두 표만 — §11.10.29 「못 한 것」). 규칙 v16 판(상세가 글 줄)은 null.
     * 예: gridDetail({sub:'accident', detail:[{title:'KOMSA 해양사고 위험예보', head:['시각','등급'], rows:[…]}]}) → 그 detail · gridDetail({sub:'congestion', …}) → null
     * @param {Object} g - badges[] 하나 @returns {Object|null} [연계] ← seaBadges·seaGrid
     */
    function gridDetail(g) {
        if (!g || (g.sub !== 'accident' && g.sub !== 'warning')) return null;
        var d = (Array.isArray(g.detail) ? g.detail : [])[0];
        return d && typeof d === 'object' && Array.isArray(d.head) && d.head.length === 2 && Array.isArray(d.rows) && d.rows.length ? d : null;
    }
    // ── §11.10.29 (c) 가로 표 칸 색 — 고르는 곳은 여기 한 곳(gridRank). 사용자에게 「특보 발효 칸 색」을 묻는 중이라 답 전까지는 배지와 같은 규칙:
    //    해양사고 위험예보 칸 = 그 등급 색(주의 주황 · 경계 빨강) · 특보 「발효 중」 = 주의보 주황 · 경보 빨강 · 「예비특보」·「해제 뒤」 = 노랑(분석 문단 특보 말과 같은 색).
    //    「발효 = 빨강」으로 바꾸려면 아래 GRID_WARN_ON_RANK 를 3 으로(null = 특보 종류대로).
    var GRID_WARN_ON_RANK = null;
    /**
     * 가로 표 칸 하나의 색 단계(0~3, 칸 글자 색 = colorOf · 3 = CSS 밝은 빨강). 색을 안 칠하면 null.
     * 예: gridRank({text:'주의',rank:2}, g) → 2 · gridRank('발효 중', {name:'풍랑주의보'}) → 2 · gridRank('발효 중', {name:'풍랑경보'}) → 3 · gridRank('예비특보', g) → 1 · gridRank('—', g) → null
     * @param {string|{text:string,rank:number}} c - 서버 표 칸 @param {Object} g - 그 배지 @returns {number|null} [연계] ← seaGrid
     */
    function gridRank(c, g) {
        if (c && typeof c === 'object') return Number.isFinite(Number(c.rank)) ? Number(c.rank) : null;
        var t = String(c || '');
        if (/^발효/.test(t)) return GRID_WARN_ON_RANK != null ? GRID_WARN_ON_RANK : /경보$/.test(String(g.name || '').replace(/ (예비특보|해제 뒤)$/, '')) ? 3 : 2;   // 「풍랑경보」 → 3 · 「풍랑주의보」 → 2
        if (/예비특보|해제 뒤/.test(t)) return 1;
        return null;
    }
    /**
     * 해역 카드 가로 표 — 열 = 시각(행들의 시각을 모은 것, 보통 12·15·18·21시), 행 = 「해양사고 위험예보(KOMSA)」·「풍랑주의보(기상청)」 + 특보구역 작은 회색 글.
     * 2026-10-18 사용자 *"표로 인해서 자리가 너무 많이 차지되는것 같지 않아 ? … 표 자체는 좋은데 데이터 정리방법이 적절치 않은 것 같은데 ?"* → 시안 A *"이게 낫겠어."*(설계서 §11.10.29) — 종전 세로 표 두 개(「시각 | 등급」·「시각 | 상태」 4줄씩).
     * 한 행의 칸 값이 모든 열에서 같으면 한 칸으로 합쳐 「12~24시 주의」(창 = 배지 window — 서버 runsText, 없으면 첫 열~마지막 열+3시), 다르면 칸마다(그 행에 없는 시각 = 「—」).
     * 칸 글은 굵지 않게(사용자 *"여기서는 볼드 빼줘."* — CSS .sb-grid-v), 색 = gridRank. 서버 글은 textContent 로만.
     * 예: seaGrid([{sub:'accident',name:'해양사고 위험예보',agency:'KOMSA',window:'12~24시',detail:[{title:'KOMSA 해양사고 위험예보',head:['시각','등급'],rows:[['12시',{text:'주의',rank:2}],…4줄]}]}])
     *     → <div class="sb-srcb-det sb-srcb-tab sb-grid"><div class="sb-srcb-tblw"><table class="sb-srcb-tbl sb-grid-tbl"><thead>(빈칸)·12시·15시·18시·21시</thead><tbody><tr><td>해양사고 위험예보(KOMSA)</td><td colspan="4">12~24시 주의</td></tr></tbody></table></div></div>
     * @param {Object[]} list - gridDetail 이 있는 배지들(배지 순서) @returns {HTMLElement} [연계] ← seaBadges / → gridDetail·gridRank·colorOf · station_briefing.css(.sb-grid-*)
     */
    function seaGrid(list) {
        var hours = [];
        list.forEach(function (g) { var prev = -1; gridDetail(g).rows.forEach(function (r) { var h = String(r[0]), k = hours.indexOf(h); if (k < 0) { hours.splice(prev + 1, 0, h); k = prev + 1; } prev = k; }); });
        var wrap = el('div', 'sb-srcb-det sb-srcb-tab sb-grid'), sc = el('div', 'sb-srcb-tblw'), t = el('table', 'sb-srcb-tbl sb-grid-tbl'), hr = el('tr'), th = el('thead'), tb = el('tbody');
        wrap.setAttribute('data-sb-grid', String(list.length));
        hr.appendChild(el('th', 'sb-grid-name')); hours.forEach(function (h) { hr.appendChild(el('th', 'sb-grid-h', h)); }); th.appendChild(hr); t.appendChild(th);
        list.forEach(function (g) {
            var d = gridDetail(g), tr = el('tr'), base = String(g.name || '').replace(/ (예비특보|해제 뒤)$/, ''), agency = String(g.agency || '');
            var nm = el('td', 'sb-grid-name', base ? base + (agency ? '(' + agency + ')' : '') : String(d.title || ''));
            // 특보구역 — 서버 표 제목 「기상청 {구역} {특보}」에서 기관·특보 이름을 뗀 나머지(해양사고 위험예보 제목 「KOMSA 해양사고 위험예보」는 남는 것 없음)
            var title = String(d.title || ''), zone = title.indexOf(agency + ' ') === 0 ? title.slice(agency.length + 1) : title;
            zone = base && zone.slice(-base.length) === base ? zone.slice(0, -base.length).trim() : '';
            if (zone) { nm.appendChild(el('br')); nm.appendChild(el('span', 'sb-grid-zone', zone)); }
            tr.appendChild(nm);
            var by = {}; d.rows.forEach(function (r) { by[String(r[0])] = r[1]; });
            var txt = function (c) { return c && typeof c === 'object' ? String(c.text) : String(c == null ? '' : c); };
            var first = d.rows[0][1], same = hours.every(function (h) { return Object.prototype.hasOwnProperty.call(by, h) && txt(by[h]) === txt(first); });
            var cell = function (c, text) {
                var td = el('td', 'sb-grid-v', text), r = c == null ? null : gridRank(c, g);
                if (r != null) { td.setAttribute('data-rank', String(r)); if (r !== 3) td.style.color = colorOf(r); }
                return td;
            };
            if (same) {
                var win = g.window || (parseInt(hours[0], 10) + '~' + (parseInt(hours[hours.length - 1], 10) + 3) + '시');
                var td = cell(first, win + ' ' + txt(first)); td.colSpan = hours.length; td.setAttribute('data-sb-merged', 'true'); tr.appendChild(td);
            } else hours.forEach(function (h) { tr.appendChild(Object.prototype.hasOwnProperty.call(by, h) ? cell(by[h], txt(by[h])) : cell(null, '—')); });
            tb.appendChild(tr);
        });
        t.appendChild(tb); sc.appendChild(t); wrap.appendChild(sc);
        return wrap;
    }
    /**
     * 배지 상세 표 — 제목(서버 글 「KOMSA 해양사고 위험예보」·「232해구 예보」 등) + 표 「시각 | 등급」 같은 꼴(설계서 §11.10.15 「2026-10-17 사용자 확정(시안 ④판)」).
     * 칸은 서버 글 그대로(textContent), {text, rank} 칸은 그 등급 색 굵게(관심·주의 = colorOf, 경계 = CSS [data-rank="3"] 밝은 빨강 — 배지와 같은 규칙). 좁은 화면에서는 표 상자 안 가로 스크롤.
     * 예: srcbTable({title:'KOMSA 해양사고 위험예보', head:['시각','등급'], rows:[['18시',{text:"'주의'",rank:2}]]}) → <div class="sb-srcb-det sb-srcb-tab"><p class="sb-srcb-dt">KOMSA …</p><div class="sb-srcb-tblw"><table class="sb-srcb-tbl">…</table></div></div>
     * @param {Object} d - badges[].detail[] 하나 @returns {HTMLElement} [연계] ← seaBadges / → colorOf
     */
    function srcbTable(d) {
        var wrap = el('div', 'sb-srcb-det sb-srcb-tab');
        if (d.title) wrap.appendChild(el('p', 'sb-srcb-dt', d.title));
        wrap.appendChild(cellsTable(d.head, d.rows));
        return wrap;
    }
    /**
     * 혼잡 예보 상세 표를 한 줄에 두 시각씩 그린다 — 머리 「시각 | 혼잡지수 | 시각 | 혼잡지수」, 행 = 시간 순서로 왼쪽 → 오른쪽, 위 → 아래. 시각이 홀수 개면 마지막 행 오른쪽 두 칸은 빈칸.
     * 2026-10-18 사용자 *"여기 시각을 가로에 시각 혼잡지수 시각 혼잡지수 이렇게 한줄에 2개 요소가 들어가도록 해줘"*(설계서 §11.10.31) — 종전 세로 한 줄에 하나(srcbTable).
     * 칸(혼잡지수 색·「(매우높음)」 단계 말·글자 크기)은 cellsTable 그대로. 머리가 두 칸이 아닌 꼴(옛 판 등)은 종전 표(srcbTable). 해역 카드 혼잡 배지 상세에만 쓴다(해구 예보·「기상특보 현황」 표는 그대로).
     * 예: pairTable({title:'KOMSA 혼잡 예보', head:['시각','혼잡지수'], rows:[['13시',a],['15시',b],['18시',c]]}) → 머리 시각·혼잡지수·시각·혼잡지수 · 행 [13시,a,15시,b] / [18시,c,'','']
     * @param {Object} d - badges[].detail[] 하나(sub 'congestion') @returns {HTMLElement} [연계] ← seaBadges / → srcbTable·cellsTable · station_briefing.css(.sb-srcb-pair)
     */
    function pairTable(d) {
        if (!Array.isArray(d.head) || d.head.length !== 2 || !Array.isArray(d.rows)) return srcbTable(d);
        var rows = [];
        for (var i = 0; i < d.rows.length; i += 2) rows.push([].concat(d.rows[i], d.rows[i + 1] || ['', '']));
        var w = srcbTable({ title: d.title, head: d.head.concat(d.head), rows: rows }); w.classList.add('sb-srcb-pair'); w.setAttribute('data-sb-pair', String(d.rows.length));
        return w;
    }
    /**
     * 표 하나(머리 + 칸) — 배지 상세 표·「기상특보 현황」 표 공용. 칸 = 글 또는 {text, rank}(그 단계 색 굵게 — 관심·주의 = colorOf, 경계 = CSS [data-rank="3"]). 글은 textContent.
     * 좁으면 표 상자(.sb-srcb-tblw) 안에서만 가로 스크롤. 예: cellsTable(['시각','등급'], [['18시',{text:'주의',rank:2}]]) → <div class="sb-srcb-tblw"><table class="sb-srcb-tbl">…</table></div>
     * @param {string[]} head @param {Array<Array<string|{text:string,rank:number}>>} rows @returns {HTMLElement} [연계] ← srcbTable·warnBox / → colorOf
     */
    function cellsTable(head, rows) {
        var sc = el('div', 'sb-srcb-tblw'), t = el('table', 'sb-srcb-tbl'), hr = el('tr'), th = el('thead'), tb = el('tbody');
        (Array.isArray(head) ? head : []).forEach(function (h) { hr.appendChild(el('th', '', h)); }); th.appendChild(hr); t.appendChild(th);
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
            var tr = el('tr');
            (Array.isArray(r) ? r : []).forEach(function (c) {
                var o = c && typeof c === 'object', td = el('td', o ? 'sb-srcb-grade' : '', o ? c.text : c);
                if (o && Number.isFinite(Number(c.rank))) { td.setAttribute('data-rank', String(Number(c.rank))); if (Number(c.rank) !== 3) td.style.color = colorOf(Number(c.rank)); }
                tr.appendChild(td);
            });
            tb.appendChild(tr);
        });
        t.appendChild(tb); sc.appendChild(t);
        return sc;
    }
    /**
     * 「기상특보 현황」 상자 — 둥근 테두리 상자 + 제목 + 표 「특보구역 | 특보 | 시각」 + 「기상청 … 발표」 (+ 창이면 ✕ 와 맨 아래 해제 뒤 한 문장).
     * 2026-10-17 시안 ⑤판 사용자 확정(설계서 §11.10.16 소절 E1·E2) — 원문 *"이 박스를 꼭 이렇게 만들어야 하니 위에 디자인한것처럼 만들자."*: 창 안과 「해상 분석 근거 상세」 안이 같은 상자(이 함수 하나).
     * 맨 아래 문장(서버 W.note — 해제 예고·해제가 있을 때만, 창에서만)은 「이틀 동안 … 많았습니다」를 굵게, 그 안 「1.2~1.3배」는 노랑(colorOf(1) — 분석 문단 예비특보 강조와 같은 색)
     *   — 원문 *"이틀동안부터 많았습니다까지 볼드, 수치는 색상을 노란색으로 변경"*. 글은 서버 글을 토막으로 나눠 span 의 textContent 로만.
     * 예: warnBox({title:'기상특보 현황', head:['특보구역','특보','시각'], rows:[['제주도북부앞바다','풍랑주의보','06~09시 해제 예고']], issued:'기상청 10월 17일 14:00 발표', note:'…'}, true)
     * @param {Object} Wt - summary.sea/land.warnings(서버 rules.warnTable) @param {boolean} inDialog - 창 안(✕·맨 아래 문장 있음) @returns {HTMLElement} [연계] ← openWarnPopup·summaryBodyV3(해상 근거) / → cellsTable·colorOf
     */
    function warnBox(Wt, inDialog) {
        var box = el('div', 'sb-wxbox'); box.setAttribute('data-sb-warnbox', inDialog ? 'dialog' : 'basis');
        var head = el('div', 'sb-wxbox-head'), t = el('p', 'sb-wxbox-t', Wt.title || '기상특보 현황'); t.id = 'sb-wxbox-t' + (++xSeq); head.appendChild(t);
        if (inDialog) { var x = el('button', 'sb-mapdlg-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.setAttribute('data-sb-map-close', ''); head.appendChild(x); }
        box.appendChild(head); box.appendChild(cellsTable(Wt.head, Wt.rows));
        if (Wt.issued) box.appendChild(el('p', 'sb-small sb-wxbox-iss', Wt.issued));
        if (inDialog && Wt.note) {
            var n = String(Wt.note), a = n.indexOf('이틀 동안'), z = n.indexOf('많았습니다'), np = el('p', 'sb-wxbox-note'); np.setAttribute('data-sb-warn-note', '');
            if (a >= 0 && z > a) {
                z += '많았습니다'.length; appendText(np, n.slice(0, a));
                var bd = el('b', 'sb-wxbox-em'), mid = n.slice(a, z), mm = /\d+(?:\.\d+)?~\d+(?:\.\d+)?배/.exec(mid);
                if (mm) { appendText(bd, mid.slice(0, mm.index)); var y = el('span', 'sb-wxbox-num', mm[0]); y.style.color = colorOf(1); bd.appendChild(y); appendText(bd, mid.slice(mm.index + mm[0].length)); } else appendText(bd, mid);
                np.appendChild(bd); appendText(np, n.slice(z));
            } else appendText(np, n);
            box.appendChild(np);
        }
        return box;
    }
    /**
     * 「기상특보 현황」 창을 연다 — 팝업 지도 창과 같은 틀(openMapPopup — Esc·✕·바깥·하드웨어 뒤로가기·초점), 머리 없이 상자(warnBox)가 제목·✕ 를 가진다.
     * 예: openWarnPopup(b.summary.sea.warnings) @param {Object} Wt @returns {void} [연계] ← analysisNodes(특보 말 링크)·warnFallback / → openMapPopup·warnBox
     */
    function openWarnPopup(Wt) {
        openMapPopup(Wt.title || '기상특보 현황', function (body) { body.appendChild(warnBox(Wt, true)); }, 'warn', true);
    }
    /**
     * 규칙 v16 해역 카드 본문(2026-10-17 사용자 결정 — 설계서 §11.10.15): 출처별 배지(+상세 줄) → [사고현황('21~'25년)] → 「… 많이 기록되었습니다」(사용자 *"이 문구는 사고현황 아래쪽으로 가야함"*)
     *   → (§11.10.23) [최근 14일 선박 동향](card.traffic 이 있을 때만)
     *   → [기상 예보](바다 상태 흐름 문장 today.forecast) → [권고]. 종전 꼬리표 두 개(sourceLabel·노란 시간 칩)는 배지가 대신한다.
     *   특보 줄(today.weatherLines)·[그 밖의 근거](today.otherLines — 해양사고 위험예보·혼잡 줄)는 그리지 않는다 — 같은 출처가 모두 배지·상세 줄에 있다(서버는 AI 입력용으로 그대로 둔다).
     * 예: seaCardBadged(card, {badges:[…], traits:{label:"사고현황('21~'25년)",text:'충돌 2건, …'}, historyNote:'…', today:{forecast:'…'}, advice:'18~24시 …'})
     * @param {HTMLElement} card @param {Object} c - briefing.sea.cards[] (badges 있음) @returns {void} [연계] ← seaCard / → seaBadges·row
     */
    function seaCardBadged(card, c) {
        var t = c.traits || {}, td = c.today || {};
        card.appendChild(seaBadges(c.badges));
        if (t.text) seaAccRows(card, t);   // 이름표 다음 줄에 내용(§11.10.22 B)
        if (c.historyNote) card.appendChild(historyNoteNode(c.historyNote));   // 사고 유형 흰 굵게(§11.10.20 덧붙임 25)
        // [최근 14일 선박 동향](2026-10-18 사용자 확정 *"좋아 이렇게 하자."* — 설계서 §11.10.23, 시안 Traffic.dc.html ⑦판): 서버 card.traffic 글 그대로(textContent).
        //   서버가 null(하루 평균 1척 미만·선박 칸 없음·14일 미달)이거나 옛 판(필드 없음)이면 줄 없음. 둘째 줄은 이름표 오른쪽 글 칸 시작에서(.sb-row 두 칸 — 걸린 들여쓰기)
        if (c.traffic && c.traffic.text) { var tv = el('span', 'sb-row-v sb-traffic'); appendText(tv, c.traffic.text); var tr = row('[' + (c.traffic.label || '최근 14일 선박 동향') + ']', tv); tr.setAttribute('data-sb-traffic', ''); card.appendChild(tr); }
        if (td.forecast) { var fv = el('span', 'sb-row-v'); forecastNodes(fv, td.forecast); card.appendChild(row('[기상 예보]', fv)); }   // §11.10.20 덧붙임 19 — 수치·바다 상태 말·특보 구절 굵게
        card.appendChild(adviceRow(c.advice));   // §11.10.20 덧붙임 9 — 총평 (권고)와 같은 상자(글자 크기는 카드 그대로)
    }
    /**
     * 육상(관광지) 카드 하나 — 이름·단계 딱지 → 줄들 → 일부 자료 확인 불가 → 바로가기.
     * 규칙 v19 카드(서버 advice·accidents 있음 — 2026-10-18 사용자 결정, 설계서 §11.10.20, 시안 Land.dc.html ⑥판 원문 「좋아. 이대로 반영토록 하자.」)는 landCardV19,
     *   그 전 판(advice 없음)은 종전 꼬리표·[특성]·[오늘 예상]·문장 그대로. [오늘 예상]은 두 판 모두 항목이 하나면 점 없이 글(원문 *"복수인 경우에는 점을 붙이고 복수가 아닌 경우에는 그대로 점 없이"*).
     * 예: landCard({name:'모충사',rank:2,word:'주의',indexBadge:{text:"연안 위험지수 69 '높음'",rank:2},hazardTable:{…},accidents:{…},today:{changes:['사람 평소의 1.6배']},advice:'…'}, opts)
     * @param {Object} c - briefing.land.cards[] @param {Object} opts @returns {HTMLElement}
     * [연계] ← render / → landCardV19·todayRow·linkBtn(관광지 id·날짜) / 서버: station_briefing_rules.landSection
     */
    function landCard(c, opts) {
        var card = el('div', 'sb-card'); card.setAttribute('data-sb-card', 'land');
        var head = el('div', 'sb-card-head'); head.appendChild(el('strong', 'sb-card-name', c.name || '이름 없는 장소')); head.appendChild(chip(c.rank, c.word)); card.appendChild(head);
        var ch = c.today && Array.isArray(c.today.changes) ? c.today.changes : [];
        if (typeof c.advice === 'string' && c.accidents) landCardV19(card, c, ch);
        else {
            if (c.sourceLabel) { var tags = el('div', 'sb-tags'); tags.appendChild(el('span', 'sb-tag', c.sourceLabel)); card.appendChild(tags); }
            if (c.traits && c.traits.text) card.appendChild(row('[특성]', c.traits.text));
            if (ch.length) card.appendChild(todayRow(ch));
            if (c.sentence) card.appendChild(el('p', 'sb-sentence', c.sentence));
        }
        if (Array.isArray(c.missing) && c.missing.length) card.appendChild(el('p', 'sb-miss', '일부 자료 확인 불가: ' + sourceNames(c.missing)));
        var lk = c.link || {}, lon = Number(lk.lon), lat = Number(lk.lat);
        var b = linkBtn(lk.spotId ? { kind: 'coast', id: lk.spotId, date: lk.date || null, location: Number.isFinite(lon) && Number.isFinite(lat) ? { lon: lon, lat: lat } : null } : null, opts);
        if (b) card.appendChild(b);
        return card;
    }
    /**
     * 「이 해역(이곳)에서는 집계 기간 중 충돌 사고가 많이 기록되었습니다.」 — 사고 유형 말을 흰 굵게(2026-10-18 사용자 *"충돌사고를 강조하도록 해줘."* · *"다른 사고 유형이 있다면 그 사고유형도 강조해야해"* — 설계서 §11.10.20 덧붙임 25).
     *   「집계 기간 중 {유형들} 사고가」의 유형 말마다(「·」·「와 」·「과 」·「, 」로 나뉜 각 말) 굵게, 마지막 유형은 「 사고」까지. 꼴이 다르면 글 그대로.
     * 예: historyNoteNode('이 해역에서는 집계 기간 중 충돌 사고가 많이 기록되었습니다.') → …<b class="sb-hl sb-hl-b">충돌 사고</b>가 … · '…중 충돌·전복 사고가…' → <b>충돌</b>·<b>전복 사고</b>
     * @param {string} text @returns {HTMLElement} p.sb-sentence [연계] ← seaCard·seaCardBadged·landCardV19 / → appendText
     */
    function historyNoteNode(text) {
        var p = el('p', 'sb-sentence'), t = String(text), m = /(집계 기간 중 )(.+?)( 사고)(?=가 많이 기록)/.exec(t);
        if (!m) { appendText(p, t); return p; }
        var a = m.index + m[1].length, parts = m[2].split(/(·|와 |과 |, )/);
        appendText(p, t.slice(0, a));
        parts.forEach(function (x, i) { if (i % 2) { p.appendChild(document.createTextNode(x)); return; } p.appendChild(el('b', 'sb-hl sb-hl-b sb-acc-type', x + (i === parts.length - 1 ? m[3] : ''))); });
        appendText(p, t.slice(a + m[2].length + m[3].length));
        return p;
    }
    /** [오늘 예상] 줄 — 항목이 하나면 점 없이 글, 둘 이상이면 「•」 목록(§11.10.20). 예: todayRow(['사람 평소의 1.6배']) → [오늘 예상] 사람 평소의 1.6배. @param {string[]} ch @returns {HTMLElement} [연계] ← landCard·landCardV19 / → row·list */
    function todayRow(ch) { if (ch.length === 1) return row('[오늘 예상]', parenText(el('span', 'sb-row-v'), ch[0], numText)); var u = el('ul', 'sb-list'); ch.forEach(function (x) { u.appendChild(parenText(el('li'), x, numText)); }); return row('[오늘 예상]', u); }   // 수치 흰 굵게(덧붙임 28)   // 긴 괄호 묶음(§11.10.20 덧붙임 24)
    /**
     * 규칙 v19 연안 카드 본문(설계서 §11.10.20 — 시안 ⑥판): 배지 줄(「연안 위험지수 N '띠'」 글자 색 = 띠 단계 + 해수욕장이면 「해수욕장」 — 종전 [특성] 끝에서 옮김)
     *   → [위험구역] 「N개소」 링크(누르면 바로 아래 표 「구역 종류 | 개소 수 | [위치 보기]」 — hazardBox) → [사고현황('20~'24년)] 「총 N건」(N>0 이고 표가 있으면 링크 → 「연도 | 사고 종류 | 건수」 표, 처음 닫힘 · 0 이면 굵은 글자만)
     *   → 그 아래 「익수 3건, … | 인명피해 사망 N명, 실종 N명」(0건 「기록된 연안사고 없음」) → (표) → 「이곳에서는 집계 기간 중 … 많이 기록되었습니다.」 → [오늘 예상] → [권고](노랑 굵게).
     *   원문 *"위험구역 세곳이라고 놓고 하이퍼링크로 … 누르면 밑에 열리고 … 표로 정리"* · *"사고현황 오른쪽에는 총 0건 이라고 종합 표출"* · *"총 0건을 하이퍼링크로 하여 아래 표가 아코디언처럼 열리도록 … 열리고 닫히고"*.
     * 예: landCardV19(card, {indexBadge:{text:"연안 위험지수 56 '다소 높음'",rank:1},traits:{beach:true},hazardTable:{link:'4개소',rows:[…]},accidents:{label:"사고현황('20~'24년)",total:6,totalText:'총 6건',text:'익수 3건, …',table:{…},note:'…'},advice:'…'}, ['사람 평소의 1.2배','해안 바람 11m/s(…)'])
     * @param {HTMLElement} card @param {Object} c @param {string[]} ch - today.changes @returns {void} [연계] ← landCard / → hazardBox·cellsTable·expander·todayRow·row
     */
    function landCardV19(card, c, ch) {
        var bs = el('div', 'sb-srcbs sb-landbs'), ib = c.indexBadge;
        if (ib && ib.text) { var r = Number(ib.rank), s = el('span', 'sb-srcb', ib.text); s.setAttribute('data-rank', String(r)); s.setAttribute('data-sb-src', 'index'); if (r !== 3) s.style.color = colorOf(r); bs.appendChild(s); }
        if (c.traits && c.traits.beach) { var bb = el('span', 'sb-srcb sb-landb-beach', '해수욕장'); bb.setAttribute('data-sb-src', 'beach'); bs.appendChild(bb); }
        if (bs.childNodes.length) card.appendChild(bs);
        var H = c.hazardTable;
        if (H && Array.isArray(H.rows) && H.rows.length) {
            var hx = expander(H.link || '', function (panel) { return hazardBox(panel, H, c); }, 'land-hazard', false, true); hx.btn.classList.add('sb-card-lnk');
            card.appendChild(row('[위험구역]', hx.btn)); card.appendChild(hx.panel);
        } else if (H) card.appendChild(row('[위험구역]', H.count ? H.link || '' : '없음'));
        var A = c.accidents || {};
        if (A.totalText) {
            var tot = null;
            if (Number(A.total) > 0 && A.table && Array.isArray(A.table.rows) && A.table.rows.length) {
                tot = expander(A.totalText, function (panel) { var bx = el('div', 'sb-wxbox sb-accbox'); bx.appendChild(el('p', 'sb-wxbox-t', A.table.title || '연안사고 발생 현황')); bx.appendChild(cellsTable(A.table.head, A.table.rows)); panel.appendChild(bx); }, 'land-acc', false, true);
                tot.btn.classList.add('sb-card-lnk');
            }
            card.appendChild(row('[' + (A.label || '사고현황') + ']', tot ? tot.btn : el('b', 'sb-acc-total', A.totalText)));
            var line = accText(el('p', 'sb-acc-line'), A.text || ''); line.setAttribute('data-sb-acc-line', ''); card.appendChild(line);   // 「유형 N건」·사망·실종 칠하기(§11.10.20 덧붙임 26·27)
            if (tot) card.appendChild(tot.panel);
        } else if (A.text) card.appendChild(row('[' + (A.label || '사고현황') + ']', A.text));
        if (A.note) card.appendChild(historyNoteNode(A.note));   // 사고 유형 흰 굵게(§11.10.20 덧붙임 25)
        if (ch.length) card.appendChild(todayRow(ch));
        card.appendChild(adviceRow(c.advice));   // §11.10.20 덧붙임 9 — 해역 카드·총평 (권고)와 같은 상자
    }
    /**
     * [위험구역] 펼친 상자 — 제목 「위험구역」 + 표 「구역 종류 | 개소 수 | (위치 보기)」(시안 댓글 *"개소 수 로 변경"*). 줄마다 [위치 보기](그 종류 위험구역 id 가 있을 때만)를 누르면
     *   그 줄 바로 아래 줄이 펼쳐지며 지도(zoneMap — 그 종류 위험구역 폴리곤 전부 깜빡임 + 관광지 점). 원문 *"연안사고 위험구역 오른쪽에 [위치 보기] 버튼 … 아코디언처럼 펼쳐지면서 지도에 그 위치가 폴리곤으로 … 다수가 같이 표출되어도 돼. 깜빡일 수 있도록"*.
     *   칸 글은 서버 글 그대로(textContent, 따옴표 없음 — §11.10.17 T1).
     * 예: hazardBox(panel, {rows:[{class:'연안사고 위험구역',count:1,text:'1개소',ids:['제주-2']}]}, card) → 정리 함수(펼친 지도 깜빡임 멈춤)
     * @param {HTMLElement} panel @param {Object} H - card.hazardTable @param {Object} c - 카드(관광지 이름·위치 link) @returns {Function} 정리 함수 [연계] ← landCardV19(expander build) / → expander·zoneMap
     */
    function hazardBox(panel, H, c) {
        var bx = el('div', 'sb-wxbox sb-hzbox'), sc = el('div', 'sb-srcb-tblw'), t = el('table', 'sb-srcb-tbl'), hr = el('tr'), th = el('thead'), tb = el('tbody'), stops = [];
        bx.appendChild(el('p', 'sb-wxbox-t', '위험구역'));
        (Array.isArray(H.head) ? H.head : ['구역 종류', '개소 수']).concat(['']).forEach(function (h) { hr.appendChild(el('th', '', h)); }); th.appendChild(hr); t.appendChild(th);
        H.rows.forEach(function (r) {
            var tr = el('tr'); tr.setAttribute('data-sb-hz-row', String(r.class || '')); tr.appendChild(el('td', '', r.class || '')); tr.appendChild(el('td', '', r.text || ''));
            var td = el('td', 'sb-hz-loc-td'); tr.appendChild(td); tb.appendChild(tr);
            if (!Array.isArray(r.ids) || !r.ids.length) return;
            var stopOne = null, mx = expander('위치 보기', function (p) { stopOne = zoneMap(p, r, c); return stopOne; }, 'land-hazard-map', false, true), mr = el('tr', 'sb-hz-maprow'), mtd = el('td');
            mx.btn.classList.add('sb-hz-loc'); td.appendChild(mx.btn);
            mtd.colSpan = 3; mtd.appendChild(mx.panel); mr.appendChild(mtd); mr.hidden = true; tb.appendChild(mr);
            mx.btn.addEventListener('click', function () { mr.hidden = mx.panel.hidden; });   // expander 가 먼저 panel 을 열고 닫는다(같은 단추에 먼저 단 처리) — 지도 줄도 같이
            stops.push(function () { if (typeof stopOne === 'function') stopOne(); });
        });
        t.appendChild(tb); sc.appendChild(t); bx.appendChild(sc); panel.appendChild(bx);
        return function () { stops.forEach(function (f) { f(); }); };
    }
    /**
     * [위치 보기] 지도 — 그 종류 위험구역 폴리곤을 GET /api/risk-forecast/hazard-zones?ids=(위험예측 화면이 위험구역을 누를 때 쓰는 같은 경로 — routes/risk_forecast.js)로 받아
     *   해상 근거 펼침 지도와 같은 miniMap(OpenLayers·해아름 바탕·높이 약 200px·600ms 깜빡임·움직임 줄이기면 깜빡임 없이 굵은 테두리)에 그리고, 관광지 위치(카드 link)를 흰 점 + 이름으로.
     *   받는 동안 「위치를 불러오는 중…」, 실패하면 「위험구역 위치를 불러오지 못했습니다.」(조용히 비우지 않는다). 접으면(정리 함수) 늦게 온 응답은 그리지 않는다.
     * 예: zoneMap(panel, {class:'연안사고 위험구역', text:'1개소', ids:['제주-2']}, {name:'모충사', link:{lat:33.516,lon:126.545}}) → 정리 함수
     * @param {HTMLElement} panel @param {Object} r - hazardTable.rows[] @param {Object} c - 카드 @returns {Function} 정리 함수 [연계] ← hazardBox(expander build) / → fetch·miniMap
     */
    function zoneMap(panel, r, c) {
        var done = false, stop = null, wait = el('p', 'sb-small', '위치를 불러오는 중…'), lk = c.link || {}, lon = Number(lk.lon), lat = Number(lk.lat);
        wait.setAttribute('data-sb-zone-wait', ''); panel.appendChild(wait);
        var spot = Number.isFinite(lon) && Number.isFinite(lat) ? { lon: lon, lat: lat, name: c.name || '' } : null;
        fetch('/api/risk-forecast/hazard-zones?ids=' + encodeURIComponent(r.ids.join(','))).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }).then(function (fc) {
            if (done) return;
            var polys = (fc && Array.isArray(fc.features) ? fc.features : []).map(function (f) { return f && f.geometry; }).filter(Boolean);
            if (!polys.length) { wait.textContent = '위험구역 위치 자료가 없습니다.'; return; }
            wait.remove();
            stop = miniMap(panel, [], [], '빨간 테두리(깜빡임) = ' + (r.class || '위험구역') + ' ' + (r.text || '') + (spot ? ' · 흰 점 = ' + spot.name : ''), { polys: polys, spot: spot });
        }).catch(function (e) { if (done) return; console.warn('[station-briefing] 위험구역 위치 요청 실패', e && e.message); wait.textContent = '위험구역 위치를 불러오지 못했습니다.'; });
        return function () { done = true; if (typeof stop === 'function') stop(); };
    }
    /**
     * 해상 시간 막대 — 3시간 칸마다 관할 최고 단계 색, 사건(특보 해제 예고·예비·해제·발효)이 있는 칸에 ⚑ + 범례.
     * 칸 아래 설명 줄(「18시 · 주의 필요 · ○○ 해역 · 근거 …」)과 그 줄을 채우던 칸 누르기는 없앴다(2026-10-17 사용자 결정 — 설계서 §11.10.13,
     * 원문 *"이 텍스트는 아래 또 나오니까 필요없는거 아니니? 개별로 나오잖아"* — 같은 내용이 해역 카드·특별 상황에 따로 있다). 칸은 누르는 단추가 아니라 그림(role=img + aria-label 「18시 주의 …」).
     * §11.10.29(2026-10-18 사용자 *"12, 15, 18, 21 버튼은 눌러볼 수 없는거니 ? … 그냥 게이지처럼해서 표현하는게 오해를 덜 사겠는데 ?"* → 시안 A *"이게 낫겠어."*):
     *   칸 상자(테두리·둥근 모서리·높이 34px — 단추처럼 보임) 대신 이어진 막대 하나(높이 8px, 양끝만 둥금)를 칸별 단계 색으로 나눈다.
     *   ⚑ 는 막대 위 그 구간 가운데 작은 표시, 시각은 막대 아래 눈금 글자(칸 시작 시각 + 마지막 칸 끝 — 「12 15 18 21 24시」). 눈금·⚑ 는 aria-hidden(칸 aria-label 에 같은 정보).
     * 예: timeBar([{at:'…T12:00…',label:'12시',rank:2,word:'주의',events:[{kind:'release',text:'…'}]}, …4칸]) → 막대(구간 4) + 눈금 「12 15 18 21 24시」 + 범례
     * 보는 시각(nowMs)에 이미 끝난 칸은 흐리게(.sb-slot-past) — 만드는 시각이 든 칸부터 다루므로 열어 볼 때 지난 칸이 섞일 수 있다(2단계 검토 B3).
     * @param {Object[]} slots - briefing.sea.timeBar @param {number} [nowMs] - 지금(ms) @returns {HTMLElement}
     * [연계] ← render(해상 분석) / → colorOf·tickText · station_briefing.css(.sb-timebar·.sb-gauge-*)
     */
    function timeBar(slots, nowMs) {
        var wrap = el('div', 'sb-timebar-wrap'), bar = el('div', 'sb-timebar'), n = slots.length, ticks = el('div', 'sb-gauge-ticks');
        bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '해상 시간 막대 — 3시간 칸별 관할 최고 단계');
        var flags = slots.some(function (s) { return Array.isArray(s.events) && s.events.length; }) ? el('div', 'sb-gauge-flags') : null;
        if (flags) { flags.setAttribute('aria-hidden', 'true'); wrap.appendChild(flags); }
        ticks.setAttribute('aria-hidden', 'true');
        slots.forEach(function (s, i) {
            var b = el('span', 'sb-slot'); b.setAttribute('role', 'img');
            b.style.background = colorOf(s.rank, s.word);
            var past = Number.isFinite(nowMs) && Date.parse(s.at) + 3 * 3600000 <= nowMs; if (past) { b.classList.add('sb-slot-past'); b.setAttribute('data-past', 'true'); }
            if (Array.isArray(s.events) && s.events.length) { var f = el('span', 'sb-slot-flag', '⚑'); f.style.left = ((i + 0.5) * 100 / n) + '%'; flags.appendChild(f); b.setAttribute('data-event', 'true'); }
            b.setAttribute('aria-label', (s.label || '') + ' ' + (s.word || WORDS[s.rank] || '') + (s.events && s.events.length ? ' — 특보 사건 있음' : '') + (past ? ' — 지난 시간' : ''));
            b.setAttribute('data-rank', String(s.rank));
            bar.appendChild(b);
            ticks.appendChild(tickAt(tickText(s.label), i, n));
        });
        var endH = tickEnd(slots[n - 1]); if (endH) ticks.appendChild(tickAt(endH, n, n));
        wrap.appendChild(bar); wrap.appendChild(ticks);
        var legend = el('div', 'sb-legend');
        WORDS.forEach(function (word, r) { var k = el('span', 'sb-legend-k'); var sw = el('i'); sw.style.background = colorOf(r); k.appendChild(sw); k.appendChild(document.createTextNode(word)); legend.appendChild(k); });
        legend.appendChild(el('span', 'sb-legend-k', '⚑ 특보 사건'));
        if (slots.some(function (s) { return Number.isFinite(nowMs) && Date.parse(s.at) + 3 * 3600000 <= nowMs; })) legend.appendChild(el('span', 'sb-legend-k', '흐린 칸 = 이미 지난 시간'));
        wrap.appendChild(legend);
        return wrap;
    }
    /**
     * 눈금 글자 하나를 경계 위치(i/n)에 — 첫 눈금은 왼쪽 맞춤, 마지막(i = n)은 오른쪽 맞춤, 그 밖은 가운데(§11.10.29).
     * 예: tickAt('15', 1, 4) → <span class="sb-gauge-tick" style="left:25%">15</span> @param {string} text @param {number} i @param {number} n @returns {HTMLElement} [연계] ← timeBar
     */
    function tickAt(text, i, n) {
        var t = el('span', 'sb-gauge-tick', text); t.style.left = (i * 100 / n) + '%';
        if (i === 0) t.setAttribute('data-edge', 'start'); else if (i === n) t.setAttribute('data-edge', 'end');
        return t;
    }
    /**
     * 칸 이름표 → 눈금 글자 — 시만 남긴다(서버 label 「12시」·「10월 18일 21시」(밤 판 첫 칸 — 날짜 앞말) → 「12」·「21」). 날짜는 칸 aria-label 에 그대로 있다.
     * 날짜 앞말을 눈금에 두지 않는 까닭: 밤 판은 칸이 9개라 360px 에서 눈금 사이가 약 33px — 「10월 18일 21」은 옆 눈금과 겹친다.
     * 예: tickText('12시') → '12' · tickText('10월 18일 21시') → '21' @param {string} label @returns {string} [연계] ← timeBar
     */
    function tickText(label) { return String(label || '').replace(/^.*\s/, '').replace(/시$/, ''); }
    /**
     * 마지막 칸의 끝 시각 눈금 — 칸 시작(at) + 3시간의 KST 시(0시면 24). 예: {at:'2026-10-18T21:00:00+09:00'} → '24시' · {at:'…T15:00…'} → '18시' · at 없음 → ''.
     * @param {Object} s - 마지막 칸 @returns {string} [연계] ← timeBar(마지막 칸 21시 = 21~24시라 경계 눈금 24시 — 사용자 확정 시안 A)
     */
    function tickEnd(s) {
        var t = Date.parse(s && s.at); if (!Number.isFinite(t)) return '';
        var h = new Date(t + 3 * 3600000 + 9 * 3600000).getUTCHours();
        return (h === 0 ? 24 : h) + '시';
    }
    /**
     * 조석 칸 — 해양종합정보 바텀시트 조석 게이지 디자인 그대로(OS.tideGaugeHtml) + 서버 문구(밀물·잠기는 바위).
     * 계약 §2.2: peaks {type,t:'HH:MM',cm} → {type, minutes, level}. prevPeak 는 전날 자신의 시각이라 1440 을 빼서 앞날로 민다.
     * 게이지(진행 막대)는 그 날이 오늘(KST)일 때만 — 바텀시트와 같은 규칙. 시각·cm 가 모양에 맞지 않는 피크는 버린다(HTML 에 숫자만 들어가게).
     * 예: tide({date:'2026-10-17',gauge:{peaks:[{type:'low',t:'06:12',cm:-12},…],prevPeak:{type:'high',t:'23:59',cm:600}},text:['06:12 저조 뒤부터 …']}, now)
     * @param {Object} t - briefing.tide @param {number} nowMs - 지금(ms) @param {Object} [b] - briefing(바위 링크 — §11.10.10) @returns {HTMLElement}
     * [연계] ← render / → OceanSheet.tideGaugeHtml(ocean_bottom_sheet3.js buildTideGauge)·rocksLine
     */
    function tide(t, nowMs, b) {
        var box = el('div', 'sb-tide');
        var conv = function (p, shift) {
            var m = p && /^(\d{2}):(\d{2})$/.exec(String(p.t || '')), cm = p ? Number(p.cm) : NaN;
            if (!m || !Number.isFinite(cm) || (p.type !== 'high' && p.type !== 'low')) return null;
            return { type: p.type, minutes: (+m[1]) * 60 + (+m[2]) + (shift || 0), level: cm };
        };
        var g = t.gauge || {}, peaks = (g.peaks || []).map(function (p) { return conv(p, 0); }).filter(Boolean).sort(function (a, b) { return a.minutes - b.minutes; });
        var y = g.prevPeak ? [conv(g.prevPeak, -1440)].filter(Boolean) : [], n = g.nextPeak ? [conv(g.nextPeak, 1440)].filter(Boolean) : [];
        var OS = w.OceanSheet;
        if (peaks.length && OS && typeof OS.tideGaugeHtml === 'function') {
            // 기기 시간대와 상관없이 KST 시·분을 갖는 Date(게이지는 dateObj.getHours()·getMinutes() 를 읽는다).
            var k = new Date(nowMs + 9 * 3600000), kst = new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), k.getUTCHours(), k.getUTCMinutes());
            var today = k.toISOString().slice(0, 10) === t.date;
            // 피크가 서버 숫자·시각만으로 바뀐 뒤 해양종합정보와 같은 함수로 만든 HTML(숫자·고정 글자만).
            var wrap = el('div', 'ocean-tide-wrap');
            var title = el('div', 'ocean-tide-title-row'); var tt = el('div', 'ocean-tide-title'); var ic = el('i', 'fa-solid fa-water'); tt.appendChild(ic); tt.appendChild(document.createTextNode(' 조석 · ' + dateText(t.date))); title.appendChild(tt); wrap.appendChild(title);
            var gauge = el('div', 'sb-tide-gauge'); gauge.innerHTML = OS.tideGaugeHtml(peaks, y, n, kst, today); wrap.appendChild(gauge);
            box.appendChild(wrap);
        }
        (t.text || []).forEach(function (line) { box.appendChild(rocksLine('sb-tide-text', line, b)); });   // 「잠기는 바위(간출암) N곳」은 (물때) 칸과 같은 지도 링크(§11.10.10)
        if (t.anchor && Number.isFinite(Number(t.anchor.distKm))) box.appendChild(el('p', 'sb-small', '관할 대표 위치에서 ' + Number(t.anchor.distKm) + 'km 떨어진 조석 지점 기준'));
        return box;
    }
    /**
     * 다음 판 안내 — 공개 시각(§11.10.4 — 40분 전(§11.10.22 D, 종전 20분 전)부터 만들어 두었다가 이 시각에 보임)이 아직이면 「다음 브리핑 공개: …」, 이미 지났으면(서버가 늦게 켜진 경우 등) 「다음 브리핑을 준비 중입니다(… 공개 예정)」.
     * 예: nextText('2026-10-17T23:00:00+09:00', 10-17 21:30) → '다음 브리핑 공개: 10월 17일(토) 23:00' · 23:05 → '다음 브리핑을 준비 중입니다(10월 17일(토) 23:00 공개 예정)'
     * @param {string} iso @param {number} nowMs @returns {string} [연계] ← render(브리핑 없음 — §11.10.9 ⑦ 부터 fallback 상자는 없음)
     */
    function nextText(iso, nowMs) { return Date.parse(iso) <= nowMs ? '다음 브리핑을 준비 중입니다(' + kstText(iso) + ' 공개 예정)' : '다음 브리핑 공개: ' + kstText(iso); }
    /**
     * 브리핑 응답 하나를 그린다(그릇 안을 비우고 새로). 브리핑이 없으면 안내(다음 예정 시각)만.
     * 예: render(document.getElementById('station-briefing-content'), {ok:true,display:true,date:'2026-10-17',briefing:{…},now:null}, {showSea:true,showLand:true,onLink:fn})
     * @param {HTMLElement} box @param {Object} resp - GET /api/station-briefing(또는 관리자 preview) 응답
     * @param {Object} [opts] - showSea·showLand(기본 true)·links(false 면 바로가기 없음)·onLink(target,btn)·now(ms, 시험용)
     * @returns {void}
     * [연계] ← station_briefing.js renderBody · admin_station_briefing.js 미리보기 / → summaryBodyV3(§11.10.4 「가」 모양 — summary.analysis 있음)·summaryBodyV2(§11.10.1 총평)·summaryBody(§11.10 판)·legacyOverview(그 전)·renderRest·RiskBasis.open
     */
    function render(box, resp, opts) {
        opts = opts || {};
        closeMapPopup();   // 본문을 다시 그리면 열린 팝업 지도도 닫는다(§11.10.9 ⑥)
        closePageSheet();  // 근거 지도에서 올린 화면 바텀시트도(§11.10.24)
        var showSea = opts.showSea !== false, showLand = opts.showLand !== false, nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
        box.textContent = '';
        var b = resp && resp.briefing;
        var top = el('div', 'sb-meta');
        var left = el('div', 'sb-meta-text');
        if (b && b.station) left.appendChild(el('strong', 'sb-station', (b.station.name || '') + (b.station.office ? ' · ' + b.station.office : '')));
        if (b) left.appendChild(el('span', 'sb-edition', subtitleText(b, resp && resp.nextPublishAt, nowMs)));   // §11.10.9 ⑦ — 판 종류·생성 시각 없음
        top.appendChild(left);
        var basis = el('button', 'rf-basis-btn sb-basis-btn', '기준 상세'); basis.type = 'button';
        basis.addEventListener('click', function (e) { e.stopPropagation(); if (w.RiskBasis) w.RiskBasis.open('briefing', basis); });
        top.appendChild(basis);
        box.appendChild(top);
        if (!b) {
            // 「아직 이 관할의 브리핑이 없습니다.」 줄은 뺐다(§11.10.10 F — 2026-10-17 사용자 *"오류나 자료 없음처럼 다른 내용을 알리는 안내는 남깁니다 <- 이 작업 할 필요 없어"*).
            //   빼도 칸이 비지 않는다 — 머리 줄([기준 상세])과 아래 다음 공개 안내(「다음 브리핑 공개: …」 또는 공개 시각 설명)가 남는다(UI 시험 「브리핑 없음」이 잰다).
            var empty = el('div', 'sb-empty'); empty.setAttribute('data-sb-empty', '');
            empty.appendChild(el('p', 'sb-small', resp && resp.nextExpectedAt ? nextText(resp.nextExpectedAt, nowMs) : '브리핑은 매일 07:30 · 17:30 · 23:00에 보입니다 — 각 40분 전(06:50 · 16:50 · 22:20)부터 만들어 두었다가 그 시각에 보여 드리고, 특보가 바뀌면 그 관할을 곧바로 다시 만듭니다.'));
            box.appendChild(empty);
            return;
        }
        // 「○○ 브리핑(23:00 공개)이 아직 없어 ○○ 브리핑을 보여 드립니다 — 다음 브리핑 공개 …」 상자는 없앴다(§11.10.9 ⑦ — 사용자 *"그 박스 자체가"* 필요 없다). 다음 갱신 시각은 머리 글 괄호에 있다.
        // 관리자 미리보기의 공개 예정 판 안내 「예정 — … 에 공개될 판입니다 …」 상자도 없앴다(§11.10.10 F — 같은 사용자 말). 공개 예정 판인지는 관리자 「AI 브리핑」 상태의 「공개 예정」 줄과 머리 글 시각이 보인다.

        // ① 총평과 권고 — summary.weather 칸이 있으면(§11.10.1) 결론 → (기상) → (물때) → 근거·권고 → AI 해설,
        //   summary 만 있으면(§11.10 판 — 10-17 낮에 저장된 파일) 육상·해상 덩어리 모양, 없으면(그 전) 종전 문단 모양
        var ov = b.overview || {}, s1 = section('총평과 권고', 'overview', true);   // 처음 펼친 칸은 이것뿐(§11.10.16 소절 — 나머지 칸은 접힘)
        if (b.summary && b.summary.analysis) summaryBodyV3(s1.body, b, resp, ov, showSea, showLand);
        else if (b.summary && Object.prototype.hasOwnProperty.call(b.summary, 'weather')) summaryBodyV2(s1.body, b, resp, ov, showSea, showLand);
        else if (b.summary) summaryBody(s1.body, b, resp, ov, showSea, showLand); else legacyOverview(s1.body, b, resp, ov, showSea, showLand);
        box.appendChild(s1.root);
        renderRest(box, b, opts, showSea, showLand, nowMs);
    }
    /**
     * 해상 결론 배지 오른쪽 「N개 해역 주의(KOMSA 예보)」(§11.10.16 전에는 「주의 필요」) — 해양사고 위험예보만 위험 단계인 해역 수(결론에는 넣지 않은 해역), 단계마다 하나·그 단계 색(높은 단계 먼저).
     * 2026-10-17 사용자 *"해상 평소 수준 그 오른쪽에 배지로서 "#개 해역 주의 필요(KOMSA예보)"라고 표현하고 아래 해상 분석에는 주의 필요 해역이 있습니다. 그 부분을 아예 없애는 건 어떨까?"*(설계서 §11.10.12)
     *   — 종전 결론 아래 노란 안내 한 줄(levelNoteText 「해상 분석에는 「주의 필요」 해역이 있습니다 — …」, 2단계 검토 B1)은 없앴다. 초록 「평소 수준」이 「안전」으로 읽히지 않게 하는 일은 이 배지가 한다.
     * 수 = 서버 summary.sea.accidentOnly(근거 줄 「해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 N칸」과 같은 수). 그 칸이 없는 옛 판은 해역 카드(단계 높은 순 10곳까지)에
     *   위험예보만 해역(overviewRank 0)이 모두 들어 있을 때만 카드로 센다 — 모자라면 셀 수 없어 배지 없음(지어내지 않는다).
     * 예: {summary:{sea:{accidentOnly:[{rank:3,word:'경계',count:1},{rank:2,word:'주의',count:3}]}}} → [chip(3,'1개 해역 경계(KOMSA 예보)'), chip(2,'3개 해역 주의(KOMSA 예보)')] · 없으면 [] (§11.10.16 부터 「필요」 없음)
     * @param {Object} b - briefing @returns {HTMLElement[]} [연계] ← summaryBodyV3·summaryBodyV2·summaryBody·legacyOverview / → chip
     */
    function komsaBadges(b) {
        var S = b.summary && b.summary.sea, sea = b.sea || {}, SHORT = ['', '관심', '주의', '경계'], groups = [];
        if (S && Array.isArray(S.accidentOnly)) groups = S.accidentOnly;
        else {
            var k = Number(sea.attentionRegions) - Number(sea.overviewRegions), only = (sea.cards || []).filter(function (c) { return c && Number(c.overviewRank) === 0 && Number(c.rank) > 0; });
            if (k > 0 && only.length === k) [3, 2, 1].forEach(function (r) { var n = only.filter(function (c) { return Number(c.rank) === r; }).length; if (n) groups.push({ rank: r, word: SHORT[r], count: n }); });
        }
        return groups.filter(function (g) { return g && Number(g.count) > 0 && Number(g.rank) >= 1; }).map(function (g) {
            var c = chip(g.rank, g.count + '개 해역 ' + g.word + '(KOMSA 예보)'); c.classList.add('sb-komsa'); c.setAttribute('data-sb-komsa', String(g.rank)); return c;   // §11.10.16 — 「필요」 없음
        });
    }

    // ── 근거 줄 펼침(2026-10-17 사용자 결정 §11.10.3) — 고립 사고 지점 표 · 해역·해구 미니 지도(테두리 깜빡임) ──
    var xSeq = 0, BLINK_MS = 600, blinking = 0;
    /**
     * 누르면 바로 아래가 펼쳐지는 글 버튼. 펼칠 때마다 build 로 새로 만들고, 접으면 build 가 돌려준 정리 함수(지도 깜빡임 멈춤)를 부르고 비운다.
     * 사용자 원문: *"사고지점을 하이퍼링크로 해서 누르면 아래로 아코디언이 펼쳐지며"* · *"그 텍스트를 누르면 … 아코디언처럼 펼쳐지면서"*.
     * 예: expander('사고 지점(5개소)', fn, 'iso') → {btn:<button aria-expanded="false" aria-controls="sb-x-1">사고 지점(5개소)<span> ▸</span></button>, panel:<div id="sb-x-1" hidden>}
     *     expander('연안 분석 근거 상세 보기', fn, 'basis-land', true) → 알약 배지 버튼(.sb-x-pill — 글 + 작은 꺾쇠 .sb-x-chev, 펼치면 CSS 가 꺾쇠를 뒤집는다 — 2026-10-17 사용자 *"배지 모양으로 … 오른쪽으로 정렬"*, 설계서 §11.10.9)
     * @param {string} text - 버튼 글(textContent) @param {function(HTMLElement):(Function|void)} build - 펼칠 때 panel 을 채움, 정리 함수를 돌려줄 수 있음 @param {string} key - data-sb-x(시험이 찾는 이름)
     * @param {boolean} [pill] - 참이면 알약 배지 모양(글 화살표 ▸/▾ 대신 꺾쇠)
     * @param {boolean} [noArrow] - 참이면 화살표 없이 밑줄 글만(§11.10.10 D — (고립 주의) 링크, 사용자 *"화살표 … 그냥 없애줘"* · §11.10.12 위험예보만 해역 줄 *"화살표는 빼주고"*). 펼침 상태는 aria-expanded 로 그대로 알린다
     * @returns {{btn:HTMLButtonElement, panel:HTMLElement}} [연계] ← isolationLine·basisList·summaryBodyV3 / → isoTable·raisedTable·miniMap
     */
    function expander(text, build, key, pill, noArrow) {
        var id = 'sb-x-' + (++xSeq), btn = el('button', 'sb-x-btn' + (pill ? ' sb-x-pill' : '')), panel = el('div', 'sb-x-panel'), arrow = pill ? el('span', 'sb-x-chev') : el('span', 'sb-x-arrow', ' ▸'), stop = null;
        btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id); btn.setAttribute('data-sb-x', key);
        btn.appendChild(document.createTextNode(text)); arrow.setAttribute('aria-hidden', 'true'); if (!noArrow) btn.appendChild(arrow);
        panel.id = id; panel.hidden = true; panel.setAttribute('data-sb-x-panel', key);
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = btn.getAttribute('aria-expanded') !== 'true';
            if (typeof stop === 'function') stop();
            stop = null; panel.textContent = ''; panel.hidden = !open;
            btn.setAttribute('aria-expanded', String(open)); if (!pill && arrow) arrow.textContent = open ? ' ▾' : ' ▸';
            if (open) stop = build(panel) || null;
        });
        return { btn: btn, panel: panel };
    }
    /**
     * 고립 사고 지점 표 「지점명 | 발생 현황」(서버 summary.isolation — head·rows[].status 「22년(1건), 23년(2건), 24년(1건)」, 합 많은 순·이름 순, 모두). 글은 textContent.
     * 2026-10-17 사용자 *"22년 괄호 열고 몇 건, 컴마 23년 괄호 열고 몇 건 …"*(§11.10.10 E). status 가 없는 옛 판(§11.10.3 — 「지점명 | 발생 건수」)은 그 판 그대로 「N건」.
     * 예: isoTable(panel, {head:['지점명','발생 현황'], rows:[{name:'도시해녀',count:2,status:'22년(1건), 23년(1건)'}], caption:'2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)'})
     * @param {HTMLElement} panel @param {Object} iso @returns {void} [연계] ← isolationLine(expander build)
     */
    function isoTable(panel, iso) {
        var t = el('table', 'sb-iso-table'); t.setAttribute('data-sb-iso-table', '');
        if (iso.caption) t.appendChild(el('caption', '', iso.caption));
        var head = Array.isArray(iso.head) && iso.head.length === 2 ? iso.head : ['지점명', '발생 건수'];
        var hr = el('tr'); hr.appendChild(el('th', '', head[0])); hr.appendChild(el('th', '', head[1])); var th = el('thead'); th.appendChild(hr); t.appendChild(th);
        var tb = el('tbody');
        (iso.rows || []).forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', '', r.name)); tr.appendChild(el('td', 'sb-num', r.status ? String(r.status) : Number(r.count) + '건')); tb.appendChild(tr); });
        t.appendChild(tb); panel.appendChild(t);
    }
    /**
     * 연안 근거 첫 줄 「평소보다 위험이 높아진 곳 N곳」을 누르면 펼치는 표 「관광지 | 평소 | 오늘(예상)」(서버 summary.land.raised — 관심 이상 관광지 전부, 단계 높은 순·이름 순).
     * 2026-10-17 사용자 *"관광지, 기존, 위험이 높아진 곳 세 개로 구분해서 기존엔 뭐였는데 뭘로 높아졌다 … 위험이 높아진 모든 관광지에 대해서"*(설계서 §11.10.9).
     * 평소 칸은 서버 값(「평소 수준」 — 관광지마다 따로 저장된 평소 단계는 없다, 서버 rules.raisedTable 주석, 흐린 글), 오늘 칸은 단계 말(단계 색 굵게) + 아래 작게 높아진 이유. 위 3곳 + 「[나머지 …]」 한 줄(시안). 글은 textContent.
     * 예: raisedTable(panel, {head:['관광지','평소','오늘(예상)'], rows:[{name:'협재해수욕장',usual:'평소 수준',rank:2,word:'주의',reason:"연안 위험지수 72(높음, 예상), 방문객 평소의 1.8배(예상)"}], caption:'…'})
     * @param {HTMLElement} panel @param {Object} r - summary.land.raised @returns {void} [연계] ← basisList(expander build) / → chip
     */
    function raisedTable(panel, r) {
        // 2026-10-18 사용자 「시안이 기준이 되어야 해.」 — 시안 Main.dc.html 꼴: 설명 줄(caption) 없음 · 평소 = 흐린 글 · 오늘 = 단계 말 단계 색 굵게 + 아래 작은 흐린 이유 ·
        //   위 3곳만, 나머지는 한 줄 「[나머지 N곳 — 주의 a곳 · 관심 b곳]」(rows 는 단계 높은 순 — 서버 rules.raisedTable)
        var t = el('table', 'sb-iso-table sb-raised-table'); t.setAttribute('data-sb-raised-table', '');
        var hr = el('tr'), th = el('thead'); (r.head || ['관광지', '평소', '오늘(예상)']).forEach(function (h) { hr.appendChild(el('th', '', h)); }); th.appendChild(hr); t.appendChild(th);
        var tb = el('tbody'), rows = r.rows || [], TOP = 3;
        rows.slice(0, TOP).forEach(function (x) {
            var tr = el('tr'); tr.appendChild(el('td', 'sb-raised-name', x.name));
            tr.appendChild(el('td', 'sb-raised-usual', x.usual || '평소 수준'));
            var d = el('td'), lv = el('span', 'sb-hl sb-hl-lv sb-raised-lv', levelWord(x.word || WORDS[x.rank] || ''));
            lv.style.color = colorOf(x.rank, x.word); lv.setAttribute('data-rank', String(x.rank)); d.appendChild(lv);
            if (x.reason) d.appendChild(el('p', 'sb-small sb-raised-why', x.reason)); tr.appendChild(d);
            tb.appendChild(tr);
        });
        if (rows.length > TOP) {
            var rest = rows.slice(TOP), cnt = [3, 2, 1].map(function (k) { var n = rest.filter(function (x) { return Number(x.rank) === k; }).length; return n ? WORDS[k] + ' ' + n + '곳' : ''; }).filter(Boolean);
            var rr = el('tr', 'sb-raised-rest'), td = el('td', 'sb-raised-usual', '[나머지 ' + rest.length + '곳' + (cnt.length ? ' — ' + cnt.join(' · ') : '') + ']'); td.colSpan = 3; rr.appendChild(td); tb.appendChild(rr);
        }
        t.appendChild(tb); panel.appendChild(t);
    }
    /**
     * (물때) 아래 「(고립 주의) 저조 시간(…) 전후 과거 고립 사고(N개소 M건)으로 확인 및 주의가 요구됩니다.」(§11.10.20 덧붙임 — 종전 「필요합니다」) — 서버 link(「과거 고립 사고(N개소 M건)」)가 버튼(화살표 없음 — §11.10.10 D), 누르면 지점 표.
     * 예: isolationLine({text:'(고립 주의) 저조 시간(08:16·22:09) 전후 과거 고립 사고(5개소 6건)으로 확인 및 주의가 요구됩니다.', link:'과거 고립 사고(5개소 6건)', rows:[…]}) → <div data-sb-isolation><p>…<button>…</button>…</p><div panel></div></div>
     * @param {Object} iso - summary.isolation @returns {HTMLElement} [연계] ← tidePart / → expander·isoTable
     */
    function isolationLine(iso) {
        // 머리 「[고립 주의]」(§11.10.20 덧붙임 29 — 서버 v19 글, 옛 판 「(고립 주의)」도 화면에서 같은 꼴로)
        var wrap = el('div', 'sb-iso'); wrap.setAttribute('data-sb-isolation', '');
        var p = el('p', 'sb-iso-line'), text = String(iso.text || '').replace(/^\(고립 주의\)/, '[고립 주의]'), link = String(iso.link || ''), i = link ? text.indexOf(link) : -1;
        var x = expander(link || '과거 고립 사고', function (panel) { isoTable(panel, iso); }, 'iso', false, true);
        if (i >= 0) { appendText(p, text.slice(0, i)); p.appendChild(x.btn); appendText(p, text.slice(i + link.length)); }
        else { appendText(p, text + ' '); p.appendChild(x.btn); }
        wrap.appendChild(p); wrap.appendChild(x.panel);
        return wrap;
    }
    /** 움직임 줄이기 설정이면 참(깜빡이지 않고 굵은 테두리로만). @returns {boolean} [연계] ← miniMap */
    function reducedMotion() { try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
    /**
     * 펼친 칸 안에 작은 지도(높이 약 200px)를 그린다 — 관할 해역 경계(파란 선) 전체가 보이게 맞추고, 해당 칸·해구 테두리(빨강)를 약 600ms 마다 깜빡인다.
     * 사용자 원문: *"대한민국 전도 전체로 보면 될 것이 아니라 그 해역 그 관할 전체가 표시되고 … 그 격자의 테두리가 깜빡깜빡했으면 좋겠거든."*
     * 바탕은 관심해역 고르기 지도(zone_setup.js)와 같은 해아름 바다지도(oceanCreateKhoaLayer) — 없으면 선만. 움직임 줄이기 설정이면 깜빡이지 않는다.
     * 지도는 그림처럼 고정(끌기·확대 없음) — 페이지를 쓸어 내릴 때 지도가 손가락을 가로채지 않게(팝업 지도 opt.risk.interactive·opt.zoom 은 예외 — 창 안이라 가로채도 된다).
     * 예: miniMap(panel, [[[[126.1,33.3],…]]], [[126.2,33.4,126.25,33.44]], '빨간 테두리(깜빡임) = …') → 정리 함수(깜빡임 멈춤·지도 떼기)
     * §11.10.9 ⑥: opt.big = 팝업용 큰 지도(.sb-minimap-lg) · opt.cells = [{id, box, count}] 선박이 있는 격자 — 테두리 + 격자 가운데 척수 글(ol Text) · opt.dim = 깜빡이는 격자 말고 나머지 격자를 흐리게.
     * §11.10.20: opt.polys = GeoJSON 도형(Polygon·MultiPolygon) 목록 — 상자(boxes) 대신 그 모양 그대로 깜빡임(연안 카드 [위치 보기] 위험구역) · opt.spot = {lon, lat, name} 흰 점 + 이름(관광지).
     *            polys 가 있으면 관할 폴리곤(area)이 비어 있어도 그린다(파란 선 없음).
     * §11.10.10: opt.points = [{id, lat, lon, v, times}] 간출암 — 해양안전 「위험지형」과 같은 간출암 그림(HazardRockTidePanel.icon, 없으면 주황 점) · opt.onPoint(row, unselect) = 마커를 눌렀을 때
     *            (누른 마커에 빨간 고리, unselect() 를 부르면 고리를 지운다). 지도는 끌기·확대 없이도 누름(click)은 받는다.
     * §11.10.24·§11.10.26(2026-10-18): opt.risk = {kind:'current'|'risk'|'coast', t, interactive, onPick(kind,id,point), onLoad(data, stop)} — 바탕을 위성지도로, 그 위에 위험예측 지도 층(혼잡도 지금 · 위험 예측 · 연안 위험)을
     *            그 관할 상자만 받아 깐다(StationBriefingRiskMap.attach — 위험예측 RiskMapLayer 그대로). 칸·관광지를 누르면 onPick. 정리 함수에 stop.map·caption·risk()·highlight(boxes, polys)·focus(maxZoom).
     *            위험예측 스크립트가 없으면(RM() null) 종전 모양.
     * §11.10.31(2026-10-18 — 잠기는 바위 팝업): opt.sat = 위험예측 층 없이 바탕만 위성지도(StationBriefingRiskMap.baseLayers 그대로 — 위성 키를 못 받으면 해아름 기본맵, 그 파일이 없으면 해아름 바다지도)
     *            · opt.zoom = 끌기·두 손가락(핀치)·마우스 휠·더블탭 확대(OpenLayers 기본 조작 — 위험예측 팝업 지도와 같은 것) + 지도 왼쪽 위 +/− 단추(ol.control.Zoom — 「확대」·「축소」).
     *              지도를 끄는 동안 바깥 페이지는 스크롤되지 않는다(OL 이 그 터치·휠의 기본 동작을 막는다). 바위 누르기(onPoint)는 그대로.
     * @param {HTMLElement} panel @param {Array} area - 관할 폴리곤 목록(경위도) @param {number[][]} boxes - [서,남,동,북] 목록 @param {string} caption @param {Object} [opt] - {big, cells, dim, points, onPoint, polys, spot, risk, sat, zoom}
     * @returns {Function|null} 정리 함수 [연계] ← basisList(expander build)·openMapPopup(대해구·지금 밀집 팝업)·riskPopup / ol.js(index2 전역)·ocean_map.js oceanCreateKhoaLayer · station_briefing_riskmap.js(StationBriefingRiskMap)
     */
    function miniMap(panel, area, boxes, caption, opt) {
        opt = opt || {};
        var box = el('div', 'sb-minimap' + (opt.big ? ' sb-minimap-lg' : '')); panel.appendChild(box);
        if (caption) panel.appendChild(el('p', 'sb-small sb-minimap-cap', caption));
        var polys = Array.isArray(opt.polys) ? opt.polys : []; area = Array.isArray(area) ? area : [];
        if (typeof w.ol === 'undefined' || (!area.length && !polys.length)) { box.setAttribute('data-sb-map', 'none'); box.appendChild(el('p', 'sb-small', '지도를 불러오지 못했습니다.')); return null; }
        var ol = w.ol, proj = function (p) { return ol.proj.fromLonLat([Number(p[0]), Number(p[1])]); };
        var areaSrc = new ol.source.Vector({ features: area.map(function (poly) { return new ol.Feature(new ol.geom.Polygon(poly.map(function (ring) { return ring.map(proj); }))); }) });
        var hlSrc = new ol.source.Vector({ features: (boxes || []).map(function (b) { return new ol.Feature(new ol.geom.Polygon([[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]].map(proj)])); }) });
        polys.forEach(function (g) { (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []).forEach(function (poly) { hlSrc.addFeature(new ol.Feature(new ol.geom.Polygon(poly.map(function (ring) { return ring.map(proj); })))); }); });   // §11.10.20 위험구역 모양 그대로
        var still = reducedMotion(), on = true, fill = new ol.style.Fill({ color: 'rgba(239,68,68,0.16)' });
        var styleOn = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#ef4444', width: still ? 3 : 2.5 }), fill: fill }), styleOff = new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(239,68,68,0)', width: 2.5 }), fill: fill });
        var hlLayer = new ol.layer.Vector({ source: hlSrc, style: function () { return on ? styleOn : styleOff; } });
        var areaLayer = new ol.layer.Vector({ source: areaSrc, style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#2563eb', width: 2 }), fill: new ol.style.Fill({ color: 'rgba(37,99,235,0.05)' }) }) });
        // 선박이 있는 격자(§11.10.9 ⑥) — 청록 테두리 + 가운데 척수(진한 글·흰 테두리: 바다 바탕에서 읽히게). opt.dim 이면 흐리게
        var cellSrc = new ol.source.Vector({ features: (Array.isArray(opt.cells) ? opt.cells : []).map(function (c) { var b = c.box, f = new ol.Feature(new ol.geom.Polygon([[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]].map(proj)])); f.set('label', String(c.count)); f.set('id', c.id); return f; }) });
        var cellLayer = new ol.layer.Vector({ source: cellSrc, style: function (f) { return new ol.style.Style({ stroke: new ol.style.Stroke({ color: opt.dim ? 'rgba(8,145,178,0.45)' : '#0891b2', width: 1.5 }), fill: new ol.style.Fill({ color: opt.dim ? 'rgba(8,145,178,0.06)' : 'rgba(8,145,178,0.14)' }),
            text: new ol.style.Text({ text: f.get('label'), font: '700 13px sans-serif', fill: new ol.style.Fill({ color: opt.dim ? 'rgba(15,23,42,0.6)' : '#0f172a' }), stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 }), overflow: true }) }); } });
        // 간출암 마커(§11.10.10) — 위치는 서버 summary.rocks.rows 그대로(화면이 바위를 찾지 않는다). 그림은 해양안전 「위험지형」 간출암과 같은 것(hazard_rocks.js 가 내보냄)
        var RP = w.HazardRockTidePanel, sel = null;
        var ptSrc = new ol.source.Vector({ features: (Array.isArray(opt.points) ? opt.points : []).filter(function (r) { return r && Number.isFinite(Number(r.lon)) && Number.isFinite(Number(r.lat)); }).map(function (r) { var f = new ol.Feature(new ol.geom.Point(proj([r.lon, r.lat]))); f.set('row', r); return f; }) });
        var ptImg = RP && RP.icon ? new ol.style.Icon({ src: RP.icon, scale: RP.iconScale || 0.3 }) : new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#f59e0b' }), stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }) });
        var ptStyle = new ol.style.Style({ image: ptImg }), ring = new ol.style.Style({ image: new ol.style.Circle({ radius: 17, stroke: new ol.style.Stroke({ color: '#ef4444', width: 3 }), fill: new ol.style.Fill({ color: 'rgba(239,68,68,0.15)' }) }) });
        var ptLayer = new ol.layer.Vector({ source: ptSrc, style: function (f) { return f === sel ? [ring, ptStyle] : ptStyle; } });
        // 관광지 점(§11.10.20) — 흰 점 + 이름(진한 테두리 글: 바다 바탕에서 읽히게)
        var sp = opt.spot && Number.isFinite(Number(opt.spot.lon)) && Number.isFinite(Number(opt.spot.lat)) ? opt.spot : null, spotSrc = new ol.source.Vector({ features: sp ? [new ol.Feature(new ol.geom.Point(proj([sp.lon, sp.lat])))] : [] });
        var spotLayer = new ol.layer.Vector({ source: spotSrc, style: new ol.style.Style({ image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: '#ffffff' }), stroke: new ol.style.Stroke({ color: '#0f172a', width: 2 }) }),
            text: sp && sp.name ? new ol.style.Text({ text: String(sp.name), font: '700 12px sans-serif', offsetY: -13, fill: new ol.style.Fill({ color: '#0f172a' }), stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 }), overflow: true }) : undefined }) });
        var layers = [], baseOn = false, RMx = opt.risk && area.length ? RM() : null, risk = RMx ? opt.risk : null, sat = null;
        // §11.10.24: 위험예측 배경(opt.risk) — 바탕 = 위험예측을 켰을 때와 같은 위성지도(브이월드, 키가 없으면 해아름 기본맵), 그 위에 위험예측 지도 층(RiskMapLayer)
        // §11.10.31: opt.sat(잠기는 바위 팝업) — 위험예측 층 없이 같은 위성지도 바탕만(부품이 덜 실려 RM() 이 null 이어도 바탕 함수는 쓴다)
        var SAT = risk ? RMx : opt.sat && w.StationBriefingRiskMap ? w.StationBriefingRiskMap : null;
        if (SAT) { sat = SAT.baseLayers(function (k) { box.setAttribute('data-sb-map-base', k); }); if (sat) { layers.push.apply(layers, sat); baseOn = true; } }
        if (!sat && typeof w.oceanCreateKhoaLayer === 'function') { try { var base = w.oceanCreateKhoaLayer('BASEMAP_RLTM3857'); base.setVisible(true); layers.push(base); baseOn = true; } catch (e) { console.warn('[station-briefing] 바탕 지도 없이 선만 그립니다', e); } }
        layers.push(areaLayer, cellLayer, hlLayer, ptLayer, spotLayer);
        // 위험예측 층(zIndex 130~139) 위에 관할 선·깜빡임·점이 오게
        if (risk) [areaLayer, cellLayer, hlLayer, ptLayer, spotLayer].forEach(function (l, i) { l.setZIndex(150 + i); });
        // 팝업 지도(risk.interactive)는 끌기·두 손가락 확대를 받는다(혼잡도 숫자는 확대해야 보인다 — 위험예측 지도와 같은 규칙). 근거 펼침 지도는 종전처럼 그림(누름만)
        var mapOpt = { target: box, layers: layers, view: new ol.View({ center: proj([127.5, 36]), zoom: 7 }), controls: [] }; if (!(risk && risk.interactive) && !opt.zoom) mapOpt.interactions = [];
        // §11.10.31: opt.zoom — 화면 +/− 단추(손가락·휠을 못 쓰는 사람·키보드용). 앱의 다른 지도는 단추를 숨기지만 사용자가 단추를 원했다
        if (opt.zoom) { var zc = new ol.control.Zoom({ zoomInLabel: '+', zoomOutLabel: '−', zoomInTipLabel: '확대', zoomOutTipLabel: '축소' }); mapOpt.controls = [zc]; [].forEach.call(zc.element.querySelectorAll('button'), function (bt) { var out = bt.classList.contains('ol-zoom-out'); bt.setAttribute('aria-label', out ? '축소' : '확대'); bt.setAttribute('data-sb-map-zoom', out ? 'out' : 'in'); }); box.setAttribute('data-sb-map-zoomable', ''); }
        var map = new ol.Map(mapOpt); if (sat) sat.map = map;
        var ext = areaSrc.getExtent().slice(); if (hlSrc.getFeatures().length) ol.extent.extend(ext, hlSrc.getExtent()); if (cellSrc.getFeatures().length) ol.extent.extend(ext, cellSrc.getExtent()); if (ptSrc.getFeatures().length) ol.extent.extend(ext, ptSrc.getExtent()); if (spotSrc.getFeatures().length) ol.extent.extend(ext, spotSrc.getExtent());
        if (ptSrc.getFeatures().length && typeof opt.onPoint === 'function') {
            map.on('click', function (evt) {
                var hit = null; map.forEachFeatureAtPixel(evt.pixel, function (f) { hit = f; return true; }, { layerFilter: function (l) { return l === ptLayer; }, hitTolerance: 6 });
                if (!hit) return;
                sel = hit; ptLayer.changed(); box.setAttribute('data-sb-map-sel', String(hit.get('row').id));
                opt.onPoint(hit.get('row'), function () { if (sel === hit) { sel = null; ptLayer.changed(); box.removeAttribute('data-sb-map-sel'); } });
            });
        }
        var fitOpt = { size: map.getSize(), padding: polys.length ? [24, 24, 24, 24] : [10, 10, 10, 10] }; if (polys.length) fitOpt.maxZoom = 15;   // 위험구역 하나는 아주 작아 너무 당겨지지 않게
        map.updateSize(); map.getView().fit(ext, fitOpt);
        box.setAttribute('data-sb-map', 'ol'); if (!sat) box.setAttribute('data-sb-map-base', baseOn ? 'khoa' : 'none'); box.setAttribute('data-sb-map-spot', String(spotSrc.getFeatures().length));
        box.setAttribute('data-sb-map-cells', String(cellSrc.getFeatures().length)); box.setAttribute('data-sb-map-labels', cellSrc.getFeatures().map(function (f) { return f.get('label'); }).join(','));
        box.setAttribute('data-sb-map-points', String(ptSrc.getFeatures().length)); box.setAttribute('data-sb-map-icon', RP && RP.icon ? 'hazard-rocks' : 'dot');
        box.setAttribute('data-sb-map-area', String(areaSrc.getFeatures().length)); box.setAttribute('data-sb-map-hl', String(hlSrc.getFeatures().length));
        box._sbMap = { map: map, area: areaSrc, hl: hlSrc, hlLayer: hlLayer, cells: cellSrc, points: ptSrc, spot: spotSrc };   // 시험용 손잡이(OL 지형지물 수 확인 · 마커 화면 위치)
        var timer = null, ctl = null, cap = panel.querySelector('.sb-minimap-cap');
        if (risk) {
            // 혼잡도(지금)는 칸 안 선박 수가 보이는 확대(위험예측 지도 규칙 — 해상도 80m/px 미만)로 — 깜빡이는 칸(없으면 관할) 가운데
            if (risk.kind === 'current' && map.getView().getResolution() >= 80) { map.getView().setCenter(ol.extent.getCenter(hlSrc.getFeatures().length ? hlSrc.getExtent() : ext)); map.getView().setResolution(79); }
            ctl = RMx.attach(map, { kind: risk.kind, t: risk.t, bbox: RMx.bbox(area, boxes),
                onPick: function (kind, id, point) { ctl.select(kind, Array.isArray(id) ? id[0] : id); box.setAttribute('data-sb-map-pick', String(Array.isArray(id) ? id[0] : id)); if (typeof risk.onPick === 'function') risk.onPick(kind, Array.isArray(id) ? id[0] : id, point || null); },
                onLoad: function (d) {
                    var list = d.cells || d.spots || []; box.setAttribute('data-sb-grid', d.mode || 'coast'); box.setAttribute('data-sb-grid-n', String(list.length)); box.setAttribute('data-sb-grid-at', String(d.forecastAt || d.t || ''));
                    box.setAttribute('data-sb-grid-labels', d.mode === 'current' ? (d.cells || []).filter(function (c) { return c.n > 0; }).map(function (c) { return c.n; }).join(',') : '');
                    if (typeof risk.onLoad === 'function') risk.onLoad(d, stop);
                } });
            ctl.load().catch(function (e) { box.setAttribute('data-sb-grid', 'error'); if (cap) cap.textContent = '위험예측 자료를 불러오지 못했습니다 — ' + (e && e.message || '오류') + ' · ' + caption; });
        }
        var stop = function () { if (timer) { clearInterval(timer); timer = null; blinking--; } if (ctl) { ctl.destroy(); ctl = null; } box.setAttribute('data-sb-blink', still ? 'static' : 'off'); map.setTarget(null); };
        stop.map = map; stop.caption = cap; stop.risk = function () { return ctl; };
        /** 깜빡이는 칸·도형을 바꾼다(§11.10.24 — 실시간 갱신으로 가장 붐비는 해역이 바뀜 · 관광지 영역은 자료를 받은 뒤). 예: stop.highlight([[126.2,33.4,126.225,33.425]], []) */
        stop.highlight = function (bx, pl) {
            hlSrc.clear();
            (bx || []).forEach(function (b) { hlSrc.addFeature(new ol.Feature(new ol.geom.Polygon([[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]].map(proj)]))); });
            (pl || []).forEach(function (g) { (g && g.type === 'MultiPolygon' ? g.coordinates : g && g.type === 'Polygon' ? [g.coordinates] : []).forEach(function (poly) { hlSrc.addFeature(new ol.Feature(new ol.geom.Polygon(poly.map(function (ring) { return ring.map(proj); })))); }); });
            box.setAttribute('data-sb-map-hl', String(hlSrc.getFeatures().length));
        };
        /** 깜빡이는 것에 맞춰 지도를 옮긴다(없으면 그대로). 예: stop.focus(15) @param {number} [maxZoom] */
        stop.focus = function (maxZoom) { if (hlSrc.getFeatures().length) map.getView().fit(hlSrc.getExtent(), { size: map.getSize(), padding: [40, 40, 40, 40], maxZoom: maxZoom || 14 }); };
        if (still) box.setAttribute('data-sb-blink', 'static');
        else {
            box.setAttribute('data-sb-blink', 'on'); blinking++;
            timer = setInterval(function () { if (!box.isConnected) { stop(); return; } on = !on; box.setAttribute('data-sb-blink-phase', on ? '1' : '0'); hlLayer.changed(); }, BLINK_MS);
        }
        return stop;
    }
    /**
     * 지도 아래 한 줄 풀이. 예: ({key:'haegu',major:'232'}, {name:'한림파출소'}) → '빨간 테두리(깜빡임) = 232해구 · 파란 선 = 한림파출소 관할 해역'(§11.10.22 A — 종전 「대해구 232」)
     *   · ({key:'accidentOnly'}, {name:'영목파출소'}, "해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 3칸") → "빨간 테두리(깜빡임) = KOMSA 기준 등급 '주의' 해역 · 파란 선 = 영목파출소 관할 해역"(§11.10.12 — 단계는 그 근거 줄의 따옴표 말)
     * @param {Object} d - detail @param {Object} station @param {string} [text] - 그 근거 줄 @returns {string} [연계] ← basisList
     */
    function mapCaption(d, station, text) {
        var q = /'([^']+)'/.exec(String(text || ''));
        var what = d.key === 'haegu' ? (d.major || '') + '해구' : d.key === 'accidentOnly' ? 'KOMSA 기준 등급 ' + (q ? "'" + q[1] + "' " : '') + '해역' : '위험이 높아진 해역';
        return '빨간 테두리(깜빡임) = ' + what + ' · 파란 선 = ' + ((station && station.name) || '') + ' 관할 해역';
    }

    // ── 팝업 지도(2026-10-17 사용자 결정 — 설계서 §11.10.9 ⑥) — 대해구 링크·지금 밀집 링크가 연다 ──
    // 원문: *"대해구 75 부분은 정확히 어딘지 알 수 있도록 하이퍼링크를 통해, 그 부분을 눌렀을 때 팝업으로 지도가 표출되고, 해당 해역의 해구 격자가 표시되도록"* ·
    //       *"관할 해역 선박 27척 … 팝업으로 해당 관할이 나오고, 그 지도의 선박이 있는 격자를 표시한 뒤 그 격자 안에 선박수를 표출"* · *"죽변항 북서방 0.7해리 해역 그 부분도 마찬가지로 하이퍼링크 처리 및 격자 안에 숫자 처리"*.
    // 모양·닫기는 관할 확인 창(station_briefing_picker.js confirmPick)과 같은 틀(.sb-dlg — role=dialog·aria-modal·Esc·바깥·✕·하드웨어 뒤로가기 PopupStack). 지도는 근거 줄 펼침과 같은 miniMap(OpenLayers·해아름 바탕).
    var popup = null;
    /** 팝업 지도를 닫는다(깜빡임 멈춤·지도 떼기·연 곳으로 초점). 예: closeMapPopup(). @returns {void} [연계] ← openMapPopup(✕·바깥·Esc·뒤로가기)·render(본문을 다시 그릴 때) */
    function closeMapPopup() {
        closeRockPanel();   // 간출암 상자(§11.10.10)가 떠 있으면 같이 닫는다
        if (!popup) return;
        var p = popup; popup = null;
        document.documentElement.classList.remove('sb-mapdlg-open');
        if (w.PopupStack) w.PopupStack.remove('sb-map-popup');
        if (typeof p.stop === 'function') p.stop();
        if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
        if (p.back && p.back.isConnected && p.back.focus) p.back.focus({ preventScroll: true });
    }
    /**
     * 가운데 팝업 하나를 열고 build(지도 칸)로 채운다 — 이미 열린 것은 닫는다.
     * 예: openMapPopup('경북북부앞바다(대해구 75)', function (body) { return miniMap(body, area, [box], '…', {big:true}); }, btn)
     * @param {string} title @param {function(HTMLElement):(Function|void)} build - 정리 함수를 돌려줄 수 있음 @param {string} key - data-sb-map-popup(시험이 찾는 이름) @returns {void}
     * [연계] ← analysisNodes(대해구 링크)·nowNode(지금 밀집 링크) / → miniMap·closeMapPopup
     */
    function openMapPopup(title, build, key, bare) {
        closeMapPopup();
        var back = document.activeElement, wrap = el('div', 'sb-dlg sb-mapdlg' + (bare ? ' sb-warndlg' : '')), dim = el('div', 'sb-dlg-dim'), box = el('div', 'sb-dlg-box sb-mapdlg-box'), id = 'sb-mapdlg-t' + (++xSeq), x = null;
        wrap.setAttribute('data-sb-map-popup', key || '');
        // §11.10.24: 창 안(지도·창 안 바텀시트)을 마우스로 눌러도 초점이 창에 남게 — 초점 없는 지도 캔버스를 누르면 초점이 body 로 가 Esc(아래 keydown)가 창에 닿지 않았다
        wrap.tabIndex = -1;
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
        // bare(「기상특보 현황」 창 — §11.10.16 소절 E1): 머리를 만들지 않고 build 가 넣은 상자(warnBox)의 제목·✕ 를 쓴다(근거 안 상자와 같은 모양). 이름 = aria-label + 그 제목
        if (bare) box.setAttribute('aria-label', title);
        else {
            box.setAttribute('aria-labelledby', id);
            var head = el('div', 'sb-mapdlg-head'), t = el('p', 'sb-dlg-title', title); x = el('button', 'sb-mapdlg-x', '✕'); t.id = id; x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.setAttribute('data-sb-map-close', '');
            head.appendChild(t); head.appendChild(x); box.appendChild(head);
        }
        var body = el('div', 'sb-mapdlg-body'); box.appendChild(body);
        wrap.appendChild(dim); wrap.appendChild(box); document.body.appendChild(wrap);
        document.documentElement.classList.add('sb-mapdlg-open');   // 창 안 바텀시트의 사고 목록·[?]·[기준 상세] 창(.rf-acc-pop·.rf-modal)이 이 창 위에 오게(station_briefing.css)
        popup = { wrap: wrap, back: back, stop: null, key: key || '', title: box.querySelector('.sb-dlg-title'), sheet: null, live: null };
        if (bare) { popup.stop = build(body) || null; x = box.querySelector('[data-sb-map-close]'); var bt = box.querySelector('.sb-wxbox-t'); if (bt && bt.id) box.setAttribute('aria-labelledby', bt.id); }
        x.addEventListener('click', function (e) { e.stopPropagation(); closeMapPopup(); });
        dim.addEventListener('pointerdown', function (e) { e.preventDefault(); closeMapPopup(); });
        wrap.addEventListener('click', function (e) { e.stopPropagation(); });   // 바깥 아코디언 머리로 번지지 않게
        // Esc = 간출암 상자(§11.10.10)가 떠 있으면 그것만, 아니면 창 · Tab = 창 안에서만 돈다(상자가 떠 있으면 ✕ ↔ 상자 단추들 · 지도 +/− 단추가 있으면 ✕ 다음 — §11.10.31)
        wrap.addEventListener('keydown', function (e) {
            // §11.10.24: 창 안 바텀시트가 올라와 있으면 Esc 는 시트만 내린다
            if (e.key === 'Escape') { e.preventDefault(); if (rockPanel) closeRockPanel(); else if (popup && popup.sheet && popup.sheet.isOpen()) popup.sheet.close(); else closeMapPopup(); }
            else if (e.key === 'Tab') {
                e.preventDefault();
                var sh = popup && popup.sheet && popup.sheet.isOpen() ? [].slice.call(popup.sheet.el.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')).filter(function (b) { return !b.disabled && b.getClientRects().length; }) : [];
                var f = [x].concat([].slice.call(wrap.querySelectorAll('[data-sb-map-zoom]'))).concat(rockPanel ? [].slice.call(rockPanel.el.querySelectorAll('button')).filter(function (b) { return !b.disabled; }) : []).concat(sh), k = f.indexOf(document.activeElement);
                f[(k + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
            }
        });
        if (w.PopupStack) w.PopupStack.push('sb-map-popup', closeMapPopup);
        var p = popup; if (!bare) p.stop = build(body) || null;   // 붙인 뒤에 그려야 지도가 크기를 잰다(bare 는 위에서 이미 — ✕ 를 찾으려고)
        x.focus();
    }
    // ── 위험예측 배경 지도 + 바텀시트(2026-10-18 사용자 결정 — 설계서 §11.10.24·§11.10.26) ──
    // 원문: *"해상 위험 분석 예측 분석에서 혼잡도를 클릭했을 때 나오는 지도처럼 … 위성 지도에 그 숫자가 입력되도록 하고 그 숫자가 입력된 그 격자를 실제로 클릭해 볼수 있었으면 좋겠거든
    //        그래서 그 분석 자체를 바로 이 화면 안에서 볼수 있도록"* · *"배경지도가 위험예측으로 나오도록 … 해당 격자가 깜박이도록 … 바텀시트도 열어볼 수 있도록"*
    //        · 관광지 *"지도가 팝업으로 나오고 그 팝업에서 해당 영역이 깜빡이도록 하며 잠깐 뒤 자동으로 바텀시트가 올라왔으면"*.
    var AUTO_SHEET_MS = 200;   // 관광지 하나 팝업: 자료를 받아 그 영역이 깜빡이기 시작한 뒤 이만큼(0.2초 — 위험예측 시트가 누른 뒤 올라오는 hold 와 같은 값) 뒤 시트가 올라온다
    /** 부품이 다 실렸으면 StationBriefingRiskMap, 아니면 null(관리자 미리보기 단독 등 — 종전 지도). @returns {Object|null} [연계] ← miniMap·nowNode·basisList */
    function RM() { var m = w.StationBriefingRiskMap; return m && m.ready() ? m : null; }
    /** 브리핑의 관할 경계(summary.sea.area — 연안 지도도 이 경계 상자로 관광지를 고른다). 예: seaArea(b) → [[[[126.1,33.3],…]]] @param {Object} b @returns {Array|null} */
    function seaArea(b) { var S = b && b.summary && b.summary.sea; return S && Array.isArray(S.area) && S.area.length ? S.area : null; }
    /** 연안 하루 값 시각 — 브리핑 날짜가 오늘(이 기기 KST)이면 없음(서버 지금), 뒤 날짜면 그날 00시. 예: targetDate '2026-10-18'·오늘 10-17 → '2026-10-18T00:00:00+09:00' @param {Object} b @returns {string|undefined} */
    function coastAt(b) { var d = b && b.targetDate, today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); return d && d > today ? d + 'T00:00:00+09:00' : undefined; }
    /**
     * 근거 지도(위험이 높아진 해역)의 위험 예측 시각 — 해상 시간 막대에서 그 단계(overview 는 overviewRank, 위험예보만은 rank)가 가장 높은 첫 칸. 그 칸이 지금보다 앞이면 없음(서버 지금 칸).
     * 예: timeBar [{at:'…T15:00',overviewRank:2}, {at:'…T18:00',overviewRank:2}] · 지금 10:05 → '…T15:00' @param {Object} b @param {string} key @returns {string|undefined}
     */
    function riskAt(b, key) {
        var best = null; ((b && b.sea && b.sea.timeBar) || []).forEach(function (s) { var r = Number(key === 'overview' ? s.overviewRank : s.rank) || 0; if (r > 0 && (!best || r > best.r)) best = { r: r, at: s.at }; });
        return best && Date.parse(best.at) > Date.now() ? best.at : undefined;
    }
    /**
     * 위험예측 배경 팝업 지도 + 그 창 안 바텀시트. 칸·관광지를 누르면 그 해상·연안 분석 시트가 0.2초 뒤 올라온다(위험예측과 같은 내용·같은 틀).
     * 예: riskPopup('한림파출소 관할 해역 선박 37척', 'now-all', {area, kind:'current', boxes:[], caption:'…'})
     * @param {string} title @param {string} key - data-sb-map-popup @param {Object} o - {area, kind, t, boxes, polys, caption, head(지도 위 요소), onLoad(d, stop, sheet)}
     * @returns {void} [연계] ← nowPopup·spotPopup / → openMapPopup·miniMap(opt.risk)·StationBriefingRiskMap.sheet
     */
    function riskPopup(title, key, o) {
        openMapPopup(title, function (body) {
            var P = popup, stop = null;
            if (o.head) body.appendChild(o.head);
            var sh = RM().sheet(P.wrap, {
                onOpen: function () { up(true); }, onClose: function () { up(false); },
                // 연안 시트의 위험구역 목록을 누르면 위험예측처럼 그 구역을 지도에 칠하고 그 줄을 눌림 표시
                onHazard: function (id, S) { fetch('/api/risk-forecast/hazard-zones?ids=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (fc) { var c = stop && stop.risk(); if (c && fc && fc.features) { c.layer.showHazards(fc, [30, 30, 30, 30]); S.markZone(id); } }).catch(function (e) { console.warn('[연안 안전 브리핑] 위험구역을 받지 못함', e && e.message); }); }
            });
            P.sheet = sh;
            /** 시트가 올라오면 창을 위로 붙이고 지도를 줄여 고른 칸이 시트에 가려지지 않게(내려가면 되돌림). @param {boolean} on */
            function up(on) {
                P.wrap.classList.toggle('sb-sheet-up', on);
                if (!stop || !stop.map) return;
                stop.map.updateSize(); var c = stop.risk(), ex = c && c.layer.selectionExtent();
                if (on && ex) stop.map.getView().fit(ex, { size: stop.map.getSize(), padding: [30, 30, 30, 30], maxZoom: 13 });   // 움직임 없이 — 시트가 올라오는 동안 지도는 이미 맞춰져 있다
            }
            stop = miniMap(body, o.area, o.boxes || [], o.caption, { big: true, polys: o.polys, risk: { kind: o.kind, t: o.t, interactive: true,
                onPick: function (kind, id, point) { sh.open(kind === 'coast' ? 'coast' : 'marine', id, point, o.t); },
                onLoad: function (d) { if (typeof o.onLoad === 'function') o.onLoad(d, stop, sh); } } });
            P.mapStop = stop;
            return function () { sh.destroy(); if (typeof stop === 'function') stop(); };
        }, key);
    }
    var nowState = null;   // 「지금 밀집」 마지막 값 {now, b} — nowNode 가 두고 updateNow(실시간 갱신)가 바꾼다. 열린 선박 팝업(nowPopup)이 이것을 읽는다
    /** 붐비는 해역 격자 상자(now.busiest.id 가 든 now.cells 줄). 예: busiestBox(now) → [126.2,33.4,126.225,33.425] @param {Object} now @returns {number[]|null} */
    function busiestBox(now) { var bz = now && now.busiest, c = bz && bz.id && Array.isArray(now.cells) ? now.cells.filter(function (x) { return x.id === bz.id; })[0] : null; return c ? c.box : null; }
    /** 선박 팝업 제목. 예: ('all') → '한림파출소 관할 해역 선박 37척' · ('busiest') → '한림항 북서방 … 18척'(붐비는 해역이 없어졌으면 「… — 지금 14척 이상 붐비는 해역 없음」) @param {string} which @returns {string} */
    function nowTitle(which) {
        var now = nowState.now, b = nowState.b, st = (b.station && b.station.name) || '', bz = now.busiest;
        return which === 'busiest' ? (bz && bz.name ? bz.name + ' ' + bz.count + '척' : st + ' 관할 — 지금 14척 이상 붐비는 해역 없음') : st + ' 관할 해역 선박 ' + now.count + '척';
    }
    /** 지도 위 시각 줄. 예: nowAtText({at:'2026-10-17T10:00:00+09:00'}) → '10:00 기준 · 새 선박 자료가 오면 자동으로 바뀝니다' @param {Object} now @returns {string} */
    function nowAtText(now) { var hm = /T(\d{2}:\d{2})/.exec(String(now && now.at || '')); return (hm ? hm[1] + ' 기준' : '지금') + ' · 새 선박 자료가 오면 자동으로 바뀝니다'; }
    /**
     * 「관할 해역 선박 N척」(all)·붐비는 해역(busiest) 팝업 — 위성지도 + 혼잡도 지금(칸 색·칸 안 선박 수, 위험예측 「혼잡도」 지금 화면과 같은 층) · 관할 경계 · 붐비는 해역 칸 깜빡임.
     * 칸을 누르면 그 칸 해상 분석 시트. 열려 있는 동안 실시간 선박 자료가 바뀌면(updateNow → popup.live) 제목·시각·깜빡임 칸·칸 색과 숫자를 다시(창은 그대로).
     * 사용자 원문 2026-10-18: *"이게 실시간으로 업데이트 되면 이 지도도 업데이트 돼야 될것 같고"* · *"제주 남남서방 0.9해리 해역(223-7해구)" 눌렀을 때에도 동일하게 직전 지시와 동일하게 조치."*
     * 예: nowPopup('busiest') @param {string} which - 'all'|'busiest' @returns {void} [연계] ← nowNode 링크 / → riskPopup · popup.live ← updateNow
     */
    function nowPopup(which) {
        var b = nowState.b, st = (b.station && b.station.name) || '', head = el('p', 'sb-small sb-now-at', nowAtText(nowState.now)), bx = busiestBox(nowState.now);
        head.setAttribute('data-sb-now-at', '');
        riskPopup(nowTitle(which), 'now-' + which, { area: seaArea(b), kind: 'current', head: head, boxes: which === 'busiest' && bx ? [bx] : [],
            caption: '칸 색 = 지금 혼잡도(밀집도) · 칸 안 숫자 = 선박 수 · ' + (which === 'busiest' ? '빨간 테두리(깜빡임) = 가장 붐비는 해역 · ' : '') + '파란 선 = ' + st + ' 관할 해역 · 칸을 누르면 해상 분석' });
        var P = popup;
        P.live = function () {
            if (popup !== P || !nowState) return;
            if (P.title) P.title.textContent = nowTitle(which);
            head.textContent = nowAtText(nowState.now);
            var s = P.mapStop; if (!s) return;
            if (which === 'busiest') { var nb = busiestBox(nowState.now); s.highlight(nb ? [nb] : [], []); }
            var c = s.risk(); if (c) c.load().catch(function (e) { console.warn('[연안 안전 브리핑] 선박 지도 갱신 실패', e && e.message); });
        };
    }
    /** 브리핑에서 관광지 이름 → 관광지 id(연안 카드 link.spotId). 없으면 null(지도 자료에서 이름으로 찾는다). 예: spotIdOf(b,'협재해수욕장') → '50110|협재해수욕장' @param {Object} b @param {string} name @returns {string|null} */
    function spotIdOf(b, name) { var c = ((b && b.land && b.land.cards) || []).filter(function (x) { return x && x.name === name && x.link && x.link.spotId; })[0]; return c ? c.link.spotId : null; }
    /**
     * 관광지 하나 팝업(연안 근거 줄의 관광지 이름) — 위성지도 + 연안 위험 색(그날 하루 값 — 위험예측 연안 화면과 같은 층) · 그 관광지 영역 깜빡임 · 잠깐 뒤 그 관광지 연안 분석 시트가 저절로 올라온다
     * (해상 팝업은 누를 칸이 여럿이라 저절로 올리지 않는다 — 사용자 *"이것은 한곳만이라서 바텀시트를 자동으로 올릴 수 있을 것 같은데"*). 다른 관광지를 누르면 그 시트로 바뀐다.
     * 예: spotPopup('모충사', b) @param {string} name @param {Object} b @returns {void} [연계] ← basisList(연안 근거 「이름 — 내용」 줄) / → riskPopup(kind coast)
     */
    function spotPopup(name, b) {
        var t = coastAt(b), id = spotIdOf(b, name), done = false;
        riskPopup(name, 'spot', { area: seaArea(b), kind: 'coast', t: t,
            caption: '지역 색 = 연안 위험 예측(' + (t ? dateText(t.slice(0, 10)) : '오늘') + ' 하루 값) · 빨간 테두리(깜빡임) = ' + name + ' · 다른 관광지를 누르면 그 연안 분석',
            onLoad: function (d, stop, sh) {
                var s = (d.spots || []).filter(function (p) { return id ? p.id === id : p.name === name; })[0], P = popup;
                if (!s) { if (stop.caption) stop.caption.textContent = name + ' 위치를 위험예측 관광지 자료에서 찾지 못했습니다 · ' + stop.caption.textContent; return; }
                stop.highlight([], s.geometry ? [s.geometry] : []); stop.focus(14); stop.risk().select('coast', s.id);
                if (done) return; done = true;
                if (popup === P && !sh.isOpen()) sh.open('coast', s.id, null, t, AUTO_SHEET_MS);   // 시트 hold(AUTO_SHEET_MS) — 그동안 영역이 먼저 깜빡인다
            } });
    }
    // ── 근거 펼침 지도(위험이 높아진 해역)에서 칸을 누르면 올라오는 화면 바텀시트(창 없이 — 위험예측 시트와 같은 자리) ──
    var pageSheet = null, pageWatch = null;
    /**
     * 화면 바텀시트를 연다(처음 한 번 만든다). 다른 탭으로 옮기면·본문을 다시 그리면·펼친 지도를 접으면 내린다.
     * 예: openPageSheet('marine', 'GR4_F4K23_P4', {lon:126.54,lat:33.56}, '2026-10-17T15:00:00+09:00')
     * @param {string} kind @param {string} id @param {Object} point @param {string} [t] @returns {void} [연계] ← basisList 지도 onPick / → StationBriefingRiskMap.sheet
     */
    function openPageSheet(kind, id, point, t) {
        if (!pageSheet) {
            pageSheet = RM().sheet(document.body, { onClose: function () { if (pageWatch) { pageWatch.disconnect(); pageWatch = null; } } });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pageSheet && pageSheet.isOpen() && !popup) pageSheet.close(); });
        }
        pageSheet.open(kind, id, point, t);
        if (!pageWatch && w.MutationObserver) { pageWatch = new MutationObserver(function () { closePageSheet(); }); pageWatch.observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] }); }
    }
    /** 화면 바텀시트를 내린다(열려 있거나 올라오는 중일 때만). 예: closePageSheet() @returns {void} [연계] ← render·근거 지도 접기·탭 이동 */
    function closePageSheet() { if (pageSheet && (pageSheet.isOpen() || pageSheet.el.classList.contains('rf-shown') || pageSheet.el.hasAttribute('data-sb-rf-kind'))) pageSheet.close(); }
    /**
     * 실시간 「지금 밀집」만 바꾼다(브리핑 본문은 그대로 — 2026-10-18 사용자 *"실시간 현황이 계속 표출될 수 있도록 … 시간도 계속 바뀌어가면서"*, 설계서 §11.10.24).
     * 줄([data-sb-now])을 새 글·링크로 바꾸고, 선박 팝업이 열려 있으면 그 지도·제목도(popup.live). 줄이 새로 생기거나 사라져야 하면 거짓 — 부르는 쪽이 본문을 다시 그린다.
     * 예: updateNow(box, {briefing, now:{at, count:38, text:'10:05 기준 …', cells, busiest}}) → true
     * @param {HTMLElement} box @param {Object} resp - 브리핑 응답(now 를 새 값으로 바꾼 것) @returns {boolean} [연계] ← station_briefing.js pollNow·loadBriefing / → nowNode·popup.live
     */
    function updateNow(box, resp) {
        var now = resp && resp.now, b = resp && resp.briefing, node = box && box.querySelector('[data-sb-now]');
        if (!b) return false;
        if (!now || !now.text) return !node;
        if (!node) return false;
        if (node.tagName === 'DIV') node.parentNode.replaceChild(nowNode(now, b), node); else node.textContent = now.text;
        if (popup && typeof popup.live === 'function') popup.live();
        return true;
    }
    /** 실시간 선박 팝업(지금 밀집 — now-all·now-busiest)이 열려 있나(열려 있는 동안은 아코디언이 접혀도 1분 갱신을 한다). 예: nowPopupOpen() → true @returns {boolean} [연계] ← station_briefing.js nowShown */
    function nowPopupOpen() { return !!(popup && /^now-/.test(popup.key)); }
    /** 아무 팝업 지도나 열려 있나(10분 정기 갱신이 같은 판이면 본문을 다시 그리지 않게 — 열린 창이 닫히지 않게). 예: popupOpen() → false @returns {boolean} [연계] ← station_briefing.js loadBriefing */
    function popupOpen() { return !!popup; }
    /**
     * 글 안의 링크 단추(밑줄 글 — 근거 줄 펼침 단추와 같은 .sb-x-btn 모양). 예: mapLink('대해구 75', fn, 'haegu') → <button class="sb-x-btn sb-maplink" data-sb-maplink="haegu" aria-haspopup="dialog">
     * @param {string} text @param {function(HTMLElement)} onOpen - 눌렀을 때(단추를 넘긴다) @param {string} key @returns {HTMLButtonElement} [연계] ← analysisNodes·nowNode
     */
    function mapLink(text, onOpen, key) {
        var b = el('button', 'sb-x-btn sb-maplink', text); b.type = 'button'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('data-sb-maplink', key);
        b.addEventListener('click', function (e) { e.stopPropagation(); onOpen(b); });
        return b;
    }
    // ── 잠기는 바위(간출암) — 링크 → 팝업 지도 → 마커 → 간출암 조석 곡선 상자(2026-10-17 사용자 결정 — 설계서 §11.10.10) ──
    // 원문: *"그 간출암 두 곳 그 부분에 하이퍼링크를 걸어서 누르면 그 바위 두 곳이 어디에 있는지 지도에 표출 … 그 바위 마커를 누르면 우리 해양안전생활에서 위험지형에
    //       저 간출암을 누르면 시간대에 따라 팝업으로 언제 잠기고 뭐 이런 게 별도의 박스로 정보를 제공하잖아. 거기까지 제공될 수 있도록"*.
    // 상자는 새로 만들지 않고 해양안전 「위험지형」의 것을 그대로 쓴다(hazard_rocks.js mountTidePanel → window.HazardRockTidePanel). 바위 번호(id)는 서버가 준 hazard_rocks.json id.
    var rockPanel = null;
    /** 간출암 상자를 닫는다(받기 멈춤·떼기·마커 고리 지움). 예: closeRockPanel(). @returns {void} [연계] ← openRockPanel(✕·뒤로가기)·openMapPopup(Esc)·closeMapPopup */
    function closeRockPanel() {
        if (!rockPanel) return;
        var r = rockPanel; rockPanel = null;
        if (w.PopupStack) w.PopupStack.remove('sb-rock-panel');
        if (r.ctl) r.ctl.close();
        if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
        if (typeof r.done === 'function') r.done();
    }
    /**
     * 팝업 지도 창 위 가운데에 간출암 조석 곡선 상자를 띄운다 — 해양안전 「위험지형」 간출암 팝업과 같은 함수(HazardRockTidePanel.mount)·같은 모양(.hazard-rock-popup.rock-tide-popup).
     * 다른 마커를 누르면 상자를 바꾼다. hazard_rocks.js 가 없으면(그 화면에 안 실렸으면) 아무것도 띄우지 않고 거짓.
     * 예: openRockPanel({id:812, lat:33.4, lon:126.2, v:0.9, times:['02:40']}, unselectFn) → true
     * @param {Object} row - summary.rocks.rows 한 줄 @param {Function} done - 상자가 닫힐 때(마커 고리 지움) @returns {boolean}
     * [연계] ← rocksLine(miniMap onPoint) / → HazardRockTidePanel.mount(hazard_rocks.js)·closeRockPanel
     */
    function openRockPanel(row, done) {
        closeRockPanel();
        var RP = w.HazardRockTidePanel;
        if (!popup || !RP || typeof RP.mount !== 'function') { if (typeof done === 'function') done(); return false; }
        var el = document.createElement('div'); el.className = 'hazard-rock-popup rock-tide-popup sb-rockbox';
        el.setAttribute('data-sb-rockbox', String(row.id)); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', RP.title(row.v));
        el.addEventListener('click', function (e) { e.stopPropagation(); });
        popup.wrap.appendChild(el);
        rockPanel = { el: el, ctl: null, done: done };
        rockPanel.ctl = RP.mount(el, { rockId: row.id, v: row.v, lon: Number(row.lon), lat: Number(row.lat), onClose: function () { closeRockPanel(); } });
        if (w.PopupStack) w.PopupStack.push('sb-rock-panel', closeRockPanel);
        var c = el.querySelector('.rtp-close'); if (c && c.focus) c.focus({ preventScroll: true });
        return true;
    }
    /**
     * (물때)·조석 칸의 서버 물때 줄 하나 — 그 줄에 summary.rocks.link(「잠기는 바위(간출암) N곳」)가 있고 관할 경계(summary.sea.area)가 있으면 그 글만 팝업 지도 링크로.
     * 지도 = 관할 경계(파란 선) + 그 N곳 간출암 마커 — 마커를 누르면 openRockPanel. 그 밖은 글만(옛 판·바위 목록 없음).
 *   §11.10.31(사용자 *"이거 배경을 위성지도로 해주고"* · *"해당 지도에서 확대 축소도 가능토록 해줘."*): 바탕 = 위성지도(miniMap opt.sat) · 끌기·핀치·휠·더블탭 + +/− 단추(opt.zoom).
     * 예: rocksLine('sb-sum-tide', '관할 내 잠기는 바위(간출암) 2곳이 02:40~16:41 사이 …', b) → <p class="sb-sum-tide" data-sb-rocks>관할 내 <button data-sb-maplink="rocks">잠기는 바위(간출암) 2곳</button>이 …</p>
     * @param {string} cls - p 의 class @param {string} line - 서버 글 @param {Object} b - briefing(summary.rocks·summary.sea.area·station) @returns {HTMLElement}
     * [연계] ← tidePart·tide / → mapLink·openMapPopup·miniMap(points)·openRockPanel
     */
    function rocksLine(cls, line, b) {
        var p = el('p', cls), S = (b && b.summary) || {}, R = S.rocks, text = String(line || ''), i = R && R.link ? text.indexOf(R.link) : -1;
        var area = S.sea && Array.isArray(S.sea.area) && S.sea.area.length ? S.sea.area : null;
        if (i < 0 || !area || !Array.isArray(R.rows) || !R.rows.length) { appendText(p, text); return p; }
        var stName = (b.station && b.station.name) || '';
        p.setAttribute('data-sb-rocks', '');
        appendText(p, text.slice(0, i));
        p.appendChild(mapLink(R.link, function () {
            openMapPopup(stName + ' 관할 내 ' + R.link, function (body) {
                return miniMap(body, area, [], '바위 그림 = 이 날 물에 잠기는 간출암(누르면 오늘·내일·모레 조석 곡선과 잠기는 시각) · 파란 선 = ' + stName + ' 관할 해역', { big: true, points: R.rows, onPoint: openRockPanel, sat: true, zoom: true });   // §11.10.31 위성 바탕 + 확대·축소
            }, 'rocks');
        }, 'rocks'));
        appendText(p, text.slice(i + R.link.length));
        return p;
    }
    /**
     * 「지금 밀집」 줄 — 「관할 해역 선박 N척」과 가장 붐비는 해역 이름을 팝업 지도 링크로(§11.10.9 ⑥). 관할 경계(summary.sea.area)나 격자(now.cells)가 없으면 글만.
     * 예: nowNode({text:'20:45 기준 관할 해역 선박 35척 · …\n죽변항 … 27척 — 충돌·접촉 주의', count:35, cells:[…], busiest:{name:'죽변항 …', count:27, id:'GR4_…'}}, b)
     * @param {Object} now - resp.now @param {Object} b - briefing @returns {HTMLElement} div.sb-now(두 줄 이상이면 안에 ul.sb-now-list) [연계] ← summaryBodyV3 / → mapLink·openMapPopup·miniMap
     */
    function nowNode(now, b) {
        var box = el('div', 'sb-now'), text = String(now.text || ''); box.setAttribute('data-sb-now', ''); nowState = { now: now, b: b };
        var area = b.summary && b.summary.sea && Array.isArray(b.summary.sea.area) && b.summary.sea.area.length ? b.summary.sea.area : null, cells = Array.isArray(now.cells) ? now.cells : [];
        var stName = (b.station && b.station.name) || '', links = [];
        if (area && cells.length) {
            var all = '관할 해역 선박 ' + now.count + '척';
            // §11.10.24(2026-10-18): 위험예측 배경(위성지도 + 혼잡도 지금 칸 색·선박 수 — 칸을 누르면 해상 분석 시트, 열린 동안 실시간 갱신). 부품이 없으면 종전 청록 칸 지도
            links.push({ text: all, key: 'all', open: function () { if (RM()) return nowPopup('all'); openMapPopup(stName + ' 관할 해역 선박 ' + now.count + '척', function (body) { return miniMap(body, area, [], '청록 칸 = 지금 선박이 있는 해역 격자 · 칸 안 숫자 = 선박 수 · 파란 선 = ' + stName + ' 관할 해역', { big: true, cells: cells }); }, 'now-all'); } });
            var bz = now.busiest, bc = bz && bz.id ? cells.filter(function (c) { return c.id === bz.id; })[0] : null;
            if (bz && bz.name && bc) links.push({ text: bz.name, key: 'busiest', open: function () { if (RM()) return nowPopup('busiest'); openMapPopup(bz.name + ' ' + bz.count + '척', function (body) { return miniMap(body, area, [bc.box], '빨간 테두리(깜빡임) = ' + bz.name + ' · 칸 안 숫자 = 선박 수 · 파란 선 = ' + stName + ' 관할 해역', { big: true, cells: cells, dim: true }); }, 'now-busiest'); } });
        }
        // 줄(서버 글의 줄바꿈)마다 — 두 줄 이상이면 「•」 목록(근거 목록과 같은 걸린 들여쓰기), 한 줄이면 점 없이 글(2026-10-18 사용자 *"여기도 각 문장이 점으로 시작되었으면 좋겠어."* ·
        //   *"만약 단독이면 점 불필요"* — 설계서 §11.10.20 덧붙임 14, 카드 [오늘 예상]과 같은 규칙). 링크는 그 글이 든 줄에서 처음 나온 곳 하나.
        var lines = text.split('\n').filter(function (x) { return x.trim(); }), used = {}, ul = lines.length > 1 ? el('ul', 'sb-list sb-now-list') : null;
        if (ul) box.appendChild(ul);
        lines.forEach(function (line) {
            var p = ul ? el('li') : box, at = 0;
            links.filter(function (l) { return !used[l.key]; }).map(function (l) { return { l: l, i: line.indexOf(l.text) }; }).filter(function (x) { return x.i >= 0; }).sort(function (a, c) { return a.i - c.i; }).forEach(function (x) {
                if (x.i < at) return;
                appendText(p, line.slice(at, x.i)); p.appendChild(mapLink(x.l.text, x.l.open, 'now-' + x.l.key)); at = x.i + x.l.text.length; used[x.l.key] = true;
            });
            appendText(p, line.slice(at));
            if (ul) ul.appendChild(p);
        });
        return box;
    }
    /**
     * (근거) 목록 — 서버가 준 줄 번호(detail.line)에 지도 재료(boxes)와 관할 경계(area)가 있으면 그 줄을 펼침 버튼으로, 풀이(note)가 있으면 줄 아래 작게.
     * 연안 근거 첫 줄에 서버 raised(§11.10.9)가 있으면 그 줄 안의 「평소보다 위험이 높아진 곳 N곳」(raised.link)만 버튼 — 누르면 바로 아래 표(raisedTable). 글에 link 가 없으면 줄 끝에 버튼.
     * 예: basisList({basis:['관할 해역 30칸 중 위험이 높아진 해역 1칸', …], area:[…], detail:[{line:0,key:'overview',boxes:[[…]]}]}, b) → <ul class="sb-list sb-sum-basis">
     *     basisList({basis:['관할 관광지 30곳 중 평소보다 위험이 높아진 곳 12곳 (주의 3곳 · 관심 9곳)', …], raised:{line:0, link:'평소보다 위험이 높아진 곳 12곳', rows:[…]}}, b)
     * @param {Object} sum - {basis, area, detail, raised} @param {Object} b - briefing(관할 이름) @returns {HTMLElement} [연계] ← summaryBodyV2·summaryBodyV3 / → expander·miniMap·raisedTable
     */
    /**
     * 근거 줄 글 칠하기(2026-10-18 사용자 *"각 수치, 등급을 색상반영 해주고, 또한 지명은 흰색 볼드 처리해줘."* — 설계서 §11.10.20 덧붙임 17, 시안 Main.dc.html):
     *   「연안 위험지수 100(매우 높음, 예상)」의 「100(매우 높음, 예상)」·「2.4배」·「9m/s」·「12초」 = 그 관광지 단계 색 굵게(rank 없으면 흰 굵게) ·
     *   특보 이름(「풍랑주의보 예비특보」·「… 해제 뒤」 = 노랑, 「… 발효」 = 주의보 주황·경보 빨강) 굵게. 지명(「이름 —」)은 CSS .sb-basis-k 흰 굵게. 글은 textContent 로만.
     * 예: basisNodes(span, '연안 위험지수 100(매우 높음, 예상), 방문객 평소의 2.4배(예상)', 3) → 「연안 위험지수 」<b 빨강>100(매우 높음, 예상)</b>「, 방문객 평소의 」<b 빨강>2.4배</b>「(예상)」
     * @param {HTMLElement} node @param {string} text @param {number} [rank] - 그 관광지 단계(1~3) @returns {void} [연계] ← basisList / → colorOf·appendText
     */
    function basisNodes(node, text, rank) {
        var t = String(text), re = new RegExp('((?:' + HL_KINDS + ')(?:주의보|경보))( 예비특보| 해제 뒤| 발효)?|연안 위험지수 (\\d+(?:\\([^)]*\\))?)|(\\d+(?:\\.\\d+)?(?:배|m\\/s|초))', 'g'), at = 0, m;
        var paint = function (txt, r, red) { var b = el('b', 'sb-hl sb-bv', txt); if (red || Number(r) === 3) b.classList.add('sb-hl-red'); else if (Number.isFinite(Number(r)) && r !== undefined) b.style.color = colorOf(Number(r)); else b.classList.add('sb-hl-b'); return b; };
        while ((m = re.exec(t))) {
            var s0 = m.index, txt = m[0];
            if (m[1]) { var tail = m[2] || '', warnR = /예비특보|해제 뒤/.test(tail) ? 1 : /경보/.test(m[1]) ? 3 : 2; appendText(node, t.slice(at, s0)); node.appendChild(paint(m[1] + tail, warnR)); at = s0 + txt.length; continue; }
            if (m[3]) { s0 = m.index + txt.length - m[3].length; txt = m[3]; }
            appendText(node, t.slice(at, s0)); node.appendChild(paint(txt, rank)); at = s0 + txt.length;
        }
        appendText(node, t.slice(at));
    }
    /** 근거 줄 「이름 —」의 관광지 단계. 예: spotRank(b, '하트해변') → 3 · 없으면 undefined. @param {Object} b @param {string} name @returns {number|undefined} [연계] ← basisList */
    function spotRank(b, name) { var L = (b && b.land) || {}, hit = (L.attentionAll || []).concat(L.cards || []).filter(function (x) { return x && x.name === name; })[0]; return hit ? Number(hit.rank) : undefined; }
    /**
     * 해역 카드 [기상 예보] 글 칠하기(2026-10-18 사용자 *"여기서도 주요 수치, 단어 등은 볼드 처리해줘. 색상도 필요 시 넣어주고"* — 설계서 §11.10.20 덧붙임 19, 시안 Sea.dc.html):
     *   「최대 파고 1.7m·풍속 11.1m/s」·바다 상태 말(「물결이 다소 높고 바람이 강할」·「잔잔한 바다일」 — 「 것으로」 앞까지) 흰 굵게 · 「21시부터 풍랑주의보 발효」 같은 특보 구절 = 주의보 주황·경보 빨강 굵게
     *   (예비특보 구절은 노랑). 「(223-9해구 예보)」 꼬리는 그대로. 서버 글(today.forecast)을 화면이 칠한다 — 글은 textContent 로만.
     *   §11.10.22 C: 서버 글이 「유의파고 1.7m·풍속 11.1m/s」(종전 「최대 파고 …」)로 바뀌어 둘 다 굵게(옛 판 저장 글).
     * 예: forecastNodes(span, '유의파고 1.7m·풍속 11.1m/s로 물결이 다소 높고 바람이 강할 것으로 예상됩니다(223-9해구 예보).')
     * @param {HTMLElement} node @param {string} text @returns {void} [연계] ← seaCardBadged / → colorOf·appendText
     */
    function forecastNodes(node, text) {
        var t = String(text), marks = [], m, add = function (a, z, cls, r) { if (z > a && marks.every(function (k) { return z <= k.a || a >= k.b; })) marks.push({ a: a, b: z, cls: cls, r: r }); };
        var wr = new RegExp('(?:\\d{1,2}시(?:부터|까지)? )?(?:' + HL_KINDS + ')(?:주의보|경보)(?: 예비특보)?(?: 발효(?: 중| 예정)?| 해제(?: 예고)?)?', 'g');
        while ((m = wr.exec(t))) add(m.index, m.index + m[0].length, 'warn', /예비특보|해제/.test(m[0]) ? 1 : /경보/.test(m[0]) ? 3 : 2);
        var mx = SEA_VALS_RE; mx.lastIndex = 0;
        while ((m = mx.exec(t))) add(m.index, m.index + m[0].length, 'b');
        var st = /(?:잔잔한 바다일|잔잔해질|(?:물결|바람)이 [^.,()]*?)(?= 것으로)|잔잔하다가/g;
        while ((m = st.exec(t))) add(m.index, m.index + m[0].length, 'b');
        marks.sort(function (x, y) { return x.a - y.a; }); var at = 0;
        marks.forEach(function (k) { appendText(node, t.slice(at, k.a)); var b = el('b', 'sb-hl sb-fv', t.slice(k.a, k.b)); if (k.cls === 'warn') { if (k.r === 3) b.classList.add('sb-hl-red'); else b.style.color = colorOf(k.r); b.setAttribute('data-rank', String(k.r)); } else b.classList.add('sb-hl-b'); node.appendChild(b); at = k.b; });
        appendText(node, t.slice(at));
    }
    /**
     * 총평 결론 줄 — 「…의 단계는 "주의"입니다.」의 따옴표 단계 말(따옴표 포함)을 그 단계 색 굵게(2026-10-18 사용자 *"주의 등 단계에 색상 적용 필요"* — 설계서 §11.10.20 덧붙임 23).
     *   경계 = .sb-hl-red(어두운 바탕 위 읽히는 밝은 빨강), 주의·관심·평소 수준 = colorOf(단계), 확인 불가 = 회색. 나머지 글은 그대로(textContent).
     * 예: headlineNode('오늘 한림파출소 관할 연안의 단계는 "주의"입니다.', 2, '주의') → <p class="sb-headline">…<span class="sb-hl sb-hl-lv" style="color:#fb923c">"주의"</span>입니다.</p>
     * @param {string} text @param {number} rank @param {string} word @returns {HTMLElement} [연계] ← summaryBodyV3(block) / → colorOf
     */
    function headlineNode(text, rank, word) {
        var p = el('p', 'sb-headline'), t = String(text), m = /"[^"]+"/.exec(t);
        if (!m) { appendText(p, t); return p; }
        appendText(p, t.slice(0, m.index));
        var sp = el('span', 'sb-hl sb-hl-lv', m[0]), col = colorOf(rank, word); sp.setAttribute('data-rank', String(rank));
        if (Number(rank) === 3) sp.classList.add('sb-hl-red'); else sp.style.color = col;
        p.appendChild(sp); appendText(p, t.slice(m.index + m[0].length));
        return p;
    }
    function basisList(sum, b) {
        var u = el('ul', 'sb-list sb-sum-basis'), det = {}, area = Array.isArray(sum.area) && sum.area.length ? sum.area : null;
        var rz = sum.raised && Array.isArray(sum.raised.rows) && sum.raised.rows.length ? sum.raised : null;
        (Array.isArray(sum.detail) ? sum.detail : []).forEach(function (d) { if (d && Number.isFinite(Number(d.line))) det[Number(d.line)] = d; });
        sum.basis.forEach(function (text, i) {
            // 위험예보만 해역 줄의 풀이(옛 판 note 「(한국해양교통안전공단 예보에서는 …)」)는 보이지 않는다 — §11.10.12 사용자 *"이 텍스트는 그냥 빼는게 좋겠어"*
            var li = el('li'), d = det[i], note = d && d.note && d.key !== 'accidentOnly' ? el('p', 'sb-small sb-basis-note', d.note) : null;
            if (rz && Number(rz.line) === i) {
                var link = String(rz.link || ''), at = link ? text.indexOf(link) : -1, rx = expander(link || '위험이 높아진 곳', function (panel) { raisedTable(panel, rz); }, 'raised');
                if (at >= 0) { appendText(li, text.slice(0, at)); li.appendChild(rx.btn); appendText(li, text.slice(at + link.length)); }
                else { appendText(li, text + ' '); li.appendChild(rx.btn); }
                li.appendChild(rx.panel);
            } else if (d && area && Array.isArray(d.boxes) && d.boxes.length) {
                // §11.10.24(2026-10-18 사용자 *"배경지도가 위험예측으로 나오도록 … 해당 격자가 깜박이도록 … 바텀시트도 열어볼 수 있도록"*): 위험이 높아진 해역·위험예보만 해역 줄은
                //   위성지도 + 위험 예측 색(그 단계가 가장 높은 첫 시각) — 칸을 누르면 화면 바텀시트(해상 분석). 대해구 줄(haegu)은 종전 지도
                var useRisk = (d.key === 'overview' || d.key === 'accidentOnly') && !!RM(), rk = useRisk ? riskAt(b, d.key) : undefined;
                var x = expander(text, function (panel) {
                    var cap0 = mapCaption(d, b.station, text);
                    if (!useRisk) return miniMap(panel, area, d.boxes, cap0);
                    var st = miniMap(panel, area, d.boxes, cap0 + ' · 칸을 누르면 해상 분석', { risk: { kind: 'risk', t: rk,
                        onPick: function (kind, id, point) { openPageSheet('marine', id, point, rk); },
                        onLoad: function (dd) { if (st && st.caption) st.caption.textContent = '칸 색 = ' + kstText(dd.forecastAt || dd.t) + ' 위험 예측 · ' + cap0 + ' · 칸을 누르면 해상 분석'; } } });
                    return function () { closePageSheet(); if (typeof st === 'function') st(); };
                }, 'map-' + (d.key || ''), false, d.key === 'accidentOnly');
                li.appendChild(x.btn); if (note) li.appendChild(note); li.appendChild(x.panel);
            } else {
                // 「이름 — 내용」 줄(연안 근거 「하트해변 — 연안 위험지수 100(매우 높음, 예상), …」)은 두 칸 — 「이름 —」 줄지 않는 칸 + 내용 칸, 둘째 줄이 내용 첫 글자 위치에서
                //   (2026-10-18 사용자 *"첫 텍스트 시작하는 위치에 다음줄 텍스트가 시작되도록 해줘."* — 설계서 §11.10.20 덧붙임 12). 이름이 길면(20자 넘음 — 해역 이름 등) 종전 한 덩어리(좁은 화면에서 넘치지 않게).
                var kv = /^([^—]{1,20}?) — ([^]+)$/.exec(String(text));
                if (kv) {
                    var row2 = el('div', 'sb-basis-kv'), bv = el('span', 'sb-basis-v'), bk = el('span', 'sb-basis-k'), nm = kv[1];
                    // §11.10.26(2026-10-18): 관광지 이름(연안 근거 — 브리핑이 아는 관광지일 때만) → 그 관광지 팝업 지도(영역 깜빡임 + 잠깐 뒤 연안 분석 시트 자동).
                    //   글자 색·굵기·크기는 그대로, 밑줄만(사용자 *"텍스트 색상과 스타일이 바뀌지 않도록 하고 밑줄만 쳐질 수 있도록 해줘."* — .sb-spotlink)
                    if (spotRank(b, nm) !== undefined && RM() && seaArea(b)) { var sl = mapLink(nm, function () { spotPopup(nm, b); }, 'spot'); sl.className = 'sb-spotlink'; bk.appendChild(sl); appendText(bk, ' — '); }
                    else appendText(bk, nm + ' — ');
                    row2.appendChild(bk); basisNodes(bv, kv[2], spotRank(b, kv[1])); row2.appendChild(bv); li.appendChild(row2);
                }
                else basisNodes(li, text, undefined);   // 공통 줄(「풍랑주의보 예비특보(…)」 등) — 특보 이름만 색(§11.10.20 덧붙임 17)
                if (note) li.appendChild(note);
            }
            if (d && d.key) li.setAttribute('data-sb-basis', d.key);
            u.appendChild(li);
        });
        return u;
    }
    /**
     * 「총평과 권고」 새 모양(2026-10-17 사용자 결정 §11.10 — *"오늘 한림파출소 관할 연안의 단계는 "주의 필요" 입니다. (줄바꿈) (근거)가 나오도록"*).
     * 육상(보일 때)·해상마다: 단계 배지 줄 → 결론(굵게) → (근거) 목록 → (권고) → (물때, 육상만) → AI 해설(있으면, 작은 이름표 「해설 · ChatGPT」).
     * 결론·근거·권고는 서버가 계산한 글(summary), 해설만 AI(overview.land·sea — 틀이면 없음). 글은 모두 textContent.
     * 예: summaryBody(body, {summary:{land:{headline:'오늘 한림파출소 관할 연안의 단계는 "주의 필요"입니다.',basis:[…],advice:'…',tide:[…]},sea:{…}},…}, resp, ov, true, true)
     * @param {HTMLElement} body @param {Object} b - briefing @param {Object} resp @param {Object} ov - b.overview @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·list
     */
    function summaryBody(body, b, resp, ov, showSea, showLand) {
        var ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        /** 육상·해상 한 덩어리. */
        var block = function (kind, label, rank, word, sum, commentary) {
            var wrap = el('div', 'sb-sum'); wrap.setAttribute('data-sb-summary', kind);
            var lv = el('div', 'sb-levels'); lv.appendChild(el('span', 'sb-level-k', label)); lv.appendChild(chip(rank, word)); wrap.appendChild(lv);
            if (kind === 'sea') komsaBadges(b).forEach(function (x) { lv.appendChild(x); });   // §11.10.12 — 종전 노란 안내 한 줄 대신 결론 배지 오른쪽 KOMSA 배지
            wrap.appendChild(el('p', 'sb-headline', sum.headline || ''));
            if (Array.isArray(sum.basis) && sum.basis.length) { wrap.appendChild(el('p', 'sb-sum-k', '(근거)')); var ul = list(sum.basis); ul.classList.add('sb-sum-basis'); wrap.appendChild(ul); }
            if (sum.advice) { var ad = el('p', 'sb-sum-advice'); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); appendText(ad, sum.advice); wrap.appendChild(ad); }
            if (Array.isArray(sum.tide) && sum.tide.length) { wrap.appendChild(el('p', 'sb-sum-k', '(물때)')); sum.tide.forEach(function (t) { wrap.appendChild(el('p', 'sb-sum-tide', t)); }); }
            if (ai && commentary) {
                var cm = el('p', 'sb-commentary'); cm.setAttribute('data-sb-commentary', kind);
                cm.appendChild(el('span', 'sb-commentary-k', '해설 · ' + who + ' ')); appendText(cm, commentary); wrap.appendChild(cm);
            }
            body.appendChild(wrap);
        };
        if (showLand && b.land && b.summary.land) block('land', '연안', b.land.level.rank, b.land.level.word, b.summary.land, ov.land);
        if (showSea && b.sea && b.summary.sea) block('sea', '해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, b.summary.sea, ov.sea);
        if (showSea && resp.now && resp.now.text) body.appendChild(el('p', 'sb-now', resp.now.text));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·근거·권고는 서버가 계산한 값입니다.'
            : 'AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }
    // (기상) 칸 수치 — 「1.0~2.5m」·「8~13m/s」·「20m/s」·「90km/h」·「30~50mm」·「00~06시」(서버 periodText·bulletinScan 글의 꼴). [연계] ← wxNodes
    var WX_NUM_RE = /\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?(?:m\/s|km\/h|mm|m(?![a-z/])|시)/g;
    // (기상) 특이사항의 위험 날씨 말 — 서버 bulletinScan 이 쓰는 말 그대로(gustNote 「(매우) 강한 바람」·waveNote 「높아짐」·windNote 「강해짐」·「돌풍과 천둥·번개」·「시간당 … 강한 비」·「짙은 안개」). [연계] ← wxNodes
    var WX_RISK_RE = /(?:매우 )?강한 (?:바람|비)|돌풍과 천둥·번개|천둥·번개|짙은 안개|높아짐|강해짐/g;
    /**
     * (기상) 칸 오전·오후 줄·특이사항 글 칠하기(2026-10-18 사용자 *"여기도 주요 수치나 그런거는 색상 또는 텍스트 스타일이 달랐으면 좋겠는데 ? 다른데 반영된 것 처럼"* — 설계서 §11.10.27).
     *   다른 칸과 같은 규칙·같은 class: 수치 흰 굵게(해역 카드 [기상 예보] forecastNodes·[오늘 예상] numText — §11.10.20 덧붙임 19·28) ·
     *   특보 이름 = forecastNodes 와 같은 색(「풍랑 예비특보」·「… 해제」 노랑 colorOf(1) · 「풍랑주의보」 주황 colorOf(2) · 「…경보」 .sb-hl-red) ·
     *   위험 날씨 말(WX_RISK_RE) 흰 굵게(분석 문단 기상 전망 위험 구절 — 덧붙임 4). 「구름많음」·「풍향 남→남서」·구역 이름·「(곳에 따라)」는 그대로. 겹치면 특보 → 수치 → 위험 말 순.
     *   서버 글(summary.weather rows[].text·notes[])을 화면이 칠한다 — 글은 textContent 로만(이어 붙이면 서버 글과 같다).
     * 예: wxNodes(li, '풍랑 예비특보: 오늘 새벽(00~06시) 제주도앞바다 — 물결 1.5~3.0m로 높아짐') → <b 노랑>풍랑 예비특보</b>: 오늘 새벽(<b 흰>00~06시</b>) 제주도앞바다 — 물결 <b 흰>1.5~3.0m</b>로 <b 흰>높아짐</b>
     * @param {HTMLElement} node @param {string} text @returns {HTMLElement} node [연계] ← weatherPart / → colorOf·appendText·HL_KINDS
     */
    function wxNodes(node, text) {
        var t = String(text), marks = [], m, add = function (a, z, k, r) { if (z > a && marks.every(function (x) { return z <= x.a || a >= x.b; })) marks.push({ a: a, b: z, k: k, r: r }); };
        var wr = new RegExp('(?:' + HL_KINDS + ')(?:(?:주의보|경보)(?: 예비특보)?(?: 발효(?: 중| 예정)?| 해제(?: 예고)?)?| 예비특보)', 'g');
        while ((m = wr.exec(t))) add(m.index, m.index + m[0].length, 'warn', /예비특보|해제/.test(m[0]) ? 1 : /경보/.test(m[0]) ? 3 : 2);
        [[WX_NUM_RE, 'num'], [WX_RISK_RE, 'risk']].forEach(function (p) { p[0].lastIndex = 0; while ((m = p[0].exec(t))) add(m.index, m.index + m[0].length, p[1]); });
        marks.sort(function (x, y) { return x.a - y.a; }); var at = 0;
        marks.forEach(function (k) { appendText(node, t.slice(at, k.a)); var b = el('b', 'sb-hl sb-fv', t.slice(k.a, k.b)); b.setAttribute('data-sb-wx-k', k.k); if (k.k === 'warn') { if (k.r === 3) b.classList.add('sb-hl-red'); else b.style.color = colorOf(k.r); b.setAttribute('data-rank', String(k.r)); } else b.classList.add('sb-hl-b'); node.appendChild(b); at = k.b; });
        appendText(node, t.slice(at)); return node;
    }
    /**
     * (기상) 칸 — 가장 가까운 앞바다 단기 해상예보 오전·오후 두 줄 + 출처 + 특이사항(§11.10.1·§11.10.2). summaryBodyV2(§11.10.1)·summaryBodyV3(§11.10.4) 공용.
     * 2026-10-17 사용자 결정(§11.10.9): 머리 「{구역} 기상 현황」을 결론 줄(.sb-headline 「… 해상의 단계는 "평소 수준"입니다」)과 같은 모양으로 — 원문 *"그 텍스트 크기와 스타일과 동일한 크기로 그 헤더 … 경북북부앞바다 기상 현황"*.
     *   「파출소 대표 위치에서 가장 가까운 특보구역(약 0.1km)」 줄과 먼 구역 안내(서버 weather.note — 울릉·흑산처럼 앞바다가 30km 넘게 먼 곳)는 그리지 않는다 — *"아예 삭제 … 필요가 없는 내용"*. 구역 이름은 머리에 남는다.
     *   특이사항: 항목이 있으면 머리 「특이사항」(같은 모양) + 목록 + 출처 · 항목이 없으면 이유와 상관없이(그날 특이사항 없음 · 단기 전망을 못 받음(bulletinMissing) · 뽑지 못함(notesFound)) 칸째 없음 —
     *   머리·안내·출처 줄 모두 없음(§11.10.11 사용자 결정 *"아예 빼 받지 못함 안내 넣지 말고"* — 이 자리만 L-291 「조용한 것이 이상 없는 것처럼 보이면 안 된다」보다 사용자 결정이 우선).
     *   §11.10.31(2026-10-18 사용자 *"오늘 오후 흐리고 한때 비 다음에 나오는 데이터는 "흐"자부터 다음줄에서 줄바꿈하여 시작할 수 있도록 해. 내일도 마찬가지로."*): 오전·오후 줄은 굵은 머리말 뒤 <br> —
 *     날씨 내용은 다음 줄 머리말 첫 글자 위치에서 시작(「•」 목록 걸린 들여쓰기). 특이사항 줄은 그대로.
 * 예: weatherPart(part, {weather:{zone:'제주도서부앞바다',rows:[{label:'오늘 오전',text:'…'}],source:'…',notes:[…]}}) → <div data-sb-part="weather"><p class="sb-headline sb-wx-head">제주도서부앞바다 기상 현황</p><ul class="sb-list sb-wx-rows"><li><b>오늘 오전 </b><br>…</li></ul>…</div>
     * @param {function(string,string):HTMLElement} part - 이름표 칸 만들기 @param {Object} S - summary @returns {void} [연계] ← summaryBodyV2·summaryBodyV3 / → wxNodes(줄·특이사항 칠하기 — §11.10.27)
     */
    function weatherPart(part, S) {
        var W = S.weather || {}, wp = part('weather', null), head = function (text, key) { var h = el('p', 'sb-headline sb-wx-head', text); h.setAttribute('data-sb-wx-head', key); wp.appendChild(h); };
        head((W.zone ? W.zone + ' ' : '') + '기상 현황', 'weather');
        if (!W.missing && Array.isArray(W.rows) && W.rows.length) {
            var wl = el('ul', 'sb-list sb-wx-rows'); W.rows.forEach(function (r) { var li = el('li'); li.appendChild(el('b', '', r.label + ' ')); li.appendChild(document.createElement('br')); wxNodes(li, r.text); wl.appendChild(li); }); wp.appendChild(wl);   // 수치 흰 굵게(§11.10.27) · 머리말 다음 줄에서 날씨 내용(§11.10.31 — 빈칸은 <br> 앞에 남아 textContent 그대로)
            if (W.source) wp.appendChild(el('p', 'sb-small', W.source));
        } else { var wm = el('p', 'sb-miss', '기상예보 자료를 확인하지 못했습니다.'); wm.setAttribute('data-sb-wx-missing', ''); wp.appendChild(wm); }
        if (!W.bulletinMissing && Array.isArray(W.notes) && W.notes.length) {
            head('특이사항', 'notes'); var nl = el('ul', 'sb-list sb-wx-notes'); W.notes.forEach(function (x) { nl.appendChild(wxNodes(el('li'), x)); }); wp.appendChild(nl);   // 수치·특보·위험 날씨 말 칠하기(§11.10.27)
            if (W.notesSource) wp.appendChild(el('p', 'sb-small', W.notesSource));
        }
        // 그 밖(항목 없음·못 받음·뽑지 못함) — 칸째 없음: 머리·안내·출처 줄 모두 없다(§11.10.11)
    }
    /**
     * (물때) 칸 — 서버 물때 줄 + (고립 주의) 줄(§11.10.3 — 연안을 보일 때만). 줄이 없으면 칸도 없다. summaryBodyV2·summaryBodyV3 공용.
     * §11.10.31(2026-10-18 사용자 *"여기서 물때 텍스트를 제주도서부앞바다 기상 현황과 동일한 스타일 크기로 맞춰서 표출해줘. 그리고 아래 내용도 점으로 시작할 수 있도록 해줘."*):
     *   머리 「물때」 = 기상 현황 머리와 같은 모양(.sb-headline.sb-wx-head) · 줄은 「•」 목록(ul.sb-list.sb-tide-rows) — 항목 = 서버 summary.tide 배열 한 칸 + (고립 주의) 한 칸.
     *   간출암 칸은 서버가 한 글(「…물에 잠깁니다. 바위 위 낚시·채취 중 …」 — station_briefing_rules.js tideLines)로 주므로 점 하나, 둘째 문장은 appendText 의 <br> 로 같은 들여쓰기 다음 줄.
     *   항목 안 모양(rocksLine·isolationLine — 링크·고립 지점 표)은 그대로.
     * 예: tidePart(part, {tide:['09:12 저조 뒤부터 물이 차오릅니다(17:09 고조).', '관할 내 잠기는 바위(간출암) 1곳이 …']}, land, b) → <div data-sb-part="tide"><p class="sb-headline sb-wx-head" data-sb-tide-head>물때</p><ul class="sb-list sb-tide-rows"><li><p class="sb-sum-tide">…</p></li>…</ul></div>
     * @param {function(string,string):HTMLElement} part @param {Object} S - summary @param {*} land - 연안을 보이나(summary.land) @param {Object} b - briefing(바위 링크 — §11.10.10) @returns {void} [연계] ← summaryBodyV2·summaryBodyV3 / → isolationLine·rocksLine
     */
    function tidePart(part, S, land, b) {
        // (고립 주의) 줄(§11.10.3)은 물때 줄 아래 — 「과거 고립 사고(N개소 M건)」를 누르면 지점 표(§11.10.10). 「잠기는 바위(간출암) N곳」은 팝업 지도 링크(rocksLine)
        var iso = land && S.isolation && Array.isArray(S.isolation.rows) && S.isolation.rows.length ? S.isolation : null;
        if (!((Array.isArray(S.tide) && S.tide.length) || iso)) return;
        var tp = part('tide', null), h = el('p', 'sb-headline sb-wx-head', '물때'), ul = el('ul', 'sb-list sb-tide-rows'), item = function (node) { var li = el('li'); li.appendChild(node); ul.appendChild(li); };   /* §11.10.20 덧붙임 10 — 사용자 *"물때에서 괄호는 빼자."*(「(고립 주의)」 머리는 그대로) */
        h.setAttribute('data-sb-tide-head', ''); tp.appendChild(h); tp.appendChild(ul);
        (S.tide || []).forEach(function (t) { item(rocksLine('sb-sum-tide', t, b)); }); if (iso) item(isolationLine(iso));
    }
    /**
     * 「총평과 권고」 §11.10.1 모양(2026-10-17 사용자 후속 결정 — *"결론 한줄 -> 기상(…가장 가까운 특보구역…오전, 오후…) … / 물때 / 연안의 안전 등급 분석에 근거…"*):
     *   ① 결론(육상·해상 단계 배지 + 결론 한 줄씩) ② (기상) 가장 가까운 앞바다 단기 해상예보 오전·오후 두 줄 + 출처 + (특이사항) 지방기상청 단기 전망 대상일 것
     *   ③ (물때) 공용 ④ 육상 (근거)·(권고) ⑤ 해상 (근거)·(권고) ⑥ AI 해설(있으면). 자료가 없으면 「기상예보 자료를 확인하지 못했습니다」. 글은 모두 textContent.
     *   §11.10.3: (물때) 아래 (고립 주의) 줄(summary.isolation — 지점 표 펼침) · 근거 줄 ▸ 지도 펼침(basisList) · 해상 근거 끝에 지금 밀집 한 줄.
     * 예: summaryBodyV2(body, {summary:{weather:{zone:'제주도서부앞바다',rows:[{label:'오늘 오전',text:'…'}],source:'…',notes:[…]},tide:[…],land:{…},sea:{…}},…}, resp, ov, true, true)
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·list·basisList·isolationLine
     */
    function summaryBodyV2(body, b, resp, ov, showSea, showLand) {
        var S = b.summary, ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        var land = showLand && b.land && S.land, sea = showSea && b.sea && S.sea;
        /** 이름표가 붙은 칸. 예: part('weather','(기상)') → <div class="sb-part" data-sb-part="weather"><p class="sb-sum-k">(기상)</p></div> */
        var part = function (key, label) { var d = el('div', 'sb-part'); d.setAttribute('data-sb-part', key); if (label) d.appendChild(el('p', 'sb-sum-k', label)); body.appendChild(d); return d; };
        // ① 결론
        var c = part('conclusion', null);
        var head = function (label, rank, word, text, extra) { var r = el('div', 'sb-conclusion'); var lv = el('span', 'sb-levels'); lv.appendChild(el('span', 'sb-level-k', label)); lv.appendChild(chip(rank, word)); (extra || []).forEach(function (x) { lv.appendChild(x); }); r.appendChild(lv); r.appendChild(el('p', 'sb-headline', text || '')); c.appendChild(r); };
        if (land) head('연안', b.land.level.rank, b.land.level.word, S.land.headline);
        if (sea) head('해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, S.sea.headline, komsaBadges(b));   // §11.10.12 — 노란 안내 한 줄 대신 KOMSA 배지
        weatherPart(part, S);
        tidePart(part, S, land, b);
        // ④⑤ 연안·해상 근거·권고
        var nowText = showSea && resp.now && resp.now.text ? resp.now.text : null;
        var basis = function (kind, label, sum) {
            var d = part(kind, null); d.setAttribute('data-sb-summary', kind); d.classList.add('sb-sum');
            d.appendChild(el('p', 'sb-part-title', label));
            // 해상 근거 끝에 「지금 … 선박 N척」(실시간 — 서버 route 가 붙임) 한 줄, 그다음 (권고)(§11.10.3 화면 순서)
            var rows = Array.isArray(sum.basis) ? sum.basis : [];
            if (rows.length || (kind === 'sea' && nowText)) {
                d.appendChild(el('p', 'sb-sum-k', '(근거)')); var ul = basisList({ basis: rows, area: sum.area, detail: sum.detail, raised: sum.raised }, b);
                if (kind === 'sea' && nowText) { var nl = el('li', 'sb-now', nowText); nl.setAttribute('data-sb-now', ''); ul.appendChild(nl); nowText = null; }
                d.appendChild(ul);
            }
            if (sum.advice) { var ad = el('p', 'sb-sum-advice'); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); appendText(ad, sum.advice); d.appendChild(ad); }
        };
        if (land) basis('land', '연안', S.land);
        if (sea) basis('sea', '해상', S.sea);
        // ⑥ AI 해설
        if (ai && ((land && ov.land) || (sea && ov.sea))) {
            var cp = part('commentary', null);
            [['land', '연안', land && ov.land], ['sea', '해상', sea && ov.sea]].forEach(function (x) {
                if (!x[2]) return;
                var cm = el('p', 'sb-commentary'); cm.setAttribute('data-sb-commentary', x[0]);
                cm.appendChild(el('span', 'sb-commentary-k', '해설 · ' + who + ' · ' + x[1] + ' ')); appendText(cm, x[2]); cp.appendChild(cm);
            });
        }
        if (nowText) body.appendChild(el('p', 'sb-now', nowText));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.'
            : 'AI 해설 없음 — 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }

    /**
     * 노란 (권고) 상자 — 「(권고)」·「[권고]」 머리(노랑 굵게, 줄지 않는 칸) + 본문 칸(흰색 굵게, min-width 0 — 둘째 줄이 본문 첫 글자 위치에서). 본문 속 등급 말(경계·주의·관심, 따옴표 등급)은
     *   분석 문단과 같은 칠하기(highlightSegments 의 'lv' 토막 — 등급 색 굵게, 경계 = .sb-hl-red)만 쓰고 나머지 토막(장소·특보 이름 등)은 글 그대로. 글은 textContent 로만.
     *   2026-10-18 사용자 결정(설계서 §11.10.20 덧붙임 6·7·8·9 — 시안 Main·Sea·Land·Special .adv): 총평 (권고)와 해역·연안 카드 [권고]가 같은 모양(글자 크기만 각자 그대로).
     * 예: adviceBox('p', 'sb-sum-advice', '(권고) ', '하트해변에는 경계가, 봉평해수욕장에는 주의가 요구됩니다.') → <p class="sb-sum-advice sb-adv"><span class="sb-advk">(권고) </span><span class="sb-adv-v">하트해변에는 <span class="sb-hl sb-hl-lv sb-hl-red">경계</span>가, …</span></p>
     * @param {string} tag @param {string} cls @param {string} head - 머리 글(「(권고) 」·「[권고]」) @param {string} txt - 서버·AI 글 @returns {HTMLElement} [연계] ← summaryBodyV3(adviceLine)·adviceRow(카드) / → highlightSegments·colorOf
     */
    function adviceBox(tag, cls, head, txt) {
        var ad = el(tag, cls + ' sb-adv'), v = el('span', 'sb-adv-v');
        ad.appendChild(el('span', 'sb-advk', head));
        highlightSegments(txt, [], []).forEach(function (sg) {
            if (sg.cls !== 'lv' || sg.rank === undefined) { appendText(v, sg.text); return; }
            var sp = el('span', 'sb-hl sb-hl-lv', sg.text); sp.setAttribute('data-rank', String(sg.rank));
            if (Number(sg.rank) === 3) sp.classList.add('sb-hl-red'); else sp.style.color = colorOf(sg.rank);
            v.appendChild(sp);
        });
        ad.appendChild(v);
        return ad;
    }
    /** 카드 [권고] 줄 — adviceBox 를 카드 줄(.sb-row 두 칸 그리드 — 이름표 칸·글 칸)로. 예: adviceRow('18~24시 이 해역은 …') @param {string} txt @returns {HTMLElement} [연계] ← seaCard·seaCardBadged·landCardV19 */
    function adviceRow(txt) { var r = adviceBox('div', 'sb-row sb-row-adv', '[권고]', txt); r.firstChild.classList.add('sb-row-k'); r.lastChild.classList.add('sb-row-v'); return r; }

    // ── 분석 문단 강조(2026-10-17 사용자 결정 — 설계서 §11.10.9 ④) ──
    // 원문: *"풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정 이 부분을 볼드, 노란색 처리(발효 시에는 빨간색으로)"* · *"하트해변은 과 방문객이 평소의 2.4배로 예상 을 볼드"*
    //   · *"매우 높음, 높음 등 등급은 그 색상으로 볼드 및 색상변경"*. 글은 서버가 준 평문 그대로 — 잘라서 span 의 textContent 로만 넣는다(innerHTML 없음).
    // 특보 종류 = 앱이 이미 쓰는 특보 이름(forecast/alerts/render.js TYPE_RANK 의 태풍·풍랑·강풍·해일·호우·대설 + 서버 station_briefing_inputs.typeOf 의 폭풍해일). 긴 이름 먼저(폭풍해일 → 해일).
    var HL_KINDS = '폭풍해일|태풍|풍랑|강풍|해일|호우|대설';
    // 따옴표 단계 이름 → 단계 순위(색 = colorOf — 위험예측 4색). 연안 위험지수 단계(BAND_ORDER)와 해양사고 위험예보 '주의'·'경계'(브리핑 주의 필요·경계 필요와 같은 순위).
    //   '보통'·'낮음'·'매우높음'(혼잡 예보)은 앱에 그 말의 색이 없어 굵게만(색을 새로 만들지 않는다).
    //   §11.10.20 덧붙임 5(2026-10-18 사용자 *"'주의' 부분을 해당 등급에 맞는 색상과 볼드처리해줘."*): '관심'(노랑)·'심각'(빨강 — 우리 자료에는 없는 말이나 사용자가 등급 말로 들었다, 가장 높은 색) 추가.
    // 해구 예보 값 토막 — 새 글 「유의파고 1.7m·풍속 11.1m/s」·「풍속 7.5m/s」(§11.10.22 C 사용자 *"유의파고로만 반영"*) · 옛 판 글 「최대 파고 …」·「최대 풍속 …」. [연계] ← forecastNodes·highlightSegments ⑤
    var SEA_VALS_RE = /최대 (?:파고 \d+(?:\.\d+)?m(?:·풍속 \d+(?:\.\d+)?m\/s)?|풍속 \d+(?:\.\d+)?m\/s)|유의파고 \d+(?:\.\d+)?m(?:·풍속 \d+(?:\.\d+)?m\/s)?|풍속 \d+(?:\.\d+)?m\/s(?=로 )/g;
    var HL_LABEL = { '평소 수준': 0, '다소 높음': 1, '높음': 2, '매우 높음': 3, '관심': 1, '주의': 2, '경계': 3, '심각': 3 }, HL_STEP = { '관심': 1, '주의': 2, '경계': 3 };
    /** 정규식 글자 이스케이프. 예: '경북북부앞바다(대해구 75)' → '경북북부앞바다\(대해구 75\)'. @param {string} t @returns {string} [연계] ← highlightSegments */
    function reEsc(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    /**
     * 분석 문단 글을 강조 토막으로 나눈다(순수 함수 — 시험이 vm 으로 직접 부른다). 겹치면 앞 규칙이 이긴다: ①특보 → ②문장 첫 장소 주어 → ③방문객 배수 → ④단계 말.
     *   ① 특보: 「풍랑주의보 예비특보 … 예정」(그 절 안 — 쉼표·마침표 전까지 「예정」이 있으면 거기까지, 없으면 「…예비특보」까지) → 'warn-pre'(굵게·노랑).
     *      예비특보가 아닌 특보 이름은 그 절에 「예정」이 있으면 'warn-pre', 「발효 중·발효되어·발효되었·발효됩니다·발효되고·발효된·발효돼」가 있으면 거기까지 'warn-on'(굵게·빨강), 둘 다 없으면(해제 등) 강조 없음.
     *   ② 문장 첫머리의 알려진 장소 이름(names — 그 브리핑 자료의 관광지·해역·특보구역 이름)들을 과·와·· 로 이은 것 + 은·는 → 'b'(굵게).
     *   ③ 「방문객이 (각각) 평소의 2.2배와 2.8배로 예상」·「방문객 평소의 1.8배(예상)」 → 'b'.
     *   ④ 따옴표 단계 이름('매우 높음' 등 — 따옴표 포함, 곧은 ' 와 굽은 ‘ ’ 둘 다)·「경계 수준」의 「경계」(§11.10.16)·옛 글 「경계 필요」「주의 필요」「관심 필요」
     *      ·「경계가,」「주의가 요구됩니다」「관심이」처럼 이/가 가 붙은 단계 말(§11.10.20 덧붙임 8 — (권고) 상자 속 등급 말) → 'lv'(굵게, rank 있으면 그 단계 색).
     *   ⑤(§11.10.20 덧붙임 4 — 사용자 *"동해상에 바람이 강하게 불고 물결이 높아질 수 있어 이 부분과 같이 중요한 부분은 볼드처리해줘."*) 핵심 구절 → 'b'(굵게):
     *      바다 상태 결론 「유의파고 0.8m·풍속 4.8m/s로 잔잔한 바다」(「일 것으로」·「 것으로」 앞까지 — §11.10.22 C, 옛 글 「최대 파고 …」도) · 기상 전망 위험 구절(바람이 강·물결이 높·파도가 높·너울이 … 「수 있어/있다는/있습니다」까지,
     *      그 절 첫머리부터 — 「…에 따르면 」 뒤) · 규칙 분석의 「기상청 단기 전망에 「…」」 따옴표 안 · 「위험이 높아진 해역은 없는」·「… 0칸」.
     * 예: highlightSegments("하트해변은 연안 위험지수 '매우 높음'으로 …", ['하트해변']) → [{text:'하트해변은',cls:'b'},{text:' 연안 위험지수 ',cls:null},{text:"'매우 높음'",cls:'lv',rank:3},…]
     *   ⓪(§11.10.9 ⑥) links — 대해구 이름(「경북북부앞바다(대해구 75)」·「대해구 75」, 서버 summary.sea.haegu) → 'link'(key = 대해구 번호) — 화면이 팝업 지도 단추로. 다른 규칙보다 먼저.
     * @param {string} text - 분석 문단(평문) @param {string[]} [names] - 알려진 장소 이름 @param {Array<{text:string,key:string}>} [links] - 링크로 만들 글
     * @returns {Array<{text:string, cls:(string|null), rank?:number, key?:string}>} 이어 붙이면 원문과 같다
     * [연계] ← analysisNodes(summaryBodyV3 분석 문단) · 시험 test_station_briefing.js [§11.10.9-5] / → reEsc
     */
    function highlightSegments(text, names, links) {
        var t = String(text || ''), marks = [];
        var free = function (a, b) { return marks.every(function (m) { return b <= m.a || a >= m.b; }); };
        var add = function (a, b, cls, rank) { if (b > a && free(a, b)) marks.push(rank === undefined ? { a: a, b: b, cls: cls } : { a: a, b: b, cls: cls, rank: rank }); };
        // ⓪ 링크(대해구) — 긴 글 먼저(「…(75해구)」가 「75해구」보다 먼저). 「대해구 75」 뒤에 숫자가 이어지면(대해구 750) 링크가 아니다.
        //   §11.10.22 A(「75해구」 꼴): 앞 글자가 숫자·「-」면(「175해구」·「232-75해구」) 링크가 아니다.
        (links || []).filter(function (l) { return l && l.text; }).sort(function (x, y) { return y.text.length - x.text.length; }).forEach(function (l) {
            var i = -1; while ((i = t.indexOf(l.text, i + 1)) >= 0) if (!/\d/.test(t.charAt(i + l.text.length)) && !(i > 0 && /[\d-]/.test(t.charAt(i - 1))) && free(i, i + l.text.length)) marks.push({ a: i, b: i + l.text.length, cls: 'link', key: String(l.key) });
        });
        var clauseEnd = function (i) { var m = /[,，.。!?]/.exec(t.slice(i)); return m ? i + m.index : t.length; };
        // ① 특보
        var wr = new RegExp('(?:' + HL_KINDS + ')(?:주의보|경보)', 'g'), m;
        while ((m = wr.exec(t))) {
            var a = m.index, cl = t.slice(a, clauseEnd(a)), pre = /^\s*예비\s*특보/.exec(cl.slice(m[0].length)), ye = cl.indexOf('예정'), on = /발효\s*중|발효(?:되어|되었|되고|됩니다|된|돼)/.exec(cl);
            var rel = /^\s*해제(?:\s*예고|\s*소식)?/.exec(cl.slice(m[0].length));
            if (ye >= 0 && (pre || !on || ye < on.index)) add(a, a + ye + 2, 'warn-pre');
            else if (pre) add(a, a + m[0].length + pre[0].length, 'warn-pre');
            else if (on) add(a, a + on.index + on[0].length, 'warn-on');
            // §11.10.16 소절 E1: 「풍랑주의보 해제 예고」·「… 해제」 → 'warn-rel'(노랑 — 시안 ⑤판), 그 밖의 특보 이름만 → 'warn'(색 없음) — 화면이 이 토막들을 「기상특보 현황」 창 링크로
            else if (rel) add(a, a + m[0].length + rel[0].length, 'warn-rel');
            else add(a, a + m[0].length, 'warn');
        }
        // 이름 없이 쓴 「예비특보」·「해제 예고」(「풍랑주의보 해제 예고와 예비특보가 있어」의 둘째 말) — 같은 링크 재료
        var wr2 = /예비\s*특보|해제\s*예고/g;
        while ((m = wr2.exec(t))) add(m.index, m.index + m[0].length, /^예비/.test(m[0]) ? 'warn-pre' : 'warn-rel');
        // ② 문장 첫 장소 주어
        var ns = (names || []).filter(function (n) { return n && String(n).length >= 2; }).map(String).sort(function (x, y) { return y.length - x.length; });
        if (ns.length) {
            var alt = '(?:' + ns.map(reEsc).join('|') + ')', subj = new RegExp('(^|[.!?。]\\s+|\\n)(' + alt + '(?:\\s*(?:과|와|·|,)\\s*' + alt + ')*(?:은|는))', 'g');
            while ((m = subj.exec(t))) { var s0 = m.index + m[1].length; add(s0, s0 + m[2].length, 'b'); }
        }
        // ③ 방문객 배수
        var N = '\\d+(?:\\.\\d+)?배', vr = new RegExp('방문객(?:이|은|도)?\\s*(?:각각\\s*)?평소의\\s*' + N + '(?:\\s*(?:와|과|,|·)\\s*' + N + ')*(?:\\s*(?:으로|로)\\s*예상|\\(예상\\))?', 'g');
        while ((m = vr.exec(t))) add(m.index, m.index + m[0].length, 'b');
        // ④ 단계 말
        // 「경계 수준」의 「경계」(§11.10.16 — 단계 이름에서 「필요」를 뺀 뒤의 꼴, 시안 「<경계> 수준이며」) · 옛 글 「경계 필요」
        var lr = /['‘](매우 높음|다소 높음|평소 수준|높음|보통|낮음|매우높음|관심|주의|경계|심각)['’]|(경계|주의|관심)(?: 필요|(?= 수준)|(?=[이가](?:[,\s.]|$)))/g;
        while ((m = lr.exec(t))) { var rk = m[1] !== undefined ? HL_LABEL[m[1]] : HL_STEP[m[2]]; add(m.index, m.index + m[0].length, 'lv', rk); }
        // ⑤ 핵심 구절(§11.10.20 덧붙임 4) — 바다 상태 결론 · 기상 전망 위험 구절 · 규칙 분석의 전망 인용 · 「위험이 높아진 … 없는」
        var st = new RegExp('(?:' + SEA_VALS_RE.source + ')로 [^.,]*?(?=일 것으로| 것으로)', 'g');
        while ((m = st.exec(t))) add(m.index, m.index + m[0].length, 'b');
        var wx = /(?:바람이 (?:매우 )?강|물결이 (?:매우 )?높|파도가 (?:매우 )?높|너울이 )[^.,]*?수 있(?:어|다는|습니다|겠습니다)/g;
        while ((m = wx.exec(t))) {
            var ws = m.index; while (ws > 0 && !/[,.!?。]/.test(t.charAt(ws - 1))) ws--;
            var head = t.slice(ws, m.index), fb = head.lastIndexOf('따르면 '); ws += fb >= 0 ? fb + 4 : 0; while (ws < m.index && /\s/.test(t.charAt(ws))) ws++;
            add(ws, m.index + m[0].length, 'b');
        }
        var qn = /기상청 단기 전망에 「([^」]+)」/g;
        while ((m = qn.exec(t))) { var qa = m.index + m[0].indexOf('「') + 1; add(qa, qa + m[1].length, 'b'); }
        var nr = /위험이 높아진 (?:해역|곳|관광지)(?:은|는|이|가) (?:없는|없습니다|없고|없으며|없어|0칸|0곳)/g;
        while ((m = nr.exec(t))) add(m.index, m.index + m[0].length, 'b');
        marks.sort(function (x, y) { return x.a - y.a; });
        var out = [], at = 0;
        marks.forEach(function (k) { if (k.a > at) out.push({ text: t.slice(at, k.a), cls: null }); var seg = { text: t.slice(k.a, k.b), cls: k.cls }; if (k.rank !== undefined) seg.rank = k.rank; if (k.key !== undefined) seg.key = k.key; out.push(seg); at = k.b; });
        if (at < t.length || !out.length) out.push({ text: t.slice(at), cls: null });
        return out;
    }
    /**
     * 분석 문단의 마지막 「따라서 …」 문장을 떼어 (권고)로 — 2026-10-17 사용자 결정(설계서 §11.10.9 ⑤) 원문 *"차라리 본문에 따라서 (권고) 하트해변에는 경계가, … 필요합니다.가 근거의 (권고)에 붙은 노란색 텍스트 스타일로 본문에 반영토록 하는거야. 근거에서는 권고를 빼고."*
     * 화면만 바꾼다 — AI 지시문·검증(마지막 「따라서 … 필요합니다」)은 그대로. 마지막 문장이 「따라서」로 시작하지 않으면(옛 판 등) null(문단 그대로·근거의 (권고) 그대로).
     * 예: splitAdvice('A입니다. 따라서 하트해변에는 경계가 필요합니다.') → {body:'A입니다.', advice:'하트해변에는 경계가 필요합니다.'} · splitAdvice('따라서 X가 필요합니다.') → {body:'', advice:'X가 필요합니다.'} · 'A입니다.' → null
     * @param {string} text @returns {{body:string, advice:string}|null} [연계] ← summaryBodyV3 · 시험 test_station_briefing.js [§11.10.9-6]
     */
    function splitAdvice(text) {
        var t = String(text || ''), m = /(^|[.!?。]\s+)따라서\s+([^]*)$/.exec(t);
        if (!m || /[.!?。]\s+\S/.test(m[2])) return null;   // 「따라서」 뒤에 문장이 더 있으면 마지막 문장이 아니다
        return { body: t.slice(0, m.index + m[1].length).trim(), advice: m[2].trim() };
    }
    /**
     * 그 브리핑에서 문단 주어로 나올 수 있는 장소 이름 — 관광지(관심 이상 전부·카드·상시 위험 장소)·해역 카드·대해구(「경북북부앞바다(대해구 75)」·「대해구 75」·특보구역)·관할 이름.
     * 예: highlightNames(한림 브리핑) → ['한림파출소','협재해수욕장','금능해수욕장',…,'제주도북부앞바다·제주도서부앞바다(대해구 232)','대해구 232',…]
     * @param {Object} b - briefing @returns {string[]} [연계] ← summaryBodyV3 → highlightSegments
     */
    function highlightNames(b) {
        var out = [], add = function (n) { if (n && out.indexOf(String(n)) < 0) out.push(String(n)); };
        if (b && b.station) add(b.station.name);
        var L = (b && b.land) || {}; (L.attentionAll || []).concat(L.cards || [], L.constant || []).forEach(function (c) { add(c && c.name); });
        var S = (b && b.sea) || {}; (S.cards || []).concat(S.overviewTop || []).forEach(function (c) { add(c && c.name); add(c && c.nameBase); });
        var flows = S.weatherByHaegu ? Object.keys(S.weatherByHaegu).map(function (k) { return S.weatherByHaegu[k]; }) : [];
        flows.concat(S.weather ? [S.weather] : []).forEach(function (f) { if (!f) return; add(f.label); if (f.where) { add(f.where + '(' + f.label + ')'); String(f.where).split('·').forEach(add); } });
        return out;
    }
    /**
     * 강조 토막을 DOM 으로(글은 textContent 로만). 'b' 굵게 · 'warn-pre' 굵게 노랑(colorOf(1)) · 'warn-on' 굵게 빨강(.sb-hl-red — §11.10.11 대비용 밝은 빨강) · 'lv' 굵게 + 그 단계 색(경계 = .sb-hl-red, rank 없으면 굵게만).
     * 예: analysisNodes(p, '하트해변은 …', ['하트해변']) → p 에 <ul class="sb-list sb-an-list"><li><span class="sb-hl sb-hl-b">하트해변은</span> …</li>…</ul>(문장마다 한 줄 — §11.10.20 덧붙임 3)
     * §11.10.9 ⑥: hg = {list:[{major,label,name,box}], area, station} 이 있으면 대해구 이름을 팝업 지도 단추로(관할 경계 + 그 대해구 테두리 깜빡임).
     * @param {HTMLElement} p @param {string} text @param {string[]} names @param {Object} [hg] @returns {void} [연계] ← summaryBodyV3 / → highlightSegments·colorOf·mapLink·openMapPopup
     */
    function analysisNodes(p, text, names, hg, wl) {
        var hl = hg && hg.area && Array.isArray(hg.list) ? hg.list : [], links = [], warnN = 0, ul = el('ul', 'sb-list sb-an-list'), li = null;
        // §11.10.20 덧붙임 3(2026-10-18 사용자 *"AI 분석 CHAT GPT 다음줄부터 본문이 시작되도록 하고, 각 문장마다 근거에 들어간것처럼 점으로 시작되도록"*):
        //   문장마다 「•」 목록 한 줄 — 나누는 자리는 appendText 의 「다.」 줄바꿈 자리 그대로(글 토막은 그 자리에서만 끊고, 강조·링크 토막은 그대로 지금 줄에 붙인다).
        var cur = function () { if (!li) { li = el('li'); ul.appendChild(li); } return li; };
        var plain = function (txt) { var re = /다\.(?:\s+|(?=[가-힣]))/g, at = 0, mm, x = String(txt); while ((mm = re.exec(x))) { var e = mm.index + mm[0].length; cur().appendChild(document.createTextNode(x.slice(at, e))); li = null; at = e; } if (at < x.length) cur().appendChild(document.createTextNode(x.slice(at))); };
        p.appendChild(ul);
        hl.forEach(function (h) { links.push({ text: h.name, key: h.major }); if (h.label && h.label !== h.name) links.push({ text: h.label, key: h.major }); });
        highlightSegments(text, names, links).forEach(function (sg) {
            if (sg.cls === 'link') {
                var h = hl.filter(function (x) { return String(x.major) === sg.key; })[0];
                cur().appendChild(mapLink(sg.text, function () { openMapPopup(h.name, function (body) { return miniMap(body, hg.area, [h.box], '빨간 테두리(깜빡임) = ' + h.label + ' 해구 격자 · 파란 선 = ' + hg.station + ' 관할 해역', { big: true }); }, 'haegu'); }, 'haegu'));
                return;
            }
            if (!sg.cls) { plain(sg.text); return; }   // 「다.」 뒤에서 다음 「•」 줄(§11.10.16 줄바꿈 자리 — §11.10.20 덧붙임 3)
            // 특보 말(§11.10.16 소절 E1 — 사용자 *"풍랑주의보 해제예고, 풍랑주의보, 예비특보 등 특보를 의미하는 텍스트에 하이퍼링크가 있어야 할 것 같은데 ?"*): 강조색 그대로 + 밑줄 단추 → 「기상특보 현황」 창
            var isWarn = /^warn/.test(sg.cls);
            if (isWarn && wl && wl.rows && wl.rows.length) {
                var lk = mapLink(sg.text, function () { openWarnPopup(wl); }, 'warn'); lk.classList.add('sb-hl', 'sb-hl-' + sg.cls); warnN++;
                if (sg.cls === 'warn-pre' || sg.cls === 'warn-rel') lk.style.color = colorOf(1); else if (sg.cls === 'warn-on') lk.classList.add('sb-hl-red');
                cur().appendChild(lk); return;
            }
            if (sg.cls === 'warn' || sg.cls === 'warn-rel') { plain(sg.text); return; }   // 표가 없으면 종전처럼 강조 없음
            var sp = el('span', 'sb-hl sb-hl-' + sg.cls, sg.text);
            // 빨강(발효 · 「경계」 단계)은 인라인 색 대신 .sb-hl-red(station_briefing.css — 이 문단 글자에만 쓰는 조금 밝은 빨강, 어두운 카드 위 대비 4.5 이상 · §11.10.11). 지도·배지의 4색은 그대로.
            if (sg.cls === 'warn-pre') sp.style.color = colorOf(1); else if (sg.cls === 'warn-on') sp.classList.add('sb-hl-red'); else if (sg.cls === 'lv' && sg.rank !== undefined) { if (Number(sg.rank) === 3) sp.classList.add('sb-hl-red'); else sp.style.color = colorOf(sg.rank); sp.setAttribute('data-rank', String(sg.rank)); }
            cur().appendChild(sp);
        });
        return warnN;
    }
    /**
     * 특보 표가 있는데 분석 문단에 특보 말이 하나도 없을 때(AI 가 빼먹음)만 문단 아래 한 줄 「(특보) 해제 예고 2곳 · 예비특보 1곳」 — 그 글이 「기상특보 현황」 창 링크(§11.10.16 소절 E1 폴백).
     * 예: warnFallback({short:'해제 예고 2곳 · 예비특보 1곳', rows:[…]}) → <p class="sb-warn-fb" data-sb-warn-fallback><span>(특보) </span><button …>해제 예고 2곳 · 예비특보 1곳</button></p>
     * @param {Object} Wt @returns {HTMLElement} [연계] ← summaryBodyV3 / → mapLink·openWarnPopup
     */
    function warnFallback(Wt) {
        var f = el('p', 'sb-warn-fb'); f.setAttribute('data-sb-warn-fallback', ''); f.appendChild(el('span', 'sb-sum-k', '(특보) '));
        f.appendChild(mapLink(Wt.short || '기상특보 현황', function () { openWarnPopup(Wt); }, 'warn'));
        return f;
    }
    /**
     * 「총평과 권고」 §11.10.4 「가」 모양(2026-10-17 사용자 *"가.로 진행하고"* — 설계서 §11.10.4):
     *   ① [연안 ○○] 결론(§11.10.16 부터 「필요」 없음) → 연안 분석 문단(AI 3~5문장, 실패면 서버 규칙 분석 — 작은 이름표 「AI 분석 · ChatGPT」/「규칙 분석」) → ▸ 연안 분석 근거(접힘 — (근거)·(권고))
     *   ② [해상 ○○] 결론(+ 해상 분석 단계가 더 높으면 한 줄) → 해상 분석 문단 → 지금 밀집 줄 → ▸ 해상 분석 근거(접힘 — (근거)(▸ 지도 펼침 그대로)·(권고))
     *   ③ 「{구역} 기상 현황」 ④ (물때)·(고립 주의) — 작은 출처 줄은 §11.10.9 부터 없음(이름표만). 사용자 원문: *"그 분석 아래에 (연안 분석 근거) <- 이 아코디언이 있어서 누르면 육상 분석 근거가 나오고 해상 분석 아래에 (해상 분석 근거) <- 이 아코디언이 있어서 누르면 … 분석 근거가 나오도록"*
     * 예: summaryBodyV3(body, {summary:{analysis:{land:'…',sea:'…'},land:{headline,basis,advice},sea:{…},weather:{…},tide:[…]},…}, resp, {source:'chatgpt',land:'…',sea:'…'}, true, true)
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov - b.overview @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·expander·basisList·weatherPart·tidePart
     */
    function summaryBodyV3(body, b, resp, ov, showSea, showLand) {
        var S = b.summary, A = S.analysis || {}, ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        var land = showLand && b.land && S.land, sea = showSea && b.sea && S.sea, nowText = showSea && resp.now && resp.now.text ? resp.now.text : null, names = highlightNames(b);
        var hg = S.sea && Array.isArray(S.sea.haegu) && S.sea.haegu.length && Array.isArray(S.sea.area) && S.sea.area.length ? { list: S.sea.haegu, area: S.sea.area, station: (b.station && b.station.name) || '' } : null;   // §11.10.9 ⑥ 대해구 링크
        /** 이름표가 붙은 칸. 예: part('weather','(기상)') → <div class="sb-part" data-sb-part="weather"><p class="sb-sum-k">(기상)</p></div> */
        var part = function (key, label) { var d = el('div', 'sb-part'); d.setAttribute('data-sb-part', key); if (label) d.appendChild(el('p', 'sb-sum-k', label)); body.appendChild(d); return d; };
        /** 연안·해상 한 덩어리 — 결론 → 분석 문단 → (해상이면 지금 밀집) → ▸ 분석 근거. */
        var block = function (kind, label, rank, word, sum, aiText, ruleText) {
            var d = part(kind, null); d.classList.add('sb-sum'); d.setAttribute('data-sb-summary', kind);
            var c = el('div', 'sb-conclusion'); c.appendChild(chip(rank, word, label));
            if (kind === 'sea') komsaBadges(b).forEach(function (x) { c.appendChild(x); });   // §11.10.12 — 「해상 평소 수준」 오른쪽 「N개 해역 주의 필요(KOMSA 예보)」(종전 노란 안내 한 줄은 없앰)
            c.appendChild(headlineNode(sum.headline || '', rank, word)); d.appendChild(c);   // §11.10.20 덧붙임 23 — 「"주의"」 단계 색
            var useAi = !!(ai && aiText), text = useAi ? aiText : ruleText, sp = text ? splitAdvice(text) : null;
            /** (권고) 상자 — §11.10.20 덧붙임 2·6·7·8(2026-10-18 사용자 *"(권고)도 노란색 글자로 볼드"* · *"권고 내용 전체를 박스 안에 넣어주고 박스에 색을 적절한 색을 입혀줬으면"*
             *   · *"두번째 줄의 텍스트 시작이 첫번쨰 줄의 텍스트 시작인 "하" 위치부터"* · *"텍스트 색상을 흰색으로 하고 각 등급이 해당 등급 색상에 맞도록"*): adviceBox. */
            var adviceLine = function (txt, src) { var ad = adviceBox('p', 'sb-sum-advice', '[권고] ', txt);   /* 덧붙임 11 — 사용자 *"권고 괄호를 [ ] 로 바꾸자."*(카드 [권고]와 같은 머리) */ ad.setAttribute('data-sb-advice', src); return ad; };
            if (text) {
                var p = el('div', 'sb-analysis'); p.setAttribute('data-sb-analysis', kind); p.setAttribute('data-sb-analysis-source', useAi ? ov.source : 'rule');   // §11.10.20 덧붙임 3 — 이름표 줄 + 「•」 문장 목록(ul 이 들어가 p 가 아니라 div)
                // 문단 글은 강조 토막으로(§11.10.9 ④ — 특보·장소 주어·방문객 배수·단계 말, textContent 로만). 마지막 「따라서 …」는 떼어 아래 (권고) 줄로(⑤ — 강조 없이 (권고) 모양 그대로)
                var wt = sum.warnings && Array.isArray(sum.warnings.rows) && sum.warnings.rows.length ? sum.warnings : null;   // 「기상특보 현황」 표(§11.10.16 소절 E1 — 서버 rules.warnTable)
                var tag = el('span', 'sb-an-tag' + (useAi ? ' sb-an-' + ov.source : ' sb-an-rule'), useAi ? 'AI 분석 · ' + who : '규칙 분석'); p.appendChild(tag); p.appendChild(document.createTextNode(' '));   // 이름표는 자기 줄(아래 ul 이 블록) · §11.10.29 이름표 색 = 공급자(sb-an-chatgpt 흰색 · sb-an-gemini 파랑 — ov.source 'chatgpt'·'gemini')
                var wn = analysisNodes(p, sp ? sp.body : text, names, kind === 'sea' ? hg : null, wt); d.appendChild(p);
                if (wt && !wn) d.appendChild(warnFallback(wt));   // 특보 말이 문단에 없으면(AI 가 빼먹음) 그때만 한 줄
                if (sp) d.appendChild(adviceLine(sp.advice, 'analysis'));
            } else if (sum.advice) d.appendChild(adviceLine(sum.advice, 'summary'));   // 문단이 없으면(지금 규칙으로는 생기지 않음 — 시험 [§11.10.9-6]) 서버 권고를 결론 아래에 — 권고가 사라지지 않게
            var basisAdvice = !!text && !sp && sum.advice;   // 근거 칸 (권고)는 문단에서 (권고)를 못 뗐을 때만(옛 판 등)
            if (kind === 'sea' && nowText) { d.appendChild(nowNode(resp.now, b)); nowText = null; }   // §11.10.9 ⑥ — 「관할 해역 선박 N척」·붐비는 해역이 팝업 지도 링크
            var rows = Array.isArray(sum.basis) ? sum.basis : [];
            if (rows.length || basisAdvice || (kind === 'sea' && sum.warnings && sum.warnings.rows && sum.warnings.rows.length)) {
                // 2026-10-17 사용자 *"너무 딱딱한 디자인 … 연안 분석 근거 상세 보기 해가지고 약간 배지 모양으로 만들어서 그 칸에서 오른쪽으로 정렬"*(§11.10.9) — 알약 배지, 오른쪽(.sb-basis-x)
                var x = expander(label + ' 분석 근거 상세 보기', function (panel) {
                    // 맨 위 「(근거)」 제목 줄은 뺐다 — 2026-10-18 사용자 *"여기 어차피 근거로 들어왔으니 (근거) 빼자."*(설계서 §11.10.20 덧붙임). 옛 판 모양(summaryBody·summaryBodyV2 — 펼침 칸 아님)은 그대로
                    if (rows.length) panel.appendChild(basisList({ basis: rows, area: sum.area, detail: sum.detail, raised: sum.raised }, b));
                    // 해상 근거 안 「기상특보 현황」 상자(§11.10.16 소절 E2 — 창과 같은 상자, ✕·맨 아래 문장 없음)
                    if (kind === 'sea' && sum.warnings && Array.isArray(sum.warnings.rows) && sum.warnings.rows.length) panel.appendChild(warnBox(sum.warnings, false));
                    if (basisAdvice) panel.appendChild(adviceLine(sum.advice, 'basis'));
                }, 'basis-' + kind, true);
                var row = el('p', 'sb-basis-x'); row.appendChild(x.btn); d.appendChild(row); d.appendChild(x.panel);
            }
        };
        if (land) block('land', '연안', b.land.level.rank, b.land.level.word, S.land, ov.land, A.land);
        if (sea) block('sea', '해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, S.sea, ov.sea, A.sea);
        if (nowText) { var nw = el('p', 'sb-now', nowText); nw.setAttribute('data-sb-now', ''); body.appendChild(nw); }
        weatherPart(part, S);
        tidePart(part, S, land, b);
        // 맨 아래 작은 출처 줄(「분석 문단은 ChatGPT가 썼습니다 — 숫자·지명·단계는 …」/「규칙 분석 — …」)은 없앴다 — 2026-10-17 사용자 *"굳이 필요가 없어 … 아예 다 빼줘"*(§11.10.9).
        //   누가 썼는지는 분석 문단 앞 이름표(「AI 분석 · ChatGPT」/「규칙 분석」 — data-sb-analysis-source)가 그대로 보인다.
    }
    /**
     * 「총평과 권고」 종전 모양 — summary 가 없는 브리핑(2026-10-17 전에 저장된 10-16·10-17 파일 등)용: 단계 배지 · 육상/해상 문단(overview.land/sea) · 근거 ▸ 접힘 · 출처 작은 글씨.
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render
     */
    function legacyOverview(body, b, resp, ov, showSea, showLand) {
        var s1 = { body: body };   // 종전 render 안의 코드를 그대로 옮겨 s1.body 이름을 유지
        var levels = el('div', 'sb-levels');
        if (showLand && b.land && b.land.level) { levels.appendChild(el('span', 'sb-level-k', '연안')); levels.appendChild(chip(b.land.level.rank, b.land.level.word)); }
        if (showSea && b.sea && b.sea.overviewLevel) { levels.appendChild(el('span', 'sb-level-k', '해상')); levels.appendChild(chip(b.sea.overviewLevel.rank, b.sea.overviewLevel.word)); komsaBadges(b).forEach(function (x) { levels.appendChild(x); }); }   // §11.10.12 KOMSA 배지(종전 노란 안내 한 줄 대신)
        if (levels.childNodes.length) s1.body.appendChild(levels);
        if (showLand && ov.land) { var pl = el('p', 'sb-overview'); pl.setAttribute('data-sb-overview', 'land'); pl.appendChild(el('b', 'sb-overview-k', '연안 ')); appendText(pl, ov.land); s1.body.appendChild(pl); }
        if (showSea && ov.sea) { var ps = el('p', 'sb-overview'); ps.setAttribute('data-sb-overview', 'sea'); ps.appendChild(el('b', 'sb-overview-k', '해상 ')); appendText(ps, ov.sea); s1.body.appendChild(ps); }
        if (showSea && resp.now && resp.now.text) s1.body.appendChild(el('p', 'sb-now', resp.now.text));
        // 근거 ▸ (접힘) — 총평에 쓴 해역·관광지와 그 근거
        var basisItems = [];
        if (showSea && b.sea) {
            (b.sea.overviewTop || []).forEach(function (c) { if (c && c.overview) basisItems.push('해상 · ' + (c.overview.window ? c.overview.window + ' ' : '') + c.name + ' — ' + (c.overview.label || c.sourceLabel || '')); });
            if (b.sea.weather && b.sea.weather.text) basisItems.push('해상 · ' + b.sea.weather.text);
        }
        if (showLand && b.land) (b.land.overviewTop || []).forEach(function (c) { basisItems.push('연안 · ' + c.name + ' — ' + (c.sourceLabel || '') + (c.today && c.today.text ? ' (' + c.today.text + ')' : '')); });
        if (basisItems.length) { var d = el('details', 'sb-basis'); d.appendChild(el('summary', '', '근거')); d.appendChild(list(basisItems)); s1.body.appendChild(d); }
        var srcNote = ov.source === 'template' ? '기본 문장(틀) — AI 총평 대신 서버 규칙으로 만든 문장입니다.' : ov.source === 'chatgpt' || ov.source === 'gemini' ? (ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini') + '가 쓴 총평 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '.' : null;
        if (srcNote) { var sn = el('p', 'sb-small sb-source'); sn.setAttribute('data-sb-source', ov.source); sn.textContent = srcNote; s1.body.appendChild(sn); }
    }
    // ── 「해상 분석」·「연안 분석」 단계 나누기(2026-10-17 사용자 결정 — 설계서 §11.10.14): 칸 머리 오른쪽 단계별 개수 배지 + 펼친 칸 안 단계 단추(하나만 고름) ──
    var tabSeq = 0;   // 단추·패널 id 가 겹치지 않게(사용자 아코디언과 관리자 미리보기가 한 화면에 함께 있을 수 있다)
    /**
     * 카드를 단계별로 묶는다 — 높은 단계부터(경계 → 주의 → 관심), 한 단계 안의 카드 순서는 서버가 준 순서 그대로.
     * 예: levelGroups([{rank:2,word:'주의'},{rank:1,word:'관심'},{rank:2,word:'주의'}]) → [{rank:2,word:'주의',cards:[첫째,셋째]},{rank:1,word:'관심',cards:[둘째]}] (옛 판 「주의 필요」도 「주의」)
     * @param {Object[]} cards - briefing.sea.cards·land.cards(관심 이상 전부 — 2026-10-17 부터 상한 없음. 그 전 판은 서버가 10곳까지 자른 것이라 개수도 보이는 카드 수다) @returns {{rank:number, word:string, cards:Object[]}[]}
     * [연계] ← renderRest(해상·연안 분석) / → levelBadges·levelTabs
     */
    function levelGroups(cards) {
        var by = {};
        (cards || []).forEach(function (c) { var r = Number(c && c.rank); if (!by[r]) by[r] = { rank: r, word: levelWord((c && c.word) || WORDS[r] || ''), cards: [] }; by[r].cards.push(c); });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, c) { return c.rank - a.rank; });
    }
    /**
     * 칸 머리 오른쪽(꺾쇠 바로 앞)에 단계별 개수 배지를 붙인다 — 카드가 있는 단계만, 색·글자색은 chip(위험예측 4색) 그대로. 카드가 없으면 아무것도 붙이지 않는다.
     * 글 = 단계 이름 + 개수(단위 없음 — 2026-10-17 사용자 *"경계 필요, 주의 필요 이렇게 하지말고 경계 1, 주의 5, 관심 1 처럼 표출"*, 설계서 §11.10.16).
     * 예: levelBadges(s3.head, groups) → 머리 「해상 분석 … [주의 5][관심 1] ⌄」
     * @param {HTMLElement} head - section().head @param {Object[]} groups - levelGroups 결과 @returns {void}
     * [연계] ← renderRest / → chip / 모양: station_briefing.css .sb-sec-badges(좁으면 배지끼리 줄바꿈 — 꺾쇠와 겹치지 않음)
     */
    function levelBadges(head, groups) {
        if (!groups.length) return;
        var wrap = el('span', 'sb-sec-badges'); wrap.setAttribute('data-sb-sec-badges', '');
        groups.forEach(function (g) { wrap.appendChild(chip(g.rank, g.word + ' ' + g.cards.length)); });
        head.insertBefore(wrap, head.querySelector('.marine-forecast-sub-icon'));
    }
    /**
     * 카드 목록을 그린다 — 단계가 둘 이상이면 위에 단계 단추(role=tablist · 하나만 고름 · 처음 = 가장 높은 단계)를 두고 고른 단계의 카드만 보인다. 단계가 하나면 단추 없이 카드만.
     * 카드는 모두 만들어 두고 단계 묶음(tabpanel)만 숨긴다. 다시 그리면(판이 바뀌면) 늘 가장 높은 단계로 돌아온다(고른 것을 기억하지 않음 — 사용자 결정).
     * 단추: 고른 것 = 그 단계 색으로 채움(chip 과 같은 글자색), 나머지 = 그 단계 색 테두리 · 좌우 화살표·Home·End 로 옮김 · 좁으면 가로 스크롤.
     * 예: levelTabs(s3.body, groups, function (c) { return seaCard(c, opts); }, 'sea') → [주의 5][관심 1](§11.10.16 — 단위 없음) + 주의 카드 5장(관심 카드 1장은 숨김)
     * @param {HTMLElement} body @param {Object[]} groups - levelGroups 결과 @param {function(Object):HTMLElement} make - 카드 하나 그리기(seaCard·landCard)
     * @param {string} key - 'sea'|'land'(data-sb-tabs — 시험이 찾는 이름) @returns {void}
     * [연계] ← renderRest / → chip(단계 색) / 모양: station_briefing.css .sb-lvl-tabs·.sb-lvl-tab
     */
    function levelTabs(body, groups, make, key) {
        if (groups.length < 2) { groups.forEach(function (g) { g.cards.forEach(function (c) { body.appendChild(make(c)); }); }); return; }
        var id = 'sb-lv-' + key + '-' + (++tabSeq), bar = el('div', 'sb-lvl-tabs'), tabs = [], panels = [], paint = [];
        bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', (key === 'sea' ? '해상' : '연안') + ' 분석 단계'); bar.setAttribute('data-sb-tabs', key);
        var pick = function (i, focus) {
            tabs.forEach(function (t, k) { var on = k === i; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; t.style.background = on ? paint[k].bg : 'transparent'; t.style.color = on ? paint[k].fg : '#e2e8f0'; panels[k].hidden = !on; });
            if (focus) tabs[i].focus();
        };
        groups.forEach(function (g, i) {
            var ref = chip(g.rank, g.word), t = el('button', 'sb-lvl-tab', g.word + ' ' + g.cards.length), p = el('div', 'sb-lvl-panel');
            paint.push({ bg: ref.style.background, fg: ref.style.color });
            t.type = 'button'; t.id = id + '-t' + i; t.setAttribute('role', 'tab'); t.setAttribute('aria-controls', id + '-p' + i); t.setAttribute('data-rank', String(g.rank)); t.style.borderColor = ref.style.background;
            t.addEventListener('click', function (e) { e.stopPropagation(); pick(i); });
            t.addEventListener('keydown', function (e) {
                var n = tabs.length, j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
                if (j < 0) return; e.preventDefault(); pick(j, true);
            });
            p.id = id + '-p' + i; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', t.id); p.setAttribute('data-rank', String(g.rank));
            g.cards.forEach(function (c) { p.appendChild(make(c)); });
            tabs.push(t); panels.push(p); bar.appendChild(t);
        });
        body.appendChild(bar); panels.forEach(function (p) { body.appendChild(p); });
        pick(0);
    }
    /**
     * 총평 아래 나머지 칸(해상 분석·육상 분석·조석·꼬리)을 그린다 — 종전 render 뒷부분 그대로. 「특별 상황」 칸은 없앴다(아래 ② 주석).
     * 처음에는 모두 접힘(§11.10.16 소절 — 「총평과 권고」만 펼침).
     * @param {HTMLElement} box @param {Object} b @param {Object} opts @param {boolean} showSea @param {boolean} showLand @param {number} nowMs @returns {void}
     * [연계] ← render / → section·timeBar·seaCard·landCard·tide · levelGroups·levelBadges·levelTabs(§11.10.14 — 해상·연안 분석 머리 배지·단계 단추)
     */
    function renderRest(box, b, opts, showSea, showLand, nowMs) {
        // ② 「특별 상황」 칸(특보 해제 예고·예비·이미 해제)은 그리지 않는다 — 2026-10-17 사용자 *"특별상황은 굳이 들어갈 필요가 있겠나 싶은게, 어차피 특보정보가 총평 내용에 녹아들어가고,
        //   또 해상분석에 해상특보 내용이 녹는거 아니니 ? 그래서 필요가 없을 것 같은데."*(설계서 §11.10.16 소절). 이미 저장된 판도 그리지 않는다.
        //   그 제목(해제 예고·예비특보·해제)은 전부 총평 「해상 분석 근거 상세 보기」 (근거) 줄에 있다(서버 rules.seaSummary — 규칙 v17). 서버 b.special 은 AI 입력용으로 그대로.

        // ③④ 해상 분석 — 시간 막대 + 해역 카드
        if (showSea && b.sea) {
            var sea = b.sea, s3 = section('해상 분석', 'sea');   // 처음 접힘(§11.10.16 소절)
            var seaGroups = levelGroups(sea.cards); levelBadges(s3.head, seaGroups);   // 머리 오른쪽 단계별 개수(§11.10.14 — §11.10.16 「주의 5」)
            var sh = el('div', 'sb-sec-head'); sh.appendChild(chip(sea.level && sea.level.rank, sea.level && sea.level.word)); if (sea.level && sea.level.source) sh.appendChild(el('span', 'sb-tag', sea.level.source)); s3.body.appendChild(sh);
            // 「관할 해역 N칸 검토 · 관심 이상 M칸 (카드는 단계 높은 순 10곳까지)」 줄은 없앴다 — 2026-10-17 사용자 *"이 문구 굳이 넣을 필요없음"*(설계서 §11.10.16).
            //   전체 수는 총평 「해상 분석 근거 상세 보기」의 (근거) 줄(「관할 해역 N칸 중 위험이 높아진 해역 M칸」·KOMSA 등급 줄)에 그대로 있다.
            if (Array.isArray(sea.missing) && sea.missing.length) s3.body.appendChild(el('p', 'sb-miss', '확인하지 못한 자료: ' + sourceNames(sea.missing) + ' — 그 근거는 판단에서 뺐습니다.'));
            if (sea.missingSlots && Array.isArray(sea.missingSlots.accident) && sea.missingSlots.accident.length) s3.body.appendChild(el('p', 'sb-miss', '해양사고 위험예보를 받지 못한 시각: ' + sea.missingSlots.accident.map(function (a) { return String(a).slice(11, 13) + '시'; }).join('·')));
            if (sea.weather && sea.weather.text) s3.body.appendChild(el('p', 'sb-weather', sea.weather.text));
            if (Array.isArray(sea.timeBar) && sea.timeBar.length) s3.body.appendChild(timeBar(sea.timeBar, nowMs));
            // 카드: 머리 배지는 위에서(seaGroups) · 여기서는 단계 단추 + 고른 단계 카드(§11.10.14). 막대·검토 줄 등 공통 줄은 단추 위라 고른 단계와 무관하다.
            if (Array.isArray(sea.cards) && sea.cards.length) levelTabs(s3.body, seaGroups, function (c) { return seaCard(c, opts); }, 'sea');
            else s3.body.appendChild(el('p', 'sb-small', (sea.missing && sea.missing.length ? '확인된 자료에서는 ' : '') + '관심 이상인 해역이 없습니다.'));
            box.appendChild(s3.root);
        }

        // ⑤ 육상 분석 — 관광지 카드 + 상시 위험 장소. 해상만 관할(land null)은 육상 보기를 꺼 두었어도 이유 한 줄을 보인다(계약 §7).
        if (showLand || !b.land) {
            var s4 = section('연안 분석', 'land');
            if (!b.land) s4.body.appendChild(el('p', 'sb-small', b.seaOnlyReason || '이 관할은 해상 브리핑만 제공합니다.'));
            else {
                var land = b.land, lh = el('div', 'sb-sec-head'); lh.appendChild(chip(land.level && land.level.rank, land.level && land.level.word)); if (land.level && land.level.source) lh.appendChild(el('span', 'sb-tag', land.level.source)); s4.body.appendChild(lh);
                // 「관광지 N곳 검토 · …」 줄도 해상과 같이 없앴다(§11.10.16 — 같은 꼴의 줄). 그 줄에 있던 「관광지 N곳 자료 확인 불가」도 그리지 않는다 —
                //   2026-10-17 사용자 *"아예 확인 불가도 빼."*(설계서 §11.10.16 소절). 서버 land.failedSpots 값은 그대로 저장된다(화면에만 없음).
                if (Array.isArray(land.missing) && land.missing.length) s4.body.appendChild(el('p', 'sb-miss', '확인하지 못한 자료: ' + sourceNames(land.missing)));
                var landGroups = levelGroups(land.cards); levelBadges(s4.head, landGroups);   // 머리 오른쪽 단계별 개수(§11.10.14 — §11.10.16 「주의 2」)
                if (Array.isArray(land.cards) && land.cards.length) levelTabs(s4.body, landGroups, function (c) { return landCard(c, opts); }, 'land');
                else { var ne = el('p', 'sb-small', dayWord(b) + ' 평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 있는 관광지가 없습니다.'); ne.setAttribute('data-sb-land-none', ''); s4.body.appendChild(ne); }
                if (Array.isArray(land.constant) && land.constant.length) {
                    var cd = el('details', 'sb-constant'); cd.appendChild(el('summary', '', '상시 위험 장소 (' + land.constant.length + ')'));
                    var cl = el('ul', 'sb-list');
                    land.constant.forEach(function (c) { var li = el('li'); li.appendChild(el('b', '', c.name || '')); if (c.text) appendText(li, ' — ' + c.text); cl.appendChild(li); });
                    cd.appendChild(cl); s4.body.appendChild(cd);
                }
            }
            box.appendChild(s4.root);
        }

        // ⑥ 조석(서해·남해·제주 관할)
        if (b.tide) { var s5 = section('조석', 'tide'); s5.body.appendChild(tide(b.tide, nowMs, b)); box.appendChild(s5.root); }

        // ⑦ 안내(종전 「데이터 출처 보기」 접힘은 2026-10-18 삭제) — 2026-10-18 사용자 결정(설계서 §11.10.20, 시안 ⑥판) 원문 *"출처 이런 게 나오는데 너무 보기가 지저분한데 … 데이터 출처 보기 … 아코디언 … 체계적으로"*
        //   · 기준 시각 줄 *"이걸 굳이 명시해야할까 ?"* → 다루는 시간도 *"아예 빼자."* · 안내 *"노란색 텍스트 … 출처 아코디언 밖으로"* · *"결과로, 다음 줄바꿔서 … 실제 현장상황과 다를 수 있습니다."*
        //   안내는 저장된 판의 b.notice(옛 판은 「참고 정보이며 안전을 보장하지 않습니다.」)가 아니라 이 고정 글 — 옛 판도 새 안내로 보인다.
        //   2026-10-18 「데이터 출처 보기」 아코디언 삭제 *"데이터 출처보기 버튼을 별도 아코디언으로 한다기보다 뺴줘. 어차피 기준 상세에 들어가 있잖아."* — 같은 SOURCES 표가 [기준 상세](station_briefing_basis.js)에 있다.
        var foot = el('div', 'sb-foot');
        var nt = el('p', 'sb-notice'); nt.setAttribute('data-sb-notice', '');
        // §11.10.28 사용자 *"텍스트 크기 3포인트정도 크게 해줘. 그리고 볼드는 빼고 텍스트 맨앞에 당구장 표시 처럼 뭔가 나와있으면 좋겠어."* — 「※」 칸 + 글 칸(.sb-notice flex — 둘째 줄이 ※ 뒤 글자 시작에)
        var nk = el('span', 'sb-notice-k', '※'); nk.setAttribute('aria-hidden', 'true'); nt.appendChild(nk);
        var nx = el('span', 'sb-notice-t'); nt.appendChild(nx);
        nx.textContent = '각종 정보(API, 기상정보 등) 기반 AI 분석 결과로, 실제 현장상황과 다를 수 있습니다.';   // 2026-10-18 *"한줄로 표출해주되, 어절단위로 줄바꿔줘"* — 강제 줄바꿈(br) 없이 한 문장, 넘치면 어절에서(.sb-notice keep-all)
        foot.appendChild(nt);
        box.appendChild(foot);
    }
    // blinking() = 지금 깜빡이는 지도 수(시험이 접기·다시 그리기 뒤 0 인지 본다 — §11.10.3)
    w.StationBriefingRender = { render: render, titleText: titleText, editionTime: editionTime, subtitleText: subtitleText, colorOf: colorOf, kstText: kstText, dateText: dateText, sourceNames: sourceNames, dayWord: dayWord, highlightSegments: highlightSegments, highlightNames: highlightNames, splitAdvice: splitAdvice, closeMapPopup: closeMapPopup, WORDS: WORDS, levelWord: levelWord, appendText: appendText, SOURCES: SOURCES, blinking: function () { return blinking; }, updateNow: updateNow, nowPopupOpen: nowPopupOpen, popupOpen: popupOpen, riskAt: riskAt, coastAt: coastAt };
})(window);
