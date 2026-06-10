// 특보구역별 "실제 KHOA 해안도(WMS) 배경 + 0.5° 격자 + 특보구역 영역" 크롭 생성기
// 방식: KHOA 는 타일그리드 정렬된 256×256 GetMap 만 허용 → 구역 범위를 덮는 타일을
//   받아 모자이크 → 구역 범위로 크롭 → 오버레이.
// 오버레이:
//   1) 대해구 0.5° 격자선 (옅게, 위치 감각용)
//   2) 특보구역 영역 = zone_grid_map.smallZones(소해구) 합집합 — 반투명 채움 + 외곽 경계선 굵게
//   3) 구역 인덱스 번호 (범례와 매칭)
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
const TARGET_TILES = 6, TILE = 256;
const SUB = 0.5 / 3; // 소해구 한 변(도)

// marine_zone_no -> 0.5° 셀 box
const cellBox = {};
for (const f of GEO.features) {
  const no = String(f.properties.marine_zone_no);
  let ring = f.geometry.coordinates;
  while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
  let lonMin=Infinity,lonMax=-Infinity,latMin=Infinity,latMax=-Infinity;
  for (const [lo,la] of ring){lonMin=Math.min(lonMin,lo);lonMax=Math.max(lonMax,lo);latMin=Math.min(latMin,la);latMax=Math.max(latMax,la);}
  cellBox[no] = { lonMin, latMin, lonMax, latMax };
}

// 소해구 "P-s"(1..9) -> box. subNo=(2-row)*3+col+1 (북행=1,2,3 / 서→동)
function subBox(parent, sub) {
  const b = cellBox[parent]; if (!b) return null;
  const s = parseInt(sub, 10); if (!(s >= 1 && s <= 9)) return null;
  const r3 = Math.floor((s - 1) / 3); // 0=북, 1=중, 2=남
  const c3 = (s - 1) % 3;             // 0=서 .. 2=동
  const dlon = (b.lonMax - b.lonMin) / 3, dlat = (b.latMax - b.latMin) / 3;
  return { lonMin: b.lonMin + c3*dlon, lonMax: b.lonMin + (c3+1)*dlon,
           latMax: b.latMax - r3*dlat, latMin: b.latMax - (r3+1)*dlat };
}
// 구역 영역 = 소해구 합집합 (각 소해구 box + 1/6° 격자 정수인덱스)
function footprintOf(z) {
  const cells = [];
  for (const sz of (z.smallZones || [])) {
    const [p, s] = String(sz).split('-');
    const bx = subBox(p, s); if (!bx) continue;
    const ix = Math.round(bx.lonMin / SUB), iy = Math.round(bx.latMin / SUB);
    cells.push({ ...bx, ix, iy });
  }
  return cells;
}
function majorsOf(z){const set=new Set();(z.smallZones||[]).forEach(s=>set.add(String(s).split('-')[0]));(z.majorZones||[]).forEach(n=>set.add(String(n)));return [...set].filter(m=>cellBox[m]);}

const FONT={'0':['111','101','101','101','101','101','111'],'1':['010','110','010','010','010','010','111'],'2':['111','001','001','111','100','100','111'],'3':['111','001','001','111','001','001','111'],'4':['101','101','101','111','001','001','001'],'5':['111','100','100','111','001','001','111'],'6':['111','100','100','111','101','101','111'],'7':['111','001','001','010','010','100','100'],'8':['111','101','101','111','101','101','111'],'9':['111','101','101','111','001','001','111']};
function drawDigits(img,t,ox,oy,s,c){let cx=ox;for(const ch of String(t)){const g=FONT[ch];if(!g){cx+=4*s;continue;}for(let r=0;r<7;r++)for(let k=0;k<g[r].length;k++)if(g[r][k]==='1')for(let dy=0;dy<s;dy++)for(let dx=0;dx<s;dx++){const x=cx+k*s+dx,y=oy+r*s+dy;if(x>=0&&y>=0&&x<img.bitmap.width&&y<img.bitmap.height)img.setPixelColor(c,x,y);}cx+=(g[0].length+1)*s;}}

const tileCache = new Map();
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
      throw new Error(`status ${r.status}`);
    } catch (e) { if (a === 2) console.warn(`  tile ${key} fail`); else await new Promise(s=>setTimeout(s,600*(a+1))); }
  }
  tileCache.set(key, img);
  return img;
}

function blend(bg, fg, fa){ // fg rgb hex 0xRRGGBB, fa 0..1
  const br=(bg>>>24)&0xff,bgc=(bg>>>16)&0xff,bb=(bg>>>8)&0xff;
  const fr=(fg>>>16)&0xff,fgc=(fg>>>8)&0xff,fb=fg&0xff;
  const r=Math.round(fr*fa+br*(1-fa)),g=Math.round(fgc*fa+bgc*(1-fa)),b=Math.round(fb*fa+bb*(1-fa));
  return ((r<<24)|(g<<16)|(b<<8)|0xff)>>>0;
}

(async () => {
  const zones = Object.entries(ZMAP).filter(([c,z])=>z&&z.name);
  const results = []; let idx = 0;
  for (const [code, z] of zones) {
    const fp = footprintOf(z); if (!fp.length){results.push({code,name:z.name,ok:false});continue;}
    // 크롭 범위 = 영역 합집합 bbox + 여백(해안 맥락 보이게)
    let loMin=Infinity,loMax=-Infinity,laMin=Infinity,laMax=-Infinity;
    for (const c of fp){loMin=Math.min(loMin,c.lonMin);loMax=Math.max(loMax,c.lonMax);laMin=Math.min(laMin,c.latMin);laMax=Math.max(laMax,c.latMax);}
    const spanLon=loMax-loMin, spanLat=laMax-laMin;
    const padLon=Math.max(0.18, spanLon*0.45), padLat=Math.max(0.18, spanLat*0.45);
    loMin-=padLon;loMax+=padLon;laMin-=padLat;laMax+=padLat;
    const X0=mx(loMin),X1=mx(loMax),Y0=my(laMin),Y1=my(laMax);
    const longer=Math.max(X1-X0,Y1-Y0);
    let zoom=Math.max(7,Math.min(13,Math.round(Math.log2(TARGET_TILES*2*Math.PI*R/longer))));
    const ts=2*Math.PI*R/2**zoom;
    const txMin=Math.floor((X0-originX)/ts),txMax=Math.floor((X1-originX)/ts);
    const tyMin=Math.floor((originY-Y1)/ts),tyMax=Math.floor((originY-Y0)/ts);
    const nx=txMax-txMin+1,ny=tyMax-tyMin+1;
    const mosaic=new Jimp({width:nx*TILE,height:ny*TILE,color:0xeaf2f8ff});
    for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){const t=await getTile(zoom,txMin+i,tyMin+j);if(t)mosaic.composite(t,i*TILE,j*TILE);}
    const mX0=originX+txMin*ts,mYtop=originY-tyMin*ts;
    const cx0=Math.round((X0-mX0)/ts*TILE),cx1=Math.round((X1-mX0)/ts*TILE),cy0=Math.round((mYtop-Y1)/ts*TILE),cy1=Math.round((mYtop-Y0)/ts*TILE);
    const Wc=cx1-cx0,Hc=cy1-cy0;
    const img=mosaic.crop({x:cx0,y:cy0,w:Wc,h:Hc});
    const px=X=>(X-X0)/(X1-X0)*Wc, py=Y=>(Y1-Y)/(Y1-Y0)*Hc;

    // 1) 대해구 격자선 (옅게)
    const GRID=0x35506677;
    const drawRectEdge=(b,color,th)=>{const x1=px(mx(b.lonMin)),x2=px(mx(b.lonMax)),y1=py(my(b.latMax)),y2=py(my(b.latMin));const ix1=Math.round(Math.min(x1,x2)),ix2=Math.round(Math.max(x1,x2)),iy1=Math.round(Math.min(y1,y2)),iy2=Math.round(Math.max(y1,y2));const set=(x,y)=>{if(x>=0&&y>=0&&x<Wc&&y<Hc)img.setPixelColor(color,x,y);};for(let t=0;t<th;t++){for(let x=ix1;x<=ix2;x++){set(x,iy1+t);set(x,iy2-t);}for(let y=iy1;y<=iy2;y++){set(ix1+t,y);set(ix2-t,y);}}};
    for(const no of majorsOf(z)){const b=cellBox[no];if(b.lonMax<loMin||b.lonMin>loMax||b.latMax<laMin||b.latMin>laMax)continue;drawRectEdge(b,GRID,1);}

    // 2) 특보구역 영역: 반투명 채움
    const fset=new Set(fp.map(c=>c.ix+','+c.iy));
    const FILL=0xe23b3b, FA=0.30, BORDER=0xd11a1aff;
    for(const c of fp){const ax=Math.max(0,Math.round(px(mx(c.lonMin)))),bx=Math.min(Wc-1,Math.round(px(mx(c.lonMax)))),ay=Math.max(0,Math.round(py(my(c.latMax)))),by=Math.min(Hc-1,Math.round(py(my(c.latMin))));for(let y=ay;y<=by;y++)for(let x=ax;x<=bx;x++)img.setPixelColor(blend(img.getPixelColor(x,y),FILL,FA),x,y);}
    // 외곽 경계선만 굵게 (이웃이 영역 밖인 변)
    const setpx=(x,y,c)=>{if(x>=0&&y>=0&&x<Wc&&y<Hc)img.setPixelColor(c,x,y);};
    const thickH=(xa,xb,y)=>{for(let t=-1;t<=1;t++)for(let x=xa;x<=xb;x++)setpx(x,y+t,BORDER);};
    const thickV=(ya,yb,x)=>{for(let t=-1;t<=1;t++)for(let y=ya;y<=yb;y++)setpx(x+t,y,BORDER);};
    for(const c of fp){
      const ax=Math.round(px(mx(c.lonMin))),bx=Math.round(px(mx(c.lonMax))),ay=Math.round(py(my(c.latMax))),by=Math.round(py(my(c.latMin)));
      if(!fset.has((c.ix)+','+(c.iy+1))) thickH(Math.min(ax,bx),Math.max(ax,bx),ay); // 북쪽 변(위)
      if(!fset.has((c.ix)+','+(c.iy-1))) thickH(Math.min(ax,bx),Math.max(ax,bx),by); // 남쪽 변(아래)
      if(!fset.has((c.ix-1)+','+(c.iy))) thickV(Math.min(ay,by),Math.max(ay,by),Math.min(ax,bx)); // 서쪽 변
      if(!fset.has((c.ix+1)+','+(c.iy))) thickV(Math.min(ay,by),Math.max(ay,by),Math.max(ax,bx)); // 동쪽 변
    }

    // 3) 인덱스 번호 (영역 중심)
    let clon=0,clat=0;for(const c of fp){clon+=(c.lonMin+c.lonMax)/2;clat+=(c.latMin+c.latMax)/2;}clon/=fp.length;clat/=fp.length;
    idx++;
    const cxp=px(mx(clon)),cyp=py(my(clat)),w=String(idx).length*5*4;
    drawDigits(img,String(idx),Math.round(cxp-w/2)+1,Math.round(cyp-16)+1,5,0x000000ff);
    drawDigits(img,String(idx),Math.round(cxp-w/2),Math.round(cyp-16),5,0xffe000ff);

    const fname=`${String(idx).padStart(2,'0')}_${code}.png`;
    await img.write(path.join(OUT,fname));
    results.push({code,name:z.name,region:z.region,ok:true,idx,file:fname,zoom,cells:fp.length});
    process.stdout.write(`\r생성 ${idx}/${zones.length}   `);
  }
  fs.writeFileSync(path.join(OUT,'_index.json'),JSON.stringify(results,null,2));
  console.log('\n생성:',results.filter(r=>r.ok).length,'실패:',results.filter(r=>!r.ok).length,'| 타일캐시',tileCache.size);
})();
