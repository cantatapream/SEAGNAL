/**
 * 파일명: local_server/services/risk_geo.js
 * 역할  : 위험예측의 거리·다각형·방위 계산을 제공한다(경계 포함, 홀 제외).
 * [연계] risk_store.js·risk_sea_cells.js에서 사용 · API/마크업 없음
 * [로드 순서] 위험예측 저장소 이전
 */
'use strict';
const RAD=Math.PI/180, R=6371.0088;
/** 두 좌표 사이 대권거리를 km로 구한다. 예: 같은 점→0.
 * @param {number} lat1 - 위도 @param {number} lon1 - 경도 @param {number} lat2 - 위도 @param {number} lon2 - 경도
 * @returns {number} km [연계] ← risk_sea_cells.js / 최근접 지명을 찾는다.
 */
function haversine(lat1,lon1,lat2,lon2){const a=Math.sin((lat2-lat1)*RAD/2)**2+Math.cos(lat1*RAD)*Math.cos(lat2*RAD)*Math.sin((lon2-lon1)*RAD/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,a)));}
/** 점과 선분 사이 국소 km 거리를 구한다. 예: 선분 위 점→0.
 * @param {number[]} p - [경도,위도] @param {number[]} a - 시작 @param {number[]} b - 끝
 * @returns {number} km [연계] ← distanceToGeometry / 근처 경계 거리를 구한다.
 */
function segmentDistance(p,a,b){const sx=R*RAD*Math.cos(p[1]*RAD),sy=R*RAD;const ax=(a[0]-p[0])*sx,ay=(a[1]-p[1])*sy,bx=(b[0]-p[0])*sx,by=(b[1]-p[1])*sy;const dx=bx-ax,dy=by-ay,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/d)):0;return Math.hypot(ax+t*dx,ay+t*dy);}
/** 다각형 고리 안인지 검사한다. 예: 변 위의 점도 true.
 * @param {number[]} p - [경도,위도] @param {Array} ring - 폐곡선
 * @returns {boolean} 포함 [연계] ← pointInGeometry / 홀을 함께 검사한다.
 */
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(segmentDistance(p,a,b)<1e-8)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
/** GeoJSON 다각형 포함을 검사한다. 예: 홀 내부는 false.
 * @param {number[]} p - 좌표 @param {object} geo - Polygon/MultiPolygon
 * @returns {boolean} 포함 [연계] ← risk_store.js / 특보구역을 연결한다.
 */
function pointInGeometry(p,geo){if(!geo)return false;const ps=geo.type==='Polygon'?[geo.coordinates]:geo.type==='MultiPolygon'?geo.coordinates:[];return ps.some(poly=>inRing(p,poly[0])&&!poly.slice(1).some(r=>inRing(p,r)));}
/** 다각형까지 최단거리를 km로 구한다. 예: 내부→0.
 * @param {number[]} p - 좌표 @param {object} geo - 다각형
 * @returns {number} km [연계] ← risk_sea_cells.js / 거리 제한을 적용한다.
 */
function distanceToGeometry(p,geo){if(pointInGeometry(p,geo))return 0;const ps=geo?.type==='Polygon'?[geo.coordinates]:geo?.type==='MultiPolygon'?geo.coordinates:[];let d=Infinity;for(const poly of ps)for(const ring of poly)for(let i=1;i<ring.length;i++)d=Math.min(d,segmentDistance(p,ring[i-1],ring[i]));return d;}
/** 출발점에서 목표까지 진북 기준 방위각을 구한다. 예: 정동→90.
 * @param {number} lat1 - 위도 @param {number} lon1 - 경도 @param {number} lat2 - 위도 @param {number} lon2 - 경도
 * @returns {number} 도 [연계] ← risk_sea_cells.js / 해상 부제를 만든다.
 */
function bearing(lat1,lon1,lat2,lon2){const dl=(lon2-lon1)*RAD,y=Math.sin(dl)*Math.cos(lat2*RAD),x=Math.cos(lat1*RAD)*Math.sin(lat2*RAD)-Math.sin(lat1*RAD)*Math.cos(lat2*RAD)*Math.cos(dl);return(Math.atan2(y,x)/RAD+360)%360;}
/** 방위각을 16방위로 바꾼다. 예: 45→북동.
 * @param {number} deg - 방위각 @returns {string} 방위
 * [연계] ← risk_sea_cells.js / 사용자 확정 부제를 만든다.
 */
function direction16(deg){return['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'][Math.round(((deg%360+360)%360)/22.5)%16];}
/** 두 상자의 겹친 면적을 구한다. 예: 떨어져 있으면0.
 * @param {number[]} a - [minlon,minlat,maxlon,maxlat] @param {number[]} b - 같은 형식
 * @returns {number} 제곱도 [연계] ← risk_sea_cells.js / 대표 소해구를 고른다.
 */
function overlapArea(a,b){return Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));}
module.exports={haversine,segmentDistance,pointInGeometry,distanceToGeometry,bearing,direction16,overlapArea};
