var baseMap;

//베이스맵
$(document).ready(function(){
	 initMap();
});
function initMap(){
	//뷰(좌표 및 줌 설정)
	proj4.defs("EPSG:3857", "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs");
	ol.proj.proj4.register(proj4);
	var proj3857 = ol.proj.get('EPSG:3857');
	var resolutions = [156543.03, 78271.52, 39135.76, 19567.88, 9783.94, 4891.96981025128125, 2445.98490512, 1222.99245256, 611.49622628, 305.74811314, 152.87405657, 76.43702828, 38.21851414, 19.10925707, 9.55462853, 4.77731426, 2.38865713, 1.19433, 0.5972, 0.298583];
	var tileExtent = [-20037508.3427892439067364, -20037508.3427892550826073, 20037508.3427892439067364, 20037508.3427892439067364];
	var initExtent = [18321.13581588259, 1424794.937360047, 1894734.6292558827, 2214452.282516047];
	var initBasemapType = "서비스명" 
	var minZoomLevel = 0;
	var maxZoomLevel = 10;
	var feature = null;
	var view =  new ol.View({
				projection: proj3857,
				extent: tileExtent,
				center: [14177553.107181, 4308348.8448386 ],
				zoom: 1,
				minZoom: minZoomLevel,
				maxZoom: maxZoomLevel,
				maxResolution: 1954.597389
	});


	baseMap = new ol.Map({
		target: 'baseMap', 
		layers: [ 
			new ol.layer.Tile({
				division: 'TILE',
				layerName: 'BASEMAP',
				visible: true,
				source: new ol.source.XYZ({
					projection: proj3857, 
					tileSize: 256,
					minZoom: minZoomLevel,
					maxZoom: maxZoomLevel,
					tileGrid: new ol.tilegrid.TileGrid({ 
						extent: ol.proj.get('EPSG:3857').getExtent(), 
						origin: ol.extent.getTopLeft(ol.proj.get('EPSG:3857').getExtent()), 
						resolutions: resolutions
					}),
					serverType: "mapserver",
					tileUrlFunction: function(tileCoord, pixelRatio, projection) {
						if (tileCoord == null) return undefined;
	
						var z = tileCoord[0];
						var x = tileCoord[1];
						var y = -tileCoord[2] - 1; 
	
						var basemapPath = _vectorMapUrl;
						basemapPath += "&z=" + z;
						basemapPath += "&x=" + x;
						basemapPath += "&y=" + y;
	
						return basemapPath;
					}
				})
			})
		],
		controls: ol.control.defaults({
			attributionOptions: ({
				collapsible: false
			})
		}),
		view: view
	});
}

//베이스맵 요청 시 사용
function fn_fillzero(n, digits) {
	var zero = '';
	n = n.toString();
	if (digits > n.length) {
		for (var i = 0; digits - n.length > i; i++) {
			zero += '0';
		}
	}
	return zero + n;
}


