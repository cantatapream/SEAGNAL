/**
 * [방재기상시스템 API 폴링 서비스]
 *
 * 기상청 모바일 방재기상시스템 (https://afso.kma.go.kr) 의
 * retMmrWarningSeaNow.kajx 엔드포인트를 호출하여 자식해역 정보를 수집합니다.
 *
 * 본 모듈은 자체적으로 스케줄링하지 않으며, 외부에서 호출되어야 합니다
 * (5단계 스케줄러 통합 시 매 1분마다 호출 예정).
 *
 * 근거 문서:
 * - 02_DATA_MODEL/01_api_spec.md (API 명세)
 * - 02_DATA_MODEL/02_response_fields.md (응답 필드 의미)
 * - 02_DATA_MODEL/07_data_validation.md (검증 규칙)
 * - 01_LOGIC/14_rule_order.md §3.1 (응답 건전성 검사)
 */

'use strict';

const AFSO_HOST = 'https://afso.kma.go.kr';
const AFSO_PATH = '/afsOut/mmr/warning/retMmrWarningSeaNow.kajx';
const REFERER = `${AFSO_HOST}/afsOut/mmr/warning/retMmrSeaWeatherStatus.kfrm`;
const USER_AGENT = 'Mozilla/5.0 (compatible; SEAGNAL-bot)';
const TIMEOUT_MS = 5000;

/**
 * 현재 KST 시각을 YYYYMMDDHHMI 형식으로 반환
 */
function buildTmFc() {
    const now = new Date();
    // KST 기준 (UTC+9)
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    const yyyy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${mi}`;
}

/**
 * AFSO 응답 검증 (LOGIC 14 §3.1)
 * @returns {{ valid: boolean, reason?: string, detail?: any }}
 */
function validateAfsoResponse(httpStatus, body) {
    if (httpStatus !== 200) {
        return { valid: false, reason: 'HTTP_STATUS', detail: httpStatus };
    }
    if (body == null) {
        return { valid: false, reason: 'EMPTY_BODY' };
    }
    if (body.meta == null) {
        return { valid: false, reason: 'MISSING_META' };
    }
    if (body.meta.err === 'true') {
        return { valid: false, reason: 'META_ERR_TRUE', detail: body.meta.errCd || '' };
    }
    if (body.data == null) {
        return { valid: false, reason: 'MISSING_DATA' };
    }
    if (body.data.metData == null) {
        return { valid: false, reason: 'MISSING_METDATA' };
    }
    if (!Array.isArray(body.data.metData)) {
        return { valid: false, reason: 'METDATA_NOT_ARRAY' };
    }
    if (body.data.metData.length === 0) {
        return { valid: false, reason: 'METDATA_EMPTY' };
    }
    return { valid: true };
}

/**
 * 방재기상 API 호출
 *
 * @returns {Promise<{
 *   success: boolean,
 *   metData: Array | null,
 *   tmFc: string,
 *   error: { type: string, message: string, detail?: any } | null,
 *   rawResponse: object | null
 * }>}
 */
async function pollAfso() {
    const tmFc = buildTmFc();
    const body = `tmFc=${tmFc}&stnId=108&fe=f&mmr=mmr&tmFe=`;

    let httpStatus = null;
    let parsedBody = null;
    let rawText = null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(`${AFSO_HOST}${AFSO_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': REFERER,
                'User-Agent': USER_AGENT
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        httpStatus = response.status;
        rawText = await response.text();

        try {
            parsedBody = JSON.parse(rawText);
        } catch (parseErr) {
            return {
                success: false,
                metData: null,
                tmFc: tmFc,
                error: { type: 'PARSE_ERROR', message: parseErr.message },
                rawResponse: { httpStatus, rawText: rawText.slice(0, 500) }
            };
        }
    } catch (fetchErr) {
        const isTimeout = fetchErr.name === 'AbortError';
        return {
            success: false,
            metData: null,
            tmFc: tmFc,
            error: {
                type: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
                message: fetchErr.message
            },
            rawResponse: null
        };
    }

    const validation = validateAfsoResponse(httpStatus, parsedBody);
    if (!validation.valid) {
        return {
            success: false,
            metData: null,
            tmFc: tmFc,
            error: {
                type: 'VALIDATION_ERROR',
                message: validation.reason,
                detail: validation.detail
            },
            rawResponse: parsedBody
        };
    }

    return {
        success: true,
        metData: parsedBody.data.metData,
        tmFc: tmFc,
        error: null,
        rawResponse: parsedBody
    };
}

module.exports = {
    pollAfso,
    validateAfsoResponse,
    buildTmFc
};
