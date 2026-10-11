/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_sheet.js
 * 역할  : 서버가 판정한 해상·연안 상세 응답을 고정 문장 틀과 바텀시트로 표시한다.
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
                case 'event': var url=F.safeURL(r.src);return row(labels.event,'<b class="rf-t-'+(r.weekend?'y':'g')+'">'+F.escape(r.name)+'</b>',(r.weekend?'주말 행사가 있어 같은 요일 행사 없는 날 대비 '+possibility(r.rr):'평일 행사는 과거 사고에 차이가 없어 점수에 넣지 않음')+(url?'<br><a href="'+F.escape(url)+'" target="_blank" rel="noopener noreferrer">행사 원문</a>':'')+(r.dateRange?' · '+F.escape(Array.isArray(r.dateRange)?r.dateRange.join(' ~ '):r.dateRange):''));
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
            var label={congestion:'배 혼잡도',warning:'특보',wave:'파고',wind:'풍속',forecastOnly:'특보급 날씨 예보'}[r.key]||r.key;
            if(r.missing)return row(label,'<span class="rf-muted">자료 없음</span>','');
            if(r.key==='congestion')return r.level>=1?row(label,'<b class="rf-t-'+['g','y','r','r'][r.level]+'">지수 '+Number(r.ci).toFixed(1)+' ('+F.escape(r.levelName)+')</b>',''):'';
            if(r.key==='warning') {var name=r.name||((r.type||'')+(r.level||'')),pre=r.state==='예비'?'예비 ':'';var assumed=r.state==='예비가정'?'('+F.escape(r.assumedFromHour)+'시부터 특보로 가정)':'';return row(label,b(pre+name,r.rr||1),r.state==='예비'?'':F.escape(name)+assumed+' 발효 시 평소 대비 '+possibility(r.rr),r.used);}
            if(r.key==='forecastOnly')return row(label,b('파고 '+r.dayMaxWh+'m · 풍속 '+r.dayMaxWs+'m/s',r.rr),'특보 없이 예보만 특보급인 날 평소 대비 '+possibility(r.rr),r.used);
            var unit=r.key==='wave'?'m':'m/s',value=Number(r.value).toFixed(r.key==='wave'?1:0)+unit,cond=r.cond?(r.key==='wave'?'특보 중 파고 '+value+'로':'특보 중 풍속 '+value+'로')+' 평소 대비 '+possibility(r.rr):'';
            var valueHTML=r.cond?b(value,r.rr||1):'<b class="rf-t-'+(Number(r.value)>=(r.key==='wave'?2:12)?'y':'g')+'">'+F.escape(value)+'</b>';
            return row(label,valueHTML,cond,r.used);
        }).join('');
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
                if(pre.length)s+=F.escape(pre.join(', '))+(effective.length?' 예비특보,':' 발표 상태입니다.');
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
     * @param {HTMLElement} el - 시트; handlers는 close·hazard·basis·retry 콜백
     * @returns {Object} show·error·clear·timelineEl API
     * [연계] RiskForecast → 상세 응답 표시
     */
    function create(el,handlers) {
        el.innerHTML='<div class="rf-sheet-handle"></div><button class="ocean-sheet-close rf-close" type="button" aria-label="위험예측 닫기">×</button><h3 class="rf-title"></h3><div class="rf-subtitle"></div><div class="rf-timeline"></div><div class="rf-body" aria-live="polite"></div>';
        el.querySelector('.rf-close').addEventListener('click',handlers.close);
        el.addEventListener('click',function(e){var z=e.target.closest('[data-zone-id]'),basis=e.target.closest('[data-basis]'),retry=e.target.closest('[data-retry]');if(z)handlers.hazard(z.dataset.zoneId);if(basis)handlers.basis(basis.dataset.basis,basis);if(retry)handlers.retry();});
        function show(d,kind,item) {
            var sub=d.subtitle||{};
            el.querySelector('.rf-title').textContent=kind==='sea'?((d.title||{}).major+'-'+(d.title||{}).sub+'해구'):d.title;
            el.querySelector('.rf-subtitle').textContent=kind==='sea'?[sub.name,sub.bearingWord||F.direction(sub.bearingDeg||0),String(Math.round(sub.bearingDeg||0)%360).padStart(3,'0')+'도',Number(sub.distNm||0).toFixed(1)+'해리'].join(' '):F.dms(sub.lat==null?item.lat:sub.lat,true)+' - '+F.dms(sub.lon==null?item.lon:sub.lon,false)+(sub.police?' · '+sub.police+(sub.police.endsWith('파출소')?'':'파출소')+' 관할':'');
            var missing=(d.missing||[]).filter(function(k){return k!=='swell';});
            var body=(missing.length?'<div class="rf-missing">⚠ 일부 요소 자료 없음 — '+F.escape(missing.map(sourceName).join(', '))+'</div>':'');
            if(d.clickable===false)body+='<p class="rf-muted">이 시각에는 날씨 위험도 없고 배도 적은 칸입니다(지도에 색이 없음).</p>';
            else {body+=summary(d,kind)+(kind==='coast'?notices(d.notices)+coastRows(d.rows||[]):seaRows(d.rows||[]));
                if(kind==='sea'&&d.kinds){var sensitive=d.kinds.sensitive||{},collision=d.kinds.collision||{};body+='<div class="rf-kinds"><div>전복·침몰·침수·표류 <span>'+b(sensitive.rr===1?'평소 수준':F.amt(sensitive.rr)+(sensitive.rr<2?' 높음':''),sensitive.rr)+'</span></div><div>충돌·접촉 <span>'+(collision.status==='withheld'?'<span class="rf-muted">자료가 적어 따로 재지 못함</span>':b(collision.rr===1?'평소 수준':F.amt(collision.rr)+(collision.rr>=1?' 높음':' 낮음'),collision.rr))+'</span></div></div>';}
            }
            el.querySelector('.rf-body').innerHTML=body;el.classList.add('open');
        }
        function error(message){el.querySelector('.rf-body').innerHTML='<p class="rf-missing">위험예측 자료를 불러오지 못했습니다 — '+F.escape(message)+'</p><button type="button" data-retry>다시 시도</button>';el.classList.add('open');}
        return {show:show,error:error,clear:function(){el.classList.remove('open');el.querySelector('.rf-body').innerHTML='';},timelineEl:el.querySelector('.rf-timeline')};
    }
    /**
     * 서버 자료 키를 화면에서 읽을 수 있는 이름으로 바꾼다.
     * 예: sourceName('congestion') → 배 혼잡도
     * @param {string} k - 자료 키
     * @returns {string} 한국어 자료 이름
     * [연계] RiskForecast·create.show → 결측 안내
     */
    function sourceName(k) {return {congestion:'배 혼잡도',tourConcentration:'관광지 집중률',people:'사람 혼잡',concentration:'사람 혼잡',rip:'이안류',forecast:'해구 예보',zoneForecasts:'해구 예보',swell:'너울',ripCurrent:'이안류',events:'행사',warnings:'특보',gale:'강풍'}[k]||k;}
    w.RiskSheet={create:create,sourceName:sourceName,coastRows:coastRows,seaRows:seaRows};
})(window);
