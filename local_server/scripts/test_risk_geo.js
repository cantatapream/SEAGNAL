/** 파일명: local_server/scripts/test_risk_geo.js
 * 역할  : 홀·다중면·경계 포함·방위·거리·겹침 동률 기초를 검증한다.
 * [연계] risk_geo.js · 개발검사 전용
 */
'use strict';
const G=require('../services/risk_geo'),run=require('./risk_test_helpers');
const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]],geo={type:'Polygon',coordinates:[outer,hole]};
run({
 '외곽 내부는 포함 홀 내부는 제외':a=>{a.ok(G.pointInGeometry([.5,.5],geo));a.ok(!G.pointInGeometry([2,2],geo));},
 '외곽 경계는 포함':a=>a.ok(G.pointInGeometry([0,2],geo)),
 '홀 경계는 제외':a=>a.ok(!G.pointInGeometry([1,2],geo)),
 'MultiPolygon 다른면도 포함':a=>a.ok(G.pointInGeometry([5.5,.5],{type:'MultiPolygon',coordinates:[[outer,hole],[[[5,0],[6,0],[6,1],[5,1],[5,0]]]]})),
 '내부거리0 외부거리양수':a=>{a.equal(G.distanceToGeometry([.5,.5],geo),0);a.ok(G.distanceToGeometry([5,2],geo)>100);},
 '하버사인 영거리와 대칭':a=>{a.equal(G.haversine(35,129,35,129),0);a.equal(G.haversine(35,129,36,130),G.haversine(36,130,35,129));},
 '진북진동과16방위':a=>{a.equal(G.bearing(0,0,1,0),0);a.equal(G.bearing(0,0,0,1),90);a.equal(G.direction16(11.24),'북');a.equal(G.direction16(11.25),'북북동');a.equal(G.direction16(359),'북');},
 '상자 겹침과 경계면적0':a=>{a.equal(G.overlapArea([0,0,1,1],[.5,.5,1.5,1.5]),.25);a.equal(G.overlapArea([0,0,1,1],[1,0,2,1]),0);}
});
