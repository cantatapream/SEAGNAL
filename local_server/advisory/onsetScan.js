/**
 * ============================================================================
 * advisory/onsetScan.js — 프레임-외부(frame-outer) onset 스캔
 * ============================================================================
 *
 * 목적: 메모리 절감. 일기도(GIF) 디코드 결과를 누적 보관하지 않고 "한 프레임만"
 *       메모리에 올려 분석한 뒤 즉시 폐기한다. (기존 zone-outer 는 한 청의 모든
 *       프레임 디코드본을 캐시에 쌓아 OOM 을 유발했음)
 *
 * 동치성(검증됨): 기존 zone-outer 스캔과 "각 해역의 onset/밴드/peak" 결과가 100%
 *       동일하다. run_onsetscan_test.js 가 무작위 시나리오로 동치를 증명한다.
 *
 * 알고리즘(기존과 동일):
 *   - primary(풍속 시퀀스, 없으면 파고 시퀀스)를 유효시각 오름차순으로 순회.
 *   - 각 해역에 대해, 풍속밴드(wB) 또는 파고밴드(vB)가 처음 임계(windCut/waveCut)를
 *     넘는 유효시각을 onset 으로 확정하고 그때의 밴드를 windBand/waveBand 로 기록.
 *   - peakWind/peakWave = onset 까지(또는 onset 없으면 전 구간) 본 최대 밴드.
 *   - onset 이 확정된 해역은 더 이상 평가하지 않는다(조기 종료).
 *
 * 메모리/효율:
 *   - decodeFrame 은 프레임당 1회만 호출(중복 디코드 없음). 모든 해역의 onset 이
 *     확정되면 남은 프레임은 받지 않는다(다운로드 최소화 — 기존 캐시판과 동일 범위).
 *   - 디코드 결과는 루프 지역변수라 다음 프레임 진입 전에 GC 대상이 된다.
 *
 * 순수성: 네트워크/디코드/분석은 모두 콜백으로 주입 → node 단위 테스트 가능.
 * ============================================================================
 */
'use strict';

/**
 * @param {object} p
 * @param {Array<{f:*, vt:Date}>} p.primary       유효시각 오름차순 프레임 목록
 * @param {Map<number,*>}        p.waveByVt        vt.getTime() → 파고 프레임 핸들
 * @param {boolean}              p.hasWind         풍속 시퀀스 존재 여부
 * @param {Array<*>}             p.zones           해역 객체 배열
 * @param {number}               p.windCut         풍속 임계(밴드)
 * @param {number}               p.waveCut         파고 임계(밴드)
 * @param {(frameHandle:*)=>Promise<*>} p.decodeFrame  프레임 1장 디코드(캐시 없음)
 * @param {(decoded:*, zone:*)=>number} p.bandWind     풍속 maxBand(실패 0)
 * @param {(decoded:*, zone:*)=>number} p.bandWave     파고 maxBand(실패 0)
 * @returns {Promise<Map<*, {onset:Date|null, windBand:number, waveBand:number,
 *                           peakWind:number, peakWave:number}>>}
 */
async function scanOnsets(p) {
    const primary = Array.isArray(p.primary) ? p.primary : [];
    const zones = Array.isArray(p.zones) ? p.zones : [];
    const hasWind = !!p.hasWind;
    const windCut = p.windCut;
    const waveCut = p.waveCut;
    const waveByVt = p.waveByVt instanceof Map ? p.waveByVt : new Map();

    // 지속 게이트: onset 후 연속 임계유지를 sustainNeedH 시간만큼 확인(③).
    //   미지정(0)이면 기존 동작 — onset 즉시 확정·조기종료(동치성 테스트 보존).
    const sustainNeedH = (typeof p.sustainNeedH === 'number' && p.sustainNeedH > 0) ? p.sustainNeedH : 0;

    // 해역별 누적 상태
    const st = zones.map((z) => ({
        z, onset: null, windBand: 0, waveBand: 0, peakWind: 0, peakWave: 0, done: false, sustainUntil: null,
    }));
    let remaining = st.length;

    for (const { f, vt } of primary) {
        if (remaining === 0) break; // 모든 해역 onset(+지속) 확정 → 더 받을 필요 없음

        // 프레임 한 장씩만 디코드(캐시 없음). 실패는 흡수 → 해당 프레임은 밴드 0.
        let windDec = null;
        if (hasWind) {
            try { windDec = await p.decodeFrame(f); } catch (_) { windDec = null; }
        }
        const waveHandle = hasWind ? waveByVt.get(vt.getTime()) : f;
        let waveDec = null;
        if (waveHandle) {
            try { waveDec = await p.decodeFrame(waveHandle); } catch (_) { waveDec = null; }
        }

        for (const s of st) {
            if (s.done) continue;
            let wB = 0, vB = 0;
            if (windDec) { try { wB = p.bandWind(windDec, s.z) || 0; } catch (_) { wB = 0; } }
            if (waveDec) { try { vB = p.bandWave(waveDec, s.z) || 0; } catch (_) { vB = 0; } }

            if (wB > s.peakWind) s.peakWind = wB;
            if (vB > s.peakWave) s.peakWave = vB;

            const over = (wB >= windCut || vB >= waveCut);
            if (!s.onset) {
                if (over) {
                    s.onset = vt; s.windBand = wB; s.waveBand = vB; s.sustainUntil = vt;
                    if (sustainNeedH <= 0) { s.done = true; remaining -= 1; } // 게이트 없음 → 즉시 확정(기존)
                }
            } else {
                // onset 후 지속 추적: 연속 임계유지면 sustainUntil 연장, 끊기면 종료.
                if (over) {
                    s.sustainUntil = vt;
                    if ((vt.getTime() - s.onset.getTime()) / 3600000 >= sustainNeedH) { s.done = true; remaining -= 1; } // 충분 지속 확정
                } else {
                    s.done = true; remaining -= 1; // 지속 끊김 → sustainUntil 고정(=지속시간 확정)
                }
            }
        }
        // windDec/waveDec 는 다음 프레임 진입 시 교체 → 메모리에 1장만 유지.
    }

    const out = new Map();
    for (const s of st) {
        const sustainHours = (s.onset && s.sustainUntil) ? (s.sustainUntil.getTime() - s.onset.getTime()) / 3600000 : 0;
        out.set(s.z, {
            onset: s.onset, windBand: s.windBand, waveBand: s.waveBand,
            peakWind: s.peakWind, peakWave: s.peakWave, sustainHours,
        });
    }
    return out;
}

module.exports = { scanOnsets };
