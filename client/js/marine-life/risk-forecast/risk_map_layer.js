/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_map_layer.js
 * 역할  : 해상은 단일 GR4의 연속 면색·확대 척수와 선택 경계로, 연안은 기존 분석으로 표시한다.
 *           특보 구역은 이 지도에 그리지 않는다(사용자 확정 2026-10-15 「지도에 특보 영역을 표시하지 말자」).
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_api.js 다음 · risk_slider.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    /**
     * 위험예측의 지도 층과 육지 마스크·클릭 처리를 만든다.
     * 예: RiskMapLayer.create(map,select)
     * @param {ol.Map} map - 앱 지도; select(kind,id,point)는 선택 콜백(사고는 실제 클릭 좌표, 동일좌표 관광지는 id 배열)
     * @returns {Object} 경계·표·프레임·선택·가시성·정리 API
     * [연계] RiskForecast → OpenLayers
     */
    function create(map, select) {
        var geo=new ol.format.GeoJSON(), sources={}, layers={}, spots=[], cells=[], accidentCells=[], trafficCells=[], unifiedCells=[], unified=!!w.RiskMarine, unifiedMode=null, visible=false, active={coast:true,sea:false}, selection=null, land=[], maskKey='', maskCanvas=null, smoothCanvas=null, disposed=false, unifiedTable=null, unifiedIndex=new Map(), unifiedRows=new Map(), unifiedFeatures=new Map(), unifiedBins=new Map(), fillStyles=new Map(), numberStyles=new Map();
        ['accident','sea','marine','traffic','coast','hazard','selection','shore','points'].forEach(function (k,i) {
            sources[k]=new ol.source.Vector();
            layers[k]=new ol.layer.Vector({source:sources[k], zIndex:130+i, className:'rf-'+k+'-canvas',declutter:k==='traffic'});
            map.addLayer(layers[k]);
        });
        function read(g) { return geo.readGeometry(g,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()}); }
        function add(k,g,props,style) {
            if (!g) return null;
            // 육지 교차 면이 없거나 같은 좌표를 다른 관광지가 소유하면 정적 표는 빈 면을 유지한다.
            // 가짜 원으로 덮지 않고 지도 면만 건너뛴다. 선택용 중심점은 drawCoast에서 따로 남긴다.
            if ((g.type==='Polygon'||g.type==='MultiPolygon')&&Array.isArray(g.coordinates)&&!g.coordinates.length) return null;
            var f=new ol.Feature(Object.assign({geometry:read(g)},props||{})); f.setStyle(style); sources[k].addFeature(f); return f;
        }
        function rgba(rgb,a) { return rgb.replace('rgb(','rgba(').replace(')',','+a+')'); }
        function colorStyle(score,coast) {
            var c=w.RiskFormat.col(score);
            return new ol.style.Style({fill:new ol.style.Fill({color:rgba(c,score==null?0:(coast?0.5:score>0?0.7:0))}),stroke:new ol.style.Stroke({color:coast?c:'rgba(200,225,240,.12)',width:coast?2:0.5})});
        }
        function mask(evt,kind) {
            if (!land.length) return;
            var ctx=evt.context;
            if (!ctx || !ctx.canvas) return;
            var key=ctx.canvas.width+','+ctx.canvas.height+','+map.getView().getCenter()+','+map.getView().getResolution()+','+map.getView().getRotation();
            if (maskKey!==key) {
                maskKey=key; maskCanvas=document.createElement('canvas'); maskCanvas.width=ctx.canvas.width; maskCanvas.height=ctx.canvas.height;
                var mc=maskCanvas.getContext('2d'); mc.fillStyle='#fff';
                var extent=map.getView().calculateExtent(map.getSize());
                land.forEach(function (polygon) {
                    // 각 다각형을 따로 합성하여 겹친 육지·섬이 짝홀 규칙으로 다시 바다가 되는 일을 막는다.
                    if (!ol.extent.intersects(polygon.extent,extent)) return;
                    mc.beginPath();
                    polygon.rings.forEach(function (ring) {
                        ring.forEach(function (p,i) {
                            var px=map.getPixelFromCoordinate(p); if (!px) return;
                            px=ol.render.getRenderPixel(evt,px); if (!i) mc.moveTo(px[0],px[1]); else mc.lineTo(px[0],px[1]);
                        }); mc.closePath();
                    }); mc.fill('evenodd');
                });
            }
            ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalCompositeOperation=kind==='coast'?'destination-in':'destination-out'; ctx.drawImage(maskCanvas,0,0); ctx.restore();
        }
        layers.accident.on('postrender',function (e) { mask(e,'sea'); });
        layers.sea.on('postrender',function (e) { mask(e,'sea'); });
        layers.traffic.on('postrender',function (e) { mask(e,'sea'); });
        // 격자마다 필터를 적용하지 않고 완성된 면색 canvas에 단 한 번 흐림을 적용한다.
        layers.marine.on('postrender',function(e){var ctx=e.context;if(ctx&&ctx.canvas){if(!smoothCanvas)smoothCanvas=document.createElement('canvas');if(smoothCanvas.width!==ctx.canvas.width||smoothCanvas.height!==ctx.canvas.height){smoothCanvas.width=ctx.canvas.width;smoothCanvas.height=ctx.canvas.height;}var sc=smoothCanvas.getContext('2d');sc.clearRect(0,0,smoothCanvas.width,smoothCanvas.height);sc.drawImage(ctx.canvas,0,0);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.filter='blur(6px)';ctx.drawImage(smoothCanvas,0,0);ctx.restore();}mask(e,'sea');});
        layers.coast.on('postrender',function (e) { mask(e,'coast'); });
        function landGeometry(g,island) {
            if (!g) return;
            var polys=g.type==='MultiPolygon'?g.coordinates:[g.coordinates];
            polys.forEach(function (rings) {
                var geometry=read({type:'Polygon',coordinates:rings});
                land.push({rings:geometry.getCoordinates(),extent:geometry.getExtent()});
                var f=new ol.Feature(geometry); f.setStyle(new ol.style.Style({stroke:new ol.style.Stroke({color:'#5b6576',width:island?2:2.4})})); sources.shore.addFeature(f);
            }); maskKey='';
        }
        /** 육지·섬 외곽선을 받아 해안선과 육지 마스크를 만든다. 특보 구역 경계(/api/warn-zones)는 받지 않는다(2026-10-15 특보 영역 미표시).
         * 예: boundaries(api) → 해안선 HTTP 실패면 섬만 그리고 오류를 던진다.
         * @param {object} api - RiskApi(get('islands')) @returns {Promise<void>} [연계] ← RiskForecast.refresh
         */
        async function boundaries(api) {
            land=[];sources.shore.clear();maskKey='';
            var outcomes=await Promise.allSettled([fetch('/api/ocean/land-mask').then(function(r){if(!r.ok)throw Error('해안선 HTTP '+r.status);return r.json();}),api.get('islands')]);
            if(disposed)return;
            if (outcomes[0].status==='fulfilled') (outcomes[0].value.rings||[]).forEach(function(r){landGeometry({type:'Polygon',coordinates:[r]});});
            if (outcomes[1].status==='fulfilled') (outcomes[1].value.features||[]).forEach(function(f){landGeometry(f.geometry,true);});
            var failed=outcomes.filter(function(x){return x.status==='rejected';});
            if(failed.length) throw new Error(failed.map(function(x){return x.reason.message;}).join(' / '));
        }
        function setTables(c,s,a,current) { cells=c.cells||[]; spots=s.spots||[]; accidentCells=a&&a.cells||[];if(current)trafficCells=current.cells||[]; }
        /** 원본 GR4 경계 하나로 면색을 표시하고 숫자는 확대할 때만 보여준다.
         * 예: 현재21척 숫자, 혼잡점·중복 사고격자선 없음.
         * @param {object} table - 공통 경계 @param {object} frame - 선택 항목
         * @returns {void} [연계] ← RiskForecast / 사고 원본 지수는 색단계만 유지.
         */
        function drawUnified(table,frame){
            unified=true;unifiedMode=frame.mode;unifiedCells=table.cells||[];
            if(unifiedTable!==table){unifiedTable=table;unifiedIndex=new Map();unifiedBins=new Map();unifiedFeatures.clear();unifiedCells.forEach(function(c){unifiedIndex.set(c.i,c);var key=Math.floor(c.lon*4)+','+Math.floor(c.lat*4);if(!unifiedBins.has(key))unifiedBins.set(key,[]);unifiedBins.get(key).push(c);});}
            unifiedRows=new Map((frame.cells||[]).filter(function(v){return Number.isFinite(v[1])&&Number.isFinite(v[3])&&v[3]>=0&&v[3]<=1&&typeof v[2]==='string';}).map(function(v){return[v[0],v];}));
            renderUnified();
            layers.sea.setVisible(false);layers.accident.setVisible(false);layers.traffic.setVisible(visible&&active.sea&&frame.mode==='current');layers.marine.setVisible(visible&&active.sea);
        }
        /** 화면과 한 격자 여유 범위의 자료만 OL Feature로 만든다. 같은 시각의 이동은 원본 API를 다시 호출하지 않는다.
         * 예: 제주 확대 시 다른 지역 수만 개 geometry·style를 만들지 않는다.
         * @returns {void} [연계] ← drawUnified·map.moveend / 결측은 보이지도 클릭되지도 않는다.
         */
        function renderUnified(){
            if(disposed||!unifiedTable)return;var size=map.getSize();if(!size)return;
            var view=map.getView(),extent=ol.extent.buffer(view.calculateExtent(size),view.getResolution()*128),b=ol.proj.transformExtent(extent,view.getProjection(),'EPSG:4326'),features=[],numbers=[],wanted=new Set();
            var res=view.getResolution(),groups=new Map(),overview=res>=80,showNumbers=unifiedMode==='current'&&res<80;
            for(var x=Math.floor(b[0]*4);x<=Math.floor(b[2]*4);x++)for(var y=Math.floor(b[1]*4);y<=Math.floor(b[3]*4);y++)(unifiedBins.get(x+','+y)||[]).forEach(function(c){
                var row=unifiedRows.get(c.i);if(!row||c.lon<b[0]-.0125||c.lon>b[2]+.0125||c.lat<b[1]-.0125||c.lat>b[3]+.0125)return;
                // 위험 예측(accident)은 위험 4색, 혼잡도(지금 current=밀집도·미래 congestion=혼잡 예보)는 혼잡 4색 — 범례 막대와 같은 색(2026-10-15 조작부 시안).
                var cong=unifiedMode==='current'||unifiedMode==='congestion',colorKey=(cong?256:0)+Math.round(row[3]*255),style=fillStyles.get(colorKey);if(!style){var color=(cong&&w.RiskMarine.congestionColor?w.RiskMarine.congestionColor:w.RiskMarine.color)((colorKey%256)/255);style=new ol.style.Style({fill:new ol.style.Fill({color:rgba(color,.5)})});fillStyles.set(colorKey,style);}
                if(overview){
                    // 전국 보기에서는 동일 색상 다각형을 한 도형으로 묶어 수만 개 Feature를 만들지 않는다.
                    var polygon;if(c.geometry){polygon=read(c.geometry).getCoordinates();}else{var lo=ol.proj.fromLonLat([c.lon-.0125,c.lat-.0125]),hi=ol.proj.fromLonLat([c.lon+.0125,c.lat+.0125]);polygon=[[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]],[lo[0],lo[1]]]];}
                    if(!groups.has(colorKey))groups.set(colorKey,{polygons:[],style:style});groups.get(colorKey).polygons.push(polygon);
                }else{
                    var f=unifiedFeatures.get(c.i);if(!f){var g=c.geometry||{type:'Polygon',coordinates:[[[c.lon-.0125,c.lat-.0125],[c.lon+.0125,c.lat-.0125],[c.lon+.0125,c.lat+.0125],[c.lon-.0125,c.lat+.0125],[c.lon-.0125,c.lat-.0125]]]};f=new ol.Feature({geometry:read(g),kind:'marine',id:c.id});unifiedFeatures.set(c.i,f);}
                    f.setProperties({mode:unifiedMode,level:row[2],colorValue:row[3]},true);f.setStyle(style);features.push(f);wanted.add(c.i);
                }
                if(showNumbers){var number=new ol.Feature({geometry:new ol.geom.Point(ol.proj.fromLonLat([c.lon,c.lat])),id:c.id,count:row[1]});number.setStyle(function(feature,resolution){if(resolution>=80)return[];var text=String(feature.get('count')),ns=numberStyles.get(text);if(!ns){ns=new ol.style.Style({text:new ol.style.Text({text:text,font:'bold 12px sans-serif',fill:new ol.style.Fill({color:'#fff'}),stroke:new ol.style.Stroke({color:'#10223d',width:3})})});if(numberStyles.size>=256)numberStyles.clear();numberStyles.set(text,ns);}return ns;});numbers.push(number);}
            });
            groups.forEach(function(group){var f=new ol.Feature({geometry:new ol.geom.MultiPolygon(group.polygons),mode:unifiedMode});f.setStyle(group.style);features.push(f);});
            sources.marine.clear(true);sources.marine.addFeatures(features);sources.traffic.clear(true);sources.traffic.addFeatures(numbers);
            // 지도를 오래 이동해도 오래된 형상을 쌓지 않는다. 현재 화면의 형상은 유지한다.
            if(unifiedFeatures.size>8000)unifiedFeatures.forEach(function(f,i){if(!wanted.has(i))unifiedFeatures.delete(i);});
        }
        map.on('moveend',renderUnified);

        /** 현재 척수는 원본 GR4 격자의 숫자로 겹쳐 표시한다. 예: 21척, 실제 선박 위치 점 아님.
         * @param {object} frame - [i,count,density,trafficLevel] @returns {void}
         * [연계] ← RiskForecast.refresh / 공식 사고 면색과 혼잡 예보 테두리는 유지한다.
         */
        function drawCurrent(frame){sources.traffic.clear();if(frame.status&&frame.status.status!=='ok')return;var byIndex=new Map(trafficCells.map(function(c){return[c.i,c];}));(frame.cells||[]).forEach(function(v){var c=byIndex.get(v[0]);if(!c)return;var g=c.geometry||{type:'Polygon',coordinates:[[[c.lon-.0125,c.lat-.0125],[c.lon+.0125,c.lat-.0125],[c.lon+.0125,c.lat+.0125],[c.lon-.0125,c.lat+.0125],[c.lon-.0125,c.lat-.0125]]]};add('traffic',g,{kind:'traffic',id:c.id,count:v[1]},new ol.style.Style({stroke:new ol.style.Stroke({color:'rgba(255,255,255,.35)',width:.5}),fill:new ol.style.Fill({color:'rgba(0,0,0,0)'}),text:new ol.style.Text({text:String(v[1]),font:'bold 12px sans-serif',fill:new ol.style.Fill({color:'#fff'}),stroke:new ol.style.Stroke({color:'#10223d',width:3})})}));});}
        function drawCoast(frame) {
            sources.coast.clear();sources.points.clear();var centers=new Map();
            (frame.spots||[]).forEach(function (v) {
                var p=spots.find(function(p){return p.i===v[0];}); if(!p) return;
                var g=p.geometry || (p.cell?{type:'Polygon',coordinates:[p.cell]}:null);
                add('coast',g,{kind:'coast',id:p.id,score:v[1]},colorStyle(v[1],true));
                // 빈 면도 중심점은 남긴다. 같은 좌표는 한 점과 선택 목록으로 표시한다.
                var key=p.lon+','+p.lat,center=centers.get(key);
                if(center)center.get('ids').push(p.id);
                else {center=new ol.Feature({geometry:new ol.geom.Point(ol.proj.fromLonLat([p.lon,p.lat])),kind:'coast',id:p.id,ids:[p.id]});center.setStyle(new ol.style.Style({image:new ol.style.Circle({radius:4,fill:new ol.style.Fill({color:'#fff'}),stroke:new ol.style.Stroke({color:w.RiskFormat.col(v[1]),width:2})})}));sources.points.addFeature(center);centers.set(key,center);}
            });
        }
        /**
         * 기관이 제공한 사고 단계만 원본 격자 면색으로 표시한다.
         * 예: [0,0.0013,'경계']는 빨간 면이며 위험지수를 확률로 바꾸지 않는다.
         * @param {Object} frame - cells는 [i,riskIndex,officialLevel] 배열
         * @returns {void} [연계] RiskForecast.refresh → 공식 사고 경계 표
         */
        function drawAccident(frame) {
            sources.accident.clear();
            var palette={'낮음':'rgba(47,179,107,.42)','보통':'rgba(242,194,48,.48)','주의':'rgba(251,146,60,.55)','경계':'rgba(224,50,44,.62)'};
            (frame.cells||[]).forEach(function(v){var c=accidentCells.find(function(c){return c.i===v[0];});if(!c||!palette[v[2]])return;add('accident',c.geometry,{kind:'accident',id:c.id,riskIndex:v[1],level:v[2]},new ol.style.Style({fill:new ol.style.Fill({color:palette[v[2]]}),stroke:new ol.style.Stroke({color:'rgba(240,248,255,.24)',width:.6})}));});
        }
        /**
         * 혼잡도 공식 단계는 원래 GR4 격자의 테두리와 점으로 사고 면 위에 겹친다.
         * 예: 매우높음은 자홍 점 9개이며 점은 실제 선박 위치나 척수가 아니다.
         * @param {Object} frame - cells는 [i,legacyScore,ci,officialLevel] 배열
         * @returns {void} [연계] RiskForecast.refresh → 기존 혼잡 위치 표
         */
        function drawSea(frame) {
            sources.sea.clear();
            var levels=['낮음','보통','높음','매우높음'],colors=['#b8c5da','#74b9ff','#d47cff','#ff5fe3'];
            (frame.cells||[]).forEach(function(v){
                var c=cells.find(function(c){return c.i===v[0];});if(!c||!Number.isFinite(v[2]))return;
                var level=levels.indexOf(v[3]),color=level<0?'#b8c5da':colors[level];
                var half=.0125,g=c.geometry||{type:'Polygon',coordinates:[[[c.lon-half,c.lat-half],[c.lon+half,c.lat-half],[c.lon+half,c.lat+half],[c.lon-half,c.lat+half],[c.lon-half,c.lat-half]]]};
                var outline=new ol.style.Style({stroke:new ol.style.Stroke({color:color,width:level>=2?1.3:.8,lineDash:[3,3]}),fill:new ol.style.Fill({color:'rgba(0,0,0,0)'})});
                var f=add('sea',g,{kind:'sea',id:c.id,ci:v[2],level:v[3]},outline),count=level<0?0:[1,2,5,9][level],styles=[outline];
                for(var k=0;k<count;k++){var lon=c.lon+(((k*7)%17)/16-.5)*.019,lat=c.lat+(((k*11)%17)/16-.5)*.019;styles.push(new ol.style.Style({geometry:new ol.geom.Point(ol.proj.fromLonLat([lon,lat])),image:new ol.style.Circle({radius:1.65,fill:new ol.style.Fill({color:color}),stroke:new ol.style.Stroke({color:'#12213b',width:.7})})}));}
                f.setStyle(styles);
            });
        }
        function setSelection(kind,id) {
            var changed=!selection||selection.kind!==kind||selection.id!==id;
            selection=kind?{kind:kind,id:id}:null; sources.selection.clear(); if(changed||!selection)sources.hazard.clear();
            if(!selection)return;
            var f=sources[kind]&&sources[kind].getFeatures().find(function(f){return f.get('id')===id;});
            if(kind==='marine'&&!f){var c=unifiedCells.find(function(c){return c.id===id;});if(c){var g=c.geometry||{type:'Polygon',coordinates:[[[c.lon-.0125,c.lat-.0125],[c.lon+.0125,c.lat-.0125],[c.lon+.0125,c.lat+.0125],[c.lon-.0125,c.lat+.0125],[c.lon-.0125,c.lat-.0125]]]};f=new ol.Feature(read(g));}}
            if(f){var copy=f.clone();copy.setStyle(new ol.style.Style({stroke:new ol.style.Stroke({color:'#fff',width:kind==='sea'?2:2.5})}));sources.selection.addFeature(copy);}
            if(kind==='coast'){var p=spots.find(function(p){return p.id===id;});if(p){var center=new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat([p.lon,p.lat])));center.setStyle(new ol.style.Style({image:new ol.style.Circle({radius:6,stroke:new ol.style.Stroke({color:'#fff',width:2.5})})}));sources.selection.addFeature(center);}}
        }
        /**
         * 선택한 위험구역을 그리고 시트에 가려지지 않은 지도 영역의 가운데에 오도록 이동한다.
         * 예: showHazards(fc,[30,40,330,40]) — 아래 330px는 시트가 가린 높이
         * @param {Object} fc - GeoJSON FeatureCollection @param {number[]} [pad] - [위,오른쪽,아래,왼쪽] 여백(px)
         * @returns {void} [연계] RiskForecast.hazard → visiblePadding() / 해상 관할 해역 이동과 같은 여백을 쓴다
         */
        function showHazards(fc,pad) {
            sources.hazard.clear(); var features=geo.readFeatures(fc,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()});
            features.forEach(function(f){f.setStyle(new ol.style.Style({fill:new ol.style.Fill({color:'rgba(255,143,31,.55)'}),stroke:new ol.style.Stroke({color:'#ffd740',width:2})}));});sources.hazard.addFeatures(features);
            if(features.length)map.getView().fit(sources.hazard.getExtent(),{padding:pad||[55,55,Math.min(map.getSize()[1]*0.5,300),55],duration:250,maxZoom:16});
        }
        function setActive(state,enabled) {
            active=state;visible=enabled; layers.coast.setVisible(enabled&&state.coast);layers.points.setVisible(enabled&&state.coast); layers.sea.setVisible(enabled&&state.sea);layers.accident.setVisible(enabled&&state.sea);layers.traffic.setVisible(enabled&&state.sea);
            if(unified){layers.sea.setVisible(false);layers.accident.setVisible(false);layers.traffic.setVisible(enabled&&state.sea&&unifiedMode==='current');}layers.marine.setVisible(enabled&&state.sea&&unified);
            ['shore','selection','hazard'].forEach(function(k){layers[k].setVisible(enabled&&(state.coast||state.sea));});
        }
        function hit(evt) {
            if(active.coast){var point=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers.points?f:null;},{layerFilter:function(l){return l===layers.points;},hitTolerance:4});if(point){var ids=point.get('ids');select('coast',ids.length>1?ids:ids[0]);return true;}}
            // 그림에서 잘린 쪽은 클릭도 막는다. 겹친 육지와 섬은 합집합으로 판정한다.
            var landHit=land.some(function(p){var geom=new ol.geom.Polygon(p.rings);return geom.intersectsCoordinate(evt.coordinate);});
            var wanted=landHit?'coast':'sea'; if(!active[wanted])return false;
            if(wanted==='sea'&&unified){var p=ol.proj.toLonLat(evt.coordinate),chosen=null;for(var x=Math.floor((p[0]-.0125)*4);x<=Math.floor((p[0]+.0125)*4);x++)for(var y=Math.floor((p[1]-.0125)*4);y<=Math.floor((p[1]+.0125)*4);y++)(unifiedBins.get(x+','+y)||[]).forEach(function(c){if(!chosen&&unifiedRows.has(c.i)&&Math.abs(c.lon-p[0])<=.0125&&Math.abs(c.lat-p[1])<=.0125&&(!c.geometry||read(c.geometry).intersectsCoordinate(evt.coordinate)))chosen=c;});if(chosen){select('marine',chosen.id,{lon:p[0],lat:p[1]});return true;}return false;}
            if(wanted==='sea'){var current=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers.traffic?f:null;},{layerFilter:function(l){return l===layers.traffic;},hitTolerance:0});if(current){var currentPoint=ol.proj.toLonLat(evt.coordinate);select('traffic',current.get('id'),{lon:currentPoint[0],lat:currentPoint[1]});return true;}}
            if(wanted==='sea'){var accident=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers.accident?f:null;},{layerFilter:function(l){return l===layers.accident;},hitTolerance:0});if(accident){var lonLat=ol.proj.toLonLat(evt.coordinate);select('accident',accident.get('id'),{lon:lonLat[0],lat:lonLat[1]});return true;}}
            var feature=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers[wanted]?f:null;},{layerFilter:function(l){return l===layers[wanted];},hitTolerance:2});
            if(feature){select(wanted,feature.get('id'));return true;}return false;
        }
        function destroy(){disposed=true;map.un('moveend',renderUnified);unifiedFeatures.clear();smoothCanvas=null;Object.keys(layers).forEach(function(k){map.removeLayer(layers[k]);});}
        return {boundaries:boundaries,setTables:setTables,drawCoast:drawCoast,drawSea:drawSea,drawAccident:drawAccident,drawCurrent:drawCurrent,drawUnified:drawUnified,setSelection:setSelection,showHazards:showHazards,setActive:setActive,hit:hit,destroy:destroy};
    }
    w.RiskMapLayer={create:create};
})(window);
