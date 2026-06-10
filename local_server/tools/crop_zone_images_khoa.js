// 특보구역별 "실제 KHOA 해안도(WMS) 배경 + 0.5° 격자 + 구성 대해구" 크롭 생성기
// 배경 = KHOA WMS GetMap (BASEMAP_RLTMCOAST3857) 을 구역 bbox(EPSG:3857)로 1장 요청.
//   → 앱의 해구도 화면(배경:해안도)과 동일한 베이스맵.
// 주의: khoa.go.kr 접속이 가능한 환경에서 실행해야 함.
//   - 직접:   node tools/crop_zone_images_khoa.js
//   - 프록시: KHOA_PROXY=http://localhost:3000/api/ocean/khoa-wms node tools/crop_zone_images_khoa.js
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'zone_crops_khoa');
fs.mkdirSync(OUT, { recursive: true });

const ZMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'zone_grid_map.json'), 'utf8'));
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'marine_zone_area.json'), 'utf8'));

const LAYER = 'BASEMAP_RLTMCOAST3857';
const PROXY = process.env.KHOA_PROXY || null; // 예: http://localhost:3000/api/ocean/khoa-wms
const DIRECT = 'http://www.khoa.go.kr/oceanmap/' + LAYER + '/wmsVectordata.do';

const cellBox = {};
for (const f of GEO.features) {
  const no = String(f.properties.marine_zone_no);
  let ring = f.geometry.coordinates;
  while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
  let lonMin=Infinity,lonMax=-Infinity,latMin=Infinity,latMax=-Infinity;
  for (const [lo,la] of ring){lonMin=Math.min(lonMin,lo);lonMax=Math.max(lonMax,lo);latMin=Math.min(latMin,la);latMax=Math.max(latMax,la);}
  cellBox[no] = { lonMin, latMin, lonMax, latMax };
}

const R=6378137, D=Math.PI/180;
const mx=lon=>R*lon*D, my=lat=>R*Math.log(Math.tan(Math.PI/4+lat*D/2));

function majorsOf(z){const s=new Set();(z.majorZones||[]).forEach(n=>s.add(String(n)));(z.smallZones||[]).forEach(x=>s.add(String(x).split('-')[0]));return [...s].filter(m=>cellBox[m]);}

const FONT={'0':['111','101','101','101','101','101','111'],'1':['010','110','010','010','010','010','111'],'2':['111','001','001','111','100','100','111'],'3':['111','001','001','111','001','001','111'],'4':['101','101','101','111','001','001','001'],'5':['111','100','100','111','001','001','111'],'6':['111','100','100','111','101','101','111'],'7':['111','001','001','010','010','100','100'],'8':['111','101','101','111','101','101','111'],'9':['111','101','101','111','001','001','111']};
function drawDigits(img,t,ox,oy,s,c){let cx=ox;for(const ch of String(t)){const g=FONT[ch];if(!g){cx+=4*s;continue;}for(let r=0;r<7;r++)for(let k=0;k<g[r].length;k++)if(g[r][k]==='1')for(let dy=0;dy<s;dy++)for(let dx=0;dx<s;dx++){const x=cx+k*s+dx,y=oy+r*s+dy;if(x>=0&&y>=0&&x<img.bitmap.width&&y<img.bitmap.height)img.setPixelColor(c,x,y);}cx+=(g[0].length+1)*s;}}

async function fetchKhoa(X0,Y0,X1,Y1,W,H){
  const p=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',FORMAT:'image/png',TRANSPARENT:'true',STYLES:'',LAYERS:'',SRS:'EPSG:3857',WIDTH:String(W),HEIGHT:String(H),BBOX:`${X0},${Y0},${X1},${Y1}`});
  const url = PROXY ? `${PROXY}?layer=${LAYER}&${p}` : `${DIRECT}?${p}`;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'Referer':'http://www.khoa.go.kr/oceanmap/main.do','User-Agent':'Mozilla/5.0'}});
      const b=Buffer.from(await r.arrayBuffer());
      if(r.ok && /png/.test(r.headers.get('content-type')||'') && b.length>100) return b;
      throw new Error(`status ${r.status} ${b.slice(0,40).toString('utf8')}`);
    }catch(e){ if(attempt===2) throw e; await new Promise(s=>setTimeout(s,1000*(attempt+1))); }
  }
}

(async()=>{
  const zones=Object.entries(ZMAP).filter(([c,z])=>z&&z.name);
  const results=[]; let idx=0; let netFail=false;
  for(const [code,z] of zones){
    const majors=majorsOf(z); if(!majors.length){results.push({code,name:z.name,ok:false});continue;}
    let loMin=Infinity,loMax=-Infinity,laMin=Infinity,laMax=-Infinity;
    for(const m of majors){const b=cellBox[m];loMin=Math.min(loMin,b.lonMin);loMax=Math.max(loMax,b.lonMax);laMin=Math.min(laMin,b.latMin);laMax=Math.max(laMax,b.latMax);}
    const padLon=Math.max(0.15,(loMax-loMin)*0.12),padLat=Math.max(0.15,(laMax-laMin)*0.12);
    loMin-=padLon;loMax+=padLon;laMin-=padLat;laMax+=padLat;
    const X0=mx(loMin),X1=mx(loMax),Y0=my(laMin),Y1=my(laMax);
    const TARGET=640, ar=(X1-X0)/(Y1-Y0);
    let W,H; if(ar>=1){W=TARGET;H=Math.round(TARGET/ar);}else{H=TARGET;W=Math.round(TARGET*ar);}
    const px=X=>(X-X0)/(X1-X0)*W, py=Y=>(Y1-Y)/(Y1-Y0)*H;

    let img;
    try{
      const buf=await fetchKhoa(X0,Y0,X1,Y1,W,H);
      img=await Jimp.read(buf);
      if(img.bitmap.width!==W||img.bitmap.height!==H) img.resize({w:W,h:H});
      // 흰 배경 깔고 해안도 합성(투명 png 대비)
      const base=new Jimp({width:W,height:H,color:0xeaf2f8ff}); base.composite(img,0,0); img=base;
    }catch(e){ netFail=true; results.push({code,name:z.name,ok:false,reason:'khoa fetch fail: '+e.message}); continue; }

    const GRID=0x5b7b91ff, MEMBER=0xe22222ff, LBL=0x0c3a66ff;
    const drawRect=(b,color,th)=>{const x1=px(mx(b.lonMin)),x2=px(mx(b.lonMax)),y1=py(my(b.latMax)),y2=py(my(b.latMin));const ix1=Math.round(Math.min(x1,x2)),ix2=Math.round(Math.max(x1,x2)),iy1=Math.round(Math.min(y1,y2)),iy2=Math.round(Math.max(y1,y2));const set=(x,y)=>{if(x>=0&&y>=0&&x<W&&y<H)img.setPixelColor(color,x,y);};for(let t=0;t<th;t++){for(let x=ix1;x<=ix2;x++){set(x,iy1+t);set(x,iy2-t);}for(let y=iy1;y<=iy2;y++){set(ix1+t,y);set(ix2-t,y);}}};
    const ms=new Set(majors);
    for(const no of Object.keys(cellBox)){const b=cellBox[no];if(b.lonMax<loMin||b.lonMin>loMax||b.latMax<laMin||b.latMin>laMax)continue;if(ms.has(no))continue;drawRect(b,GRID,1);}
    for(const no of majors)drawRect(cellBox[no],MEMBER,3);
    for(const no of majors){const b=cellBox[no];const cx=px(mx((b.lonMin+b.lonMax)/2)),cy=py(my((b.latMin+b.latMax)/2));const w=String(no).length*4*4;drawDigits(img,no,Math.round(cx-w/2),Math.round(cy-14),4,LBL);}

    idx++; const fname=`${String(idx).padStart(2,'0')}_${code}.png`;
    await img.write(path.join(OUT,fname));
    results.push({code,name:z.name,region:z.region,ok:true,idx,file:fname});
    process.stdout.write(`\r생성 ${idx}...`);
  }
  fs.writeFileSync(path.join(OUT,'_index.json'),JSON.stringify(results,null,2));
  console.log('\n생성:',results.filter(r=>r.ok).length,'실패:',results.filter(r=>!r.ok).length);
  if(netFail) console.log('⚠ KHOA 접속 실패가 있었습니다. khoa.go.kr 접속 가능한 환경에서 실행하거나 KHOA_PROXY 를 지정하세요.');
})();
