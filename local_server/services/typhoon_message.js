/**
 * ============================================================================
 * 파일명: services/typhoon_message.js
 * 역할 : 태풍 "발생/소멸" 푸시 알림의 제목·본문 문구를 생성하는 순수 모듈.
 * ============================================================================
 *
 * [왜 별도 모듈인가]
 *   - I/O·네트워크 없이 "데이터 → 문구"만 담당 → 단위 테스트가 쉽고, 실제 발송기
 *     (typhoon_notifier.js)와 관리자 테스트 발송(routes/admin.js)이 같은 함수를
 *     써서 문구가 절대 갈라지지 않게 한다.
 *
 * [입력 스냅샷 형태]  (typhoon.json 의 태풍/통보문에서 발췌해 정규화한 값)
 *   { seq, name, nameEn,
 *     current: { lat, lon, time } | null,   // time = "YYYYMMDDHHmm" (KST)
 *     rem,                                    // 통보문 비고(소멸 사유 추출용)
 *     tmFc }                                  // 통보문 발표시각 "YYYYMMDDHHmm" (KST)
 *
 * [출력]  { title, body, url }
 *
 * [확정된 표기 규칙 — 사용자 합의]
 *   - 호수: 식별값(seq)을 "제N호"로 표기. 정수(1~40)가 아니면 자동 생략.
 *   - 위치: 제주 중심부(33.4N/126.5E) 기준 8방위 + 해리(1해리=1.852km). 표시는 "제주도".
 *   - 발생 본문 끝: "앱에서 예상 진로를 확인하세요." / 소멸 본문: 안내문구 없음.
 *   - 소멸 사유: 비고에 "열대저압부"→약화 / "온대저기압"→변질 / 그 외(종료)→"약화되어".
 * ============================================================================
 */
'use strict';

// 탭(클릭) 시 이동: 해양종합정보 탭 + 태풍 레이어 ON (js/assistant_deeplink.js 가 처리)
const TYPHOON_DEEPLINK_URL = '/?assistant=ocean&layer=typhoon';

// 거리 계산 기준점 — 제주 중심부. (문구 표기는 항상 "제주도")
const JEJU_REF = { lat: 33.4, lon: 126.5 };

const DIRS_8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

// ---------------------------------------------------------------------------
// 소형 헬퍼
// ---------------------------------------------------------------------------

/** "제N호 " 접두 — seq 가 1~40 정수가 아니면 "" (호수 생략, 안전 폴백). */
function formatTyphoonNumber(seq) {
    const n = parseInt(String(seq == null ? '' : seq).replace(/[^0-9]/g, ''), 10);
    return Number.isInteger(n) && n >= 1 && n <= 40 ? `제${n}호 ` : '';
}

/** "YYYYMMDDHHmm"(KST) → "M월 D일 H시". 형식이 어긋나면 "". */
function formatKstTime(yyyymmddhhmm) {
    const s = String(yyyymmddhhmm || '').replace(/[^0-9]/g, '');
    if (s.length < 12) return '';
    const mo = parseInt(s.slice(4, 6), 10);
    const d = parseInt(s.slice(6, 8), 10);
    const h = parseInt(s.slice(8, 10), 10);
    if (!mo || !d) return '';
    return `${mo}월 ${d}일 ${h}시`;
}

/** 한글 받침 유무로 주격 조사 선택. 비한글/공백은 '가' 기본. */
function subjectParticle(word) {
    if (!word) return '가';
    const code = word.charCodeAt(word.length - 1);
    if (code >= 0xac00 && code <= 0xd7a3) return ((code - 0xac00) % 28) !== 0 ? '이' : '가';
    return '가';
}

/** 제주 기준 8방위 + 해리. lat/lon 없으면 null(→ 위치 문구 생략). */
function jejuBearingDistance(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return null;
    const toRad = (x) => x * Math.PI / 180;
    const R = 6371; // km
    const φ1 = toRad(JEJU_REF.lat), φ2 = toRad(lat);
    const dφ = toRad(lat - JEJU_REF.lat);
    const dλ = toRad(lon - JEJU_REF.lon);
    // 거리(하버사인)
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    let nm = km / 1.852;
    nm = nm >= 100 ? Math.round(nm / 10) * 10 : Math.max(5, Math.round(nm / 5) * 5);
    // 방위(제주 → 태풍 초기 방위)
    const θ = Math.atan2(
        Math.sin(dλ) * Math.cos(φ2),
        Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
    );
    const deg = (θ * 180 / Math.PI + 360) % 360;
    const dir = DIRS_8[Math.round(deg / 45) % 8];
    return { dir, nm };
}

/** 위치 문구 "제주도 OO쪽 약 N해리 해상에서 " (없으면 ""). */
function locationPhrase(current) {
    const bd = current ? jejuBearingDistance(current.lat, current.lon) : null;
    if (!bd) return '';
    return `제주도 ${bd.dir}쪽 약 ${bd.nm.toLocaleString('ko-KR')}해리 해상에서 `;
}

/** 소멸 사유 어구 (뒤에 "소멸했습니다"가 붙음). 단서 없으면 "". */
function dissipationReason(rem) {
    const s = String(rem || '');
    if (s.indexOf('열대저압부') >= 0) return '열대저압부로 약화되어 ';
    if (s.indexOf('온대저기압') >= 0) return '온대저기압으로 변질되어 ';
    if (s.indexOf('종료') >= 0) return '약화되어 ';
    return '';
}

/** "OO 태풍 '이름'" 조각 — 이름 없으면 따옴표 생략. */
function namePhrase(snap) {
    const name = (snap.name || snap.nameEn || '').trim();
    return name ? ` '${name}'` : '';
}

// ---------------------------------------------------------------------------
// 공개 빌더
// ---------------------------------------------------------------------------

/** 태풍 발생 알림 문구. */
function buildOnset(snap) {
    const num = formatTyphoonNumber(snap.seq);
    const np = namePhrase(snap);
    const when = formatKstTime((snap.current && snap.current.time) || snap.tmFc);
    const loc = locationPhrase(snap.current);
    const title = `🌀 ${num}태풍${np} 발생`;
    const lead = when ? `${when} 기준, ` : '';
    const body = `${lead}${loc}태풍이 발생했습니다. 앱에서 예상 진로를 확인하세요.`;
    return { title, body, url: TYPHOON_DEEPLINK_URL };
}

/** 태풍 소멸 알림 문구 (안내문구 없음). */
function buildDissipation(snap) {
    const num = formatTyphoonNumber(snap.seq);
    const name = (snap.name || snap.nameEn || '').trim();
    const np = namePhrase(snap);
    const particle = name ? subjectParticle(name) : '이';
    const when = formatKstTime((snap.current && snap.current.time) || snap.tmFc);
    const loc = locationPhrase(snap.current);
    const reason = dissipationReason(snap.rem);
    const title = `🌀 ${num}태풍${np} 소멸`;
    const lead = when ? `${when} 기준, ` : '';
    const body = `${lead}${loc}태풍${np}${particle} ${reason}소멸했습니다.`;
    return { title, body, url: TYPHOON_DEEPLINK_URL };
}

/** 현재 KST 시각 "YYYYMMDDHHmm" — 관리자 테스트 문구의 "기준" 시각용. */
function nowKstYmdHm() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * 관리자 시연용 샘플 문구 (실제 태풍 없이 형식 확인).
 * @param {'onset'|'dissipation'} kind
 */
function buildSample(kind) {
    const now = nowKstYmdHm();
    const snap = {
        seq: '3', name: '개미', nameEn: 'GAEMI',
        current: { lat: 28.5, lon: 123.0, time: now },
        rem: kind === 'dissipation' ? "제3호 태풍 '개미'에 대한 정보 발표를 종료합니다." : '',
        tmFc: now
    };
    return kind === 'dissipation' ? buildDissipation(snap) : buildOnset(snap);
}

module.exports = {
    TYPHOON_DEEPLINK_URL,
    buildOnset,
    buildDissipation,
    buildSample,
    // 내부 헬퍼도 노출(단위 테스트/재사용 편의)
    formatTyphoonNumber,
    formatKstTime,
    jejuBearingDistance,
    dissipationReason
};
