function transCoord(){
    this._lonDo = null;
    this._lonBun = null;
    this._lonCho = null;
    this._latDo= null;
    this._latBun= null;
    this._latCho= null;
    this._value = null; //유향 또는 유속값
	this._extent ={};
	
};
transCoord.prototype.setExtent=function(extent){
	
	var tran, coord;

	//좌측하단
	var min = new ol.geom.Point([extent[0], extent[1]]);
	tran = min.transform('EPSG:5179','EPSG:4326');
	coord = tran.getCoordinates();
	
	this.setLonLat(coord[0],coord[1]);
	this._extent['minlon'] = this._lonDo+"^"+this._lonBun+"^"+this._lonCho;
	this._extent['minlat'] = this._latDo+"^"+this._latBun+"^"+this._latCho;
	
	//우측상단
	var max = new ol.geom.Point([extent[2], extent[3]]);
	tran = max.transform('EPSG:5179','EPSG:4326');
	coord = tran.getCoordinates();
	
	this.setLonLat(coord[0],coord[1]);
	this._extent['maxlon'] = this._lonDo+"^"+this._lonBun+"^"+this._lonCho;
	this._extent['maxlat'] = this._latDo+"^"+this._latBun+"^"+this._latCho;	
}

transCoord.prototype.setLonLat=function(sLon,sLat){
    if(sLon.length > 11 || typeof sLon == "number"){sLon = parseFloat(sLon).toFixed(6);}
    
    if(sLat.length > 10 || typeof sLat == "number"){sLat = parseFloat(sLat).toFixed(6);}
    
    //경도 계산
    var tmpLon1 = (sLon - sLon.toString().split(".")[0])*60;   
    var tmpLon2 = (tmpLon1 - tmpLon1.toString().split(".")[0])*60;
    this._lonDo = sLon.toString().split(".")[0];
    this._lonBun = tmpLon1.toString().split(".")[0];
    this._lonCho = parseFloat(tmpLon2).toFixed(0);
    
    if(this._lonCho == 60){
        this._lonCho = "00";
        this._lonBun = parseInt(this._lonBun) + 1;
    }else if(this._lonCho <10){
    	this._lonCho = "0"+this._lonCho;
    }else if(this._lonCho == 0){
    	this._lonCho = "00";
    }
    
    if(this._lonBun == 60){
        this._lonBun = "00";
        this._lonDo = parseInt(this._lonDo) +1;
    }else if(this._lonBun <10){
    	this._lonBun = "0"+this._lonBun;
    }else if(this._lonBun == 0){
    	this._lonBun = "00";
    }


    //위도 계산
    var tmpLat1 = (sLat - sLat.toString().split(".")[0])*60;   
    var tmpLat2 = (tmpLat1 - tmpLat1.toString().split(".")[0])*60;

    this._latDo = sLat.toString().split(".")[0];
    this._latBun = tmpLat1.toString().split(".")[0];
    this._latCho = parseFloat(tmpLat2).toFixed(0); 
    
    if(this._latCho == 60){
        this._latCho = "00";
        this._latBun = parseInt(this._latBun) + 1;
    }else if(this._latCho <10){
    	this._latCho = "0"+this._latCho;
    }else if(this._latCho == 0){
    	this._latCho = "00";
    }
    
    if(this._latBun == 60){
        this._latBun = "00";
        this._latDo = parseInt(this._latDo) +1;
    }else if(this._latBun <10){
    	this._latBun = "0"+this._latBun;
    }else if(this._latBun == 0){
    	this._latBun = "00";
    }
};
transCoord.prototype.toString=function(){
  return "경도:"+this._lonDo+"˚ "+this._lonBun+"´ "+this._lonCho+"˝"+" 위도:"+this._latDo+"˚ "+this._lonBun+"´ "+this._lonCho+"˝";  
};
transCoord.prototype.getLonDo=function(){
    return this._lonDo.toString();
};
transCoord.prototype.getLonBun=function(){
    return this._lonBun.toString();
};
transCoord.prototype.getLonCho=function(){
    return this._lonCho.toString();
};
transCoord.prototype.getLatDo=function(){
    return this._latDo.toString();
};
transCoord.prototype.getLatBun=function(){
    return this._latBun.toString();
};
transCoord.prototype.getLatCho=function(){
    return this._latCho.toString();
};

transCoord.prototype.getLonDMS=function(){
    return this._lonDo+"° "+this._lonBun+"' "+this._lonCho+"\"";
};

transCoord.prototype.getLatDMS=function(){
    return this._latDo+"° "+this._latBun+"' "+this._latCho+"\"";
};

transCoord.prototype.getUnit=function(OriginUnit, TargetUnit, value){
	var result = value;

	if (value == "-" || isNaN(value))
		return "-";

	if (OriginUnit == "cm/s") {
		if (TargetUnit == "m/s")
			result = (value * 0.01);
		else if (TargetUnit == "kn")
			result = (value * 0.01 * 1.9438);
	} else if (OriginUnit == "m/s") {
		if (TargetUnit == "cm/s")
			result = (value * 100);
		else if (TargetUnit == "kn")
			result = (value * 1.9438);
	} else if (OriginUnit == "kn") {
		if (TargetUnit == "m/s")
			result = (value * 0.5144);
		else if (TargetUnit == "cm/s")
			result = (value * 51.444);
	}

	return (result * 1.0).toFixed(2);
};

