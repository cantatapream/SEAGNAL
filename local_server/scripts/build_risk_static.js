/**
 * 파일명: local_server/scripts/build_risk_static.js
 * 역할  : 위험예측 정적 표를 EPSG:5179에서 재현하는 개발용 빌드를 실행한다.
 * [연계] build_risk_static.py → config/coastal_safety/risk_spots.json
 * [로드 순서] 개발 CLI 전용 · 운영 서버에서는 실행하지 않는다.
 */
'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
const fs=require('fs'),vm=require('vm');
const tide=fs.readFileSync(path.join(__dirname,'../../client/tide.js'),'utf8');
const source=tide.match(/const TIDE_REFERENCE_STATIONS\s*=\s*(\[.*?\]);/s);
if(!source)throw new Error('TIDE_REFERENCE_STATIONS source missing');
const references=vm.runInNewContext(source[1],{}, {timeout:1000});
// 개발 요구: Python 3 + shapely>=2 + pyproj. 별도 Python 설치 경로도 PYTHONPATH로 전달한다.
const proc=spawnSync(process.env.RISK_PYTHON||'python3',[path.join(__dirname,'build_risk_static.py'),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,RISK_TIDE_REFERENCES_JSON:JSON.stringify(references)}});
if(proc.error){console.error(proc.error.message);process.exit(1);}process.exit(proc.status??1);
