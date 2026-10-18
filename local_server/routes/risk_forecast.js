/**
 * 역할: 연안 분석·공식 선박사고와 혼잡 예보·자료 상태·원본 PDF를 수집 없이 제공한다.
 * [연계] risk_store → /api/risk-forecast/* → marine-life/risk-forecast 화면.
 *        sea/area-frame·coast/area-frame(2026-10-18 §11.10.24) — 지도와 같은 값을 관할 하나 상자만: 연안 안전 브리핑 팝업 지도(forecast/station-briefing/station_briefing_riskmap.js).
 *        sea/traffic-history 는 sea_traffic_history.createApi(칸별 2주 30분 척수 + 특보 발효 구간) — 화면은 디자인 확정 뒤.
 *        기본 저장소(stores)는 관할 브리핑(services/station_briefing.js forDefault)이 함께 쓴다.
 *        coast/spot 의 beach = 그 날짜의 해수욕장 안내 줄(services/beach_weather.js — 개장·입수 참고, 점수에는 없음, 설계서 §18 2026-10-18).
 * [로드 순서] server.js 라우트 등록. 요청에서는 수집·AI·푸시 호출이 없다.
 */
'use strict';
const express=require('express'),path=require('path'),fs=require('fs');
const {createStore}=require('../services/risk_store');
/** 위험예측 전용 라우터를 만든다. 예: 검사에서는 가짜저장소로계약확인. @param {object} options @returns {Router} [연계] ← server.js */
function createRouter({store=createStore(),marine=require('../services/marine_fusion').createStore({risk:store}),trafficHistory=require('../services/sea_traffic_history').createApi(),reportDir=path.join(__dirname,'..','config','coastal_safety','accident_analysis','v3','public'),beach=(id,date)=>require('../services/beach_weather').forDefault().linesFor(id,date)}={}){
    const router=express.Router(),base='/api/risk-forecast';
    /** 실패를 상태 포함 JSON으로 보낸다. 예: 자료준비전503. @param {function} fn @param {number} maxAge @returns {function} [연계] ← route handlers */
    function handle(fn,maxAge=60){return(req,res)=>{try{res.set('Cache-Control',maxAge?'public, max-age='+maxAge:'no-store');res.json({ok:true,...fn(req),sources:store.sources()});}catch(e){res.status(e.status||503).set('Cache-Control','no-store').json({ok:false,error:e.status?e.message:'위험예측 자료 처리 실패',sources:store.sources()});}};}
    router.get(base+'/meta',handle(()=>store.meta(),0));
    router.get(base+'/status',handle(()=>({now:store.meta().now,sources:store.sources(true)}),0));
    router.get(base+'/coast/spots',handle(()=>store.spots(),86400));
    router.get(base+'/sea/cells',handle(()=>store.cells(),3600));
    router.get(base+'/sea/traffic-cells',handle(()=>marine.tables(),60));
    router.get(base+'/sea/current',handle(()=>marine.current(),0));
    router.get(base+'/sea/traffic-history',handle(req=>trafficHistory.query(req.query),60));
    router.get(base+'/sea/unified-cells',handle(()=>marine.unifiedCells(),60));
    router.get(base+'/sea/unified-frame',handle(req=>marine.unifiedFrame(req.query.mode,req.query.t),0));
    // 관할 하나 구역만(연안 안전 브리핑 팝업 지도 — 설계서 §11.10.24): 같은 unifiedFrame 값을 bbox 안 칸만 칸 위치와 함께
    router.get(base+'/sea/area-frame',handle(req=>marine.areaFrame(req.query.mode,req.query.t,req.query.bbox),0));
    router.get(base+'/sea/analysis',handle(req=>marine.analysis(req.query),0));
    router.get(base+'/sea/jurisdictions',handle(()=>marine.jurisdictionList(),86400));
    router.get(base+'/sea/briefing',handle(req=>marine.briefing(req.query.id,req.query.t),0));
    router.get(base+'/sea/accident-cells',handle(()=>store.accidentCells(),3600));
    router.get(base+'/sea/accident-frame',handle(req=>store.accidentFrame(req.query.t)));
    router.get(base+'/sea/accident-cell',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('사고 격자 id 필요'),{status:400});return store.accidentDetail(req.query.id,req.query.t,{lon:req.query.lon,lat:req.query.lat});}));
    // 연안 지도·상세는 날짜(KST)당 하나 — 그날 3시간 칸 중 가장 높은 값(T24, 사용자 2026-10-16 「5-하루 하나로 합치기」·「1. 가」). t 는 그 날짜 안의 시각.
    /** 연안 하루 값(coastDayFrame — 지도 /coast/frame 과 같은 값)을 경위도 상자 안 관광지만, 관광지 도형과 함께 준다(연안 안전 브리핑 팝업 지도 — 설계서 §11.10.24·§11.10.26).
     * 전국 관광지 표(/coast/spots — 도형 포함 수 MB)를 받지 않고 관할 하나만 그리려고 둔다. 번호 i 는 이 응답 안 번호(0부터) — scores 의 [i,score] 와 짝.
     * 예: coastArea('2026-10-17T10:05:00+09:00','126.1,33.2,126.5,33.6') → {t,daily:{date,times},spots:[{i:0,id,name,lat,lon,beach,geometry}],scores:[[0,1.2]]}
     * @param {string} [t] - 선택 시각(그 KST 날짜의 하루 값) @param {string} bbox - '서,남,동,북'(4°×4° 이하·한국 범위) @returns {object} [연계] ← GET coast/area-frame / → store.coastDayFrame·spots */
    function coastArea(t,bbox){const b=String(bbox||'').split(',').map(Number);
        if(b.length!==4||!b.every(Number.isFinite)||b[0]>=b[2]||b[1]>=b[3]||b[2]-b[0]>4||b[3]-b[1]>4||b[0]<115||b[2]>140||b[1]<20||b[3]>45)throw Object.assign(new Error('구역 상자 오류'),{status:400});
        const f=store.coastDayFrame(t),table=store.spots().spots,byI=new Map(table.map(p=>[p.i,p])),spots=[],scores=[];
        for(const [i,score]of f.spots||[]){const p=byI.get(i);if(!p||p.lon<b[0]||p.lon>b[2]||p.lat<b[1]||p.lat>b[3])continue;scores.push([spots.length,score]);spots.push({i:spots.length,id:p.id,name:p.name,lat:p.lat,lon:p.lon,beach:p.beach,geometry:p.geometry||(p.cell?{type:'Polygon',coordinates:[p.cell]}:null)});}
        return{t:f.t||t||null,daily:f.daily||null,degraded:f.degraded||[],bbox:b,spots,scores};}
    router.get(base+'/coast/area-frame',handle(req=>coastArea(req.query.t,req.query.bbox),0));
    router.get(base+'/coast/frame',handle(req=>store.coastDayFrame(req.query.t)));
    router.get(base+'/sea/frame',handle(req=>store.frame(true,req.query.t)));
    /** 해수욕장 안내 줄(§18) — 실패해도 연안 상세는 그대로 준다(줄 없음). 예: beachOf('a','2026-10-18') → ['…'] @returns {string[]} [연계] ← GET coast/spot / → services/beach_weather.linesFor */
    function beachOf(id,date){try{return date?beach(id,date)||[]:[];}catch(_){console.error('[risk_forecast] 해수욕장 안내 줄 실패');return[];}}
    router.get(base+'/coast/spot',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('관광지 id 필요'),{status:400});const d=store.coastDayDetail(req.query.id,req.query.t);return{...d,beach:beachOf(req.query.id,d&&d.daily&&d.daily.date)};}));
    router.get(base+'/sea/cell',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('해상 칸 id 필요'),{status:400});return store.seaDetail(req.query.id,req.query.t);}));
    router.get(base+'/hazard-zones',handle(req=>{if(typeof req.query.ids!=='string'||!req.query.ids)throw Object.assign(new Error('위험구역 ids 필요'),{status:400});return store.hazards(req.query.ids.split(','));},86400));
    router.get(base+'/islands',handle(()=>store.islands(),86400));
    router.get(base+'/report/:kind',(req,res)=>{const names={sea:'해상_위험지수_산출근거.pdf',coast:'연안_위험지수_산출근거.pdf'},name=names[req.params.kind];if(!name)return res.status(404).json({ok:false,error:'보고서 종류 없음'});const file=path.join(reportDir,name);if(!fs.existsSync(file))return res.status(503).json({ok:false,error:'보고서 준비 전'});res.set('Cache-Control','public, max-age=86400').set('Content-Type','application/pdf').set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.sendFile(file,error=>{if(error&&!res.headersSent)res.status(503).json({ok:false,error:'보고서 읽기 실패'});});});
    return router;
}
// 기본 저장소는 여기서 한 벌만 만들어 관할 브리핑(services/station_briefing.forDefault)과 함께 쓴다 — 같은 원천 자료를 메모리에 두 번 들고 있지 않게(2026-10-16).
const defaultStore=createStore(),defaultMarine=require('../services/marine_fusion').createStore({risk:defaultStore});
const router=createRouter({store:defaultStore,marine:defaultMarine});module.exports=router;module.exports.createRouter=createRouter;module.exports.stores={risk:defaultStore,marine:defaultMarine};
