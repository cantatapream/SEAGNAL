/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_map_layer.js
 * 역할  : 해상 격자·연안 분할 원·특보 테두리와 선택 구역을 OpenLayers에 그린다.
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
     * @param {ol.Map} map - 앱 지도; select(kind,id)는 선택 콜백(동일좌표는 id 배열)
     * @returns {Object} 경계·표·프레임·선택·가시성·정리 API
     * [연계] RiskForecast → OpenLayers
     */
    function create(map, select) {
        var geo=new ol.format.GeoJSON(), sources={}, layers={}, spots=[], cells=[], active={coast:true,sea:false}, selection=null, zones={}, land=[], maskKey='', maskCanvas=null;
        ['sea','coast','borders','hazard','selection','shore','points'].forEach(function (k,i) {
            sources[k]=new ol.source.Vector();
            layers[k]=new ol.layer.Vector({source:sources[k], zIndex:130+i, className:'rf-'+k+'-canvas'});
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
        layers.sea.on('postrender',function (e) { mask(e,'sea'); });
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
        async function boundaries(api) {
            zones={};land=[];sources.shore.clear();maskKey='';
            var outcomes=await Promise.allSettled([Promise.all(['/api/warn-zones','/api/warn-zones-sub'].map(function(url){return fetch(url).then(function(r){if(!r.ok)throw Error('특보 경계 HTTP '+r.status);return r.json();});})).then(function(parts){return {features:parts.reduce(function(all,p){return all.concat(p.features||[]);},[])};}),fetch('/api/ocean/land-mask').then(function(r){if(!r.ok)throw Error('해안선 HTTP '+r.status);return r.json();}),api.get('islands')]);
            if (outcomes[0].status==='fulfilled') (outcomes[0].value.features||[]).forEach(function(f){ zones[f.properties.name]=f.geometry; });
            if (outcomes[1].status==='fulfilled') (outcomes[1].value.rings||[]).forEach(function(r){landGeometry({type:'Polygon',coordinates:[r]});});
            if (outcomes[2].status==='fulfilled') (outcomes[2].value.features||[]).forEach(function(f){landGeometry(f.geometry,true);});
            var failed=outcomes.filter(function(x){return x.status==='rejected';});
            if(failed.length) throw new Error(failed.map(function(x){return x.reason.message;}).join(' / '));
        }
        function setTables(c,s) { cells=c.cells||[]; spots=s.spots||[]; }
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
        function drawSea(frame) {
            sources.sea.clear();
            (frame.cells||[]).forEach(function (v) {
                var c=cells.find(function(c){return c.i===v[0];}); if(!c)return;
                var clickable=Number(v[1])>0 || v[2]>=1;
                if(!clickable)return;
                var half=0.0125, g=c.geometry||{type:'Polygon',coordinates:[[[c.lon-half,c.lat-half],[c.lon+half,c.lat-half],[c.lon+half,c.lat+half],[c.lon-half,c.lat+half],[c.lon-half,c.lat-half]]]};
                var f=add('sea',g,{kind:'sea',id:c.id,score:v[1],ci:v[2]},colorStyle(v[1],false));
                var count=v[2]==null||v[2]<1?0:v[2]<10?2:v[2]<20?5:9, styles=[colorStyle(v[1],false)];
                for(var k=0;k<count;k++) {
                    var lon=c.lon+( ((k*7)%17)/16-0.5)*0.019, lat=c.lat+( ((k*11)%17)/16-0.5)*0.019;
                    styles.push(new ol.style.Style({geometry:new ol.geom.Point(ol.proj.fromLonLat([lon,lat])),image:new ol.style.Circle({radius:1.25,fill:new ol.style.Fill({color:'rgba(255,255,255,.85)'})})}));
                }
                f.setStyle(styles);
            });
        }
        function drawBorders(frames) {
            sources.borders.clear(); var merged={};
            frames.forEach(function(frame){(frame.borders||[]).forEach(function(b){var rank={pre:0,adv:1,wrn:2};if(!merged[b.zone]||rank[b.color]>rank[merged[b.zone].color])merged[b.zone]=b;});});
            Object.keys(merged).sort(function(a,b){return merged[a].color==='wrn'?1:-1;}).forEach(function(k){var b=merged[k];add('borders',b.geometry||zones[k],{},new ol.style.Style({stroke:new ol.style.Stroke({color:{pre:'#ffd740',adv:'#ff8f1f',wrn:'#ff3b30'}[b.color]||'#ffd740',width:3.5})}));});
            frames.forEach(function(frame){(frame.day3Dashed||[]).forEach(function(k){add('borders',typeof k==='object'?k.geometry:zones[k],{},new ol.style.Style({stroke:new ol.style.Stroke({color:'#ffd740',width:3.5,lineDash:[6,5]})}));});});
        }
        function setSelection(kind,id) {
            var changed=!selection||selection.kind!==kind||selection.id!==id;
            selection=kind?{kind:kind,id:id}:null; sources.selection.clear(); if(changed||!selection)sources.hazard.clear();
            if(!selection)return;
            var f=sources[kind].getFeatures().find(function(f){return f.get('id')===id;});
            if(f){var copy=f.clone();copy.setStyle(new ol.style.Style({stroke:new ol.style.Stroke({color:'#fff',width:kind==='sea'?2:2.5})}));sources.selection.addFeature(copy);}
            if(kind==='coast'){var p=spots.find(function(p){return p.id===id;});if(p){var center=new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat([p.lon,p.lat])));center.setStyle(new ol.style.Style({image:new ol.style.Circle({radius:6,stroke:new ol.style.Stroke({color:'#fff',width:2.5})})}));sources.selection.addFeature(center);}}
        }
        function showHazards(fc) {
            sources.hazard.clear(); var features=geo.readFeatures(fc,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()});
            features.forEach(function(f){f.setStyle(new ol.style.Style({fill:new ol.style.Fill({color:'rgba(255,143,31,.55)'}),stroke:new ol.style.Stroke({color:'#ffd740',width:2})}));});sources.hazard.addFeatures(features);
            if(features.length)map.getView().fit(sources.hazard.getExtent(),{padding:[55,55,Math.min(map.getSize()[1]*0.5,300),55],duration:250,maxZoom:16});
        }
        function setActive(state,enabled) {
            active=state; layers.coast.setVisible(enabled&&state.coast);layers.points.setVisible(enabled&&state.coast); layers.sea.setVisible(enabled&&state.sea);
            ['borders','shore','selection','hazard'].forEach(function(k){layers[k].setVisible(enabled&&(state.coast||state.sea));});
        }
        function hit(evt) {
            if(active.coast){var point=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers.points?f:null;},{layerFilter:function(l){return l===layers.points;},hitTolerance:4});if(point){var ids=point.get('ids');select('coast',ids.length>1?ids:ids[0]);return true;}}
            // 그림에서 잘린 쪽은 클릭도 막는다. 겹친 육지와 섬은 합집합으로 판정한다.
            var landHit=land.some(function(p){var geom=new ol.geom.Polygon(p.rings);return geom.intersectsCoordinate(evt.coordinate);});
            var wanted=landHit?'coast':'sea'; if(!active[wanted])return false;
            var feature=map.forEachFeatureAtPixel(evt.pixel,function(f,l){return l===layers[wanted]?f:null;},{layerFilter:function(l){return l===layers[wanted];},hitTolerance:2});
            if(feature){select(wanted,feature.get('id'));return true;}return false;
        }
        function destroy(){Object.keys(layers).forEach(function(k){map.removeLayer(layers[k]);});}
        return {boundaries:boundaries,setTables:setTables,drawCoast:drawCoast,drawSea:drawSea,drawBorders:drawBorders,setSelection:setSelection,showHazards:showHazards,setActive:setActive,hit:hit,destroy:destroy};
    }
    w.RiskMapLayer={create:create};
})(window);
