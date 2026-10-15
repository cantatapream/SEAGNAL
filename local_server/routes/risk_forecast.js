/**
 * 역할: 연안 분석·공식 선박사고와 혼잡 예보·자료 상태·원본 PDF를 수집 없이 제공한다.
 * [연계] risk_store → /api/risk-forecast/* → marine-life/risk-forecast 화면.
 *        sea/traffic-history 는 sea_traffic_history.createApi(칸별 2주 30분 척수 + 특보 발효 구간) — 화면은 디자인 확정 뒤.
 * [로드 순서] server.js 라우트 등록. 요청에서는 수집·AI·푸시 호출이 없다.
 */
'use strict';
const express=require('express'),path=require('path'),fs=require('fs');
const {createStore}=require('../services/risk_store');
/** 위험예측 전용 라우터를 만든다. 예: 검사에서는 가짜저장소로계약확인. @param {object} options @returns {Router} [연계] ← server.js */
function createRouter({store=createStore(),marine=require('../services/marine_fusion').createStore({risk:store}),trafficHistory=require('../services/sea_traffic_history').createApi(),reportDir=path.join(__dirname,'..','config','coastal_safety','accident_analysis','v3','public')}={}){
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
    router.get(base+'/sea/analysis',handle(req=>marine.analysis(req.query),0));
    router.get(base+'/sea/jurisdictions',handle(()=>marine.jurisdictionList(),86400));
    router.get(base+'/sea/briefing',handle(req=>marine.briefing(req.query.id,req.query.t),0));
    router.get(base+'/sea/accident-cells',handle(()=>store.accidentCells(),3600));
    router.get(base+'/sea/accident-frame',handle(req=>store.accidentFrame(req.query.t)));
    router.get(base+'/sea/accident-cell',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('사고 격자 id 필요'),{status:400});return store.accidentDetail(req.query.id,req.query.t,{lon:req.query.lon,lat:req.query.lat});}));
    router.get(base+'/coast/frame',handle(req=>store.frame(false,req.query.t)));
    router.get(base+'/sea/frame',handle(req=>store.frame(true,req.query.t)));
    router.get(base+'/coast/spot',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('관광지 id 필요'),{status:400});return store.coastDetail(req.query.id,req.query.t);}));
    router.get(base+'/sea/cell',handle(req=>{if(typeof req.query.id!=='string'||!req.query.id)throw Object.assign(new Error('해상 칸 id 필요'),{status:400});return store.seaDetail(req.query.id,req.query.t);}));
    router.get(base+'/hazard-zones',handle(req=>{if(typeof req.query.ids!=='string'||!req.query.ids)throw Object.assign(new Error('위험구역 ids 필요'),{status:400});return store.hazards(req.query.ids.split(','));},86400));
    router.get(base+'/islands',handle(()=>store.islands(),86400));
    router.get(base+'/report/:kind',(req,res)=>{const names={sea:'해상_위험지수_산출근거.pdf',coast:'연안_위험지수_산출근거.pdf'},name=names[req.params.kind];if(!name)return res.status(404).json({ok:false,error:'보고서 종류 없음'});const file=path.join(reportDir,name);if(!fs.existsSync(file))return res.status(503).json({ok:false,error:'보고서 준비 전'});res.set('Cache-Control','public, max-age=86400').set('Content-Type','application/pdf').set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.sendFile(file,error=>{if(error&&!res.headersSent)res.status(503).json({ok:false,error:'보고서 읽기 실패'});});});
    return router;
}
const router=createRouter();module.exports=router;module.exports.createRouter=createRouter;
