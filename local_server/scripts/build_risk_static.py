#!/usr/bin/env python3
"""위험예측 정적 표: 5179 거리, 최근접 몫 분할, 육지+사용자 섬 클립.
개발 때만 실행한다. pip install shapely pyproj; 운영에서는 JSON을 읽는다.
원본 파일은 읽기 전용이며 출력은 risk_spots.json 한 곳이다.
"""
import json,math,re,hashlib,sys,os
from pathlib import Path
import numpy as np
from shapely.geometry import shape,Point,Polygon,MultiPolygon,LineString,mapping
from shapely.ops import transform,unary_union
from shapely import make_valid
from shapely.strtree import STRtree
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[2]
CONFIG=ROOT/'local_server/config/coastal_safety'
forward=Transformer.from_crs(4326,5179,always_xy=True).transform
reverse=Transformer.from_crs(5179,4326,always_xy=True).transform

def load(path):
    """UTF8 JSON을 읽는다. 호출: main 정적 원본."""
    return json.loads(path.read_text())

def features(path):
    """원본 다각형을 유효한 5179 형상으로 바꾼다. 호출: main."""
    fs=load(path)['features']
    return fs,[transform(forward,make_valid(shape(f['geometry']))) for f in fs]

def polygonal(geo):
    """점/선을 버리고 면 형상만 남긴다. 호출: 원 분할·육지클립."""
    if geo.is_empty:return MultiPolygon([])
    if isinstance(geo,(Polygon,MultiPolygon)):return geo
    polys=[]
    for g in geo.geoms:
        if isinstance(g,Polygon):polys.append(g)
        elif isinstance(g,MultiPolygon):polys.extend(g.geoms)
    return unary_union(polys) if polys else MultiPolygon([])

def json_geometry(geo):
    """위경도 출력에 소수6자리 좌표를 넣는다. 호출: main."""
    g=mapping(transform(reverse,polygonal(geo)))
    def clean(v):
        if isinstance(v,(list,tuple)):return [clean(x) for x in v]
        return round(v,6) if isinstance(v,float) else v
    return {'type':g['type'],'coordinates':clean(g['coordinates'])}

def nearest(p,gs,limit=None):
    """가장 가까운 폴리곤 번호를 고른다(동률 원본순). 호출: 특보·파출소 매칭."""
    ds=[p.distance(g) for g in gs]
    k=min(range(len(ds)),key=lambda i:ds[i])
    return k if limit is None or ds[k]<=limit else None

def main():
    """관광지별 분석요소·지도 형상을 생성하고 재현 통계를 출력한다."""
    spots=load(CONFIG/'coastal_spots.json')['spots']
    hz,hg=features(CONFIG/'coastal_hazard_zones.wgs84.geojson')
    stations,sg=features(CONFIG/'coastguard_stations.geojson')
    warns,wg=features(ROOT/'client/assets/warn_zones.geojson')
    gales,gg=features(ROOT/'client/assets/warn_zones_land_coastal.geojson')
    _,islands=features(CONFIG/'island_outlines.geojson')
    raw_land=load(ROOT/'client/land_mask_korea.json')['rings']
    # 원본은 세계 전역이다. 한국 주변만 투영하고 union으로 중복 링을 합친다.
    land=[]
    for r in raw_land:
        if len(r)<4:continue
        xs=[x[0] for x in r];ys=[x[1] for x in r]
        if max(xs)<123 or min(xs)>133 or max(ys)<32 or min(ys)>40:continue
        land.append(transform(forward,make_valid(Polygon(r))))
    land_geo=polygonal(unary_union(land+islands))
    segs=load(ROOT/'client/coastline_segments.json')['segments']
    lines=[transform(forward,LineString(list(zip(s['c'][::2],s['c'][1::2])))) for s in segs]
    line_tree=STRtree(lines);ht=STRtree(hg)
    pts=[transform(forward,Point(s['lon'],s['lat'])) for s in spots];ptree=STRtree(pts)
    rip=load(CONFIG/'rip_spot_map.json')['places'];rip_inverse={v:k for k,v in rip.items() if v}
    refs=json.loads(os.environ['RISK_TIDE_REFERENCES_JSON'])
    out=[];hist=[0,0,0,0];empty=0;duplicate=0
    for i,(s,p) in enumerate(zip(spots,pts)):
        near=sorted(int(k) for k in ht.query(p,predicate='dwithin',distance=3000))
        bucket=0 if not near else 1 if len(near)<=2 else 2 if len(near)<=5 else 3;hist[bucket]+=1
        wi=nearest(p,wg,3000);gi=nearest(p,gg,3000);si=nearest(p,sg,10000)
        coast_index=int(line_tree.nearest(p));cell=segs[coast_index]['z']
        # 24각형을 이웃 관광지와의 수직이등분선으로 자른다. 동일 좌표는 원본순으로 배정한다.
        circle=Polygon([(p.x+3000*math.cos(k*math.pi/12),p.y+3000*math.sin(k*math.pi/12)) for k in range(24)])
        for j in sorted(int(k) for k in ptree.query(p,predicate='dwithin',distance=6000)):
            if i==j:continue
            q=pts[j];dx=q.x-p.x;dy=q.y-p.y;d=math.hypot(dx,dy)
            if d<1e-7:
                if j<i:circle=Polygon();duplicate+=1;break
                continue
            nx,ny=dx/d,dy/d;tx,ty=-ny,nx;mx,my=(p.x+q.x)/2,(p.y+q.y)/2;L=100000
            half=Polygon([(mx+tx*L,my+ty*L),(mx-tx*L,my-ty*L),(mx-tx*L-nx*L,my-ty*L-ny*L),(mx+tx*L-nx*L,my+ty*L-ny*L)])
            circle=circle.intersection(half)
            if circle.is_empty:break
        geom=polygonal(circle.intersection(land_geo));empty+=int(geom.is_empty)
        id=f"{s['sgg']}|{s['name']}"
        row={k:s[k] for k in ['sgg','sgg_name','name','lat','lon']}
        row.update({'id':id,'beach':bool(re.search('해수욕장|해변|비치',s['name'])),
            'hazard':{'count':len(near),'bucket':bucket,'fatal':any(hz[k]['properties']['구역분류']=='사망사고 발생구역' for k in near),'zoneIds':[hz[k]['properties']['name'] for k in near],
            'zones':[{'id':hz[k]['properties']['name'],**hz[k]['properties']} for k in near]},
            'warnZone':warns[wi]['properties']['name'] if wi is not None else None,
            'galeZone':gales[gi]['properties']['name'] if gi is not None else None,
            'coastCell':cell,'major':int(cell.split('-')[0]),
            'station':stations[si]['properties']['name'] if si is not None else None,
            'ripBeach':rip_inverse.get(id),'geometry':json_geometry(geom)})
        out.append(row)
    result={'_about':{'version':'risk-static-v1','distanceCrs':'EPSG:5179','circleVertices':24,'landClip':'land_mask_korea.json union island_outlines.geojson','duplicatePointRule':'same coordinates: first source row owns map area; all rows remain searchable','sourceSpots':len(spots),'hazardBuckets':hist,'beaches':sum(s['beach'] for s in out),'islands':len(islands),'references':len(refs),'emptyGeometries':empty,'duplicateGeometries':duplicate},'spots':out,'landGeometry':json_geometry(land_geo),'references':refs}
    result['_about']['hash']=hashlib.sha256(json.dumps(result,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
    dest=Path(sys.argv[1]) if len(sys.argv)>1 else CONFIG/'risk_spots.json'
    dest.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps(result['_about'],ensure_ascii=False));print(f'{dest}: {dest.stat().st_size} bytes')
if __name__=='__main__':main()
