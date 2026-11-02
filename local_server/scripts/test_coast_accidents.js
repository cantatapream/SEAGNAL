/** 파일명: local_server/scripts/test_coast_accidents.js
 * 역할  : 관광지별 주변 연안 인명사고 정적 표(coast_accidents.json)가 유형·기간·중복·영역 계약을 지키는지
 *         원본 사고 파일과 관광지 영역으로 **파이썬(shapely) 없이 따로 다시 계산해** 대조한다.
 * [연계] config/coastal_safety/coast_accidents.json ← build_coast_accidents.py · risk_spots.json(영역·육지) ·
 *        client/accident_persons.json(원본) · risk_test_helpers · proj4(EPSG:5179 미터 거리) · 개발검사 전용
 * [로드 순서] verify_all.sh 가 독립 Node 프로세스로 실행한다.
 */
'use strict';
const fs=require('fs'),path=require('path'),proj4=require('proj4'),run=require('./risk_test_helpers');
const CFG=path.join(__dirname,'..','config','coastal_safety'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const out=read(path.join(CFG,'coast_accidents.json')),rs=read(path.join(CFG,'risk_spots.json')),src=read(path.join(__dirname,'..','..','client','accident_persons.json')).rows;
const TM='+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';
const xy=(lon,lat)=>proj4('WGS84',TM,[lon,lat]),TYPES={ATY001:'익수',ATY002:'추락',ATY003:'고립',ATY007:'표류',ATY008:'기타'},SEA=500,CIRCLE=3000;
/** 위경도 GeoJSON 면을 미터 고리 목록으로 바꾼다. 예: MultiPolygon → [[x,y]…] 고리들. @param {object} g @returns {array} 고리 [연계] ← index */
function rings(g){const ps=g.type==='Polygon'?[g.coordinates]:g.coordinates;return ps.flat().map(r=>r.map(c=>xy(c[0],c[1])));}
/** 선분까지 거리(미터). @param {number[]} p @param {number[]} a @param {number[]} b @returns {number} [연계] ← index.dist */
function seg(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy,t=L?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
/** 고리들을 500m 띠·칸으로 색인해 포함(짝홀 규칙)·경계거리를 빠르게 묻는다. 본토 고리가 24만 점이라 전수 순회는 느리다.
 * 예: index(rings(land)).inside([x,y]) → 육지면 true. @param {array} rs - 미터 고리 @returns {object} inside·dist [연계] ← judge */
function index(rs){const band=new Map(),grid=new Map(),B=500,add=(m,k,s)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(s);};
 for(const r of rs)for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i],s=[a,b];for(let y=Math.floor(Math.min(a[1],b[1])/B);y<=Math.floor(Math.max(a[1],b[1])/B);y++){add(band,y,s);for(let x=Math.floor(Math.min(a[0],b[0])/B);x<=Math.floor(Math.max(a[0],b[0])/B);x++)add(grid,x+','+y,s);}}
 return{inside(p){let c=false;for(const[a,b]of band.get(Math.floor(p[1]/B))||[])if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;return c;},
  dist(p,limit){let d=Infinity;const gx=Math.floor(p[0]/B),gy=Math.floor(p[1]/B),k=Math.ceil(limit/B);for(let x=gx-k;x<=gx+k;x++)for(let y=gy-k;y<=gy+k;y++)for(const[a,b]of grid.get(x+','+y)||[])d=Math.min(d,seg(p,a,b));return d;}};}
/** 사고 한 점이 관광지 영역(육지 몫 ∪ 바다 500m [∩ 수직이등분 칸])에 드는지 판정한다. 경계에서 몇 m 이내면 sure:false.
 * 예: 육지 몫 밖 바다 300m·더 가까운 이웃 없음 → {in:true,sure:true}. 버퍼 다각형 근사(8분할 ≈2.4m)를 3m 로 덮는다.
 * @param {number[]} a - 사고 미터좌표 @param {object} s - {p,own,others} @param {object} land - index @param {boolean} split
 * @returns {object} in·sure [연계] ← 아래 검사(작은 예·전수 대조)
 */
function judge(a,s,land,split){const dOwn=s.own.dist(a,SEA+10),dLand=land.dist(a,1),cell=split?Math.min(Infinity,...s.others.map(q=>(Math.hypot(a[0]-q[0],a[1]-q[1])**2-Math.hypot(a[0]-s.p[0],a[1]-s.p[1])**2)/(2*Math.hypot(q[0]-s.p[0],q[1]-s.p[1])))):Infinity;
 // 경계 가까이(몫·육지 1m, 이등분선 1m, 500m 선 3m)는 양쪽 값을 다 넣어 보고, 결과가 하나로 모일 때만 확정한다
 const opt=(near,v)=>near?[true,false]:[v],res=new Set();
 for(const own of opt(dOwn<=1,s.own.inside(a)))for(const sea of opt(dLand<=1,!land.inside(a)))for(const near of opt(Math.abs(dOwn-SEA)<=3,dOwn<=SEA))for(const c of opt(Math.abs(cell)<=1,cell>=0))res.add(own||(sea&&near&&c));
 return{in:res.has(true),sure:res.size===1};}
// 원본에서 기간·유형을 거르고 같은 좌표·날짜·유형은 먼저 나온 1건만(빌드 스크립트와 따로 계산)
const seen=new Set(),acc=[];let dups=0;for(const r of src){if(!(r[2]>='20200101'&&r[2]<='20241231'&&TYPES[r[4]]))continue;const k=[r[0],r[1],r[2],r[4]].join('|');if(seen.has(k)){dups++;continue;}seen.add(k);acc.push(r);}
const key=r=>[r[2].slice(0,4)+'-'+r[2].slice(4,6)+'-'+r[2].slice(6),TYPES[r[4]],r[8],r[9],r[7]].join('|'),ekey=e=>[e.date,e.type,e.death,e.missing,e.rescue].join('|');
run({
 '기간 2020~2024·유형 익수·추락·고립·표류·기타만(자살·변사·해양오염 없음)·날짜 내림차순':a=>{const types=new Set(Object.values(TYPES));for(const L of Object.values(out.spots))if(L){for(const e of L){a.ok(types.has(e.type),e.type);a.ok(e.year>=2020&&e.year<=2024);a.equal(String(e.year),e.date.slice(0,4));for(const n of['death','missing','rescue'])a.ok(Number.isInteger(e[n])&&e[n]>=0);}for(let i=1;i<L.length;i++)a.ok(L[i-1].date>=L[i].date);}a.deepEqual(out._about.types,TYPES);},
 '중복 1건 규칙·건수 재계산 일치(대상 3,460건·중복 9건)':a=>{a.equal(out._about.accidents,acc.length);a.equal(out._about.duplicatesDropped,dups);a.equal(acc.length,3460);a.equal(dups,9);},
 '관광지 1,354곳 모두 키·영역 없음 6곳 null·같은 좌표 28곳은 첫 행 목록 그대로':a=>{a.deepEqual(Object.keys(out.spots),rs.spots.map(s=>s.id));const first=new Map();let dup=0;for(const s of rs.spots){const k=s.lat+','+s.lon;if(first.has(k)){dup++;a.deepEqual(out.spots[s.id],out.spots[first.get(k)],s.id);}else first.set(k,s.id);}a.equal(dup,28);a.equal(out._about.duplicateSpots,28);
  const empty=rs.spots.filter(s=>first.get(s.lat+','+s.lon)===s.id&&!s.geometry.coordinates.length).map(s=>s.id);a.deepEqual(out._about.noArea,empty);a.equal(empty.length,6);for(const s of rs.spots)a.equal(out.spots[s.id]===null,empty.includes(first.get(s.lat+','+s.lon)),s.id);},
 '판정기 작은 예: 육지 몫 안·앞바다 300m·700m·이웃 쪽 바다·남의 육지':a=>{const sq=(x0,y0,x1,y1)=>[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]];
  // 육지는 x<0 반평면(넓은 사각형), 관광지 P(-1000,0) 몫은 x∈[-3000,0]·y∈[-1000,1000], 이웃 Q(-1000,2400) → 이등분선 y=1200
  const land=index(sq(-50000,-50000,0,50000)),s={p:[-1000,0],own:index(sq(-3000,-1000,0,1000)),others:[[-1000,2400]]};
  a.deepEqual(judge([-500,0],s,land,true),{in:true,sure:true});a.deepEqual(judge([300,0],s,land,true),{in:true,sure:true});
  a.equal(judge([700,0],s,land,true).in,false);a.equal(judge([300,1100],s,land,true).in,true,'이등분선 아래 바다');
  a.equal(judge([300,1300],s,land,true).in,false,'이웃 쪽 바다(몫에서 424m)는 split 에서 뺀다');a.equal(judge([300,1300],s,land,false).in,true,'overlap 은 센다');
  a.equal(judge([-500,1300],s,land,true).in,false,'몫 밖 육지 300m 는 바다가 아니라 안 센다');a.equal(judge([499,0],s,land,true).sure,false,'500m 경계 3m 안은 판정 보류');},
 '전수 대조: 독립 판정(5179 미터)과 관광지별 사고 목록이 일치(경계 가까워 답이 갈리는 쌍만 예외)':a=>{const split=out._about.mode==='split';a.equal(out._about.seaBufferM,SEA);
  const land=index(rings(rs.landGeometry)),pts=rs.spots.map(s=>xy(s.lon,s.lat)),apts=acc.map(r=>xy(r[1],r[0])),grid=new Map();apts.forEach((p,i)=>{const k=Math.floor(p[0]/4000)+','+Math.floor(p[1]/4000);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);});
  const first=new Map();let unsure=0,checked=0,bad=[];
  rs.spots.forEach((sp,i)=>{const k=sp.lat+','+sp.lon;if(first.has(k))return;first.set(k,i);if(!sp.geometry.coordinates.length)return;const p=pts[i];
   const s={p,own:index(rings(sp.geometry)),others:pts.filter((q,j)=>j!==i&&Math.hypot(q[0]-p[0],q[1]-p[1])<=2*(CIRCLE+SEA)&&Math.hypot(q[0]-p[0],q[1]-p[1])>=1e-7)};
   const want=new Map(),maybe=new Map(),inc=(m,k)=>m.set(k,(m.get(k)||0)+1);const gx=Math.floor(p[0]/4000),gy=Math.floor(p[1]/4000);
   for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const n of grid.get(x+','+y)||[]){if(Math.hypot(apts[n][0]-p[0],apts[n][1]-p[1])>CIRCLE+SEA+10)continue;const r=judge(apts[n],s,land,split);checked++;if(!r.sure){unsure++;inc(maybe,key(acc[n]));}else if(r.in)inc(want,key(acc[n]));}
   const got=new Map();for(const e of out.spots[sp.id])inc(got,ekey(e));
   for(const[k,n]of want)if((got.get(k)||0)<n)bad.push(sp.id+' 빠짐 '+k);for(const[k,n]of got)if(n>(want.get(k)||0)+(maybe.get(k)||0))bad.push(sp.id+' 남음 '+k);});
  console.log(`   판정 ${checked}쌍 · 경계 보류 ${unsure}쌍`);a.deepEqual(bad.slice(0,5),[]);a.ok(unsure<checked*0.01,'보류는 1% 미만');},
 '용량 400KB 이하':a=>a.ok(fs.statSync(path.join(CFG,'coast_accidents.json')).size<400*1024)
});
