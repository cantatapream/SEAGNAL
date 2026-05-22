/**
 * ============================================================================
 * 파일명: services/freshness.js
 * 역할: 캐시 데이터의 "신선도(얼마나 최신인지)" 를 검사하고
 *       응답 헤더에 메타정보를 부착하며,
 *       묵었다고 판단되면 백그라운드로 재수집을 트리거하는 모듈
 * ============================================================================
 *
 * [왜 필요한가]
 * 서버는 디스크 또는 메모리에 캐싱된 데이터를 응답으로 내보낸다.
 * 그러나 외부 API 장애·머신 재시작 등으로 캐시가 갱신되지 않은 채
 * 오래된 데이터가 그대로 응답될 수 있다. 이 모듈은:
 *   1) 데이터마다 정해진 "허용 묵음 시간(maxAgeMs)" 안에 있는지 검사
 *   2) 응답 헤더에 마지막 갱신 시각·신선도 메타를 자동 부착
 *   3) 묵었다면 백그라운드로 새 데이터 수집을 트리거 (사용자는 안 기다림)
 * 하여 묵은 데이터가 모르는 사이에 서비스되는 위험을 줄인다.
 *
 * [응답 헤더 표준]
 *   X-Data-Updated-At    ISO8601 형식의 마지막 수집 시각 (UTC)
 *   X-Data-Age-Seconds   현재까지 경과한 초 (정수)
 *   X-Data-Fresh         "true" | "false"
 *   ※ 응답 body 형식은 변경하지 않으므로 기존 클라이언트와 호환됨.
 *
 * [연계 파일]
 *   - services/cache_manager.js     → dataCache.lastUpdate[key] (mtime) 사용
 *   - scheduler.js                  → collectBuoys / collectMarineBuoys 등 재수집 함수
 *   - weather_alerts_crawler.js     → 특보 재수집 (run)
 *   - marine_forecast_processor.js  → 해상기상전망 재수집 (collectMarineForecasts)
 *   - routes/weather.js             → 응답에 헤더 부착 + 재수집 트리거
 *   - routes/cctv_seafog.js         → 자체 메모리 캐시이므로 registerSource 로 등록
 *
 * [초보자 안내]
 *   "신선도(freshness)" 란 데이터가 마지막으로 갱신된 시각으로부터
 *   현재까지 얼마나 시간이 흘렀는지를 의미합니다. 예를 들어 1분 주기로
 *   갱신되어야 할 특보 데이터가 30분 전에 갱신되었다면, 이는 stale(묵은)
 *   상태이므로 새 데이터를 가져오는 작업을 트리거해야 합니다.
 *   사용자에게는 일단 묵은 데이터라도 즉시 응답해주고(기다리지 않음),
 *   백그라운드로 새 데이터를 받아 다음 요청부터는 신선한 데이터가
 *   나가도록 하는 패턴(stale-while-revalidate)을 사용합니다.
 * ============================================================================
 */

'use strict';

// cache_manager 에서 mtime 정보를 읽어온다.
// require 시점에 cache_manager 의 setInterval(refreshCache, 5000) 이 이미 동작 중이므로
// dataCache.lastUpdate[key] 는 가장 최근 파일 mtime 값을 가지고 있다.
const cacheManager = require('./cache_manager');

// ============================================================================
// 1. 신선도 정책 (POLICY)
// ============================================================================
// 각 데이터 종류별로 다음 3가지를 정의한다:
//   - maxAgeMs:     이 시간을 넘으면 "묵음(stale)" 으로 판정 (밀리초)
//   - getUpdatedAt: 마지막 갱신 시각(ms epoch) 을 반환하는 함수
//   - refreshFn:    백그라운드로 새 데이터를 가져올 때 호출할 함수 (lazy require)
//
// [maxAgeMs 산정 근거]
//   각 데이터의 실제 수집 주기 × 약 1.5배.
//   (수집 한 번 놓쳐도 다음 주기 안에는 들어오도록 안전 마진 확보)
//
// [refreshFn 의 lazy require 패턴]
//   require('../scheduler') 등을 함수 내부에서 호출함으로써
//   freshness 모듈이 require 되는 시점에는 외부 모듈이 로드되지 않음.
//   이는 require 체인의 사이드 이펙트(예: scheduler 의 setInterval 즉시 시작)가
//   freshness 를 require 하는 것만으로 발생하지 않도록 보호한다.
const POLICY = {
    // 특보 — 1분 주기 수집. 5분 안쪽이면 신선.
    warnings: {
        maxAgeMs: 5 * 60 * 1000,
        getUpdatedAt: () => cacheManager.dataCache.lastUpdate.warnings,
        refreshFn: () => require('../marine_warning_crawler').run()
    },

    // 부이 (sea_obs.php, J타입 baseline) — 30분 주기 수집. 60분 안쪽이면 신선.
    buoys: {
        maxAgeMs: 60 * 60 * 1000,
        getUpdatedAt: () => cacheManager.dataCache.lastUpdate.buoys,
        refreshFn: () => require('../scheduler').collectBuoys()
    },

    // 해양기상부이 B타입 (marine.kma.go.kr) — 60분 주기. 90분 안쪽이면 신선.
    marineBuoys: {
        maxAgeMs: 90 * 60 * 1000,
        getUpdatedAt: () => cacheManager.dataCache.lastUpdate.marineBuoys,
        refreshFn: () => require('../scheduler').collectMarineBuoys()
    },

    // 해양기상부이 C타입 (파고부이) — 60분 주기. 90분 안쪽이면 신선.
    marineWhBuoys: {
        maxAgeMs: 90 * 60 * 1000,
        getUpdatedAt: () => cacheManager.dataCache.lastUpdate.marineWhBuoys,
        refreshFn: () => require('../scheduler').collectMarineWhBuoys()
    },

    // 해양기상부이 L타입 (등표) — 60분 주기. 90분 안쪽이면 신선.
    marineLhBuoys: {
        maxAgeMs: 90 * 60 * 1000,
        getUpdatedAt: () => cacheManager.dataCache.lastUpdate.marineLhBuoys,
        refreshFn: () => require('../scheduler').collectMarineLhBuoys()
    },

    // 해상기상전망 (marineForecastProcessor) — 10분 주기. 30분 안쪽이면 신선.
    // [주의] cache_manager 에 키가 등록되어 있지 않으므로(별도 파일),
    //        파일 mtime 을 직접 읽는다.
    marineForecasts: {
        maxAgeMs: 30 * 60 * 1000,
        getUpdatedAt: () => {
            try {
                const fs = require('fs');
                const path = require('path');
                const { DATA_DIR } = require('../config/server_config');
                const filePath = path.join(DATA_DIR, 'marine_forecast.json');
                return fs.statSync(filePath).mtimeMs;
            } catch (_) {
                return null;
            }
        },
        refreshFn: () => require('../marine_forecast_processor').collectMarineForecasts()
    }

    // [주의] cctv 항목은 in-memory 캐시이므로 별도 등록 메커니즘으로 처리.
    //        Step 3 에서 routes/cctv_seafog.js 가 registerSource('cctv', ...) 호출 예정.
};

// ============================================================================
// 2. 외부 등록 슬롯 (in-memory 캐시 모듈을 위한)
// ============================================================================
// CCTV 처럼 cache_manager 를 거치지 않고 자체 메모리에 캐시를 갖는 모듈을 위해
// registerSource(key, getterFn, overrides) 로 등록할 수 있다.
// 등록되면 POLICY 보다 우선 적용된다.
const _externalSources = {};

/**
 * 외부 모듈이 자신의 신선도 source 를 등록한다.
 * @param {string} cacheKey - 정책 키 (POLICY 의 키와 동일하거나 신규)
 * @param {() => number|null} getUpdatedAt - 마지막 갱신 시각(ms epoch) 반환 함수
 * @param {{ maxAgeMs?: number, refreshFn?: () => any }} [overrides]
 *        외부에서 maxAgeMs 또는 refreshFn 을 같이 정의하고 싶을 때 사용
 */
function registerSource(cacheKey, getUpdatedAt, overrides = {}) {
    _externalSources[cacheKey] = {
        getUpdatedAt,
        maxAgeMs: overrides.maxAgeMs,
        refreshFn: overrides.refreshFn
    };
}

// ============================================================================
// 3. 정책 조회 (외부 등록 우선)
// ============================================================================
// 외부 등록(_externalSources) 이 있으면 그 값으로, 없으면 내부 POLICY 값으로
// 병합된 정책을 반환한다.
function _resolvePolicy(cacheKey) {
    const ext = _externalSources[cacheKey];
    const base = POLICY[cacheKey];
    if (!ext && !base) return null;
    return {
        maxAgeMs: (ext && ext.maxAgeMs != null) ? ext.maxAgeMs
                : (base && base.maxAgeMs),
        getUpdatedAt: (ext && ext.getUpdatedAt) || (base && base.getUpdatedAt),
        refreshFn: (ext && ext.refreshFn) || (base && base.refreshFn)
    };
}

// ============================================================================
// 4. 신선도 측정
// ============================================================================
/**
 * 특정 캐시 키의 신선도를 측정한다.
 * @param {string} cacheKey
 * @returns {{ updatedAt: Date|null, ageMs: number|null, isFresh: boolean }}
 *
 * 반환값 의미:
 *   updatedAt : 마지막 갱신 시각 (Date). 데이터가 없거나 측정 실패 시 null.
 *   ageMs     : 현재까지 경과한 ms. updatedAt 이 null 이면 null.
 *   isFresh   : maxAgeMs 안쪽이면 true, 묵었거나 데이터가 없으면 false.
 *               (데이터 없음을 false 로 다루어 클라이언트가 "갱신 필요" 를 알 수 있게 함)
 */
function getFreshness(cacheKey) {
    const policy = _resolvePolicy(cacheKey);
    if (!policy || !policy.getUpdatedAt) {
        return { updatedAt: null, ageMs: null, isFresh: false };
    }

    let mtimeMs = null;
    try {
        mtimeMs = policy.getUpdatedAt();
    } catch (_) {
        // getUpdatedAt 실패는 안전하게 null 처리
        mtimeMs = null;
    }

    if (!mtimeMs || typeof mtimeMs !== 'number') {
        return { updatedAt: null, ageMs: null, isFresh: false };
    }

    const ageMs = Date.now() - mtimeMs;
    return {
        updatedAt: new Date(mtimeMs),
        ageMs,
        isFresh: ageMs <= (policy.maxAgeMs || 0)
    };
}

// ============================================================================
// 5. 응답 헤더 부착
// ============================================================================
/**
 * Express 응답 객체에 표준 freshness 헤더를 부착한다.
 * 응답 body 는 변경하지 않으므로 기존 클라이언트 호환성에 영향 없음.
 *
 * 부착 헤더:
 *   X-Data-Updated-At    ISO8601 (UTC)  — updatedAt 이 있을 때만
 *   X-Data-Age-Seconds   정수 (초)      — ageMs 가 있을 때만
 *   X-Data-Fresh         "true"|"false"
 *
 * [안전성]
 *   res.headersSent 인 상태에서 호출되어도 Express 가 무시하지 않고 throw 할 수 있으므로
 *   try/catch 로 보호한다. 헤더 부착 실패는 응답 자체에 영향 주지 않도록 무시.
 *
 * @param {import('express').Response} res
 * @param {string} cacheKey
 */
function applyFreshnessHeaders(res, cacheKey) {
    try {
        if (res.headersSent) return;
        const f = getFreshness(cacheKey);
        if (f.updatedAt) {
            res.setHeader('X-Data-Updated-At', f.updatedAt.toISOString());
        }
        if (f.ageMs != null) {
            res.setHeader('X-Data-Age-Seconds', String(Math.floor(f.ageMs / 1000)));
        }
        res.setHeader('X-Data-Fresh', f.isFresh ? 'true' : 'false');
    } catch (_) {
        // 헤더 부착 실패는 무시 (응답 본문은 정상 진행)
    }
}

// ============================================================================
// 6. 백그라운드 재수집 트리거 (debounce)
// ============================================================================
// 동일 캐시 키에 대해 60초 안의 중복 호출은 무시한다.
// 이는 동시 요청이 몰릴 때 외부 API 에 폭주(refresh storm)가 발생하지 않도록 보호한다.
const REFRESH_DEBOUNCE_MS = 60 * 1000;
const _lastRefreshTriggerAt = {};

/**
 * 캐시가 stale 상태이면 백그라운드 재수집을 트리거한다.
 * 동일 키에 대해 60초 debounce 가 적용되어 중복 호출은 무시된다.
 *
 * [호출 시점 권장]
 *   - 라우트 핸들러에서 응답 직후 (또는 직전).
 *   - 응답을 막지 않도록 await 하지 말 것 (setImmediate 로 비동기 실행됨).
 *
 * [실패 처리]
 *   - refreshFn 이 동기 throw 또는 비동기 reject 하더라도 console.error 로
 *     기록만 하고 다른 동작에 영향 주지 않는다.
 *
 * @param {string} cacheKey
 * @returns {boolean} 실제로 trigger 되었으면 true, debounce/fresh/policy 없음 이면 false
 */
function triggerRefreshIfStale(cacheKey) {
    const policy = _resolvePolicy(cacheKey);
    if (!policy || !policy.refreshFn) return false;

    const f = getFreshness(cacheKey);
    if (f.isFresh) return false;

    const now = Date.now();
    const last = _lastRefreshTriggerAt[cacheKey] || 0;
    if (now - last < REFRESH_DEBOUNCE_MS) return false;
    _lastRefreshTriggerAt[cacheKey] = now;

    // 백그라운드(다음 tick)에서 실행하여 응답 지연을 방지한다.
    setImmediate(() => {
        try {
            const result = policy.refreshFn();
            // refreshFn 이 Promise 를 반환하면 거기서도 에러 잡아준다.
            if (result && typeof result.catch === 'function') {
                result.catch(err => {
                    console.error(`[freshness] ${cacheKey} 재수집 실패:`, err && err.message);
                });
            }
        } catch (err) {
            console.error(`[freshness] ${cacheKey} 재수집 트리거 실패:`, err && err.message);
        }
    });
    return true;
}

// ============================================================================
// 7. 외부 노출 API
// ============================================================================
module.exports = {
    POLICY,                  // 정책 표 (디버깅/테스트용)
    getFreshness,            // 신선도 측정
    applyFreshnessHeaders,   // 응답 헤더 부착
    triggerRefreshIfStale,   // 백그라운드 재수집 트리거 (debounced)
    registerSource           // 외부 모듈의 in-memory 캐시 등록
};
