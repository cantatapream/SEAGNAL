/**
 * 파일명: local_server/services/mtis_accident_grid.js
 * 역할  : 공식 선박사고 예보 API 의 격자 중심점에서 그 칸의 경계(약 5㎞ 사각형)를 계산한다.
 *         MTIS 웹 화면에서 경계를 받아 오던 방식은 없앴다(사용자 결정 2026-10-15 「다른쪽에 이용약관에 사용하면
 *         안된다고 써있어서 오토 스크래핑은 하면 안될 것 같아. 이 부분은 코드에서 제외하도록 수정할 수 있도록 해줘.」).
 * [연계] sea_accident_collector → 본 모듈 → risk_sea_cells.describe / 외부 접속 없음(계산만)
 * [로드 순서] 서버 require 부작용 없음.
 *
 * [격자 정의 — 실측으로 확인한 것]
 *   사고예보 격자는 웹 메르카토르(EPSG:3857) 좌표에서 가로·세로 5,000m 정사각형이 빈틈없이 놓인 격자다.
 *   격자 남서 모서리(경도 124.5813727321613, 위도 33.06953673465312)는 종전에 공식 웹에서 받아 운영에 저장해 둔
 *   경계 5,406칸 중 가장 남서쪽 칸의 모서리 값이다. 그 5,406칸 전부를 이 계산과 대조해 경계 네 모서리가
 *   최대 6e-14도 이내로 일치했다(2026-10-15, 운영 /api/risk-forecast/sea/accident-cells 저장본).
 *   API 중심점은 계산한 칸의 경위도 한가운데와 5e-7도 이내였다(소수 6자리 반올림) — 1e-6도를 넘으면
 *   격자 정의가 바뀐 것으로 보고 거부한다(틀린 모양을 그리지 않는다).
 */
'use strict';
const R=6378137,SIZE=5000,X0=R*124.5813727321613*Math.PI/180,Y0=R*Math.log(Math.tan(Math.PI/4+33.06953673465312*Math.PI/360));
/** 메르카토르 미터 → 경위도. 예: inverse(X0,Y0) → [124.5813…, 33.0695…] @param {number} x @param {number} y @returns {number[]} [lon,lat] [연계] ← cellBounds */
function inverse(x,y){return[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];}
/** 중심점이 든 5㎞ 칸의 경위도 상자를 계산한다. 예: (126.041135,33.088353) → [126.01867…,33.06953…,126.06359…,33.10716…]
 * @param {number} lon - API 경도 @param {number} lat - API 위도 @returns {number[]} [서,남,동,북]
 * [연계] ← cells / 중심이 칸 한가운데가 아니면 throw(격자 정의 변경 감지)
 */
function cellBounds(lon,lat){
    const x=R*lon*Math.PI/180,y=R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)),ix=Math.floor((x-X0)/SIZE),iy=Math.floor((y-Y0)/SIZE);
    const [w,s]=inverse(X0+ix*SIZE,Y0+iy*SIZE),[e,n]=inverse(X0+(ix+1)*SIZE,Y0+(iy+1)*SIZE);
    if(Math.abs((w+e)/2-lon)>1e-6||Math.abs((s+n)/2-lat)>1e-6)throw new Error('invalid response');
    return[w,s,e,n];
}
/** API 격자마다 경계·대표해구를 붙인다. 예: 받은 순서대로 i=0,1,…
 * @param {array} rows - API 행(gridId·latitude·longitude) @returns {array} 경계·대표해구를 가진 칸
 * [연계] ← sea_accident_collector.collect(geometryLoader 기본값) / 경계 고리 순서는 종전 공식 웹 응답과 같다(서남→서북→동북→동남)
 */
function cells(rows){
    return rows.map((r,i)=>{
        const [w,s,e,n]=cellBounds(r.longitude,r.latitude);
        return {...require('./risk_sea_cells').describe(r,{bounds:[w,s,e,n]}),i,geometry:{type:'Polygon',coordinates:[[[w,s],[w,n],[e,n],[e,s],[w,s]]]}};
    });
}
module.exports={cells,cellBounds};
