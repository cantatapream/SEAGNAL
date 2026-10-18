/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_sheet.js
 * 역할  : 해역 종합·공식 예보·해구 기상·선박사고 이력과 연안 분석을 구별하고 연안 합계 배수의 계산 과정을 설명한다.
 *         시트는 해양종합정보 바텀시트처럼 아래에서 올라오고 내려간다(0.3초 — hold 로 0.2초 뒤에 올리기, 2026-10-16).
 *         연안 시트는 날짜(KST)당 하나 — 그날 가장 높은 값(T24). 시각 막대 자리에 해양종합정보 바텀시트와 같은 날짜 넘기기(< '26. 10. 16.(금) >)와 「가장 높은 때 HH시 기준」.
 *         특보·표류 안내는 그날 남은 칸 어느 칸이든 있으면 시각과 함께(설계서 §16.1 ②) — 특보는 기상청 발표·발효 예정·해제 예고 시각 그대로(「풍랑주의보 발효 중 — 17일 06~09시 해제 예고」, 결정 1 2026-10-16).
 *         표류 대상 말은 서버 target(예보 시각의 KST 달 — 6~9월 「튜브·물놀이기구」, 그 밖 「소형 보트·레저기구」, 2026-10-18 설계서 §11.10.35).
 *         연안 시트 끝에 「이 관광지 주변 연안사고(2020~2024년)」 카드(2026-10-16 T9 — 해상 사고 카드와 같은 꼴, RiskMarine 공용 함수). 경위도는 화면에 쓰지 않는다(같은 날).
 *         2026-10-18 연안 시트 시안(CoastSheet.dc.html·CoastSheetOpen.dc.html): 등급 배지·막대 눈금·「…날 수 있는 조건」·「•」 줄과 넘치는 줄만 자간 맞춤·
 *         위험구역 종류 밑줄 버튼 → 표(위치·종류·구분·지도)·특보/표류 한 상자·「주변 연안사고('20년 ~ '24년)」(설계서 §15.2).
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈(RiskFormat·RiskMarine.accSort/accSummary/bindAcc/closePop) / OpenLayers(지도 모듈)
 *                    · style.css 해양종합정보 시트 날짜 줄(.ocean-date-nav-inline·.ocean-date-nav-btn·.ocean-sheet-date-stack·.ocean-sheet-solar·.ocean-sheet-lunar — 연안 날짜 줄이 그대로 씀, T24)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_marine.js 다음 · risk_basis_content.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    var F=w.RiskFormat;
    /**
     * API 값을 안전한 강조 HTML로 표시한다.
     * 예: b('2단계',2)
     * @param {unknown} value - 표시값; rr은 상대 배수
     * @returns {string} 강조 HTML
     * [연계] 아래 행 렌더러 → RiskFormat
     */
    function b(value,rr) { return '<b class="rf-t-'+F.tone(rr)+'">'+F.escape(value)+'</b>'; }
    /**
     * 배수의 높고 낮음을 포함한 사고 비교 문장을 만든다.
     * 예: possibility(1.5)
     * @param {number} rr - 상대 배수
     * @returns {string} 비교 HTML
     * [연계] 행 렌더러 → b
     */
    function possibility(rr) { return b(F.amt(rr),rr)+(rr>=1?' 높은':' 낮은')+' 사고 발생 가능성'; }
    /**
     * 배수를 「… 날 수 있는 조건」 꼬리로 쓴다(2026-10-18 연안 시트 시안 댓글 — 「…가능성 높음」 대신. 연안 위험지수 카드·요소 줄이 함께 쓴다).
     * 2배 이상 「약 N배 많이」, 1~2배 「약 N% 더 많이」, 1배 미만 「약 N% 적게」, 반올림해 0% 면 「비슷하게」. 숫자 앞에는 늘 「약」.
     * 왜: 요소 하나의 배수는 「그 조건이면 사고가 이만큼 더 난다」는 뜻이라 「가능성이 높다」보다 「날 수 있는 조건」이 맞다(사용자 확정).
     *     특보 안내의 「사망·실종으로 이어질 가능성이 14% 높습니다」는 사고가 난 뒤의 비율이라 이 함수를 쓰지 않는다.
     * 예: cond(4.7) → '<b class="rf-t-o">약 4.7배</b> 많이 날 수 있는 조건' · cond(1.81) → '<b …>약 81%</b> 더 많이 날 수 있는 조건' · cond(0.7) → '<b …>약 30%</b> 적게 날 수 있는 조건'
     * @param {number} rr - 상대 배수(서버 rr·fatalRr) @returns {string} 안전한 HTML(값이 없으면 「자료 없음」)
     * [연계] summary·coastRows → b·RiskFormat.fmt
     */
    function cond(rr) {
        if(!Number.isFinite(rr))return '<span class="rf-muted">자료 없음</span>';
        var p=Math.round(Math.abs(rr-1)*100);
        return (rr>=2?b(F.fmt(rr),rr)+' 많이':p===0?'비슷하게':b('약 '+p+'%',rr)+(rr>1?' 더 많이':' 적게'))+' 날 수 있는 조건';
    }
    /**
     * 요소 줄 설명을 「•」 줄 목록으로 만든다(시안 — 한 문장이 한 줄). 줄마다 .rf-fit 이라 몇 글자 넘쳐 두 줄이 되면 create 의 fit 이 그 줄 자간만 줄인다.
     * 예: bullets(['평소 대비 …', '']) → 빈 줄은 빼고 「•」 한 줄
     * @param {string[]} lines - 이 파일에서 만든 HTML 줄 @returns {string} 줄 목록 HTML [연계] coastRows → create.fit
     */
    function bullets(lines) { return lines.filter(Boolean).map(function(l){return '<div class="rf-bullet"><span aria-hidden="true">•</span><span class="rf-fit">'+l+'</span></div>';}).join(''); }
    /**
     * 사망·실종 배수 줄(「사망·실종 사고 : 평소 대비 약 46% 더 많이 날 수 있는 조건」). 값이 없으면 빈 문자열.
     * 예: fatal(1.46,'평소 대비') @param {number|null} rr - 사망·실종 배수 @param {string} base - 비교 기준 문구 @returns {string} HTML [연계] coastRows → bullets
     */
    function fatal(rr,base) { return rr==null?'':'사망·실종 사고 : '+F.escape(base||'')+' '+cond(rr); }
    /**
     * 고정 제목·검증된 HTML·반영 표시를 상세 행으로 묶는다.
     * 예: row('특보',value,desc,true)
     * @param {string} label - 제목; value·desc는 이 파일에서 만든 HTML, used는 반영 여부
     * @returns {string} 상세 행 HTML
     * [연계] coastRows·seaRows → 시트
     */
    function row(label,value,desc,used) {
        return '<div class="rf-row"><div class="rf-row-head"><strong>'+F.escape(label)+(used?'<small class="rf-used">위험지수에 반영</small>':'')+'</strong><span>'+value+'</span></div>'+(desc?'<div class="rf-row-desc">'+desc+'</div>':'')+'</div>';
    }
    // 위험구역 종류 → 글자색 이름(risk_forecast.css .rf-hz-risk·.rf-hz-freq·.rf-hz-death). 위험구역·다발구역 색은 시안(2026-10-18), 사망사고 발생구역은 시안에 없어 따로 정했다.
    var HZ_KIND={'연안사고 위험구역':'risk','연안사고 다발구역':'freq','사망사고 발생구역':'death'};
    /**
     * 위험구역 종류 칸 이름을 짧게 쓴다 — 「연안사고 」 접두어를 뺀다(시안 표의 「구분」 칸).
     * 예: hazardShort('연안사고 다발구역') → '다발구역' · hazardShort('사망사고 발생구역') → '사망사고 발생구역'
     * @param {string} c - 서버 구역분류 @returns {string} [연계] hazards
     */
    function hazardShort(c) { return String(c||'').replace(/^연안사고\s+/,''); }
    /**
     * 위험구역 목록을 테두리 상자 안의 표로 만든다(2026-10-18 시안 ②-2 — 칸: 위치·종류·구분·지도). 처음엔 접혀 있고(hidden),
     * 요소 줄의 종류별 밑줄 버튼([data-hz-toggle])을 누르면 펼친다. [위치보기]는 종전 주소 링크처럼 지도 이동(data-zone-id → handlers.hazard).
     * 연번·주소·「…파출소 관할」은 시안대로 뺐다.
     * 예: hazards([{id:'a',place:'민락항 방파제',shape:'방파제(TTP)',class:'연안사고 다발구역'}]) → 한 줄 「민락항 방파제 | 방파제(TTP) | 다발구역 | [위치보기]」
     * @param {Object[]} zones - 서버 위험구역 목록(risk_store.coastDetail) @returns {string} 표 HTML(구역이 없으면 빈 문자열)
     * [연계] coastRows → create 클릭 위임(data-hz-toggle 펼침·data-zone-id 지도 이동)·markZone(누른 줄 tr.is-selected)
     */
    function hazards(zones) {
        if(!zones.length)return '';
        return '<div class="rf-hz-box" data-hz-box hidden><table class="rf-hz-table"><thead><tr><th scope="col">위치</th><th scope="col">종류</th><th scope="col">구분</th><th scope="col">지도</th></tr></thead><tbody>'+zones.map(function(z){var k=HZ_KIND[z.class];return '<tr><td><b>'+F.escape(z.place||z.name)+'</b></td><td class="rf-hz-shape">'+F.escape(z.shape)+'</td><td class="rf-hz-class'+(k?' rf-hz-'+k:'')+'">'+F.escape(hazardShort(z.class))+'</td><td><button type="button" class="rf-hazard-link" data-zone-id="'+F.escape(z.id)+'" aria-pressed="false">위치보기</button></td></tr>';}).join('')+'</tbody></table></div>';
    }
    /**
     * 오늘 집중률이 평소(30일 기하평균)의 몇 배인지 쓴다(U81 — 사람 혼잡 줄). 2배 미만은 소수 둘째 자리, 2배 이상은 소수 한 자리.
     * 왜: 2배 미만의 사고 가능성은 정수 %(R6-1·R6-2, 1% 단위)로 나오므로 사람 배수도 1% 단위로 맞춘다 — 소수 한 자리면
     *     1.03배가 「1.0배라 평소 대비 3% 높은」처럼 서로 어긋나 보였다(2026-10-15 검토).
     *     2배 판정은 소수 둘째 자리로 반올림한 값으로 한다 — 반올림 전 값으로 하면 1.995 가 「2.00배」, 2.0 이 「2.0배」로 어긋났다(2026-10-15 2차 검토 D8).
     * 예: crowdTimes(1.034) → '1.03배' · crowdTimes(1.84) → '1.84배' · crowdTimes(1.995) → '2.0배' · crowdTimes(4.27) → '4.3배'
     * @param {number} ratio - 서버 factor.ratio(오늘 집중률 ÷ 30일 기하평균)
     * @returns {string} 표시 문구 [연계] coastRows
     */
    function crowdTimes(ratio) { var r2=Math.round(ratio*100)/100; return r2<2?r2.toFixed(2)+'배':(Math.round(ratio*10)/10).toFixed(1)+'배'; }
    /**
     * 30일 기하평균 집중률을 소수 한 자리로 쓴다. 값이 없으면(null·undefined·빈 문자열) 빈 문자열 — Number(null)=0 이라 「0.0」으로 보이던 것(D8).
     * 예: crowdBase(17.3205) → '17.3', crowdBase(20) → '20.0', crowdBase(null) → ''
     * @param {number} base - 서버 factor.base(risk_score 의 gm, 반올림 없음) @returns {string} [연계] coastRows / 계산은 서버 원값으로 한다(표시만 반올림).
     */
    function crowdBase(base) { return base==null||String(base).trim()===''||!Number.isFinite(Number(base))?'':Number(base).toFixed(1); }
    /**
     * 위험구역 종류별 개수를 종류색 밑줄 버튼으로 쓴다(U81② — 종류마다 따로 셈, 2026-10-18 시안 — 버튼을 누르면 아래 위험구역 표가 펼쳐지고 접힌다). 0개소인 종류는 뺀다.
     * byType 이 없으면 「위험구역 N개소」 버튼 하나(표를 여는 길은 늘 남긴다).
     * 예: hazardKinds([{class:'연안사고 위험구역',count:3},{class:'사망사고 발생구역',count:0},{class:'연안사고 다발구역',count:1}],4)
     *     → '<button … rf-hz-risk>연안사고 위험구역 3개소</button> · <button … rf-hz-freq>연안사고 다발구역 1개소</button>'
     * @param {Object[]} byType - 서버 hazard.byType(class·count) @param {number} count - 전체 개수
     * @returns {string} 안전한 HTML(뒤에 「로<br>위험구역 없는 곳 대비 …」가 이어짐) [연계] coastRows → create 클릭 위임 data-hz-toggle
     */
    function hazardKinds(byType,count) {
        var btn=function(text,k){return '<button type="button" class="rf-hz-kind'+(k?' rf-hz-'+k:'')+'" data-hz-toggle aria-expanded="false">'+F.escape(text)+'</button>';};
        var list=(byType||[]).filter(function(t){return t.count>0;}).map(function(t){return btn(t.class+' '+t.count+'개소',HZ_KIND[t.class]);});
        return list.length?list.join(' · '):btn('위험구역 '+count+'개소');
    }
    /**
     * 서버 연안 분석 행을 표시하고 결측 너울 행은 생략한다.
     * 예: coastRows(detail.rows)
     * @param {Object[]} rows - 연안 상세 rows 계약
     * @returns {string} 상세 HTML
     * [연계] create.show → RiskFormat
     */
    function coastRows(rows) {
        return rows.map(function(r){
            if(r.key==='swell'&&r.missing)return '';
            // 「사람 혼잡(예측)」 — 관광지 집중률은 예측값이다(2026-10-18 시안).
            var labels={people:'사람 혼잡(예측)',hazard:'위험구역(3km 안)',event:'행사 정보',month:r.month+'월 분석',swell:'너울',rip:'이안류'};
            if(r.missing)return row(labels[r.key]||r.key,'<span class="rf-muted">자료 없음</span>','',false);
            // 설명 문구는 「…날 수 있는 조건」(2026-10-18 시안 댓글 — cond). 사람·위험구역·달은 「•」 두 줄(전체 사고 / 사망·실종 사고).
            switch(r.key) {
                // 점수가 0 이거나, 사고 가능성이 반올림해 「0%」면(예: 1.00배) 그리지 않는다 — 「0% 높은」은 평소와 같다는 뜻이라 줄의 의미가 없다(D8).
                case 'people': if(!(r.score>0)||F.amt(r.rr)==='0%')return ''; var times=crowdTimes(r.ratio); return row(labels.people,b(times,r.rr)+' <small>(집중률 '+F.escape(r.cr)+' · 30일 평균 '+F.escape(crowdBase(r.base))+')</small>',bullets(['평소(30일 평균) 대비 '+b(times,r.rr)+'로 사고가 '+cond(r.rr),fatal(r.fatalRr,'평소 대비')]));
                case 'hazard': if(!r.count)return ''; return row(labels.hazard,b(r.count+'개소',r.rr),bullets([hazardKinds(r.byType,r.count)+'로<br>위험구역 없는 곳 대비 사고가 '+cond(r.rr),fatal(r.fatalRr,'위험구역 없는 곳 대비')])+hazards(r.zones||[]));
                case 'event': var events=r.events&&r.events.length?r.events:[{name:r.name,src:r.src,sourceType:r.sourceType,start:r.dateRange&&r.dateRange[0],end:r.dateRange&&r.dateRange[1]}],links=events.map(function(e){var url=F.safeURL(e.src);return (url?'<br><a href="'+F.escape(url)+'" target="_blank" rel="noopener noreferrer">'+(events.length>1?F.escape(e.name)+' · ':'')+(e.sourceType==='tourapi'?'관광공사 원천 자료':'행사 원문')+'</a>':'')+(e.start&&e.end?' · '+F.escape(e.start+' ~ '+e.end):'');}).join('');return row(labels.event,'<b class="rf-t-'+(r.weekend?'y':'g')+'">'+F.escape(r.name)+'</b>',(r.weekend?'주말 행사가 있어 같은 요일 행사 없는 날 대비 사고가 '+cond(r.rr):'평일 행사는 과거 사고에 차이가 없어 점수에 넣지 않음')+links);
                case 'month':return row(labels.month,'',bullets(['1년 평균 대비 사고가 '+cond(r.rr),fatal(r.fatalRr,'1년 평균 대비')]));
                case 'swell': if(!(r.periodS>=12))return ''; return row(labels.swell,b('파도 주기 '+Number(r.periodS).toFixed(1)+'초',r.analysisRr),'(분석) 파도 주기가 12초 이상인 경우 사고 발생률이 '+b('25%',r.analysisRr)+' 증가 · 점수에는 '+b('23%',r.analysisRr)+'로 반영');
                case 'rip': return row(labels.rip,'<b class="rf-t-g">'+F.escape(r.level)+'</b>','');
                default:return '';
            }
        }).join('');
    }
    /**
     * 서버 해상 분석 행과 점수에 선택된 조건을 표시한다.
     * 예: seaRows(detail.rows)
     * @param {Object[]} rows - 해상 상세 rows 계약
     * @returns {string} 상세 HTML
     * [연계] create.show → RiskFormat
     */
    function seaRows(rows) {
        return rows.map(function(r){
            var label={congestion:'배 혼잡도',warning:'특보',wave:'파고',wind:'풍속'}[r.key]||r.key;
            if(r.missing)return row(label,'<span class="rf-muted">자료 없음</span>','');
            if(r.key==='congestion')return r.level>=1?row(label,'<b class="rf-t-'+['g','y','r','r'][r.level]+'">지수 '+Number(r.ci).toFixed(1)+' ('+F.escape(r.levelName)+')</b>',''):'';
            if(r.key==='warning') {var name=r.name||((r.type||'')+(r.level||'')),pre=r.state==='예비'?'예비 ':'';var assumed=r.state==='예비가정'?'('+F.escape(r.assumedFromHour)+'시부터 특보로 가정)':'';return row(label,b(pre+name,r.rr||1),r.state==='예비'?'':F.escape(name)+assumed+' 발효 시 평소 대비 '+possibility(r.rr),r.used);}
            var unit=r.key==='wave'?'m':'m/s',value=Number(r.value).toFixed(r.key==='wave'?1:0)+unit,threshold=r.threshold==null?(r.key==='wave'?4:r.cond==='wind17'?17:14):r.threshold;
            var cond=r.cond?(r.forecastOnly?'특보 없는 '+(r.lead===0?'오늘 ':r.lead===1?'내일 ':''):'특보 중 ')+(r.key==='wave'?'파고 ':'풍속 ')+b(threshold+unit+' 이상',r.rr)+'으로 평소 대비 '+possibility(r.rr):'';
            var valueHTML=r.cond?b(value,r.rr||1):'<b class="rf-t-'+(Number(r.value)>=(r.key==='wave'?2:12)?'y':'g')+'">'+F.escape(value)+'</b>';
            if(r.sourceTime)cond+=(cond?'<br>':'')+'<span class="rf-muted">예보 기준 '+F.escape(r.sourceTime)+'</span>';
            return row(label,valueHTML,cond,r.used);
        }).join('');
    }
    /**
     * 공식 사고 단계와 원시 지수, 별도 혼잡도·해구 기상의 출처 시각을 표시한다.
     * 예: 경계 / 0.0013은 공식 단계와 지수이며 0.13% 사고 확률로 바꾸지 않는다.
     * @param {Object} d - accident-cell 공식 상세 응답
     * @returns {string} 공식 사고 상세 HTML
     * [연계] create.show ← RiskForecast.detail / 공식 지수에 자체 배수를 곱하지 않는다.
     */
    function accidentRows(d) {
        var palette={'낮음':'g','보통':'y','주의':'o','경계':'r'},level=d.accidentRiskLevel;
        var body='<button type="button" class="rf-official-basis" data-basis="sea">기준 상세</button><div class="rf-official"><strong>한국해양교통안전공단 공식 선박 사고 위험예보</strong>'+row('사고 위험 단계','<b class="rf-t-'+(palette[level]||'g')+'">'+F.escape(level||'자료 없음')+'</b>','')+row('사고 위험지수',F.escape(d.accidentRiskIndex==null?'자료 없음':d.accidentRiskIndex),'기관이 제공한 원시 지수입니다. 사고 발생 확률(%)이나 앱 자체 상대 배수가 아닙니다.')+'<p class="rf-muted">예보 시각 '+F.escape(sourceTime(d.forecastAt))+'<br>생성 시각 '+F.escape(sourceTime(d.createdAt))+'</p></div>';
        // 경위도(「선택 위치 34°…N - 128°…E」)는 화면에 쓰지 않는다(사용자 2026-10-16 「그리고 경위도는 빼자. 표시하는 곳에서.」).
        var traffic=d.congestion,position='';
        var matches=d.congestionMatches||[],edge=matches.length>1?'공유 경계의 혼잡 격자 '+matches.length+'개 중 '+F.escape(traffic&&traffic.gridId)+'를 표시합니다.<br>':'';
        body+=row('해당 위치의 선박 혼잡',traffic?F.escape(traffic.congestionLevel)+' · 지수 '+F.escape(traffic.congestionIndex):'<span class="rf-muted">자료 없음</span>',traffic?position+edge+'혼잡 격자 '+F.escape(traffic.gridId)+' · 예보 '+F.escape(sourceTime(traffic.forecastAt))+'<br>사고 격자와 크기가 달라 이 위치를 포함하는 원본 혼잡 격자를 별도로 연결합니다. 사고 위험지수에 가중하지 않습니다.':'같은 위치와 예보 시각에 연결할 혼잡 자료가 없습니다.');
        var weather=d.weather||{},names={wh:['유의파고','m'],ws:['풍속','m/s'],wp:['파주기','s'],wd:['파향','°']};
        body+='<h4 class="rf-weather-title">앱 해구별 기상정보</h4><p class="rf-muted">'+F.escape(weather.source||'기상청 해구별 예보')+' · 예보 '+F.escape(sourceTime(weather.forecastAt))+'<br>사고 위험 모델의 기상 입력과는 별도 자료입니다.</p>';
        Object.keys(names).forEach(function(k){body+=row(names[k][0],Number.isFinite(weather[k])?F.escape(weather[k])+names[k][1]:'<span class="rf-muted">자료 없음</span>','');});
        return body;
    }
    /**
     * 공식 사고 격자가 없는 위치에서는 혼잡·기상 자료만 보여 준다.
     * 예: 혼잡 낮음 / 지수 0.1에는 앱 자체 사고 배수를 붙이지 않는다.
     * @param {Object} d - 기존 sea-cell 응답; rows는 기준시각을 덧붙인 표시 행
     * @returns {string} 혼잡 상세 HTML
     * [연계] create.show ← RiskForecast.detail / 자체 선박 위험요약과 구별한다.
     */
    function trafficRows(d,rows) {
        rows=rows||d.rows||[];var traffic=rows.find(function(r){return r.key==='congestion';}),at=(d.inputs||{}).forecastAt;
        var body='<button type="button" class="rf-official-basis" data-basis="sea">기준 상세</button><p class="rf-muted">선박 혼잡 예보입니다. 이 위치의 공식 사고 위험예보와 구별합니다.</p>';
        body+=row('선박 혼잡',traffic&&!traffic.missing?F.escape(['낮음','보통','높음','매우높음'].includes(d.officialCongestionLevel)?d.officialCongestionLevel:'단계 확인 불가')+' · 지수 '+F.escape(traffic.ci):'<span class="rf-muted">자료 없음</span>','');
        rows.filter(function(r){return r.key==='wave'||r.key==='wind';}).forEach(function(r){body+=row(r.key==='wave'?'유의파고':'풍속',!r.missing&&Number.isFinite(r.value)?F.escape(r.value)+(r.key==='wave'?'m':'m/s'):'<span class="rf-muted">자료 없음</span>','기상청 해구별 예보 · 예보 기준 '+F.escape(r.sourceTime||sourceTime(at)));});
        return body;
    }
    /**
     * 서버 특보·표류 안내를 표시한다(화면 글자 「떠밀림」 → 「표류」 통일, 사용자 2026-10-16 「표류로 통일」 — 서버 키 drift 는 그대로)(3일째 특보급 안내는 연안 2일 제한 「가」 2026-10-15로 서버가 더 이상 보내지 않는다).
     * 2026-10-18 시안: 특보·표류를 주황 상자 하나에 줄마다 그림(세모·구명환)과 함께 담는다(noticeBox·noticeLine).
     * 예: notices(detail.notices)
     * @param {Object[]} list - 서버 안내 목록
     * @returns {string} 안내 HTML
     * [연계] create.show → 시트 / noticeLines·noticeBox
     */
    function notices(list) { return noticeBox(noticeLines(list)); }
    // 안내 줄 앞 그림(2026-10-18 시안 — 종전 글자 ⚠·🛟 대신): 특보 = 노란 테두리 세모, 표류 = 빨강·흰 구명환.
    var ICON_WARN='<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" class="rf-ico-warn"><path d="M12 3.5L2 20.5h20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.1" fill="currentColor"/></svg>';
    var ICON_BUOY='<svg width="1.1em" height="1.1em" viewBox="0 0 24 24" aria-hidden="true" class="rf-ico-buoy"><circle cx="12" cy="12" r="8" fill="none" stroke="#f04438" stroke-width="5"/><circle cx="12" cy="12" r="8" fill="none" stroke="#ffffff" stroke-width="5" stroke-dasharray="4.2 8.37" stroke-dashoffset="2.1"/><circle cx="12" cy="12" r="10.5" fill="none" stroke="#7a2a22" stroke-width="0.8"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#7a2a22" stroke-width="0.8"/></svg>';
    /**
     * 안내 한 줄(그림 + 글)을 만든다. 예: noticeLine(ICON_WARN,'…') @param {string} icon - 그림 SVG @param {string} html - 이 파일에서 만든 HTML
     * @returns {string} 줄 HTML [연계] noticeLines·dayNotices → noticeBox
     */
    function noticeLine(icon,html) { return '<div class="rf-notice-line"><span class="rf-notice-ico">'+icon+'</span><span>'+html+'</span></div>'; }
    /**
     * 안내 줄들을 주황 상자 하나에 담는다(2026-10-18 시안 — 특보·표류가 한 상자 안 두 줄). 줄이 없으면 빈 문자열.
     * 예: noticeBox([warnLine,driftLine]) → '<div class="rf-notice">…</div>' @param {string[]} lines - 줄 HTML @returns {string} [연계] notices·dayNotices → create.show
     */
    function noticeBox(lines) { lines=lines.filter(Boolean); return lines.length?'<div class="rf-notice">'+lines.join('')+'</div>':''; }
    /**
     * 표류 안내 글(2026-10-18 시안 「09시부터 바람 최대 10m/s로 튜브·물놀이기구 등 표류 주의」). 칸 시각이 「09시~」(그날 끝까지)이면 「09시부터」.
     * 대상 말은 서버 target 그대로(risk_score.driftTarget — 그 예보 시각의 KST 달: 6~9월 「튜브·물놀이기구」, 그 밖 「소형 보트·레저기구」 — 사용자 2026-10-18
     *   *"6월 ~ 9월이 좋겠어. 튜브, 물놀이기구. 나머지는 소형보트, 레저기구 등이라고 표현 하자."*, 설계서 §11.10.35 · 관할 브리핑과 같은 값). target 이 없으면 대상 말 없이 「표류 주의」(화면이 달을 짐작하지 않는다).
     * 예: driftText({when:'09시~',most:true,windMs:9.6,target:'튜브·물놀이기구'}) → '09시부터 바람 <b class="rf-t-y">최대 10m/s</b>로 <b class="rf-notice-em">튜브·물놀이기구 등 표류 주의</b>'
     *     driftText({windMs:9,target:'소형 보트·레저기구'}) → '바람 <b class="rf-t-y">9m/s</b>로 <b class="rf-notice-em">소형 보트·레저기구 등 표류 주의</b>'
     * @param {Object} n - {when,most,windMs,target} @returns {string} HTML [연계] noticeLines
     */
    function driftText(n) { return (n.when?F.escape(String(n.when).replace(/~$/,'부터'))+' ':'')+'바람 <b class="rf-t-y">'+(n.most?'최대 ':'')+Math.round(n.windMs)+'m/s</b>로 <b class="rf-notice-em">'+(n.target?F.escape(n.target)+' 등 ':'')+'표류 주의</b>'; }
    /**
     * 서버 안내 목록을 안내 줄들로 바꾼다(하루 값이 없는 응답의 종전 길 — 특보 「… 발효 상태입니다」·표류).
     * 예: noticeLines([{key:'drift',windMs:9,target:'소형 보트·레저기구'}]) → [표류 줄] @param {Object[]} list - 서버 안내 목록 @returns {string[]} 줄 HTML [연계] notices·dayNotices(표류)
     */
    function noticeLines(list) {
        return (list||[]).map(function(n){
            if(n.key==='warning') {
                var effective=n.effective||[],pre=n.prelim||[],s='';
                if(pre.length)s+=F.escape(pre.join(', '))+(effective.length?' 예비특보, ':' 발표 상태입니다.');
                if(effective.length)s+=F.escape(effective.join(', '))+' 발효 상태입니다.<br>특보 중에는 사고는 평소보다 적지만, 사고가 나면 사망·실종으로 이어질 가능성이 '+b('14%',1.14)+' 높습니다.';
                return s?noticeLine(ICON_WARN,s):'';
            }
            if(n.key==='drift')return noticeLine(ICON_BUOY,driftText(n));
            return '';
        });
    }
    /**
     * 기상청 시각 하나({start,end,range} KST ISO — 서버 marine_fusion.warnTime)를 시트 글자로 쓴다. 시트 날짜와 다른 날이면 「17일 」을 붙인다.
     * 정시는 「HH시」, 분이 있으면 「HH:MM」, 범위는 「HH~HH시」(끝이 다음 날 자정이면 24), 범위가 이틀에 걸치면 「21시~18일 03시」.
     * 예: kmaTime({start:'2026-10-17T06:00:00+09:00',end:'…T09:00…',range:true},'2026-10-16') → '17일 06~09시' · ({start:'…16T14:30…',range:false},'2026-10-16') → '14:30'
     * @param {Object|null} x - 시각 @param {string} day - 시트 날짜(YYYY-MM-DD) @returns {string|null} 못 읽으면 null
     * [연계] ← dayNotices(발표·발효 예정·해제 예고) — 사용자 2026-10-16 결정 1 「기상청 시각 그대로」
     */
    function kmaTime(x,day) {
        var at=function(iso){var t=Date.parse(iso);if(!Number.isFinite(t))return null;var d=new Date(t+9*3600000);return {date:d.toISOString().slice(0,10),h:d.getUTCHours(),m:d.getUTCMinutes()};},p2=function(n){return String(n).padStart(2,'0');};
        var a=x&&at(x.start);if(!a)return null;
        var pre=a.date===day?'':Number(a.date.slice(8,10))+'일 ',b=x.range?at(x.end):null;
        if(!b)return pre+(a.m?p2(a.h)+':'+p2(a.m):p2(a.h)+'시');
        var next=new Date(Date.parse(a.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
        if(b.date===a.date)return pre+p2(a.h)+'~'+p2(b.h)+'시';
        if(b.date===next&&b.h===0&&b.m===0)return pre+p2(a.h)+'~24시';
        return pre+p2(a.h)+'시~'+Number(b.date.slice(8,10))+'일 '+p2(b.h)+'시';
    }
    /**
     * 연안 하루 값의 안내(특보·표류)를 그날 칸 전부에서 보여 준다(설계서 §16.1 ②, 사용자 2026-10-16 「모두 추천대로」).
     * 특보 시각은 기상청이 준 것 그대로(결정 1, 2026-10-16 — 원문 *"발표, 발효, 해제의 시각은 이미 기상청으로부터 제공이 되는 거니까 그 시각에 맞춰서 그냥 표출해주면 되는 거 아니야?"*):
     *   발효 중 = 「풍랑주의보 발효 중(14시 발표) — 17일 06~09시 해제 예고」 · 예비 = 「강풍주의보 예비특보(11시 발표) — 21~24시 발효 예정」.
     *   그 시각을 못 읽었을 때만 칸 시각에 「칸 기준」 — 「풍랑주의보 발효 중 — 11시~(칸 기준)」(칸 묶음 「11시~15시」는 그 칸들에서 확인됐다는 뜻이라 실제 시각처럼 보이면 오해된다).
     *   「더 일찍 풀릴 수 있음」 같은 말은 쓰지 않는다(사용자 「굳이 쓸 필요 없을 것 같애」).
     * 칸 시각은 KST 시(지금 칸 13:25 는 13시). 그날 마지막 칸까지 이어지면 「HH시~」, 여러 칸이면 「HH시~HH시」(첫 칸~끝 칸), 한 칸이면 「HH시 무렵」 — 표류(칸마다 바람)는 그대로 칸 시각.
     * 예: [{key:'warning',name:'풍랑주의보',state:'발효',from,to,issued:{start:'…14:00'},release:{start:'…17T06:00',end:'…09:00',range:true}}]
     *     → 「[세모] <빨강 굵게>풍랑주의보 발효 중</>(14시 발표) — 17일 06~09시 해제 예고.<br>특보 중에는 사고는 평소보다 적지만, …」(2026-10-18 시안)
     *     [{key:'drift',windMs:9,target:'튜브·물놀이기구',from:'…T03:00…',to:'…T03:00…'}] → 「[구명환] 03시 무렵 바람 9m/s로 튜브·물놀이기구 등 표류 주의」(10~5월이면 서버 target 「소형 보트·레저기구」) · 여러 칸에 이어지면 그중 가장 센 바람 「최대 Nm/s」, 그날 끝까지면 「09시부터」
     *     특보·표류 줄은 한 상자(.rf-notice) 안 줄(.rf-notice-line)
     * @param {Object} daily - 서버 risk_store.coastDayDetail 의 daily{date,times,notices:[{key,name,state,from,to,windMs,target,issued,effective,release}]} @returns {string} 안내 HTML
     * [연계] ← create.show(연안 — daily.notices 가 있을 때. 없으면 종전 notices(d.notices)) → kmaTime·notices(표류 문구) / 서버 risk_store.dayNotices
     */
    function dayNotices(daily) {
        var times=daily.times||[],end=times[times.length-1],day=daily.date||'',hh=function(at){var t=Date.parse(at);return Number.isFinite(t)?String(new Date(t+9*3600000).getUTCHours()).padStart(2,'0')+'시':'';};
        var when=function(s){return s.to===end?hh(s.from)+'~':s.from===s.to?hh(s.from)+' 무렵':hh(s.from)+'~'+hh(s.to);};
        var pre=[],eff=[],drift=[];
        daily.notices.forEach(function(s){
            if(s.key==='drift'){drift.push({key:'drift',windMs:s.windMs,target:s.target,when:when(s),most:s.from!==s.to});return;}
            if(s.key!=='warning')return;
            // 특보 이름·상태는 빨강 굵게(2026-10-18 시안 「<b>풍랑주의보 발효 중</b> — 19일 03~06시 해제 예고.」), 발표·예고 시각은 보통 글자.
            // 「(HH시 발표)」는 뺀다 — 사용자 2026-10-18 *"2번빼고"*(시안에서 「(05시 발표)」 지운 것과 같게).
            var head='<b class="rf-warn-name">'+F.escape(s.name+(s.state==='발효'?' 발효 중':' 예비특보'))+'</b>';
            var t=kmaTime(s.state==='발효'?s.release:s.effective,day);
            (s.state==='발효'?eff:pre).push(head+F.escape(' — '+(t?t+(s.state==='발효'?' 해제 예고':' 발효 예정'):when(s)+'(칸 기준)')));
        });
        var warn=pre.length||eff.length?noticeLine(ICON_WARN,pre.concat(eff).join('. ')+'.'+(eff.length?'<br>특보 중에는 사고는 평소보다 적지만, 사고가 나면 사망·실종으로 이어질 가능성이 '+b('14%',1.14)+' 높습니다.':'')):'';
        return noticeBox([warn].concat(noticeLines(drift)));
    }
    /**
     * 연안 사고 자료의 유형 이름을 화면 이름으로 바꾼다 — 집계표의 「기타」는 인명사고만 남긴 기타라 「기타(인명)」로 쓴다(U80).
     * 예: coastAccList([{type:'기타',…},{type:'익수',…}]) → [{type:'기타(인명)',…},{type:'익수',…}](최신순)
     * @param {Object[]} list - 서버 history.accidents @returns {Object[]} 최신순 사본 [연계] coastHistory·create.show → RiskMarine.accSort
     */
    function coastAccList(list) { return w.RiskMarine.accSort((list||[]).map(function(a){return a&&a.type==='기타'?Object.assign({},a,{type:'기타(인명)'}):a;})); }
    /**
     * 연안 시트 「주변 연안사고('20년 ~ '24년)」 카드(2026-10-16 T9, 제목은 2026-10-18 시안) — 해상 「이 해역 과거 선박사고」와 같은 꼴(도넛·유형 범례 팝업·인명피해 한 줄)을
     * RiskMarine 공용 함수(accSummary)로 그린다. 영역은 build_coast_accidents.py split — 지도에 칠한 관광지 구역 + 그 앞바다 500m(겹침 없음, 사용자 U79·「500미터로 하자.」).
     * 영역을 적던 작은 글씨 줄(「지도에 칠한 이 관광지 구역과 그 앞바다 500m」)은 2026-10-18 시안에 없어 화면에서 뺐다(영역 계산은 그대로).
     * 예: 사고 8건 → 제목 「주변 연안사고('20년 ~ '24년)」(연도는 h.from·h.to) + 도넛 8건 + 익수 8건 범례 + 「인명피해 없음」
     *     0건 → 「주변 연안사고 없음('20년 ~ '24년)」 · available:false(육지 몫이 없는 6곳·집계표를 못 쓸 때) → 「주변 연안사고 자료 없음」
     * @param {Object} h - 서버 history {available,from,to,area,accidents}
     * @returns {string} 카드 HTML(RiskMarine 이 없으면 빈 문자열) [연계] create.show → RiskMarine.accSummary / 범례 동작은 show 가 RiskMarine.bindAcc 로 붙인다
     */
    function coastHistory(h) {
        if(!w.RiskMarine||!w.RiskMarine.accSummary)return '';
        // 2026-10-18 시안: 제목 「주변 연안사고('20년 ~ '24년)」 — 제목은 흰색, 연도 범위만 종전 제목색(.rf-coast-yrs). 「지도에 칠한 …앞바다 500m」 줄은 시안에 없어 뺐다(영역 자체는 서버 그대로).
        if(!h||h.available!==true)return '<section class="rf-card rf-none rf-coast-acc" data-coast-acc="nodata"><h4>주변 연안사고 자료 없음</h4></section>';
        var yy=function(v){return "'"+F.escape(String(v).slice(2,4))+'년';},yrs=h.from&&h.to?'<span class="rf-coast-yrs">('+yy(h.from)+' ~ '+yy(h.to)+')</span>':'',L=coastAccList(h.accidents);
        if(!L.length)return '<section class="rf-card rf-none rf-coast-acc" data-coast-acc="none"><h4>주변 연안사고 없음'+yrs+'</h4></section>';
        return '<section class="rf-card rf-acc rf-coast-acc" data-coast-acc="list"><h4>주변 연안사고'+yrs+'</h4>'+w.RiskMarine.accSummary(L)+'</section>';
    }
    /**
     * 연안 하루 값이 나온 칸을 글로 쓴다(T24 — 「가장 높은 때 HH시 기준」, KST 시). 지금 칸(예 13:25)은 그 시(13시)로 쓴다.
     * 예: peakText({peakAt:'2026-10-17T03:00:00+09:00'}) → '가장 높은 때 03시 기준' · peakText(undefined) → ''
     * @param {Object} daily - 서버 risk_store.coastDayDetail 의 daily{date,peakAt,times} @returns {string} [연계] ← create.show(연안) → 날짜 줄 둘째 줄
     */
    function peakText(daily) { var at=Date.parse(daily&&daily.peakAt); return Number.isFinite(at)?'가장 높은 때 '+String(new Date(at+9*3600000).getUTCHours()).padStart(2,'0')+'시 기준':''; }
    /**
     * 서버가 계산한 위험지수·등급·배수를 요약한다.
     * 연안(2026-10-18 시안): 왼쪽 칸 「위험지수」/숫자/등급 배지(남색 알약·글자는 칸 색), 오른쪽 「평소 정도로 붐비고 위험구역 없는 곳의 / 평범한 날과 비교 시 /
     * 전체 사고 약 4.7배 많이 날 수 있는 조건」, 0~100 막대 위에 지수 위치 눈금(말풍선 숫자·▼·흰 세로 눈금).
     * 예: summary({index:75,band:'높음',rr:4.7,fatalRr:3.9,missing:[]},'coast') → 주황 칸 「위험지수 75 [높음]」 · 눈금 left:75%

     * @param {Object} d - 상세 응답; kind는 coast 또는 sea
     * @returns {string} 요약 HTML
     * [연계] create.show → RiskFormat
     */
    function summary(d,kind) {
        // 상자 색 = 단계 4색(사용자 2026-10-16 (가) — 종전 연속 색 col() 은 지수 19 가 거의 노랑이라 「평소 수준」 글자·시각 막대 초록과 어긋났다). 서버 band 를 쓰고, 없으면 점수로.
        var c=F.bandColor(F.BAND_COLORS[d.band]?d.band:d.score),rr=d.rr===1?'평소 수준':F.fmt(d.rr),idx=Number(d.index);
        // 등급 글자 = 4단계(평소 수준·다소 높음·높음·매우 높음 — RiskFormat.bandOf). 서버 band 를 쓰고, 4단계 밖이면 지수로.
        var band=F.BAND_COLORS[d.band]?d.band:d.index!=null&&Number.isFinite(idx)?F.bandOf(idx):'';
        // 연안 글(2026-10-18 시안): 등급 글자는 왼쪽 칸의 배지로 옮기고 오른쪽 글은 「평소 정도로 붐비고…」부터, 배수는 「… 날 수 있는 조건」(cond).
        var prose=kind==='sea'?'<b>'+F.escape(d.band)+'</b><br>평소(특보 없는 때)보다<br>선박 사고 가능성 '+b(rr,d.rr)+'<small>사고 종류 : 전복, 침몰, 침수, 표류</small>':'<span class="rf-index-lead">'+((d.missing||[]).length?'확인된 요소 기준의 상대 사고지표<br>':'평소 정도로 붐비고 위험구역 없는 곳의<br>평범한 날과 비교 시<br>')+'전체 사고 '+cond(d.rr)+'</span><small>사망·실종 사고 '+cond(d.fatalRr)+'</small><small>사고 종류 : 익수, 추락, 고립, 표류</small>';
        // 0~100 막대 위 현재 점수 눈금(시안 A안 — 흰 말풍선 숫자 + ▼ + 흰 세로 눈금, 남색 테두리). 위치 = 지수 %, 지수가 없으면 눈금 없음.
        var mark=d.index!=null&&Number.isFinite(idx)?'<div class="rf-ramp-mark" aria-hidden="true" style="left:'+Math.max(0,Math.min(100,idx))+'%"><span class="rf-ramp-val">'+F.escape(d.index)+'</span><span class="rf-ramp-tri"></span><span class="rf-ramp-tick"></span></div>':'';
        // [기준 상세]는 시트 머리 부제 줄 오른쪽 끝(✕ 아래)으로 옮겼다(2026-10-16 T8) — 이 카드 위 버튼 자리 여백도 없앴다.
        // 등급 배지: 남색 알약 + 글자색은 칸 색(c) — 사용자 시안 댓글 2026-10-18.
        return '<div class="rf-index"><div class="rf-index-main"><div class="rf-score-box" style="background:'+c+';color:'+F.ink(c)+'"><small>위험지수</small><strong>'+F.escape(d.index)+'</strong>'+(band&&kind!=='sea'?'<small class="rf-band-badge" style="color:'+c+'">'+F.escape(band)+'</small>':'')+'</div><div class="rf-index-prose">'+prose+'</div></div><div class="rf-ramp-wrap"><div class="rf-ramp"></div>'+mark+'</div><div class="rf-ramp-labels"><span>0</span><span>50</span><span>100</span></div></div>';
    }
    /**
     * 닫기·위험구역 이동·기준 상세·재시도 동작을 시트에 연결한다.
     * 예: RiskSheet.create(el,handlers)
     * @param {HTMLElement} el - 시트; handlers는 close·hazard·basis·retry·choose·day(연안 날짜 < > — T24) 콜백
     * @returns {Object} show·loading·markZone·error·choose·trafficHistory·hold·clear·day·timelineEl API
     * [연계] RiskForecast → 상세 응답 표시
     */
    function create(el,handlers) {
        var SKELETON='<div class="rf-skeleton" role="status"><span class="rf-sr">불러오는 중</span><div class="rf-sk rf-sk-score"></div><div class="rf-sk rf-sk-line"></div><div class="rf-sk rf-sk-line rf-sk-short"></div><div class="rf-sk rf-sk-row"></div><div class="rf-sk rf-sk-row"></div><div class="rf-sk rf-sk-row"></div></div>';
        // 위쪽(손잡이·닫기·제목·시각 조작)은 고정 머리, 그 아래 .rf-body만 스크롤된다. 머리는 상세·브리핑·선택 목록이 함께 쓴다.
        // 부제 줄 오른쪽 끝(✕ 아래)에 [기준 상세](2026-10-16 T8 사용자 「x버튼 아래, 관할 오른쪽 끝」). 부제가 길면 부제만 줄바꿈하고 버튼 자리는 비워 둔다.
        el.innerHTML='<div class="rf-sheet-head"><div class="rf-sheet-handle"></div><button class="ocean-sheet-close rf-close" type="button" aria-label="위험예측 닫기">×</button><h3 class="rf-title"></h3><div class="rf-sub-row"><div class="rf-subtitle"></div><button type="button" class="rf-basis-btn rf-head-basis" hidden>기준 상세</button></div><div class="rf-timeline"></div></div><div class="rf-body" aria-live="polite"></div>';
        var headBasis=el.querySelector('.rf-head-basis'),subRow=el.querySelector('.rf-sub-row'),coastKey=null;
        // 올라오기·내려가기(2026-10-16 사용자 「선택이후 약간의 딜레이(0.2초?) 정도 후 바텀시트가 나오도록 … 아래서 위로 올라오는 느낌의 애니메이션 … 닫을때도 마찬가지로」).
        // CLOSE_MS 는 risk_forecast.css .rf-sheet 의 transition .3s 와 같다 — 해양종합정보 OS.closeSheet 도 300ms 뒤 display:none 으로 정리한다(ocean_bottom_sheet1.js).
        var CLOSE_MS=300,upTimer=null,downTimer=null,wanted=false,dayDate=null,FIT=[-0.02,-0.035,-0.05];
        /**
         * 시트를 올린다(내용은 부른 쪽이 이미 채웠다). 0.2초 기다리는 중(hold)이면 그때 올리도록 표시만 한다.
         * 예: 닫혀 있음 → .rf-shown(그려짐, 아래에 숨음) → 다시 그림 계산 → .open(0.3초 동안 위로) / 내려가는 중 → 내려가기 정리를 취소하고 그 자리에서 다시 위로
         * @returns {void} [연계] ← loading·show·error·choose / → risk_forecast.css .rf-sheet.rf-shown·.open transition
         */
        function present(){wanted=true;if(upTimer)return;clearTimeout(downTimer);downTimer=null;if(!el.classList.contains('rf-shown')){el.classList.add('rf-shown');void el.offsetHeight;/* 아래(translateY(100%))에서 한 번 그린 뒤 .open 을 붙여야 움직임이 보인다 */}el.classList.add('open');fit();}
        /**
         * 한 줄이어야 할 설명 줄(.rf-fit)이 몇 글자 넘쳐 한 줄 더 늘어났으면 그 줄만 자간을 -0.02em → -0.035em → -0.05em 순으로 줄여, 줄 수가 맞는 가장 작은 값만 남긴다.
         * 그래도 안 맞으면 원래대로(줄바꿈 그대로). 전체를 일괄 줄이지 않는다(2026-10-18 시안 댓글 「넘치는 그 줄만」). 줄 수 기준 = <br> 수 + 1.
         * 예: 「사망·실종 사고 : 위험구역 없는 곳 대비 약 2.5배 많이 날 수 있는 조건」이 380px 에서 두 줄 → -0.02em 으로 한 줄
         * @returns {void} [연계] ← present(그려져 크기를 잴 수 있을 때 — 0.2초 대기 중이면 올라올 때) / ← bullets(.rf-fit)
         */
        function fit(){el.querySelectorAll('.rf-body .rf-fit').forEach(function(s){s.style.letterSpacing='';var lh=parseFloat(getComputedStyle(s).lineHeight),want=s.querySelectorAll('br').length+1,lines=function(){return Math.round(s.getBoundingClientRect().height/lh);};if(!(lh>0)||lines()<=want)return;for(var i=0;i<FIT.length;i++){s.style.letterSpacing=FIT[i]+'em';if(lines()<=want)return;}s.style.letterSpacing='';});}
        /**
         * 시트가 안 보일 때만 ms 뒤에 올라오게 미룬다. 그 사이에 채운 내용(회색 틀·상세)은 그때 함께 보인다. 다시 부르면 처음부터 다시 잰다(마지막 선택만).
         * 예: hold(200) → loading(...) → 0.2초 뒤 위로 / 이미 열렸거나 내려가는 중이면 아무것도 안 함 — 내용만 바꾸거나 그 자리에서 다시 올린다
         * @param {number} ms - 기다릴 시간(위험예측은 200) @returns {void}
         * [연계] ← RiskForecast.select(지도 테두리는 누르는 즉시) / clear 가 예약을 취소한다(닫기·토글 끔·탭 떠남·Escape·뒤로가기)
         */
        function hold(ms){if(el.classList.contains('rf-shown'))return;clearTimeout(upTimer);wanted=false;upTimer=setTimeout(function(){upTimer=null;if(wanted)present();},ms);}
        /**
         * 머리의 [기준 상세] 버튼을 보이거나 숨긴다. 누르면 위 클릭 위임([data-basis])이 handlers.basis(kind) 를 부른다.
         * 예: basisFor('coast') → 보임·data-basis="coast" / basisFor(null) → 숨김(data-basis 없음 — 숨은 버튼이 위임에 잡히지 않게)
         * @param {string|null} kind - 'coast'·'sea' 또는 null @returns {void}
         * [연계] ← show(연안 요약·해상 분석)·loading(새 지점)·choose·clear / → RiskBasis.open(kind) 는 위임이 부른다
         */
        function basisFor(kind){headBasis.hidden=!kind;if(kind)headBasis.dataset.basis=kind;else headBasis.removeAttribute('data-basis');syncSubRow();}
        /**
         * 부제가 비고 [기준 상세]도 숨었으면 부제 줄을 숨긴다(경위도를 뺀 뒤 관할이 없는 관광지 — 2026-10-16). 버튼이 보이면 줄(버튼 자리)은 남긴다.
         * 예: 부제 ''·버튼 보임 → 줄 보임 / 부제 ''·버튼 숨김 → 줄 숨김 @returns {void} [연계] ← basisFor·choose(부제를 바꾼 뒤)
         */
        function syncSubRow(){subRow.hidden=!el.querySelector('.rf-subtitle').textContent&&headBasis.hidden;}
        /**
         * 연안 시트의 날짜 줄을 시각 막대 자리(.rf-timeline)에 그리거나 맞춘다(T24, 사용자 2026-10-16 「해당구역을 클릭하면 해양종합정보의 바텀시트처럼 일 시 왼쪽 오른쪽에 < > 버튼 만들어서 넘길 수 있도록.」).
         * 모양은 해양종합정보 바텀시트 머리 날짜 넘기기 그대로 — index2.html #ocean-sheet-prev·#ocean-sheet-next(.ocean-date-nav-btn + fa-chevron)·.ocean-sheet-date-stack(.ocean-sheet-solar 날짜 · .ocean-sheet-lunar 작은 둘째 줄),
         * 비활성은 해양종합정보처럼 disabled(style.css .ocean-date-nav-btn:disabled opacity .3). 해양종합정보는 ▶ 가 늘 켜져 있지만 위험예측은 오늘·내일뿐이라(U79) 내일이면 > 도 꺼진다.
         * 날짜 글자는 해양종합정보 꼴(OS.renderHeader 「'YY. M. D.(요) HH:MM」)에서 시각을 뺀 것, 둘째 줄(음력 자리)은 show 가 채우는 「가장 높은 때 HH시 기준」.
         * 한 번 그린 뒤에는 글자·비활성만 바꾼다(60초 갱신마다 다시 그려 누르던 버튼의 초점을 잃지 않게). 날짜가 바뀌면 둘째 줄을 비운다(옛 날짜 기준을 남기지 않음).
         * 예: day({date:'2026-10-16',sheet:"'26. 10. 16.(금)",prev:false,next:true}) → < 비활성·> 켜짐
         * @param {{date:string,sheet:string,prev:boolean,next:boolean}} info - RiskForecast.dayInfo @returns {void}
         * [연계] ← RiskForecast.sheetDay(연안 선택·메인 날짜 바뀜) / 누름은 아래 클릭 위임이 handlers.day(-1|1) → RiskForecast.shiftDay. 해상 시트는 RiskSlider.mount 가 같은 자리를 덮어쓴다
         */
        function day(info){var tl=el.querySelector('.rf-timeline');if(!tl.querySelector('[data-sheet-day]')){tl.classList.remove('rf-risk-time');tl.innerHTML='<div class="ocean-date-nav-inline rf-sheet-day" role="group" aria-label="연안 위험 예측 날짜"><button type="button" class="ocean-date-nav-btn" data-sheet-day="-1" title="이전 날" aria-label="이전 날"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><div class="ocean-sheet-date-stack"><div class="ocean-sheet-solar" data-sheet-date></div><div class="ocean-sheet-lunar" data-sheet-peak></div></div><button type="button" class="ocean-date-nav-btn" data-sheet-day="1" title="다음 날" aria-label="다음 날"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div>';dayDate=null;}
            if(info.date!==dayDate){dayDate=info.date;tl.querySelector('[data-sheet-peak]').textContent='';}
            tl.querySelector('[data-sheet-date]').textContent=info.sheet;[['-1',info.prev],['1',info.next]].forEach(function(x){var b=tl.querySelector('[data-sheet-day="'+x[0]+'"]');b.disabled=!x[1];b.setAttribute('aria-disabled',String(!x[1]));});}
        el.querySelector('.rf-close').addEventListener('click',handlers.close);
        el.addEventListener('click',function(e){var z=e.target.closest('[data-zone-id]'),basis=e.target.closest('[data-basis]'),retry=e.target.closest('[data-retry]');if(z)handlers.hazard(z.dataset.zoneId);if(basis)handlers.basis(basis.dataset.basis,basis);if(retry)handlers.retry();});
        el.addEventListener('click',function(e){var spot=e.target.closest('[data-spot-id]');if(spot)handlers.choose('coast',spot.dataset.spotId);});
        // 위험구역 종류 밑줄 버튼 → 그 줄의 위험구역 표를 펼치고 접는다(2026-10-18 시안 ②-2). 같은 줄의 버튼들은 aria-expanded 를 함께 맞춘다.
        el.addEventListener('click',function(e){var t=e.target.closest('[data-hz-toggle]'),r=t&&t.closest('.rf-row'),box=r&&r.querySelector('[data-hz-box]');if(!box)return;box.hidden=!box.hidden;r.querySelectorAll('[data-hz-toggle]').forEach(function(x){x.setAttribute('aria-expanded',String(!box.hidden));});});
        el.addEventListener('click',function(e){var d=e.target.closest('[data-sheet-day]');if(d&&!d.disabled&&handlers.day)handlers.day(Number(d.dataset.sheetDay));});
        el.addEventListener('click',function(e){var point=e.target.closest('[data-marine-lon]');if(point&&handlers.marinePoint)handlers.marinePoint(Number(point.dataset.marineLon),Number(point.dataset.marineLat));});
        /**
         * 응답이 오기 전에 시트를 먼저 열고 내용 자리를 회색 틀(스켈레톤)로 채운다.
         * 예: loading({title:'광안리해수욕장'}) / 시간만 바꿀 때는 loading()으로 제목은 두고 본문만 비운다.
         * @param {Object} [hint] - 아는 제목·부제만(지점 이름 등). 없으면 기존 제목을 유지; 모르면 '불러오는 중'
         * @returns {void} [연계] RiskForecast.select·슬라이더 → 응답 뒤 show/error가 덮어쓴다. 이전 지점·시각의 값은 남기지 않는다.
         */
        function loading(hint) {
            if(hint){el.querySelector('.rf-title').textContent=hint.title||'불러오는 중…';el.querySelector('.rf-subtitle').textContent=hint.subtitle||'';basisFor(null);}
            var body=el.querySelector('.rf-body'),peak=el.querySelector('[data-sheet-peak]');el.querySelector('.rf-timeline').hidden=false;if(peak)peak.textContent='';   // 연안 「가장 높은 때」는 응답(show)이 다시 채운다 — 다른 지점·날짜의 기준을 남기지 않음
            body.innerHTML=SKELETON;body.scrollTop=0;el.setAttribute('aria-busy','true');present();
        }
        /**
         * 서버 응답으로 시트 머리(제목·부제)와 본문을 채운다.
         * 예: show({marine:{location:'화순항 북북서방 11.8해리 해역(232-2해구)',station:'한림파출소',office:'제주해양경찰서'}},'sea')
         *     → 부제 「제주해양경찰서 한림파출소 관할」(2026-10-15) · 연안은 「좌표 · <해양경찰서> <파출소> 관할」
         * @param {Object} d - 서버 상세(해상 analysis·연안 coast/spot·공식 사고·브리핑) @param {string} kind - sea/coast/accident/briefing
         * @param {Object} [item] - 누른 지점(좌표 대체용) @param {Object} [ctx] - 해상 본문용 {now: 서버 meta.now}(지금/미래 문구)
         * @returns {void}
         * [연계] RiskForecast.select → 여기 / 관할 문구는 RiskFormat.stationLabel(서버 office: marine_fusion·risk_store)
         *        해상 본문은 RiskMarine.render 로 그리고 RiskMarine.attach 로 날씨 펼침·사고 팝업·교통량 그래프 동작을 붙인다(2026-10-15 시안 8차)
         *        해상 제목은 RiskMarine.title — 끝 해구 괄호만 2pt 작게·굵기 없이(2026-10-18 사용자 확정)
         */
        function show(d,kind,item,ctx) {
            el.removeAttribute('aria-busy');
            if(w.RiskMarine&&(d.marine||kind==='briefing')){if(d.marine)w.RiskMarine.title(el.querySelector('.rf-title'),d.marine.location);else el.querySelector('.rf-title').textContent=d.station.name+' 관할 브리핑';el.querySelector('.rf-subtitle').textContent=d.marine?F.stationLabel(d.marine.station,d.marine.office):'선박 교통·예보·사고 이력 종합';basisFor(d.marine?'sea':null);el.querySelector('.rf-timeline').hidden=false;var mb=el.querySelector('.rf-body');mb.innerHTML=d.marine?w.RiskMarine.render(d.marine,ctx):w.RiskMarine.briefing(d);present();if(d.marine&&w.RiskMarine.attach)w.RiskMarine.attach(mb,d.marine,ctx);return;}
            var sub=d.subtitle||{};
            el.querySelector('.rf-title').textContent=kind==='accident'?'선박 사고 위험예보 · 격자 '+d.gridId:kind==='sea'?((d.title||{}).major+'-'+(d.title||{}).sub+'해구'):d.title;
            // 경위도는 화면에 쓰지 않는다(사용자 2026-10-16 「그리고 경위도는 빼자. 표시하는 곳에서.」) — 연안은 관할만, 옛 공식 사고 격자는 부제 없음(제목에 격자 번호).
            el.querySelector('.rf-subtitle').textContent=kind==='accident'?'':kind==='sea'?[sub.name,sub.bearingWord||F.direction(sub.bearingDeg||0),String(Math.round(sub.bearingDeg||0)%360).padStart(3,'0')+'도',Number(sub.distNm||0).toFixed(1)+'해리'].join(' '):(sub.police?F.stationLabel(sub.police,sub.office):'');
            el.querySelector('.rf-timeline').hidden=false;
            // 수집 진단은 관리자 오류현황에 두고 개별 결측값과 다시 시도는 유지한다.
            var body='';
            var rows=d.rows||[];
            if(d.sources&&d.sources.zoneForecasts&&d.sources.zoneForecasts.status==='stale')rows=rows.map(function(r){return r.key==='wave'||r.key==='wind'?Object.assign({},r,{sourceTime:sourceTime((d.inputs||{}).zoneForecastBase||d.sources.zoneForecasts.base||d.sources.zoneForecasts.updatedAt)}):r;});
            if(kind==='accident')body+=accidentRows(d);
            else if(kind==='sea')body+=trafficRows(d,rows);
            else if(d.clickable===false)body+='<p class="rf-muted">이 시각에는 날씨 위험도 없고 배도 적은 칸입니다(지도에 색이 없음).</p>';
            // 연안: 위험지수 카드 → 안내 → 요소 줄(계산 설명 아코디언 「사고 배수는 어떻게 합쳤나요?」는 2026-10-18 삭제 — 사용자 「빼자.」, 같은 방법은 [기준 상세]·PDF 에 있음) → 주변 연안사고(2026-10-16 T9 — 해상 시트가 「위 카드 → 교통량 → 과거 사고 → 날씨」로 지금 상황 뒤에 과거 사고를 두는 것과 같은 자리).
            //   안내(특보·표류)는 연안 하루 값이면 그날 칸 전부의 것(daily.notices — 시각을 붙임, §16.1 ②), 아니면 종전대로 그 칸의 것.
            //   요소 줄은 .rf-coast-rows 로 묶는다 — 마지막 줄 아래 구분선을 지우고 주변 연안사고 상자와 18px 띄우는 기준(2026-10-18 시안).
            else body+=summary(d,kind)+(d.daily&&Array.isArray(d.daily.notices)?dayNotices(d.daily):notices(d.notices))+'<div class="rf-coast-rows">'+coastRows(rows)+'</div>'+(kind==='coast'&&Object.prototype.hasOwnProperty.call(d,'history')?coastHistory(d.history):'');
            // 머리 [기준 상세]는 연안 요약(위험지수 카드)이 있을 때만. 옛 공식 사고·해상 칸 상세는 본문에 자기 버튼이 있다.
            basisFor(kind!=='accident'&&kind!=='sea'&&d.clickable!==false?kind:null);
            // 다른 관광지·시각을 그리면 열린 사고 목록 팝업을 닫는다(같은 관광지·시각의 60초 갱신은 그대로 — 내용이 같다).
            // 연안은 날짜(daily.date)로 견준다 — 오늘의 가장 높은 칸이 지금 칸이면 60초 갱신마다 d.t 가 바뀌어도 같은 날짜다(T24).
            var key=kind+'|'+d.title+'|'+(d.daily&&d.daily.date||d.t);if(key!==coastKey){coastKey=key;if(w.RiskMarine&&w.RiskMarine.closePop)w.RiskMarine.closePop();}
            // 연안 하루 값(T24): 요소별 설명은 그날 가장 높은 칸의 것이라 날짜 줄 둘째 줄에 그 칸을 작게 밝힌다(사용자 2026-10-16 「1. 가」).
            var pk=el.querySelector('[data-sheet-peak]');if(pk&&kind==='coast')pk.textContent=peakText(d.daily);
            var cb=el.querySelector('.rf-body');cb.innerHTML=body;present();
            if(kind==='coast'&&d.history&&d.history.available===true&&w.RiskMarine&&w.RiskMarine.bindAcc)w.RiskMarine.bindAcc(cb,coastAccList(d.history.accidents),function(x){return F.escape(String(x.date||'').replace(/-/g,'.'));});
        }
        /**
         * 지도에 표시한 위험구역을 목록에서 눌린 상태로 표시한다. 다른 지점을 고르면 시트 본문이 새로 그려져 해제된다.
         * 예: markZone('z3') → z3 [위치보기] aria-pressed=true·그 표 줄(tr) 강조, 나머지 false
         * @param {string} id - 위험구역 id @returns {void} [연계] RiskForecast.hazard → 지도 이동에 성공한 뒤 호출 / hazards 표(2026-10-18 — 종전 목록 li 대신 tr)
         */
        function markZone(id){el.querySelectorAll('[data-zone-id]').forEach(function(b){var on=b.dataset.zoneId===id;b.setAttribute('aria-pressed',String(on));var tr=b.closest('tr');if(tr)tr.classList.toggle('is-selected',on);});}
        function error(message){el.removeAttribute('aria-busy');el.querySelector('.rf-body').innerHTML='<p class="rf-missing">위험예측 자료를 불러오지 못했습니다 — '+F.escape(message)+'</p><button type="button" data-retry>다시 시도</button>';present();}
        function choose(items){el.removeAttribute('aria-busy');el.querySelector('.rf-title').textContent='관광지 선택';el.querySelector('.rf-subtitle').textContent='같은 위치에 있는 관광지입니다.';basisFor(null);el.querySelector('.rf-timeline').hidden=true;el.querySelector('.rf-body').innerHTML='<div class="rf-location-options">'+items.map(function(p){return '<button type="button" class="rf-location-choice" data-spot-id="'+F.escape(p.id)+'">'+F.escape(p.name)+'</button>';}).join('')+'</div>';present();}
        /**
         * 해상 본문의 「지난 2주간 선박교통량」 카드를 받은 이력으로 채운다. 지금 본문이 다른 칸이면 버린다.
         * 예: trafficHistory('GR4_F4K23_P4',응답) / trafficHistory(cell,null,'error') → 「-」와 「기록을 불러오지 못했습니다.」
         * @param {string} cell - 요청한 GR4 칸 @param {Object|null} h - sea/traffic-history 응답 @param {string} [problem] - 'error' @returns {void}
         * [연계] RiskForecast.detail → 여기 → RiskMarine.fillTraffic
         */
        function trafficHistory(cell,h,problem){if(w.RiskMarine&&w.RiskMarine.fillTraffic)w.RiskMarine.fillTraffic(el.querySelector('.rf-body'),cell,h,problem);}
        /**
         * 시트를 내린다. 열려 있었으면 0.3초 동안 아래로 내려간 뒤 숨기고 내용을 지운다(내려가는 동안은 내용이 그대로 보인다). 아직 안 올라왔으면(0.2초 대기 중) 예약을 취소하고 바로 지운다.
         * 예: 열린 시트 ✕ → .open 뗌(내려감) → 0.3초 뒤 .rf-shown 뗌·본문 비움 / 그 0.3초 안에 다른 지점 → present 가 정리를 취소하고 다시 올린다
         * @returns {void} [연계] ← RiskForecast.clearSelection / 열린 사고·[?] 팝업은 바로 닫는다
         */
        function clear(){clearTimeout(upTimer);upTimer=null;wanted=false;el.removeAttribute('aria-busy');el.classList.remove('open');var pop=document.querySelector('.rf-acc-pop');if(pop&&!pop.hidden){pop.hidden=true;if(w.PopupStack)w.PopupStack.remove('risk-sea-accident-pop');}
            function wipe(){basisFor(null);el.querySelector('.rf-body').innerHTML='';}
            if(!el.classList.contains('rf-shown')){wipe();return;}
            clearTimeout(downTimer);downTimer=setTimeout(function(){downTimer=null;el.classList.remove('rf-shown');wipe();},CLOSE_MS);}
        return {show:show,loading:loading,markZone:markZone,error:error,choose:choose,trafficHistory:trafficHistory,hold:hold,clear:clear,day:day,timelineEl:el.querySelector('.rf-timeline')};
    }
    /**
     * 서버 자료 키를 화면에서 읽을 수 있는 이름으로 바꾼다.
     * 예: sourceName('congestion') → 배 혼잡도
     * @param {string} k - 자료 키
     * @returns {string} 한국어 자료 이름
     * [연계] RiskForecast·create.show → 결측 안내
     */
    function sourceName(k) {return {accident:'공식 선박 사고 위험예보',congestion:'배 혼잡도',tourConcentration:'관광지 집중률',people:'사람 혼잡',concentration:'사람 혼잡',hazard:'위험구역',rip:'이안류',forecast:'해구 예보',zoneForecasts:'해구 예보',swell:'너울',ripCurrent:'이안류',events:'행사',warnings:'특보',gale:'강풍'}[k]||k;}
    /** 수집·UTC 해구 발표 시각을 KST로 표시한다. 예: 2026101112 → '26. 10. 11.(일) 21:00.
     * @param {string|null} value - ISO 또는 YYYYMMDDHH UTC 시각 @returns {string} 표시 시각
     * [연계] sourceMessages·create.show → RiskFormat.time / 낡은 자료의 기준을 알린다.
     */
    function sourceTime(value){if(!value)return '없음';var compact=/^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(value));if(compact){var date=new Date(Date.UTC(+compact[1],+compact[2]-1,+compact[3],+compact[4]));if(date.getUTCFullYear()!==+compact[1]||date.getUTCMonth()+1!==+compact[2]||date.getUTCDate()!==+compact[3]||date.getUTCHours()!==+compact[4])return '시각 확인 불가';value=date.toISOString();}return F.time(value)||'시각 확인 불가';}
    /** 관련 원천의 실패·낡음과 마지막 수집시각을 알린다. 예: stale → 예보가 오래되었습니다.
     * @param {Object} data - sources를 포함한 응답 @param {string} kind - sea/coast/accident
     * @returns {string[]} 진단 문장 [연계] RiskForecast.refresh / 공개 배너·시트에는 출력하지 않는다
     */
    function sourceMessages(data,kind){var sources=Object.assign({},data.sources||{}),stamp=Date.parse(data.t);if(Number.isFinite(stamp)&&sources.events&&sources.events.months){var month=new Date(stamp+9*3600000).toISOString().slice(0,7);sources.events=sources.events.months[month]||{status:'missing'};}var keys=kind==='accident'?['accident','zoneForecasts','congestion']:kind==='sea'?['warnings','zoneForecasts','congestion']:['warnings','gale','zoneForecasts','swell','ripCurrent','tourConcentration','events'];return keys.filter(function(key){var s=sources[key];return s&&s.status&&!['ok','offseason'].includes(s.status);}).map(function(key){var s=sources[key],text=sourceName(key)+(s.status==='stale'?' 자료가 오래되었습니다':s.status==='error'?' 자료 수집에 실패했습니다':' 자료를 받지 못했습니다');if(key==='zoneForecasts'&&s.status==='stale')text+=' (예보 기준 '+sourceTime((data.inputs||{}).zoneForecastBase||s.base||s.updatedAt)+')';return text+' (마지막 수집 '+sourceTime(s.lastSuccess||s.updatedAt)+')';});}
    w.RiskSheet={create:create,sourceName:sourceName,sourceMessages:sourceMessages,coastRows:coastRows,seaRows:seaRows};
})(window);
