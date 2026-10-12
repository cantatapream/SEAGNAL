/**
 * 파일명: local_server/services/marine_congestion_codec.js
 * 역할  : 혼잡 예보의 반복 ID·좌표·날짜 문자열을 공통 표와 작은 수치 배열로 저장한다.
 * [연계] risk_collector_io·sea_traffic_collector → risk_store·marine_fusion 기존 행 계약.
 * [로드 순서] io에서 필요할 때 require. 화면 API의 원래 필드는 유지한다.
 */
'use strict';
const PACK=Symbol('packed congestion');
const positions=new WeakMap();
/** 기존 행을 공통 표에 등록한다. 예: 같은 격자의 좌표는 48번 쓰지 않음.
 * @param {object} data - 저장 payload @param {array} rows - 정규화 행 @returns {array} 작은 행
 * [연계] ← decode setter/pack / 생성시각도 공통 표로 등록한다.
 */
function values(data,rows){const ids=new Map(data.cells.map((c,i)=>[c[0],i])),created=new Map(data.created.map((c,i)=>[c,i]));return rows.map(r=>{if(!ids.has(r.gridId)){ids.set(r.gridId,data.cells.length);data.cells.push([r.gridId,r.latitude,r.longitude]);}const at=r.fcstCreateDateTime||null;if(!created.has(at)){created.set(at,data.created.length);data.created.push(at);}return[ids.get(r.gridId),r.congestionIndex,r.congestionLevel??null,created.get(at)];});}
/** 원문 또는 지연 해석 객체를 압축 가능한 payload로 만든다. 예: codec2 공통 cells·created.
 * @param {object} d - 기존 수집본 @returns {object} 저장본
 * [연계] ← io.write / 센티널·예보 아닌 파일은 변경하지 않는다.
 */
function pack(d){if(d?.[PACK])return{...d[PACK],date:d.date,collectedAt:d.collectedAt};if(!d?.frames)return d;const p={codec:2,date:d.date,collectedAt:d.collectedAt,cells:[],created:[],frames:{}};for(const key of Object.keys(d.frames))p.frames[key]=values(p,d.frames[key]);return p;}
/** 한 시각씩 기존 행 형태로 읽는다. 예: 최대8시각만 행 객체로 유지.
 * @param {object} d - codec2 또는 기존 저장본 @returns {object} 호환 읽기 객체
 * [연계] ← io.read / 오래된 저장파일도 계속 읽는다.
 */
function decode(d){if(d?.codec!==2)return d;if(!Array.isArray(d.cells)||!Array.isArray(d.created)||!d.frames)throw Error('invalid response');const cache=new Map(),result={date:d.date,collectedAt:d.collectedAt};
    result.frames=new Proxy({}, {ownKeys:()=>Object.keys(d.frames),getOwnPropertyDescriptor:(target,key)=>Object.hasOwn(d.frames,key)?{enumerable:true,configurable:true}:undefined,has:(target,key)=>Object.hasOwn(d.frames,key),get:(target,key)=>{if(typeof key!=='string'||!Object.hasOwn(d.frames,key))return undefined;if(cache.has(key))return cache.get(key);const rows=d.frames[key].map(r=>{const c=d.cells[r[0]];return{gridId:c[0],latitude:c[1],longitude:c[2],fcstDate:key.slice(0,8),fcstTime:key.slice(8),fcstCreateDateTime:d.created[r[3]],congestionIndex:r[1],congestionLevel:r[2]===null?undefined:r[2]};});cache.set(key,rows);while(cache.size>8)cache.delete(cache.keys().next().value);return rows;},set:(target,key,rows)=>{d.frames[key]=values(d,rows);cache.delete(key);return true;}});
    Object.defineProperty(result,PACK,{value:d});return result;
}
/** 한 격자의 한 시각 행만 읽는다. 예: 관할 브리핑이 모든 프레임을 객체로 풀지 않음.
 * @param {object} d - 지연 저장본 @param {string} key - 예보시각 @param {string} id - 격자
 * @returns {object|null} 기존 행 @param {Map} ids - 선택적 ID 인덱스
 * [연계] ← marine_fusion / 수치 위치표는 Uint32Array로 보관한다.
 */
function rowAt(d,key,id,ids){const p=d?.[PACK];if(!p)return d?.frames?.[key]?.find(r=>r.gridId===id)||null;const i=ids?ids.get(id):p.cells.findIndex(c=>c[0]===id),rows=p.frames[key];if(i===undefined||i<0||!rows)return null;if(!positions.has(rows)){const a=new Uint32Array(p.cells.length);a.fill(0xffffffff);rows.forEach((r,j)=>a[r[0]]=j);positions.set(rows,a);}const at=positions.get(rows)[i];if(at===0xffffffff)return null;const r=rows[at],c=p.cells[i];return{gridId:id,latitude:c[1],longitude:c[2],fcstDate:key.slice(0,8),fcstTime:key.slice(8),fcstCreateDateTime:p.created[r[3]],congestionIndex:r[1],congestionLevel:r[2]};}
/** 공통 격자 ID 인덱스를 한 번 만든다. 예: codec2는 전체 프레임 디코딩 불필요.
 * @param {object} d - 저장본 @returns {Map|null} 격자 인덱스
 * [연계] ← marine_fusion / 현재 요청끼리 WeakMap으로 공유한다.
 */
function cellIds(d){return d?.[PACK]?new Map(d[PACK].cells.map((c,i)=>[c[0],i])):null;}
module.exports={pack,decode,rowAt,cellIds};
