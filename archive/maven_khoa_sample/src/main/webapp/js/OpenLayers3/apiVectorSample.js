var baseMap;
		
//베이스맵
$(document).ready(function(){
	 initMap();
});
function initMap(){
	//뷰(좌표 및 줌 설정)
	proj4.defs("EPSG:5179", "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
	ol.proj.proj4.register(proj4);
	var proj5179 = ol.proj.get('EPSG:5179');
	var resolutions = [125094.232896, 62547.116448, 31273.558224, 15636.779112, 7818.389556, 3909.194778, 1954.597389, 977.2986945, 488.6493472, 244.3246736, 122.1623368, 61.08116841, 30.5405842, 15.2702921, 7.635146051, 3.817573025, 1.908786513];
	var tileExtent = [-200000.0, -28024123.62, 31824123.62, 4000000.0];
	var initExtent = [18321.13581588259, 1424794.937360047, 1894734.6292558827, 2214452.282516047];
	var initBasemapType = "서비스명"
	var minZoomLevel = 0;
	var maxZoomLevel = 10;
	var feature = null;
	var view =  new ol.View({
				projection: proj5179,
				extent: tileExtent,
				center: [ 956498.5710969, 1819967.0629328 ],
				zoom: 1,
				minZoom: minZoomLevel,
				maxZoom: maxZoomLevel,
				maxResolution: 1954.597389
	});

	//베이스맵 설정
	baseMap = new ol.Map({
		target: 'baseMap',
		layers: [
			new ol.layer.Tile({
				division : 'TILE',
				layerName: 'BASEMAP',
				visible: true,
				
				source: new ol.source.TileWMS({
				matrixSet: 'EPSG:5179',
				projection: 'EPSG:5179',		
				hidpi: false,
				tileGrid: new ol.tilegrid.TileGrid({
						extent: tileExtent, 
						origin: [ tileExtent[0], tileExtent[1] ],
						resolutions: resolutions
					}),
				url: _vectorMapUrl,
				serverType: "mapserver"
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


