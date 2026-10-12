/**
 * 파일명: client/js/marine-life/risk-forecast/risk_marine.js
 * 역할  : 해역별 종합 근거와 관할별 현재 선종·사고현황·주의 시간대를 표시한다.
 * [연계] RiskFormat·RiskAPI → sea/analysis,sea/briefing → RiskSheet·RiskForecast.
 * [로드 순서] risk_slider.js 다음 · risk_sheet.js 이전. 화면에서 외부 MTIS·AI 호출 없음.
 */
(function(w){
    'use strict';var F=w.RiskFormat;
    /** 숫자·단계와 관측/조회 시각을 안전한 HTML로 표시한다. 예: null은 자료 없음.
     * @param {unknown} value - 값 @returns {string} 안전 문구
     * [연계] ← render/briefing / 원천 문자열은 전부 escape한다.
     */
    function value(v){return F.escape(v===null||v===undefined?'자료 없음':v);}
    /** 기준시각을 KST로 표시한다. 예: 웹은 관측시각 대신 조회시각으로 표기.
     * @param {object} current - 현재자료 @returns {string} 시각 문구
     * [연계] ← render/briefing / 미래 시각의 척수로 오인하지 않게 한다.
     */
    function stamp(c){return c&&c.sourceAt?'API 등록시각 '+F.time(c.sourceAt):c&&c.collectedAt?'웹 조회시각 '+F.time(c.collectedAt)+' (관측시각 미제공)':'기준시각 확인 불가';}
    /** 사고 집계 범위와 실제 사망·실종 인원을 표시한다. 예: 구조인원은 피해인원에 합산하지 않음.
     * @param {object} h - history @returns {string} HTML
     * [연계] ← render/briefing / 공단 화면과 집계기간·유형 차이를 명시한다.
     */
    function history(h){if(!h||!h.available)return '<p class="rf-muted">선박사고 이력 자료를 확인할 수 없습니다.</p>';return '<section class="rf-marine-section"><h4>과거 선박사고 현황</h4><p class="rf-muted">'+value(h.from)+' ~ '+value(h.to)+(h.scope?' · '+value(h.scope)+' · 격자 '+value(h.gridId):'')+'</p><div class="rf-marine-metrics"><span>대상 사고 <b>'+value(h.count)+'건</b></span><span>사망 <b>'+value(h.death)+'명</b></span><span>실종 <b>'+value(h.missing)+'명</b></span></div><p>주요 유형: '+(h.topTypes||[]).map(function(x){return value(x.type)+' '+value(x.count)+'건';}).join(', ')+'</p><p>기상악화 원인으로 기록된 사고 '+value(h.weatherCause)+'건</p><small class="rf-muted">해양오염·부유물감김 제외. 기록된 사망·실종 집계이며, 미기록은 피해 없음으로 판단하지 않습니다.'+(h.casualtyUnknown?' 피해 수치 누락 '+value(h.casualtyUnknown)+'건.':'')+'</small></section>';}
    /** 선종·톤수 표를 만든다. 예: 부분 미상은 0척으로 치환하지 않는다.
     * @param {array|null} rows - name,count @returns {string} HTML
     * [연계] ← render/briefing / 제공된 항목만 표시한다.
     */
    function composition(rows){return rows?'<div class="rf-marine-composition">'+rows.map(function(r){return '<span>'+value(r.name)+' <b>'+value(r.count)+'척</b></span>';}).join('')+'</div>':'<p class="rf-muted">선종·톤수 구성을 확인할 수 없습니다.</p>';}
    /** 종합 판단의 출처·시각을 근거별로 표시한다. 예: 과거 사고를 현재 확률로 표현하지 않음.
     * @param {array} rows - reasons @returns {string} 근거 목록
     * [연계] ← render/briefing / 서버 계산 문장만 사용한다.
     */
    function reasons(rows){return '<ul class="rf-marine-reasons">'+(rows||[]).map(function(r){return '<li>'+value(r.text)+(r.status&&r.status!=='ok'?' <small>최신성 확인 필요</small>':'')+(r.at?'<small>'+value(F.time(r.at))+'</small>':'')+'</li>';}).join('')+'</ul>';}
    /** 해역의 현재·미래·사고 특성을 한 문맥으로 표시한다. 예: 현재 척수는 미래에도 현재 카드에만 표시.
     * @param {object} m - marine 분석 @returns {string} HTML
     * [연계] ← RiskSheet.show / 공식 단계에 자체 가중치를 더하지 않는다.
     */
    function render(m){var c=m.current,a=m.accident,f=m.congestion,out=m.outlook||{},weather=m.weather||{};
        return '<section class="rf-marine-summary"><h4>'+value(m.combinedLevel?'현재 종합 관심단계 '+m.combinedLevel:m.attention)+'</h4><p>'+value(m.location)+'</p>'+reasons(m.reasons)+'</section><section class="rf-marine-section"><h4>현재 교통현황</h4><p class="rf-muted">'+value(stamp(c||m.currentStatus))+(c&&c.status!=='ok'?' · 최신성 확인 필요':'')+'</p><div class="rf-marine-metrics"><span>선박 <b>'+value(c&&c.count)+(c?'척':'')+'</b></span><span>밀집도 <b>'+value(c&&c.density)+(c&&c.density!==null?'%':'')+'</b></span><span>교통량 단계 <b>'+value(c&&c.level)+'</b></span></div>'+composition(c&&c.types)+'<details><summary>톤수별 구성</summary>'+composition(c&&c.tons)+'</details></section><section class="rf-marine-section"><h4>선택 시각의 공식 예보</h4><p>조회 '+value(F.time(m.t))+'</p><p>사고 위험: <b>'+value(a&&a.level)+'</b> · 원시 지수 '+value(a&&a.index)+(a?' · '+value(F.time(a.forecastAt)):'')+'</p><p>선박 혼잡: <b>'+value(f&&f.level)+'</b> · 지수 '+value(f&&f.index)+(f?' · '+value(F.time(f.forecastAt)):'')+'</p><small class="rf-muted">사고 예보는 약 5㎞ 원본 격자, 혼잡·현재 교통은 원본 GR4 격자를 위치로 연결합니다. 현재 교통량 단계와 사고 예보 단계는 기준이 다릅니다.</small><button type="button" data-basis="sea">공식 예보 기준</button></section><details class="rf-marine-section"><summary>오늘·내일 예보 시간대별 보기</summary><h5>사고 위험예보</h5>'+timeline(out.accident||[])+'<h5>선박 혼잡예보</h5>'+timeline(out.congestion||[])+'</details>'+history(m.history)+'<section class="rf-marine-section"><h4>해구별 기상 예보</h4><p class="rf-muted">기상청 · '+value(F.time(weather.forecastAt))+'</p><p>유의파고 '+value(weather.wh)+'m · 풍속 '+value(weather.ws)+'m/s<br>파주기 '+value(weather.wp)+'s · 파향 '+value(weather.wd)+'°</p></section><p class="rf-muted">'+value(m.scopeNote)+'</p>';
    }
    /** 원래 예보 간격의 표를 만든다. 예: 사고는 3시간, 혼잡은 1시간.
     * @param {array} rows - forecastAt,level @returns {string} 표
     * [연계] ← render / 빈 기간을 보간한 예보로 만들지 않는다.
     */
    function timeline(rows){return rows.length?'<table class="rf-marine-table"><thead><tr><th>예보시각</th><th>공식 단계</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+value(F.time(r.forecastAt))+'</td><td>'+value(r.level)+'</td></tr>';}).join('')+'</tbody></table>':'<p class="rf-muted">제공된 예보 자료가 없습니다.</p>';}
    /** 관할의 전체 집계와 관심 해역별 근거를 표시한다. 예: 관심 해역을 누르면 그 위치의 상세로 이동.
     * @param {object} d - briefing @returns {string} HTML
     * [연계] ← RiskSheet.show / 같은 marine 분석을 재사용한다.
     */
    function briefing(d){var c=d.current;return '<section class="rf-marine-section"><h4>관할 교통·사고 종합</h4><p>예보 조회 '+value(F.time(d.t))+'</p><p class="rf-muted">'+value(stamp(c))+(c&&c.status!=='ok'?' · 최신성 확인 필요':'')+'</p><p>집계 교통량 <b>'+value(c&&c.count)+(c?'척':'')+'</b> · 교통 격자 '+value(c&&c.gridCount)+'개</p>'+composition(c&&c.types)+(c&&c.unknownTypes?'<p>선종 구성 미확인 '+value(c.unknownTypes)+'척</p>':'')+'<p class="rf-muted">'+value(d.method)+'</p></section>'+history(d.history)+'<section class="rf-marine-section"><h4>관심이 필요한 해역·시간대</h4><p>'+value(d.totalAttentionRegions)+'개 해역'+(d.totalAttentionRegions>20?' 중 우선 20개 표시':'')+'</p>'+(d.regions||[]).map(function(m){return '<article><button type="button" class="rf-marine-region" data-marine-lon="'+value(m.point.lon)+'" data-marine-lat="'+value(m.point.lat)+'">'+value(m.location)+' · '+value(m.attention)+'</button>'+reasons(m.reasons)+'</article>';}).join('')+(d.regions&&d.regions.length?'':'<p class="rf-muted">현재 확보한 자료에서 별도 관심 해역이 추출되지 않았습니다. 자료의 최신성과 제공 범위도 확인해주세요.</p>')+'</section>';}
    /** 색상위치에 따라 RGB를 연속 보간한다. 예:0초록→노랑→주황→1빨강.
     * @param {number} position - 서버 색상위치0..1 @returns {string} CSS RGB
     * [연계] ← RiskMapLayer / 원본 위험지수나 확률은 바꾸지 않는다.
     */
    function color(position){var stops=[[86,166,111],[219,199,83],[229,139,70],[214,75,69]],p=Math.max(0,Math.min(1,Number(position)||0))*3,i=Math.min(2,Math.floor(p)),f=p-i;return 'rgb('+stops[i].map(function(v,j){return Math.round(v+(stops[i+1][j]-v)*f);}).join(',')+')';}
    w.RiskMarine={render:render,briefing:briefing,history:history,color:color};
})(window);
