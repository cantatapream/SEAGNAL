// 특보구역별 "실제 KHOA 해안도(WMS) 배경 + 0.5° 격자 + 구성 대해구" 크롭 생성기
// 방식: KHOA 는 타일그리드 정렬된 256×256 GetMap 만 허용하므로,
//   구역 범위를 덮는 타일들을 받아 모자이크 → 구역 범위로 크롭 → 격자/대해구 오버레이.
// 배경 레이어 = BASEMAP_RLTMCOAST3857 (앱의 "해안도").
// 실행: khoa.go.kr 접속 가능한 환경에서  node tools/crop_zone_images_khoa.js
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'zone_crops_khoa');
fs.mkdirSync(OUT, { recursive: true });

const ZMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'zone_grid_map.json'), 'utf8'));
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'marine_zone_area.json'), 'utf8'));

const LAYER = 'BASEMAP_RLTMCOAST3857';
const R = 6378137, D = Math.PI / 180, originX = -Math.PI * R, originY = Math.PI * R;
const mx = lon => R * lon * D, my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * D / 2));
const TARGET_TILES = 6;     // 긴 변 목표 타일 수
const TILE = 256;

const cellBox = {};
for (const f of GEO.features) {
  const no = String(f.properties.marine_zone_no);
  let ring = f.geometry.coordinates;
  while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
  let lonMin=Infinity,lonMax=-Infinity,latMin=Infinity,latMax=-Infinity;
  for (const [lo,la] of ring){lonMin=Math.min(lonMin,lo);lonMax=Math.max(lonMax,lo);latMin=Math.min(latMin,la);latMax=Math.max(latMax,la);}
  cellBox[no] = { lonMin, latMin, lonMax, latMax };
}
function majorsOf(z){const s=new Set();(z.majorZones||[]).forEach(n=>s.add(String(n)));(z.smallZones||[]).forEach(x=>s.add(String(x).split('-')[0]));return [...s].filter(m=>cellBox[m]);}

const FONT={'0':['111','101','101','101','101','101','111'],'1':['010','110','010','010','010','010','111'],'2':['111','001','001','111','100','100','111'],'3':['111','001','001','111','001','001','111'],'4':['101','101','101','111','001','001','001'],'5':['111','100','100','111','001','001','111'],'6':['111','100','100','111','101','101','111'],'7':['111','001','001','010','010','100','100'],'8':['111','101','101','111','101','101','111'],'9':['111','101','101','111','001','001','111']};
function drawDigits(img,t,ox,oy,s,c){let cx=ox;for(const ch of String(t)){const g=FONT[ch];if(!g){cx+=4*s;continue;}for(let r=0;r<7;r++)for(let k=0;k<g[r].length;k++)if(g[r][k]==='1')for(let dy=0;dy<s;dy++)for(let dx=0;dx<s;dx++){const x=cx+k*s+dx,y=oy+r*s+dy;if(x>=0&&y>=0&&x<img.bitmap.width&&y<img.bitmap.height)img.setPixelColor(c,x,y);}cx+=(g[0].length+1)*s;}}

const tileCache = new Map(); // "z/tx/ty" -> Jimp|null
async function getTile(z, tx, ty) {
  const key = `${z}/${tx}/${ty}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const ts = 2 * Math.PI * R / 2 ** z;
  const minX = originX + tx * ts, maxX = minX + ts, maxY = originY - ty * ts, minY = maxY - ts;
  const p = new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',FORMAT:'image/png',TRANSPARENT:'true',LAYERS:'',STYLES:'',WIDTH:String(TILE),HEIGHT:String(TILE),SRS:'EPSG:3857',TILED:'true',BBOX:`${minX},${minY},${maxX},${maxY}`});
  const url = `http://www.khoa.go.kr/oceanmap/${LAYER}/wmsVectordata.do?${p}`;
  let img = null;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { Referer: 'http://www.khoa.go.kr/oceanmap/main.do', 'User-Agent': 'Mozilla/5.0' } });
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50) { img = await Jimp.read(b); break; }
      throw new Error(`status ${r.status} ${b.slice(0,30).toString('utf8')}`);
    } catch (e) { if (a === 2) { console.warn(`  tile ${key} fail: ${e.message}`); } else await new Promise(s=>setTimeout(s,600*(a+1))); }
  }
  tileCache.set(key, img);
  return img;
}

(async () => {
  const zones = Object.entries(ZMAP).filter(([c,z])=>z&&z.name);
  const results = []; let idx = 0;
  for (const [code, z] of zones) {
    const majors = majorsOf(z); if (!majors.length){results.push({code,name:z.name,ok:false});continue;}
    let loMin=Infinity,loMax=-Infinity,laMin=Infinity,laMax=-Infinity;
    for (const m of majors){const b=cellBox[m];loMin=Math.min(loMin,b.lonMin);loMax=Math.max(loMax,b.lonMax);laMin=Math.min(laMin,b.latMin);laMax=Math.max(laMax,b.latMax);}
    const padLon=Math.max(0.15,(loMax-loMin)*0.12),padLat=Math.max(0.15,(laMax-laMin)*0.12);
    loMin-=padLon;loMax+=padLon;laMin-=padLat;laMax+=padLat;
    const X0=mx(loMin),X1=mx(loMax),Y0=my(laMin),Y1=my(laMax);
    const longer = Math.max(X1-X0, Y1-Y0);
    let zoom = Math.round(Math.log2(TARGET_TILES * 2 * Math.PI * R / longer));
    zoom = Math.max(7, Math.min(13, zoom));
    const ts = 2 * Math.PI * R / 2 ** zoom;
    const txMin=Math.floor((X0-originX)/ts), txMax=Math.floor((X1-originX)/ts);
    const tyMin=Math.floor((originY-Y1)/ts), tyMax=Math.floor((originY-Y0)/ts);
    const nx=txMax-txMin+1, ny=tyMax-tyMin+1;
    // 모자이크
    const mosaic = new Jimp({ width: nx*TILE, height: ny*TILE, color: 0xeaf2f8ff });
    for (let i=0;i<nx;i++) for (let j=0;j<ny;j++){
      const t = await getTile(zoom, txMin+i, tyMin+j);
      if (t) mosaic.composite(t, i*TILE, j*TILE);
    }
    // 모자이크 3857 범위
    const mX0=originX+txMin*ts, mYtop=originY-tyMin*ts;
    const toMpx=X=>(X-mX0)/ts*TILE, toMpy=Y=>(mYtop-Y)/ts*TILE;
    const cx0=Math.round(toMpx(X0)), cx1=Math.round(toMpx(X1)), cy0=Math.round(toMpy(Y1)), cy1=Math.round(toMpy(Y0));
    const Wc=cx1-cx0, Hc=cy1-cy0;
    const img = mosaic.crop({ x: cx0, y: cy0, w: Wc, h: Hc });
    // 오버레이 (크롭 이미지 범위 = [X0,X1]×[Y0,Y1])
    const px=X=>(X-X0)/(X1-X0)*Wc, py=Y=>(Y1-Y)/(Y1-Y0)*Hc;
    const GRID=0x37506688, MEMBER=0xe22222ff, LBL=0xffffffff, LBLO=0x000000ff;
    const drawRect=(b,color,th)=>{const x1=px(mx(b.lonMin)),x2=px(mx(b.lonMax)),y1=py(my(b.latMax)),y2=py(my(b.latMin));const ix1=Math.round(Math.min(x1,x2)),ix2=Math.round(Math.max(x1,x2)),iy1=Math.round(Math.min(y1,y2)),iy2=Math.round(Math.max(y1,y2));const set=(x,y)=>{if(x>=0&&y>=0&&x<Wc&&y<Hc)img.setPixelColor(color,x,y);};for(let t=0;t<th;t++){for(let x=ix1;x<=ix2;x++){set(x,iy1+t);set(x,iy2-t);}for(let y=iy1;y<=iy2;y++){set(ix1+t,y);set(ix2-t,y);}}};
    const ms=new Set(majors);
    for(const no of Object.keys(cellBox)){const b=cellBox[no];if(b.lonMax<loMin||b.lonMin>loMax||b.latMax<laMin||b.latMin>laMax)continue;if(ms.has(no))continue;drawRect(b,GRID,1);}
    for(const no of majors)drawRect(cellBox[no],MEMBER,3);
    for(const no of majors){const b=cellBox[no];const cx=px(mx((b.lonMin+b.lonMax)/2)),cy=py(my((b.latMin+b.latMax)/2));const w=String(no).length*4*4;const ox=Math.round(cx-w/2),oy=Math.round(cy-14);drawDigits(img,no,ox+1,oy+1,4,LBLO);drawDigits(img,no,ox,oy,4,LBL);}

    idx++; const fname=`${String(idx).padStart(2,'0')}_${code}.png`;
    await img.write(path.join(OUT,fname));
    results.push({code,name:z.name,region:z.region,ok:true,idx,file:fname,zoom});
    process.stdout.write(`\r생성 ${idx}/${zones.length} (z${zoom}, ${nx}x${ny}타일)   `);
  }
  fs.writeFileSync(path.join(OUT,'_index.json'),JSON.stringify(results,null,2));
  console.log('\n생성:',results.filter(r=>r.ok).length,'실패:',results.filter(r=>!r.ok).length,'| 타일캐시',tileCache.size);
})();
