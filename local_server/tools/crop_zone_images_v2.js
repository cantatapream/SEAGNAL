// 특보구역별 "깔끔한 해안선 배경 + 0.5° 격자 + 구성 대해구 강조" 크롭 생성기 (v2)
// KHOA 해안도(WMS)는 이 환경에서 차단되어, land_mask_korea.json 해안선으로 동등한
// 깔끔한 배경을 직접 렌더한다. EPSG:3857(웹메르카토르)로 앱과 동일 투영.
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'zone_crops_v2');
fs.mkdirSync(OUT, { recursive: true });

const ZMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'zone_grid_map.json'), 'utf8'));
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'marine_zone_area.json'), 'utf8'));
const LAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'land_mask_korea.json'), 'utf8')).rings;

// marine_zone_no -> {lonMin,latMin,lonMax,latMax} (셀은 0.5° 사각형)
const cellBox = {};
for (const f of GEO.features) {
  const no = String(f.properties.marine_zone_no);
  let ring = f.geometry.coordinates;
  while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0]; // MultiPolygon → outer ring
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const [lo, la] of ring) { lonMin = Math.min(lonMin, lo); lonMax = Math.max(lonMax, lo); latMin = Math.min(latMin, la); latMax = Math.max(latMax, la); }
  cellBox[no] = { lonMin, latMin, lonMax, latMax };
}

// EPSG:3857
const R = 6378137, D = Math.PI / 180;
const mx = lon => R * lon * D;
const my = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * D / 2));

function majorsOf(z) {
  const set = new Set();
  (z.majorZones || []).forEach(n => set.add(String(n)));
  (z.smallZones || []).forEach(s => set.add(String(s).split('-')[0]));
  return [...set].filter(m => cellBox[m]);
}

// 5x7 숫자
const FONT = { '0':['111','101','101','101','101','101','111'],'1':['010','110','010','010','010','010','111'],'2':['111','001','001','111','100','100','111'],'3':['111','001','001','111','001','001','111'],'4':['101','101','101','111','001','001','001'],'5':['111','100','100','111','001','001','111'],'6':['111','100','100','111','101','101','111'],'7':['111','001','001','010','010','100','100'],'8':['111','101','101','111','101','101','111'],'9':['111','101','101','111','001','001','111'],'-':['000','000','000','111','000','000','000'] };
function drawDigits(img, text, ox, oy, scale, color) {
  let cx = ox;
  for (const ch of String(text)) {
    const g = FONT[ch]; if (!g) { cx += 4 * scale; continue; }
    for (let r = 0; r < 7; r++) for (let c = 0; c < g[r].length; c++)
      if (g[r][c] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = cx + c*scale+dx, y = oy + r*scale+dy;
        if (x>=0&&y>=0&&x<img.bitmap.width&&y<img.bitmap.height) img.setPixelColor(color, x, y);
      }
    cx += (g[0].length + 1) * scale;
  }
}

(async () => {
  const zones = Object.entries(ZMAP).filter(([c, z]) => z && z.name);
  const results = [];
  let idx = 0;
  for (const [code, z] of zones) {
    const majors = majorsOf(z);
    if (!majors.length) { results.push({ code, name: z.name, ok: false }); continue; }
    // 구역 bbox (4326) + 여백
    let loMin=Infinity,loMax=-Infinity,laMin=Infinity,laMax=-Infinity;
    for (const m of majors){const b=cellBox[m];loMin=Math.min(loMin,b.lonMin);loMax=Math.max(loMax,b.lonMax);laMin=Math.min(laMin,b.latMin);laMax=Math.max(laMax,b.latMax);}
    const padLon=Math.max(0.15,(loMax-loMin)*0.12), padLat=Math.max(0.15,(laMax-laMin)*0.12);
    loMin-=padLon;loMax+=padLon;laMin-=padLat;laMax+=padLat;
    // 3857 extent
    const X0=mx(loMin),X1=mx(loMax),Y0=my(laMin),Y1=my(laMax);
    const TARGET=560;
    const ar=(X1-X0)/(Y1-Y0);
    let W,H; if(ar>=1){W=TARGET;H=Math.round(TARGET/ar);}else{H=TARGET;W=Math.round(TARGET*ar);}
    const px=X=>(X-X0)/(X1-X0)*W, py=Y=>(Y1-Y)/(Y1-Y0)*H;

    const SEA=0xeaf2f8ff, LANDC=0xd8d2c0ff, GRID=0x8aa6b8ff, MEMBER=0xe22222ff, MEMBERF=0xe2222230, LBL=0x12508aff;
    const img = new Jimp({ width: W, height: H, color: SEA });

    // 해안선(육지) 채우기 — 뷰와 겹치는 ring 만 scanline fill
    for (const ring of LAND) {
      // 빠른 컬링
      let any=false; for(const [lo,la] of ring){ if(lo>=loMin&&lo<=loMax&&la>=laMin&&la<=laMax){any=true;break;} }
      // ring 이 뷰를 완전히 감싸는 경우도 있어 bbox 교차로 보강
      const pts = ring.map(([lo,la])=>[px(mx(lo)),py(my(la))]);
      let rxMin=Infinity,rxMax=-Infinity,ryMin=Infinity,ryMax=-Infinity;
      for(const [x,y] of pts){rxMin=Math.min(rxMin,x);rxMax=Math.max(rxMax,x);ryMin=Math.min(ryMin,y);ryMax=Math.max(ryMax,y);}
      if(rxMax<0||rxMin>W||ryMax<0||ryMin>H) continue;
      const yA=Math.max(0,Math.floor(ryMin)), yB=Math.min(H-1,Math.ceil(ryMax));
      for(let y=yA;y<=yB;y++){
        const xs=[]; const yc=y+0.5;
        for(let i=0,j=pts.length-1;i<pts.length;j=i++){
          const [xi,yi]=pts[i],[xj,yj]=pts[j];
          if((yi>yc)!==(yj>yc)){ xs.push(xi+(yc-yi)/(yj-yi)*(xj-xi)); }
        }
        xs.sort((a,b)=>a-b);
        for(let k=0;k+1<xs.length;k+=2){
          const xa=Math.max(0,Math.ceil(xs[k])), xb=Math.min(W-1,Math.floor(xs[k+1]));
          for(let x=xa;x<=xb;x++) img.setPixelColor(LANDC,x,y);
        }
      }
    }

    // 격자선: 뷰와 겹치는 모든 셀의 사각형 외곽선
    const memberSet = new Set(majors);
    const drawRect=(b,color,th,fill)=>{
      const x1=px(mx(b.lonMin)),x2=px(mx(b.lonMax)),y1=py(my(b.latMax)),y2=py(my(b.latMin));
      const ix1=Math.round(Math.min(x1,x2)),ix2=Math.round(Math.max(x1,x2)),iy1=Math.round(Math.min(y1,y2)),iy2=Math.round(Math.max(y1,y2));
      if(fill){for(let y=Math.max(0,iy1);y<=Math.min(H-1,iy2);y++)for(let x=Math.max(0,ix1);x<=Math.min(W-1,ix2);x++){const o=img.getPixelColor(x,y);img.setPixelColor(blend(o,fill),x,y);}}
      const set=(x,y)=>{if(x>=0&&y>=0&&x<W&&y<H)img.setPixelColor(color,x,y);};
      for(let t=0;t<th;t++){for(let x=ix1;x<=ix2;x++){set(x,iy1+t);set(x,iy2-t);}for(let y=iy1;y<=iy2;y++){set(ix1+t,y);set(ix2-t,y);}}
    };
    function blend(bg,fg){ // fg has low alpha
      const fa=(fg&0xff)/255; const fr=(fg>>>24)&0xff,fgc=(fg>>>16)&0xff,fb=(fg>>>8)&0xff;
      const br=(bg>>>24)&0xff,bgc=(bg>>>16)&0xff,bb=(bg>>>8)&0xff;
      const r=Math.round(fr*fa+br*(1-fa)),g=Math.round(fgc*fa+bgc*(1-fa)),b=Math.round(fb*fa+bb*(1-fa));
      return ((r<<24)|(g<<16)|(b<<8)|0xff)>>>0;
    }
    for (const no of Object.keys(cellBox)) {
      const b=cellBox[no];
      if(b.lonMax<loMin||b.lonMin>loMax||b.latMax<laMin||b.latMin>laMax) continue;
      if(memberSet.has(no)) continue; // 멤버는 나중에 위에 덧그림
      drawRect(b, GRID, 1);
    }
    for (const no of majors){ drawRect(cellBox[no], MEMBER, 3, MEMBERF); }
    // 멤버 셀 번호 라벨(중앙)
    for (const no of majors){ const b=cellBox[no]; const cx=px(mx((b.lonMin+b.lonMax)/2)), cy=py(my((b.latMin+b.latMax)/2)); const w=String(no).length*4*4; drawDigits(img, no, Math.round(cx-w/2), Math.round(cy-14), 4, LBL); }

    idx++;
    const fname=`${String(idx).padStart(2,'0')}_${code}.png`;
    await img.write(path.join(OUT,fname));
    results.push({ code, name:z.name, region:z.region, ok:true, idx, file:fname, count:majors.length });
  }
  fs.writeFileSync(path.join(OUT,'_index.json'), JSON.stringify(results,null,2));
  console.log('생성:', results.filter(r=>r.ok).length, '실패:', results.filter(r=>!r.ok).length);
})();
