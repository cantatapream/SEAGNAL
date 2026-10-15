/**
 * 파일명: client/js/marine-life/risk-forecast/risk_marine.js
 * 역할  : 해상 지점 시트 본문(위 카드 위험 예측·밀집도/혼잡도, 과거 2주간 선박교통량 그래프, 이 해역 과거 선박사고 도넛·팝업,
 *         날씨 아코디언, 출처)과 관할 브리핑을 그린다. 화면 모양은 2026-10-15 확정 시안 8차(+추가 확정 5가지)를 따른다.
 *         선종·톤수 구성은 표시하지 않는다(사용자 결정 2026-10-15 「톤수, 선박 종류는 API에서 제공하지않는다고
 *         공식적으로 확인했어. 이용할 수 없을 것 같아.」 — 받던 MTIS 웹 수집도 이용약관 때문에 없앴다).
 * [연계] RiskFormat·RiskAPI → sea/analysis(marine.current·congestion·accident·collisionNotice·weather·history.accidents),
 *        sea/traffic-history(30분 척수·특보 구간), sea/briefing → RiskSheet.show·trafficHistory / RiskForecast.detail.
 *        지도 면색 RiskMapLayer ← color(위험 예측)·congestionColor(혼잡도·밀집도).
 * [로드 순서] risk_slider.js 다음 · risk_sheet.js 이전. 화면에서 외부 MTIS·AI 호출 없음.
 */
(function(w){
    'use strict';var F=w.RiskFormat;
    // 공식 사고 위험 4색(지도 위험 예측·슬라이더와 같다) · 혼잡도/밀집도 4색(risk_map_layer 혼잡 4색과 같다).
    var RISK={'낮음':'#56a66f','보통':'#dbc753','주의':'#e58b46','경계':'#d64b45'},CONG={'낮음':'#b8c5da','보통':'#74b9ff','높음':'#d47cff','매우높음':'#ff5fe3'},NONE='#3a4a63';
    var WD=['일','월','화','수','목','금','토'],HR=3600000,MIN30=1800000,DAY=86400000;
    // 「N척」 글자: 숫자 8px · 「척」 6.5px(추가 확정 4). 점·글자는 30분 점 간격 ≥ 가장 넓은 글자 폭 + 2px 일 때만 보인다.
    // 점 위 글자는 정수로 반올림한다 — 30분 값은 소수 한 자리 평균이라 「20.4척」으로 쓰면 글자가 넓어져 ×50 에서도 문턱을 못 넘는다(실측 ×67.7).
    // 정확한 값은 누르면 나오는 말풍선·평균 칸에 소수 한 자리로 보인다.
    var LAB_NUM=8,LAB_UNIT=6.5,LAB_GAP=2,ZOOM_MAX=50;
    var ACC_COL=['#3987e5','#c98500','#9085e9','#199e70'],ACC_ETC='#a9b3c4';
    // 한 시트 안 화면 상태 — 60초 자동 갱신으로 본문을 다시 그려도 같은 지점·같은 시각이면 확대·넘김·말풍선·날씨 펼침을 지킨다.
    var ui={key:null,z:{s:1,off:0,tap:null},wxOpen:false,history:null};
    /** 숫자·단계와 관측/조회 시각을 안전한 HTML로 표시한다. 예: null은 자료 없음.
     * @param {unknown} value - 값 @returns {string} 안전 문구
     * [연계] ← briefing / 원천 문자열은 전부 escape한다.
     */
    function value(v){return F.escape(v===null||v===undefined?'자료 없음':v);}
    /** 기준시각을 KST로 표시한다. 예: API 등록시각, 등록시각이 없는 옛 저장본은 수집시각으로 표기.
     * @param {object} current - 현재자료 @returns {string} 시각 문구
     * [연계] ← briefing / 미래 시각의 척수로 오인하지 않게 한다.
     */
    function stamp(c){return c&&c.sourceAt?'API 등록시각 '+F.time(c.sourceAt):c&&c.collectedAt?'수집시각 '+F.time(c.collectedAt)+' (등록시각 미제공)':'기준시각 확인 불가';}
    /** 관할 브리핑의 사고 집계 범위와 실제 사망·실종 인원을 표시한다. 예: 구조인원은 피해인원에 합산하지 않음.
     * @param {object} h - history @returns {string} HTML
     * [연계] ← briefing / 공단 화면과 집계기간·유형 차이를 명시한다.
     */
    function history(h){if(!h||!h.available)return '<p class="rf-muted">선박사고 이력 자료를 확인할 수 없습니다.</p>';return '<section class="rf-marine-section"><h4>과거 선박사고 현황</h4><p class="rf-muted">'+value(h.from)+' ~ '+value(h.to)+(h.scope?' · '+value(h.scope)+' · 격자 '+value(h.gridId):'')+'</p><div class="rf-marine-metrics"><span>대상 사고 <b>'+value(h.count)+'건</b></span><span>사망 <b>'+value(h.death)+'명</b></span><span>실종 <b>'+value(h.missing)+'명</b></span></div><p>주요 유형: '+(h.topTypes||[]).map(function(x){return value(x.type)+' '+value(x.count)+'건';}).join(', ')+'</p><p>기상악화 원인으로 기록된 사고 '+value(h.weatherCause)+'건</p><small class="rf-muted">해양오염·부유물감김 제외. 기록된 사망·실종 집계이며, 미기록은 피해 없음으로 판단하지 않습니다.'+(h.casualtyUnknown?' 피해 수치 누락 '+value(h.casualtyUnknown)+'건.':'')+'</small></section>';}
    /** 종합 판단의 출처·시각을 근거별로 표시한다. 예: 과거 사고를 현재 확률로 표현하지 않음.
     * @param {array} rows - reasons @returns {string} 근거 목록
     * [연계] ← briefing / 서버 계산 문장만 사용한다.
     */
    function reasons(rows){return '<ul class="rf-marine-reasons">'+(rows||[]).map(function(r){return '<li>'+value(r.text)+(r.status&&r.status!=='ok'?' <small>최신성 확인 필요</small>':'')+(r.at?'<small>'+value(F.time(r.at))+'</small>':'')+'</li>';}).join('')+'</ul>';}

    /** KST 날짜·시각 조각을 만든다. 예: k(ms) → {m:10,d:15,h:16,mi:0,w:'목',day:'2026-10-15'}
     * @param {number} ms - 시각 @returns {object} KST 조각 [연계] ← 이 파일의 시각 문구들 */
    function k(ms){var d=new Date(ms+9*HR);return{m:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),mi:d.getUTCMinutes(),w:WD[d.getUTCDay()],day:d.toISOString().slice(0,10)};}
    function p2(n){return String(n).padStart(2,'0');}
    /** ISO 시각을 KST 「HH:MM」으로. 예: '2026-10-15T07:10:00Z' → '16:10', 잘못된 값 → '' @param {string} iso @returns {string} [연계] ← hero·trafficCard */
    function hm(iso){var t=Date.parse(iso);if(!Number.isFinite(t))return '';var q=k(t);return p2(q.h)+':'+p2(q.mi);}
    /** 「#rrggbb」를 「rgb(r,g,b)」로 바꾼다(F.ink 입력용). 예: '#56a66f' → 'rgb(86,166,111)' @param {string} c @returns {string} [연계] → RiskFormat.ink */
    function rgb(c){return c.replace(/^#(..)(..)(..)$/,function(_,r,g,b){return 'rgb('+parseInt(r,16)+','+parseInt(g,16)+','+parseInt(b,16)+')';});}
    /** 선택 시각이 지금인지 본다. 예: 시트 시각 = 서버 meta.now → true. 서버 collisionNotice 의 「현재」 판정(지금+60초 이하)과 같은 식.
     * @param {object} m - marine @param {object} [ctx] - {now: meta.now} @returns {boolean}
     * [연계] ← render·fillTraffic / ctx 가 없으면(옛 호출) 지금으로 본다. */
    function isNow(m,ctx){return !ctx||!ctx.now||!(Date.parse(m.t)>Date.parse(ctx.now)+60000);}
    /** 선택 시각을 「09시」·「내일 09시」·「10.17 09시」로 쓴다. 예: 오늘 18시 → '18시', 내일 9시 → '내일 09시'.
     * @param {string} at - 선택 시각 ISO @param {string} [now] - 서버 지금 ISO @returns {string} [연계] ← 날씨 아코디언 제목 */
    function whenText(at,now){var a=k(Date.parse(at)),n=now?k(Date.parse(now)):a,next=k(Date.parse(n.day+'T00:00:00+09:00')+DAY).day;return (a.day===n.day?'':a.day===next?'내일 ':a.m+'.'+p2(a.d)+' ')+p2(a.h)+'시';}
    /** 단계 뱃지를 만든다. 4글자(매우높음)는 칸 안에 들게 글자만 줄인다. 값이 없으면 회색 「-」.
     * 예: badge('위험 예측','보통',RISK) @param {string} label @param {string|null} level @param {object} pal - 단계→색 @returns {string} HTML
     * [연계] ← hero */
    function badge(label,level,pal){var c=pal[level]||NONE,txt=pal[level]?level:'-';return '<div class="rf-lvl" data-level="'+F.escape(txt)+'" style="background:'+c+';color:'+(pal[level]?F.ink(rgb(c)):'#cfd8e6')+'"><small>'+label+'</small><strong'+(txt.length>=4?' class="l4"':'')+'>'+F.escape(txt)+'</strong></div>';}
    /** 혼잡예보 단계 작은 뱃지. 예: chip('높음') @param {string} lv @returns {string} HTML [연계] ← hero */
    function chip(lv){var c=CONG[lv];return '<span class="rf-chip" style="background:'+c+';color:'+F.ink(rgb(c))+'">'+F.escape(lv)+'</span>';}
    /** 소수 한 자리로 쓴다(정수면 소수 없이). 예: 4 → '4', 4.25 → '4.3' @param {number} v @returns {string} */
    function num(v){return Number.isInteger(v)?String(v):(Math.round(v*10)/10).toFixed(1);}
    /**
     * 위 카드: 「위험 예측」 뱃지(공식 사고 단계) + 지금이면 「밀집도」 뱃지·척수·충돌주의·혼잡예보 작은 뱃지, 미래면 「혼잡도」 뱃지·혼잡 지수·충돌주의.
     * 예: 지금 18척·12.0%·16시 혼잡 높음 → 「이 해역 선박 18척(밀집도 12.0%)」 「충돌·접촉사고 주의」 「16시 혼잡예보 [높음]」
     * 값 규칙(지어내지 않는다): 서버 상태가 ok 가 아닌 사고·혼잡 예보와 낡은(15분 넘은)·없는 현재 교통은 단계 뱃지를 「-」로 둔다 —
     * 지도 면색이 같은 자료를 칠하지 않는 규칙(marine_fusion.unifiedFrame)과 같다. 낡은 현재값은 「최신성 확인 필요」와 함께 숫자만 보인다.
     * @param {object} m - marine @param {object} ctx - {now} @returns {string} HTML
     * [연계] ← render / 서버 marine.accident·current(densityLevel)·congestion·collisionNotice
     */
    function hero(m,ctx){
        var a=m.accident,cf=m.congestion,c=m.current,okA=a&&a.status==='ok'&&RISK[a.level],okC=cf&&cf.status==='ok'&&CONG[cf.level],cc=m.collisionNotice&&m.collisionNotice.on?'<p><b class="rf-cc">충돌·접촉사고 주의</b></p>':'',row;
        if(isNow(m,ctx)){
            var live=c&&c.status==='ok'&&Number.isFinite(c.count),dens=live&&Number.isFinite(c.density)?c.density:null;
            var line=live?'<p>이 해역 선박 <b>'+F.escape(c.count)+'척</b>(밀집도 '+(dens===null?'-':dens.toFixed(1)+'%')+')</p>':'<p>이 해역 선박 정보 없음</p>'+(c&&Number.isFinite(c.count)?'<p class="sub">마지막 자료 '+hm(c.sourceAt||c.collectedAt)+' 기준 '+F.escape(c.count)+'척 · 최신성 확인 필요</p>':'');
            var fh=cf&&Number.isFinite(Date.parse(cf.forecastAt))?k(Date.parse(cf.forecastAt)).h+'시 ':'';
            row=badge('밀집도',live&&dens!==null?c.densityLevel:null,CONG)+'<div class="rf-txt">'+line+cc+'<p>'+(okC?fh+'혼잡예보 '+chip(cf.level):'혼잡예보 정보 없음')+'</p></div>';
        }else row=badge('혼잡도',okC?cf.level:null,CONG)+'<div class="rf-txt"><p>혼잡 지수 <b>'+(okC&&Number.isFinite(cf.index)?Number(cf.index).toFixed(1):'-')+'</b></p>'+cc+'</div>';
        return '<section class="rf-card rf-hero"><div class="rf-r">'+badge('위험 예측',okA?a.level:null,RISK)+'<div class="rf-txt"><p>최근 5년 간 사고사례 및<br>기상정보 기반 예측 결과</p></div></div><div class="rf-r">'+row+'</div></section>';
    }
    /** 이 지점의 교통량 이력 칸 번호(GR4)를 고른다. 예: current.gridId 우선, 없으면 그 시각 혼잡 예보 칸. 없으면 null.
     * @param {object} m - marine @returns {string|null} [연계] ← RiskForecast.detail(sea/traffic-history?cell=) · fillTraffic */
    function cellOf(m){var id=(m&&m.current&&m.current.gridId)||(m&&m.congestion&&m.congestion.gridId)||null;return typeof id==='string'&&/^GR4_/.test(id)?id:null;}
    /** 「과거 2주간 선박교통량」 카드의 틀(머리·평균 칸·그래프 자리·범례). 값은 fillTraffic 이 채운다.
     * 예: 지금 → 「16:10 기준 · 2분 전」, 미래 → 「지금 16:10 기준」(평균 칸 노란 테두리)
     * @param {object} m @param {object} ctx @returns {string} HTML [연계] ← render */
    function trafficCard(m,ctx){var c=m.current,live=c&&c.status==='ok'&&Number.isFinite(c.count),at=live&&(c.sourceAt||c.collectedAt),ago=at&&ctx&&ctx.now?Math.max(0,Math.round((Date.parse(ctx.now)-Date.parse(at))/60000)):null,now=isNow(m,ctx);
        var src=at&&hm(at)?(now?hm(at)+' 기준'+(ago===null?'':ago?' · '+ago+'분 전':' · 방금'):'지금 '+hm(at)+' 기준'):'';
        return '<section class="rf-card rf-traffic" data-traffic-card><h4>과거 2주간 선박교통량<span class="rf-src">'+src+'</span></h4><div class="rf-tile rf-avg'+(now?'':' fut')+'"><small data-avg-name>2주 평균</small><b class="none" data-avg-value>-</b></div><div class="rf-chart" data-chart aria-busy="true"></div><div class="rf-leg" data-chart-leg><span><i class="ln"></i>선박 수</span><span class="zh" data-zoom></span></div><p class="rf-muted rf-chart-msg" data-chart-msg hidden></p></section>';}
    /** 사고 한 건의 인명피해 글자. 예: {death:1,missing:2} → '사망 1명·실종 2명', 0·0 → '', 둘 중 null 이고 피해 없음 → null(기록 없음)
     * @param {object} a - 사고 @returns {string|null} [연계] ← 팝업·인명피해 줄 */
    function hurtOf(a){var x=[];if(a.death>0)x.push('사망 '+a.death+'명');if(a.missing>0)x.push('실종 '+a.missing+'명');return x.length?x.join('·'):(a.death===null||a.missing===null||a.death===undefined||a.missing===undefined)?null:'';}
    /** 사고 목록을 종류별로 묶는다(건수 많은 순, 같으면 최신 사고가 먼저 나온 종류). 6종 이상이면 상위 4종 + 기타.
     * 예: 충돌5·접촉3·표류2·침수2·화재1·전복1 → [충돌,접촉,표류,침수,기타(화재·전복)]
     * @param {object[]} list - history.accidents(최신순) @returns {object[]} {name,n,types,etc,col} [연계] ← accidents·openAcc */
    function groups(list){var cnt={},order=[];list.forEach(function(a){if(!cnt[a.type]){cnt[a.type]=0;order.push(a.type);}cnt[a.type]++;});
        var g=order.map(function(t,i){return{name:t,n:cnt[t],types:[t],o:i};}).sort(function(a,b){return b.n-a.n||a.o-b.o;});
        if(g.length>5){var rest=g.slice(4);g=g.slice(0,4).concat([{name:'기타',n:rest.reduce(function(s,a){return s+a.n;},0),etc:true,types:rest.map(function(a){return a.name;})}]);}
        g.forEach(function(a,i){a.col=a.etc?ACC_ETC:ACC_COL[i];});return g;}
    /**
     * 「이 해역 과거 선박사고」: 0건이면 한 줄, 있으면 도넛(가운데 총 건수)+누르는 범례(› 팝업)+인명피해 한 줄.
     * 인명피해 줄: 「사망 1명(23년, 충돌), 실종 2명(21년, 전복)」(한 사고에 둘 다면 「사망 1명·실종 2명(23년, 충돌)」) / 없으면 「인명피해 없음」.
     * 사망·실종 수가 비어 있는(null) 사고는 「없음」으로 단정하지 않는다 — 그런 사고가 있으면 「인명피해 기록 없는 사고 N건」을 덧붙이고,
     * 피해가 기록된 사고가 하나도 없을 때는 「인명피해 없음」 대신 「기록된 인명피해 없음 · 인명피해 기록 없는 사고 N건」으로 쓴다.
     * @param {object} h - marine.history @returns {string} HTML
     * [연계] ← render / 서버 marine_fusion.accidentList(사고예보 5km 칸 안 2021~2025, 해양오염·부유물감김 제외)
     */
    function accidents(h){
        if(!h||h.available===false)return '<section class="rf-card"><h4>이 해역 과거 선박사고</h4><p class="rf-muted">선박사고 이력 자료를 확인할 수 없습니다.</p></section>';
        var yrs=(h.from&&h.to?F.escape(String(h.from).slice(0,4))+'~'+F.escape(String(h.to).slice(0,4))+'년':''),L=(h.accidents||[]).slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
        if(!L.length)return '<section class="rf-card rf-none" data-acc-none><h4>이 해역 선박사고 없음<span class="rf-src">'+yrs+'</span></h4></section>';
        var g=groups(L),D=112,rad=42,sw=15,C=2*Math.PI*rad,acc=0,arcs='';
        g.forEach(function(a){var len=a.n/L.length*C;arcs+='<circle cx="'+D/2+'" cy="'+D/2+'" r="'+rad+'" fill="none" stroke="'+a.col+'" stroke-width="'+sw+'" stroke-dasharray="'+Math.max(0,len-(g.length>1?2:0)).toFixed(2)+' '+C.toFixed(2)+'" stroke-dashoffset="'+(-acc).toFixed(2)+'" transform="rotate(-90 '+D/2+' '+D/2+')" data-arc="'+F.escape(a.name)+'"/>';acc+=len;});
        var donut='<svg width="'+D+'" height="'+D+'" viewBox="0 0 '+D+' '+D+'" role="img" aria-label="사고 종류별 건수, 전체 '+L.length+'건">'+arcs+'<text x="'+D/2+'" y="'+(D/2+7)+'" fill="#fff" font-size="21" font-weight="800" text-anchor="middle" data-acc-total>'+L.length+'<tspan font-size="12" font-weight="500" fill="#bfcbde">건</tspan></text></svg>';
        var leg='<ul class="rf-acc-leg">'+g.map(function(a,i){return '<li><button type="button" data-acc-group="'+i+'" aria-haspopup="dialog"><i style="background:'+a.col+'"></i><span>'+F.escape(a.name)+(a.etc?' <small>('+a.types.map(F.escape).join('·')+')</small>':'')+'</span><b>'+a.n+'<em>건</em></b><span class="go" aria-hidden="true">›</span></button></li>';}).join('')+'</ul>';
        var hurt=L.filter(function(a){return hurtOf(a);}),unknown=L.filter(function(a){return hurtOf(a)===null;}).length;
        var cas=hurt.length?'<p class="rf-acc-cas" data-acc-cas>'+hurt.map(function(a){var x=[];if(a.death>0)x.push('<b>사망 '+a.death+'명</b>');if(a.missing>0)x.push('<b>실종 '+a.missing+'명</b>');return x.join('·')+'('+F.escape(String(a.year||String(a.date).slice(0,4)).slice(2,4))+'년, '+F.escape(a.type)+')';}).join(', ')+(unknown?' · 인명피해 기록 없는 사고 '+unknown+'건':'')+'</p>'
            :'<p class="rf-acc-cas none" data-acc-cas>'+(unknown?'기록된 인명피해 없음 · 인명피해 기록 없는 사고 '+unknown+'건':'인명피해 없음')+'</p>';
        return '<section class="rf-card rf-acc"><h4>이 해역 과거 선박사고<span class="rf-src">'+yrs+'</span></h4><div class="rf-acc-sum">'+donut+leg+'</div>'+cas+'</section>';
    }
    /** 날씨 방향 칸. 예: dirTile('파향',203.4) → 「203° 남남서」, null → 「-」 @param {string} lbl @param {number|null} d @returns {string} HTML [연계] ← weather */
    function dirTile(lbl,d){return '<div class="rf-tile"><small>'+lbl+'</small><b>'+(Number.isFinite(d)?Math.round(d)+'<em>°</em><em class="dir">'+F.direction(d)+'</em>':'-')+'</b></div>';}
    /** 값 칸. 예: tile('유의파고',1.2,'m') → 「1.2 m」, null → 「-」 @returns {string} HTML [연계] ← weather */
    function tile(lbl,v,unit){return '<div class="rf-tile"><small>'+lbl+'</small><b>'+(Number.isFinite(v)?F.escape(v)+'<em>'+unit+'</em>':'-')+'</b></div>';}
    /** 날씨 아코디언(처음 접힘). 지금이면 「지금 이 해역 날씨」, 미래면 「이 해역 내일 09시 예보」(오늘이면 「이 해역 18시 예보」).
     * 파도(유의파고·파주기·파향) / 바람(풍속·풍향). 예: 파향 203.4 → 「203° 남남서」.
     * @param {object} m @param {object} ctx @returns {string} HTML [연계] ← render / 서버 marine.weather {wh,wp,wd,ws,windDir} */
    function weather(m,ctx){var x=m.weather||{},open=ui.wxOpen;
        return '<section class="rf-card rf-wx"><button type="button" class="rf-wx-head" aria-expanded="'+open+'" data-wx><h4>'+(isNow(m,ctx)?'지금 이 해역 날씨':'이 해역 '+whenText(m.t,ctx&&ctx.now)+' 예보')+'</h4><i class="chev" aria-hidden="true"></i></button>'
            +'<div class="rf-wx-body" data-wx-body'+(open?'':' hidden')+'><p class="g">파도</p><div class="rf-grid rf-grid3">'+tile('유의파고',x.wh,'m')+tile('파주기',x.wp,'초')+dirTile('파향',x.wd)+'</div><p class="g">바람</p><div class="rf-grid">'+tile('풍속',x.ws,'m/s')+dirTile('풍향',x.windDir)+'</div></div></section>';}
    /**
     * 해상 지점 시트 본문 HTML 을 만든다. 순서: 위 카드 → 과거 2주간 선박교통량 → 이 해역 과거 선박사고 → 날씨 → 출처(+[기준 상세]).
     * 예: render(marine,{now:'2026-10-15T16:12:00+09:00'})
     * @param {object} m - marine 분석 @param {object} [ctx] - {now: 서버 meta.now} @returns {string} HTML
     * [연계] ← RiskSheet.show → 이어서 attach(이벤트) / 공식 단계에 자체 가중치를 더하지 않는다. 서버 문자열은 전부 escape.
     */
    function render(m,ctx){
        var key=[m.location,m.point&&m.point.lon,m.point&&m.point.lat,m.t].join('|');if(key!==ui.key){ui.key=key;ui.z={s:1,off:0,tap:null};ui.wxOpen=false;}
        return hero(m,ctx)+trafficCard(m,ctx)+accidents(m.history)+weather(m,ctx)
            +'<div class="rf-cite"><dl><dt>출처</dt><dd>위험 예측·혼잡도·과거 2주간 선박교통량: 해양교통안전공단 API</dd><dt></dt><dd>이 해역 날씨: 기상청 해구별 예보</dd><dt></dt><dd>이 해역 과거 선박사고: 국립해양조사원 개방海 데이터셋</dd></dl><button type="button" class="rf-basis-btn" data-basis="sea">기준 상세</button></div>';
    }
    /**
     * 그려 둔 본문에 동작을 붙인다: 날씨 펼침, 사고 종류 팝업, 교통량 카드(같은 칸 이력을 이미 받았으면 바로 그림).
     * 예: attach(body,marine,{now}) @param {HTMLElement} body - .rf-body @param {object} m @param {object} ctx @returns {void}
     * [연계] ← RiskSheet.show / → fillTraffic · openAcc
     */
    function attach(body,m,ctx){
        body._rfMarine={m:m,ctx:ctx,cell:cellOf(m)};
        var wx=body.querySelector('[data-wx]');if(wx)wx.addEventListener('click',function(){ui.wxOpen=wx.getAttribute('aria-expanded')!=='true';wx.setAttribute('aria-expanded',String(ui.wxOpen));body.querySelector('[data-wx-body]').hidden=!ui.wxOpen;});
        var list=((m.history&&m.history.accidents)||[]).slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date));}),g=groups(list);
        body.querySelectorAll('[data-acc-group]').forEach(function(b){b.addEventListener('click',function(){openAcc(body,g[+b.dataset.accGroup],list,b);});});
        var cell=body._rfMarine.cell;
        if(!cell)fillTraffic(body,null,null,'nocell');else if(ui.history&&ui.history.cell===cell)fillTraffic(body,cell,ui.history.data);
    }
    /** 사고 종류 팝업을 연다: 그 종류 사고 최신순 「YYYY년 · 원인: X」(기타는 종류 이름 앞에) + 오른쪽 인명피해.
     * 예: 충돌 5건 → 「2025년 · 원인: 운항부주의 … 인명피해 없음」, 「2023년 · 원인 기록 없음 … 사망 1명」(빨강 굵게)
     * @param {HTMLElement} body @param {object} grp - groups() 한 줄 @param {object[]} list - 최신순 사고 @param {HTMLElement} opener - 닫으면 돌아갈 버튼 @returns {void}
     * [연계] ← attach / 휴대폰 뒤로가기(PopupStack)·Escape·바깥 누르기로 닫는다. 화면 전체를 덮도록 document.body 에 붙인다
     *        (앱에서 시트는 지도 구역의 쌓임 맥락 안에 있어, 시트 안에 두면 메인 탭이 팝업 위로 올라온다). RiskSheet.clear 가 시트를 닫을 때 함께 닫는다. */
    function openAcc(body,grp,list,opener){
        var pop=document.querySelector('.rf-acc-pop');
        if(!pop){pop=document.createElement('div');pop.className='rf-acc-pop';pop.hidden=true;document.body.appendChild(pop);pop.addEventListener('click',function(e){if(e.target===pop||e.target.closest('.x'))closeAcc(pop);});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!pop.hidden&&pop.isConnected)closeAcc(pop);});}
        var rows=list.filter(function(x){return grp.types.indexOf(x.type)>=0;}).map(function(x){var hz=hurtOf(x);
            return '<li><span class="t">'+(grp.etc?'<b>'+F.escape(x.type)+'</b> · ':'')+F.escape(x.year||String(x.date).slice(0,4))+'년 · '+(x.cause?'원인: '+F.escape(x.cause):'<span class="no">원인 기록 없음</span>')+'</span>'+(hz?'<span class="c hurt">'+F.escape(hz)+'</span>':'<span class="c">'+(hz===null?'인명피해 기록 없음':'인명피해 없음')+'</span>')+'</li>';}).join('');
        pop.innerHTML='<div class="box" role="dialog" aria-modal="true" aria-label="'+F.escape(grp.name)+' 사고 목록"><div class="hd"><i style="background:'+grp.col+'"></i><h5>'+F.escape(grp.name)+' '+grp.n+'건<small>최신순</small></h5><button type="button" class="x" aria-label="닫기">×</button></div><ul>'+rows+'</ul></div>';
        pop._opener=opener;pop.hidden=false;if(w.PopupStack)w.PopupStack.push('risk-sea-accident-pop',function(){closeAcc(pop,true);});pop.querySelector('.x').focus();
    }
    /** 사고 팝업을 닫는다. @param {HTMLElement} pop @param {boolean} [fromBack] - 뒤로가기가 이미 목록에서 뺐으면 true @returns {void} [연계] ← openAcc */
    function closeAcc(pop,fromBack){if(pop.hidden)return;pop.hidden=true;if(!fromBack&&w.PopupStack)w.PopupStack.remove('risk-sea-accident-pop');if(pop._opener&&pop._opener.isConnected)pop._opener.focus();}

    var measure=null;
    /** 글자 폭을 잰다(SVG 와 같은 글꼴). 예: textW('18',8,600) @param {string} t @param {number} fs - px @param {number} fw - 굵기 @param {string} family @returns {number} px [연계] ← labW·chart */
    function textW(t,fs,fw,family){if(!measure)measure=document.createElement('canvas').getContext('2d');measure.font=(fw||600)+' '+fs+'px '+family;return measure.measureText(t).width;}
    /**
     * 이력 응답을 그래프 자료로 바꾼다: 지금 30분 칸을 끝으로 하는 14일(672칸) 창, 칸 값이 있는 점만, 끝에 「지금 N척」(최신 정상 척수).
     * 평균: 선택 시각이 든 30분 칸과 같은 시·분의, 이미 끝난 30분 칸 최근 14개 중 값이 있는 것의 평균(소수 한 자리).
     * 예: 지금 16:12·선택 16:12 → 어제~14일 전 16:00 칸 평균, 14개 다 있으면 「2주 평균 16:00」, 3개면 「평균 16:00 (3일)」, 0개면 「-」.
     * @param {object} h - traffic-history 응답(days=15) @param {object} m - marine @param {object} ctx @returns {object} {series,start,end,warnings,avg}
     * [연계] ← fillTraffic / 진행 중인 30분 칸(서버 null)은 5분 값 평균이 아니라 최신 5분 척수로만 끝점에 쓴다 — 평균에는 넣지 않는다.
     */
    function prepare(h,m,ctx){
        var start=Date.parse(h.start),vals=(h.traffic&&h.traffic.values)||[],cur=Math.round((Date.parse(h.traffic.currentSlot+':00+09:00')-start)/MIN30);
        if(!Number.isFinite(cur)||cur<0)cur=vals.length;
        var from=Math.max(0,cur-671),series=[];
        for(var i=from;i<Math.min(cur,vals.length);i++)if(Number.isFinite(vals[i]))series.push({t:start+i*MIN30,n:vals[i]});
        var rec=series.length,c=m.current,end=start+cur*MIN30;
        if(rec&&c&&c.status==='ok'&&Number.isFinite(c.count))series.push({t:end,n:c.count,now:true});
        var sel=Date.parse(m.t),sod=Math.floor((((sel+9*HR)%DAY)+DAY)%DAY/MIN30),occ=[];
        for(var j=0;j<Math.min(cur,vals.length);j++)if(Math.floor((((start+j*MIN30+9*HR)%DAY)+DAY)%DAY/MIN30)===sod)occ.push(vals[j]);
        occ=occ.slice(-14).filter(Number.isFinite);
        var warnings=(h.warnings||[]).map(function(x){var s=Date.parse(x.start),e=x.end?Date.parse(x.end):end;return{from:Math.max(s,start+from*MIN30),to:Math.min(e,end),grade:x.level};}).filter(function(x){return (x.grade==='주의보'||x.grade==='경보')&&x.to>x.from;});
        return{series:series,start:start+from*MIN30,end:end,warnings:warnings,empty:!rec,avg:{n:occ.length,v:occ.length?Math.round(occ.reduce(function(a,b){return a+b;},0)/occ.length*10)/10:null,hh:p2(Math.floor(sod/2))+':'+(sod%2?'30':'00')}};
    }
    /**
     * 교통량 카드를 채운다(평균 칸 이름·값, 그래프, 범례, 확대·넘기기·누르기).
     * 예: fillTraffic(body,'GR4_F4K23_P4',응답) / fillTraffic(body,null,null,'nocell') → 평균 「-」·그래프 가운데 「-」
     * @param {HTMLElement} body - .rf-body @param {string|null} cell - 요청한 칸 @param {object|null} h - 이력 응답 @param {string} [problem] - 'nocell'|'error'
     * @returns {void} [연계] ← RiskSheet.trafficHistory(RiskForecast.detail 이 받은 응답) · attach(같은 칸 캐시) / 다른 칸 응답은 버린다.
     */
    function fillTraffic(body,cell,h,problem){
        var st=body&&body._rfMarine,card=body&&body.querySelector('[data-traffic-card]');if(!st||!card||(cell&&st.cell!==cell))return;
        if(h&&cell)ui.history={cell:cell,data:h};
        var d=h&&!problem?prepare(h,st.m,st.ctx):{series:[],warnings:[],empty:true,avg:{n:0,v:null,hh:prepareHH(st.m)},start:0,end:1};
        var a=d.avg;card.querySelector('[data-avg-name]').textContent=a.n>=14||a.n===0?'2주 평균 '+a.hh:'평균 '+a.hh+' ('+a.n+'일)';
        var av=card.querySelector('[data-avg-value]');if(a.v===null){av.className='none';av.textContent='-';}else{av.className='';av.innerHTML=num(a.v)+'<em>척</em>';}
        var msg=card.querySelector('[data-chart-msg]');msg.hidden=problem!=='error';msg.textContent=problem==='error'?'기록을 불러오지 못했습니다.':'';
        var leg=card.querySelector('[data-chart-leg]');leg.querySelectorAll('[data-adv]').forEach(function(x){x.remove();});
        if(d.warnings.length)leg.querySelector('[data-zoom]').insertAdjacentHTML('beforebegin','<span data-adv><i class="adv-j"></i>주의보</span><span data-adv><i class="adv-k"></i>경보</span>');
        var CH=card.querySelector('[data-chart]');CH.removeAttribute('aria-busy');
        var fam=getComputedStyle(CH).fontFamily;d.labW=d.series.reduce(function(mx,p){return Math.max(mx,textW(String(Math.round(p.n)),LAB_NUM,600,fam)+textW('척',LAB_UNIT,600,fam));},0);
        d.fam=fam;CH._d=d;
        var draw=function(){chart(CH,d);var zh=card.querySelector('[data-zoom]');zh.innerHTML=ui.z.s>1?'확대율 <b>×'+ui.z.s.toFixed(1)+'</b>':'';};CH._draw=draw;draw();
        if(!CH._bound){CH._bound=true;bindChart(CH);}
    }
    /** 칸이 없을 때도 평균 칸 이름의 시·분을 만든다. 예: 16:12 → '16:00' @param {object} m @returns {string} [연계] ← fillTraffic */
    function prepareHH(m){var q=k(Date.parse(m.t));return p2(q.h)+':'+(q.mi<30?'00':'30');}
    /**
     * 30분 선그래프를 그린다: 특보 띠(주의보 노랑·경보 빨강, 위에 3px 줄), 날짜/시각 눈금, 선·면, 확대 문턱 이상이면 30분 점+「N척」(숫자 8px·척 6.5px),
     * 「지금 N척」 끝점, 누른 점 말풍선 「N척 · MM.DD(요) HH:MM」, 확대 중이면 아래 위치 막대. 기록 0일이면 가운데 「-」.
     * 예: 배율 ×1 → 선만, 30분 점 간격 ≥ 가장 넓은 글자+2px(약 ×40대) → 점·글자.
     * @param {HTMLElement} box - 그래프 자리 @param {object} d - prepare 결과(+labW,fam) @returns {void}
     * [연계] ← fillTraffic·bindChart / 시안 8차 sheet8.html chart() 를 옮겼다. 값이 빈 30분은 선을 끊는다(0 으로 잇지 않는다).
     */
    function chart(box,d){
        var Z=ui.z,W=box.clientWidth||340,wide=W>420,H=wide?176:156,every=wide?2:3,padL=24,padR=8,padT=8,padB=36,pw=W-padL-padR,ph=H-padT-padB;
        var span=Math.max(1,d.end-d.start),cw=pw*Z.s;Z.off=Math.max(0,Math.min(cw-pw,Z.off));
        var x=function(t){return padL+(t-d.start)/span*cw-Z.off;},pxMs=cw/span,t0=d.start+Z.off/pxMs,t1=t0+pw/pxMs;
        var empty=d.empty,mx=empty?0:Math.max.apply(null,d.series.map(function(p){return p.n;})),step=mx>12?10:5,ymax=Math.max(step*2,Math.ceil(mx/step)*step);
        var y=function(n){return padT+ph-n/ymax*ph;},COL={'주의보':'255,196,64','경보':'248,96,96'},s='',ax='',bot=padT+ph,t;
        s+='<defs><linearGradient id="rf-ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff" stop-opacity=".28"/><stop offset="1" stop-color="#8fd3ff" stop-opacity="0"/></linearGradient><clipPath id="rf-cp"><rect x="'+padL+'" y="0" width="'+pw+'" height="'+(padT+ph+1)+'"/></clipPath></defs>';
        for(var v=0;v<=(empty?0:ymax);v+=step)ax+='<line x1="'+padL+'" x2="'+(padL+pw)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="rgba(255,255,255,'+(v?'.08':'.25')+')"/><text x="'+(padL-5)+'" y="'+(y(v)+3.5)+'" fill="#9fb0c9" font-size="9.5" text-anchor="end">'+(empty?'':v)+'</text>';
        if(!empty){
            d.warnings.forEach(function(a){var x0=x(a.from),x1=x(a.to),c=COL[a.grade];s+='<rect data-warn="'+a.grade+'" x="'+x0+'" y="'+padT+'" width="'+Math.max(0,x1-x0)+'" height="'+ph+'" fill="rgba('+c+','+(a.grade==='경보'?.30:.20)+')"/><rect x="'+x0+'" y="'+padT+'" width="'+Math.max(0,x1-x0)+'" height="3" fill="rgb('+c+')"/>';});
            var MAJ=[HR,3*HR,6*HR,12*HR,24*HR,48*HR,72*HR],maj=MAJ[MAJ.length-1];
            if(Z.s===1)maj=every*24*HR;else for(var mi=0;mi<MAJ.length;mi++)if(MAJ[mi]*pxMs>=36){maj=MAJ[mi];break;}
            var minr=[MIN30,HR,3*HR].filter(function(q){return q<maj&&q*pxMs>=5;})[0],firstLab=true;
            for(t=Math.ceil((t0+9*HR)/DAY)*DAY-9*HR;t<=t1;t+=DAY)s+='<line x1="'+x(t)+'" x2="'+x(t)+'" y1="'+padT+'" y2="'+bot+'" stroke="rgba(255,255,255,'+(Z.s>1?.14:.05)+')"/>';
            if(minr&&Z.s>1)for(t=Math.ceil((t0+9*HR)/minr)*minr-9*HR;t<=t1;t+=minr)ax+='<line x1="'+x(t)+'" x2="'+x(t)+'" y1="'+bot+'" y2="'+(bot+2.5)+'" stroke="rgba(255,255,255,.22)"/>';
            var stepT=maj>=DAY?DAY:maj;
            for(t=Math.ceil((t0+9*HR)/stepT)*stepT-9*HR;t<=t1+1;t+=stepT){var X=x(t),q=k(t);if(X<padL-.5||X>padL+pw+.5)continue;
                if(maj>=DAY&&Math.floor((t+9*HR)/DAY)%(maj/DAY)!==0)continue;
                var mid=q.h===0&&q.mi===0,we=q.w==='토'||q.w==='일',l1,l2='',c1='#b9c6da',fw='';
                if(maj>=DAY||mid){l1=q.m+'.'+p2(q.d);l2=q.w;if(Z.s>1){c1='#fff';fw=' font-weight="700"';}}else{l1=p2(q.h)+':'+p2(q.mi);if(firstLab)l2=q.m+'.'+p2(q.d)+' '+q.w;}
                firstLab=false;
                ax+='<line x1="'+X+'" x2="'+X+'" y1="'+bot+'" y2="'+(bot+4)+'" stroke="rgba(255,255,255,.35)"/><text x="'+X+'" y="'+(bot+15)+'" fill="'+c1+'"'+fw+' font-size="9.5" text-anchor="middle">'+l1+'</text>'+(l2?'<text x="'+X+'" y="'+(bot+26)+'" fill="'+(we?'#8fb4e6':'#7f93b2')+'" font-size="9" text-anchor="middle">'+l2+'</text>':'');}
            // 선 + 면: 보이는 범위 앞뒤 한 칸까지, 값이 빈 30분에서 끊는다.
            var vis=d.series.filter(function(p){return p.t>=t0-MIN30&&p.t<=t1+MIN30;}),runs=[],run=[];
            vis.forEach(function(p,i){if(i&&p.t-vis[i-1].t>MIN30){runs.push(run);run=[];}run.push(p);});if(run.length)runs.push(run);
            runs.forEach(function(r){var pts=r.map(function(p){return x(p.t).toFixed(1)+','+y(p.n).toFixed(1);});s+='<path d="M'+x(r[0].t)+','+y(0)+'L'+pts.join('L')+'L'+x(r[r.length-1].t)+','+y(0)+'Z" fill="url(#rf-ar)"/><polyline points="'+pts.join(' ')+'" fill="none" stroke="#8fd3ff" stroke-width="'+(Z.s>1?1.6:1.3)+'" stroke-linejoin="round"/>';});
            var L=d.series[d.series.length-1],nowP=L&&L.now?L:null,nowBox=null,gap30=MIN30*pxMs;
            if(nowP){var nw=textW('지금 '+num(nowP.n)+'척',10.5,700,d.fam),ny=Math.max(padT+11,y(nowP.n)-9);nowBox={x0:x(nowP.t)-8-nw-LAB_GAP,x1:x(nowP.t)+7,y0:ny-11,y1:ny+3};}
            if(vis.length&&gap30>=d.labW+LAB_GAP){var dots='',labs='';
                vis.forEach(function(p){var X=x(p.t),Y=y(p.n);dots+='<circle cx="'+X.toFixed(1)+'" cy="'+Y.toFixed(1)+'" r="2.2" fill="#d6f0ff" data-dot="1"/>';
                    if(p===nowP)return;
                    var lt=String(Math.round(p.n)),wN=textW(lt,LAB_NUM,600,d.fam)+textW('척',LAB_UNIT,600,d.fam),ly=Y-5;if(ly-LAB_NUM<1)ly=Y+LAB_NUM+4;
                    if(X-wN/2<padL||X+wN/2>padL+pw)return;
                    if(nowBox&&X+wN/2>nowBox.x0&&X-wN/2<nowBox.x1&&ly>nowBox.y0&&ly-LAB_NUM<nowBox.y1)return;
                    labs+='<text x="'+X.toFixed(1)+'" y="'+ly.toFixed(1)+'" fill="#d6f0ff" font-size="'+LAB_NUM+'" font-weight="600" text-anchor="middle" stroke="#10213f" stroke-width="2" paint-order="stroke" data-n="1">'+lt+'<tspan font-size="'+LAB_UNIT+'">척</tspan></text>';});
                s+=dots+labs;}
        }else s+='<text x="'+(padL+pw/2)+'" y="'+(padT+ph/2+8)+'" fill="#98abc7" font-size="22" font-weight="700" text-anchor="middle" data-empty="1">-</text>';
        var tip='';if(Z.tap!=null&&!empty&&d.series[Z.tap]){var tp=d.series[Z.tap],tx=x(tp.t),ty=y(tp.n);
            if(tx>=padL-.5&&tx<=padL+pw+.5){var qq=k(tp.t),tt=num(tp.n)+'척 · '+p2(qq.m)+'.'+p2(qq.d)+'('+qq.w+') '+p2(qq.h)+':'+p2(qq.mi),tw=textW(tt,10.5,700,d.fam)+16,bh=20,bx=Math.max(padL,Math.min(padL+pw-tw,tx-tw/2)),byy=ty-12-bh;if(byy<1)byy=ty+12;
                tip='<line x1="'+tx+'" x2="'+tx+'" y1="'+padT+'" y2="'+(padT+ph)+'" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 2"/><circle cx="'+tx+'" cy="'+ty+'" r="7" fill="rgba(255,255,255,.22)"/><circle cx="'+tx+'" cy="'+ty+'" r="4" fill="#fff" stroke="#10213f" stroke-width="1" data-tap-dot="1"/>'
                    +'<rect x="'+bx+'" y="'+byy+'" width="'+tw+'" height="'+bh+'" rx="6" fill="#0b1b33" stroke="rgba(255,255,255,.55)"/><text x="'+(bx+tw/2)+'" y="'+(byy+14)+'" fill="#fff" font-size="10.5" font-weight="700" text-anchor="middle" data-tip="1">'+tt+'</text>';}}
        var lab='';if(!empty&&nowP){var lx=x(nowP.t),lyy=y(nowP.n);if(lx>=padL&&lx<=padL+pw+.5)lab='<circle cx="'+lx+'" cy="'+lyy+'" r="6" fill="rgba(255,255,255,.18)"/><circle cx="'+lx+'" cy="'+lyy+'" r="3.2" fill="#fff"/><text x="'+(lx-8)+'" y="'+Math.max(padT+11,lyy-9)+'" fill="#fff" font-size="10.5" font-weight="700" text-anchor="end" stroke="#10213f" stroke-width="3" paint-order="stroke" data-now-label="1">지금 '+num(nowP.n)+'척</text>';}
        var bar=Z.s>1?'<rect x="'+padL+'" y="'+(H-3)+'" width="'+pw+'" height="3" rx="1.5" fill="rgba(255,255,255,.12)"/><rect x="'+(padL+Z.off/cw*pw)+'" y="'+(H-3)+'" width="'+Math.max(6,pw/Z.s)+'" height="3" rx="1.5" fill="#8fd3ff"/>':'';
        box.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" height="'+H+'" role="img" aria-label="과거 2주 30분마다 선박 수와 특보 구간">'+ax+'<g clip-path="url(#rf-cp)">'+s+'</g>'+lab+tip+bar+'</svg>';
        box._g={padL:padL,pw:pw,pxMs:pxMs,gap30:gap30,th:(d.labW+LAB_GAP)/(MIN30*pw/span)};
    }
    /**
     * 그래프에 손가락 동작을 붙인다: 두 손가락 벌림·오므림 = 확대(×1~×50), 확대 중 한 손가락 좌우 = 넘기기, 한 번 누르기 = 가장 가까운 30분 점 말풍선.
     * 예: 6px 넘게 움직이면 누르기가 아니다. @param {HTMLElement} CH - 그래프 자리 @returns {void}
     * [연계] ← fillTraffic(처음 한 번) / 상태는 ui.z — 시트 시각이 바뀌면 render 가 초기화한다.
     */
    function bindChart(CH){var P=new Map(),G=null,T=null,Z=function(){return ui.z;};
        function rel(e){var b=CH.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top};}
        function frac(px){var g=CH._g;return(Z().off+px-g.padL)/(g.pw*Z().s);}
        function snap(){var a=Array.from(P.values());if(a.length>=2){var p=a[0],q=a[1];G={pinch:true,d0:Math.max(10,Math.hypot(p.x-q.x,p.y-q.y)),s0:Z().s,f:frac((p.x+q.x)/2)};}else if(a.length===1)G={pinch:false,x0:a[0].x,off0:Z().off};else G=null;}
        function tap(px){var d=CH._d;if(!d||d.empty||!d.series.length)return;var g=CH._g,t=d.start+(Z().off+px-g.padL)/g.pxMs,best=0;d.series.forEach(function(p,i){if(Math.abs(p.t-t)<Math.abs(d.series[best].t-t))best=i;});Z().tap=best;CH._draw();}
        CH.addEventListener('pointerdown',function(e){var r0=rel(e);P.set(e.pointerId,r0);try{CH.setPointerCapture(e.pointerId);}catch(_){/* 합성 이벤트 등 캡처를 못 하는 경우에도 동작은 같다 */}T=P.size===1?{id:e.pointerId,x:r0.x,y:r0.y}:null;snap();});
        CH.addEventListener('pointermove',function(e){if(!P.has(e.pointerId)||!G||!CH._g)return;var r1=rel(e);P.set(e.pointerId,r1);var a=Array.from(P.values());
            if(T&&T.id===e.pointerId&&Math.hypot(r1.x-T.x,r1.y-T.y)>6)T=null;
            if(G.pinch&&a.length>=2){var p=a[0],q=a[1],dd=Math.hypot(p.x-q.x,p.y-q.y),g=CH._g;Z().s=Math.max(1,Math.min(ZOOM_MAX,G.s0*dd/G.d0));Z().off=G.f*g.pw*Z().s-((p.x+q.x)/2-g.padL);CH._draw();}
            else if(!G.pinch&&Z().s>1){Z().off=G.off0-(a[0].x-G.x0);CH._draw();}});
        function up(e){if(!P.has(e.pointerId))return;var ok=e.type==='pointerup'&&T&&T.id===e.pointerId;P.delete(e.pointerId);snap();if(ok){T=null;tap(rel(e).x);}}
        ['pointerup','pointercancel'].forEach(function(n){CH.addEventListener(n,up);});
    }
    /** 시험·외부에서 그래프 배율을 정한다(핀치와 같은 상태). 예: zoom(body,43.5,'2026-10-14T12:00:00+09:00') → 그 시각이 가운데
     * @param {HTMLElement} body @param {number} s - 배율 1~50 @param {string} [center] - 가운데 둘 ISO @returns {object|null} {s,th,dots,labels} [연계] ← test_risk_sea_sheet_ui */
    function zoom(body,s,center){var CH=body&&body.querySelector('[data-chart]');if(!CH||!CH._draw)return null;var Z=ui.z,d=CH._d,g=CH._g;Z.s=Math.max(1,Math.min(ZOOM_MAX,s));Z.tap=null;if(center&&!d.empty)Z.off=(Date.parse(center)-d.start)/(d.end-d.start)*g.pw*Z.s-g.pw/2;CH._draw();return{s:Z.s,th:CH._g.th};}
    /** 관할의 전체 집계와 관심 해역별 근거를 표시한다. 예: 관심 해역을 누르면 그 위치의 상세로 이동.
     * @param {object} d - briefing @returns {string} HTML
     * [연계] ← RiskSheet.show / 같은 marine 분석을 재사용한다.
     */
    function briefing(d){var c=d.current;return '<section class="rf-marine-section"><h4>관할 교통·사고 종합</h4><p>예보 조회 '+value(F.time(d.t))+'</p><p class="rf-muted">'+value(stamp(c))+(c&&c.status!=='ok'?' · 최신성 확인 필요':'')+'</p><p>집계 교통량 <b>'+value(c&&c.count)+(c?'척':'')+'</b> · 교통 격자 '+value(c&&c.gridCount)+'개</p><p class="rf-muted">'+value(d.method)+'</p></section>'+history(d.history)+'<section class="rf-marine-section"><h4>관심이 필요한 해역·시간대</h4><p>'+value(d.totalAttentionRegions)+'개 해역'+(d.totalAttentionRegions>20?' 중 우선 20개 표시':'')+'</p>'+(d.regions||[]).map(function(m){return '<article><button type="button" class="rf-marine-region" data-marine-lon="'+value(m.point.lon)+'" data-marine-lat="'+value(m.point.lat)+'">'+value(m.location)+' · '+value(m.attention)+'</button>'+reasons(m.reasons)+'</article>';}).join('')+(d.regions&&d.regions.length?'':'<p class="rf-muted">현재 확보한 자료에서 별도 관심 해역이 추출되지 않았습니다. 자료의 최신성과 제공 범위도 확인해주세요.</p>')+'</section>';}
    /** 네 정지점 사이를 RGB 연속 보간한다. 예: blend(stops,0.5) @param {number[][]} stops @param {number} position - 0..1 @returns {string} CSS RGB [연계] ← color·congestionColor */
    function blend(stops,position){var p=Math.max(0,Math.min(1,Number(position)||0))*3,i=Math.min(2,Math.floor(p)),f=p-i;return 'rgb('+stops[i].map(function(v,j){return Math.round(v+(stops[i+1][j]-v)*f);}).join(',')+')';}
    /** 위험 예측 색: 색상위치에 따라 RGB를 연속 보간한다. 예:0초록→노랑→주황→1빨강.
     * @param {number} position - 서버 색상위치0..1 @returns {string} CSS RGB
     * [연계] ← RiskMapLayer(위험 예측 면색) / 원본 위험지수나 확률은 바꾸지 않는다.
     */
    function color(position){return blend([[86,166,111],[219,199,83],[229,139,70],[214,75,69]],position);}
    /** 혼잡도·밀집도 색: #b8c5da(낮음)→#74b9ff→#d47cff→#ff5fe3(매우높음) 연속 보간. 예: congestionColor(0.5) → 높음 시작색
     * @param {number} position - 서버 색상위치0..1 @returns {string} CSS RGB
     * [연계] ← RiskMapLayer(지도 [혼잡도] — 지금은 밀집도 mode current, 미래는 혼잡 예보 mode congestion) / 범례 .rf-pal-cong 과 같은 네 색. */
    function congestionColor(position){return blend([[184,197,218],[116,185,255],[212,124,255],[255,95,227]],position);}
    w.RiskMarine={render:render,attach:attach,fillTraffic:fillTraffic,cellOf:cellOf,zoom:zoom,briefing:briefing,history:history,color:color,congestionColor:congestionColor};
})(window);
