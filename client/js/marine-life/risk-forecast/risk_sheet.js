/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_sheet.js
 * 역할  : 공식 선박 사고·혼잡 예보와 앱 해구 기상, 연안 관광객 분석을 구별해 표시한다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_slider.js 다음 · risk_basis_content.js 이전
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
     * 자료가 있는 사망·실종 배수를 비교 문장으로 만든다.
     * 예: fatal(1.18,'없는 곳 대비')
     * @param {number|null} rr - 사망·실종 배수; base는 비교 기준 문구
     * @returns {string} 비교 HTML 또는 빈 문자열
     * [연계] coastRows → b
     */
    function fatal(rr,base) { return rr==null?'':'<br>사망·실종 사고 발생 가능성 : '+F.escape(base||'')+' '+b(F.amt(rr)+(rr>=1?' 높음':' 낮음'),rr); }
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
    /**
     * 위험구역 목록에 지도 이동 버튼을 붙인다.
     * 예: hazards([{id:'a',place:'해안'}])
     * @param {Object[]} zones - 서버 위험구역 목록
     * @returns {string} 목록 HTML
     * [연계] coastRows → create 클릭 처리
     */
    function hazards(zones) {
        return '<details class="rf-hazards"><summary>위험구역 '+zones.length+'곳 현황</summary><ol>'+zones.map(function(z){return '<li><b>'+F.escape(z.place||z.name)+'</b> · '+F.escape(z.shape)+' · '+F.escape(z.class)+'<br><button type="button" class="rf-hazard-link" data-zone-id="'+F.escape(z.id)+'">'+F.escape(z.addr||'구역 위치 보기')+'</button>'+ (z.police?' · '+F.escape(z.police)+(z.police.endsWith('파출소')?'':'파출소')+' 관할':'')+'</li>';}).join('')+'</ol></details>';
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
            var labels={people:'사람 혼잡',hazard:'위험구역(3km 안)',fatalZone:'사망사고 발생구역',event:'행사 정보',month:r.month+'월 분석',swell:'너울',rip:'이안류'};
            if(r.missing)return row(labels[r.key]||r.key,'<span class="rf-muted">자료 없음</span>','',false);
            switch(r.key) {
                case 'people': if(!r.stage)return ''; return row(labels.people,b(r.stage+'단계',r.rr)+' <small>(집중률 '+F.escape(r.cr)+')</small>','사람 혼잡 '+b(r.stage+'단계',r.rr)+'라 한산할 때(0단계) 대비 '+possibility(r.rr)+fatal(r.fatalRr,'한산할 때(0단계) 대비'));
                case 'hazard': if(!r.count)return ''; return row(labels.hazard,b(r.count+'곳',r.rr),'위험구역이 '+b(r.count+'곳',r.rr)+' 있어 위험구역 없는 곳 대비 '+possibility(r.rr)+fatal(r.fatalRr,'위험구역 없는 곳 대비')+hazards(r.zones||[]));
                case 'fatalZone':return row(labels.fatalZone,b('3km 안',r.rr),'사망사고가 난 구역이 '+b('3km 안',r.rr)+'에 있어 없는 곳 대비 '+possibility(r.rr)+fatal(r.fatalRr,'없는 곳 대비'));
                case 'event': var events=r.events&&r.events.length?r.events:[{name:r.name,src:r.src,sourceType:r.sourceType,start:r.dateRange&&r.dateRange[0],end:r.dateRange&&r.dateRange[1]}],links=events.map(function(e){var url=F.safeURL(e.src);return (url?'<br><a href="'+F.escape(url)+'" target="_blank" rel="noopener noreferrer">'+(events.length>1?F.escape(e.name)+' · ':'')+(e.sourceType==='tourapi'?'관광공사 원천 자료':'행사 원문')+'</a>':'')+(e.start&&e.end?' · '+F.escape(e.start+' ~ '+e.end):'');}).join('');return row(labels.event,'<b class="rf-t-'+(r.weekend?'y':'g')+'">'+F.escape(r.name)+'</b>',(r.weekend?'주말 행사가 있어 같은 요일 행사 없는 날 대비 '+possibility(r.rr):'평일 행사는 과거 사고에 차이가 없어 점수에 넣지 않음')+links);
                case 'month':return row(labels.month,'', '1년 평균 대비 '+possibility(r.rr)+fatal(r.fatalRr,'1년 평균 대비'));
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
        var traffic=d.congestion,query=d.queryPoint||d.matchingAt,position=query?'선택 위치 '+F.dms(query.lat,true)+' - '+F.dms(query.lon,false)+'<br>':'';
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
     * 서버 특보·3일째·떠밀림 안내를 표시한다.
     * 예: notices(detail.notices)
     * @param {Object[]} list - 서버 안내 목록
     * @returns {string} 안내 HTML
     * [연계] create.show → 시트
     */
    function notices(list) {
        return (list||[]).map(function(n){
            if(n.key==='warning') {
                var effective=n.effective||[],pre=n.prelim||[],s='';
                if(pre.length)s+=F.escape(pre.join(', '))+(effective.length?' 예비특보, ':' 발표 상태입니다.');
                if(effective.length)s+=F.escape(effective.join(', '))+' 발효 상태입니다. 특보 중에는 사고는 평소보다 적지만, 사고가 나면 사망·실종으로 이어질 가능성이 '+b('14%',1.14)+' 높습니다.';
                return s?'<div class="rf-notice">⚠ '+s+'</div>':'';
            }
            if(n.key==='day3'||n.key==='forecastDay3')return '<div class="rf-notice">⚠ 특보가 발효될 수 있을 정도의 날씨가 될 가능성이 있습니다.</div>';
            if(n.key==='drift')return '<div class="rf-notice">🛟 이 앞바다 바람 <b class="rf-t-y">'+Math.round(n.windMs)+'m/s</b> — 튜브·물놀이기구 떠밀림 주의</div>';
            return '';
        }).join('');
    }
    /**
     * 서버가 계산한 위험지수·등급·배수를 요약한다.
     * 예: summary(detail,'coast')
     * @param {Object} d - 상세 응답; kind는 coast 또는 sea
     * @returns {string} 요약 HTML
     * [연계] create.show → RiskFormat
     */
    function summary(d,kind) {
        var c=F.col(d.score),rr=d.rr===1?'평소 수준':F.fmt(d.rr);
        var prose=kind==='sea'?'평소(특보 없는 때)보다<br>선박 사고 가능성 '+b(rr,d.rr)+'<small>사고 종류 : 전복, 침몰, 침수, 표류</small>':'한산하고 위험구역 없는 곳의 평범한 날보다<br>사고 가능성 '+b(rr,d.rr)+'<small>사망·실종 사고 발생 가능성 '+b(F.fmt(d.fatalRr),d.fatalRr)+'</small><small>사고 종류 : 익수, 추락, 고립, 떠밀림</small>';
        return '<div class="rf-index"><button type="button" class="rf-basis-btn" data-basis="'+kind+'">기준 상세</button><div class="rf-index-main"><div class="rf-score-box" style="background:'+c+';color:'+F.ink(c)+'"><small>위험지수</small><strong>'+F.escape(d.index)+'</strong></div><div class="rf-index-prose"><b>'+F.escape(d.band)+'</b><br>'+prose+'</div></div><div class="rf-ramp"></div><div class="rf-ramp-labels"><span>0</span><span>50</span><span>100</span></div></div>';
    }
    /**
     * 닫기·위험구역 이동·기준 상세·재시도 동작을 시트에 연결한다.
     * 예: RiskSheet.create(el,handlers)
     * @param {HTMLElement} el - 시트; handlers는 close·hazard·basis·retry·choose 콜백
     * @returns {Object} show·error·choose·clear·timelineEl API
     * [연계] RiskForecast → 상세 응답 표시
     */
    function create(el,handlers) {
        el.innerHTML='<div class="rf-sheet-handle"></div><button class="ocean-sheet-close rf-close" type="button" aria-label="위험예측 닫기">×</button><h3 class="rf-title"></h3><div class="rf-subtitle"></div><div class="rf-timeline"></div><div class="rf-body" aria-live="polite"></div>';
        el.querySelector('.rf-close').addEventListener('click',handlers.close);
        el.addEventListener('click',function(e){var z=e.target.closest('[data-zone-id]'),basis=e.target.closest('[data-basis]'),retry=e.target.closest('[data-retry]');if(z)handlers.hazard(z.dataset.zoneId);if(basis)handlers.basis(basis.dataset.basis,basis);if(retry)handlers.retry();});
        el.addEventListener('click',function(e){var spot=e.target.closest('[data-spot-id]');if(spot)handlers.choose('coast',spot.dataset.spotId);});
        function show(d,kind,item) {
            var sub=d.subtitle||{};
            el.querySelector('.rf-title').textContent=kind==='accident'?'선박 사고 위험예보 · 격자 '+d.gridId:kind==='sea'?((d.title||{}).major+'-'+(d.title||{}).sub+'해구'):d.title;
            el.querySelector('.rf-subtitle').textContent=kind==='accident'?'격자 중심 '+F.dms(d.lat,true)+' - '+F.dms(d.lon,false):kind==='sea'?[sub.name,sub.bearingWord||F.direction(sub.bearingDeg||0),String(Math.round(sub.bearingDeg||0)%360).padStart(3,'0')+'도',Number(sub.distNm||0).toFixed(1)+'해리'].join(' '):F.dms(sub.lat==null?item.lat:sub.lat,true)+' - '+F.dms(sub.lon==null?item.lon:sub.lon,false)+(sub.police?' · '+sub.police+(sub.police.endsWith('파출소')?'':'파출소')+' 관할':'');
            var missing=(d.missing||[]).filter(function(k){return k!=='swell';});
            el.querySelector('.rf-timeline').hidden=false;
            var sourceWarnings=sourceMessages(d,kind),body=sourceWarnings.map(function(text){return '<div class="rf-missing">⚠ '+F.escape(text)+'</div>';}).join('');
            if(missing.length)body+='<div class="rf-missing">⚠ 일부 요소 자료 없음 — '+F.escape(missing.map(sourceName).join(', '))+'</div>';
            var rows=d.rows||[];
            if(d.sources&&d.sources.zoneForecasts&&d.sources.zoneForecasts.status==='stale')rows=rows.map(function(r){return r.key==='wave'||r.key==='wind'?Object.assign({},r,{sourceTime:sourceTime((d.inputs||{}).zoneForecastBase||d.sources.zoneForecasts.base||d.sources.zoneForecasts.updatedAt)}):r;});
            if(kind==='accident')body+=accidentRows(d);
            else if(kind==='sea')body+=trafficRows(d,rows);
            else if(d.clickable===false)body+='<p class="rf-muted">이 시각에는 날씨 위험도 없고 배도 적은 칸입니다(지도에 색이 없음).</p>';
            else body+=summary(d,kind)+notices(d.notices)+coastRows(rows);
            el.querySelector('.rf-body').innerHTML=body;el.classList.add('open');
        }
        function error(message){el.querySelector('.rf-body').innerHTML='<p class="rf-missing">위험예측 자료를 불러오지 못했습니다 — '+F.escape(message)+'</p><button type="button" data-retry>다시 시도</button>';el.classList.add('open');}
        function choose(items){el.querySelector('.rf-title').textContent='관광지 선택';el.querySelector('.rf-subtitle').textContent='같은 위치에 있는 관광지입니다.';el.querySelector('.rf-timeline').hidden=true;el.querySelector('.rf-body').innerHTML='<div class="rf-location-options">'+items.map(function(p){return '<button type="button" class="rf-location-choice" data-spot-id="'+F.escape(p.id)+'">'+F.escape(p.name)+'</button>';}).join('')+'</div>';el.classList.add('open');}
        return {show:show,error:error,choose:choose,clear:function(){el.classList.remove('open');el.querySelector('.rf-body').innerHTML='';},timelineEl:el.querySelector('.rf-timeline')};
    }
    /**
     * 서버 자료 키를 화면에서 읽을 수 있는 이름으로 바꾼다.
     * 예: sourceName('congestion') → 배 혼잡도
     * @param {string} k - 자료 키
     * @returns {string} 한국어 자료 이름
     * [연계] RiskForecast·create.show → 결측 안내
     */
    function sourceName(k) {return {accident:'공식 선박 사고 위험예보',congestion:'배 혼잡도',tourConcentration:'관광지 집중률',people:'사람 혼잡',concentration:'사람 혼잡',rip:'이안류',forecast:'해구 예보',zoneForecasts:'해구 예보',swell:'너울',ripCurrent:'이안류',events:'행사',warnings:'특보',gale:'강풍'}[k]||k;}
    /** 수집·UTC 해구 발표 시각을 KST로 표시한다. 예: 2026101112 → '26. 10. 11.(일) 21:00.
     * @param {string|null} value - ISO 또는 YYYYMMDDHH UTC 시각 @returns {string} 표시 시각
     * [연계] sourceMessages·create.show → RiskFormat.time / 낡은 자료의 기준을 알린다.
     */
    function sourceTime(value){if(!value)return '없음';var compact=/^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(value));if(compact){var date=new Date(Date.UTC(+compact[1],+compact[2]-1,+compact[3],+compact[4]));if(date.getUTCFullYear()!==+compact[1]||date.getUTCMonth()+1!==+compact[2]||date.getUTCDate()!==+compact[3]||date.getUTCHours()!==+compact[4])return '시각 확인 불가';value=date.toISOString();}return F.time(value)||'시각 확인 불가';}
    /** 관련 원천의 실패·낡음과 마지막 수집시각을 알린다. 예: stale → 예보가 오래되었습니다.
     * @param {Object} data - sources를 포함한 응답 @param {string} kind - sea/coast/accident
     * @returns {string[]} 화면 문장 [연계] RiskForecast.refresh·create.show → 배너·시트
     */
    function sourceMessages(data,kind){var sources=Object.assign({},data.sources||{}),stamp=Date.parse(data.t);if(Number.isFinite(stamp)&&sources.events&&sources.events.months){var month=new Date(stamp+9*3600000).toISOString().slice(0,7);sources.events=sources.events.months[month]||{status:'missing'};}var keys=kind==='accident'?['accident','zoneForecasts','congestion']:kind==='sea'?['warnings','zoneForecasts','congestion']:['warnings','gale','zoneForecasts','swell','ripCurrent','tourConcentration','events'];return keys.filter(function(key){var s=sources[key];return s&&s.status&&!['ok','offseason'].includes(s.status);}).map(function(key){var s=sources[key],text=sourceName(key)+(s.status==='stale'?' 자료가 오래되었습니다':s.status==='error'?' 자료 수집에 실패했습니다':' 자료를 받지 못했습니다');if(key==='zoneForecasts'&&s.status==='stale')text+=' (예보 기준 '+sourceTime((data.inputs||{}).zoneForecastBase||s.base||s.updatedAt)+')';return text+' (마지막 수집 '+sourceTime(s.lastSuccess||s.updatedAt)+')';});}
    w.RiskSheet={create:create,sourceName:sourceName,sourceMessages:sourceMessages,coastRows:coastRows,seaRows:seaRows};
})(window);
