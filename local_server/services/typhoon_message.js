/**
 * ============================================================================
 * 파일명: services/typhoon_message.js
 * 역할 : 태풍 "발생/소멸" 푸시 알림에 들어갈 제목·본문 "문구"를 만들어 주는 모듈.
 * ============================================================================
 *
 * [이 파일을 한 줄로 말하면]
 *   "태풍 데이터(이름·위치·시각 등)를 받아서, 사용자 휴대폰에 뜰 알림 문구로 바꿔준다."
 *
 * [왜 따로 떼어 놨나 — 초보자 설명]
 *   - 이 파일은 인터넷 통신이나 파일 저장을 전혀 하지 않습니다. 오직 "값 → 글자" 변환만 합니다.
 *     이런 함수를 '순수 함수(pure function)'라고 하며, 똑같이 넣으면 항상 똑같이 나와서
 *     테스트하기 쉽고 버그가 적습니다.
 *   - 실제 발송기(typhoon_notifier.js)와 관리자 테스트 발송(routes/admin.js)이
 *     "둘 다 이 파일의 함수를 호출"하기 때문에, 두 곳의 알림 문구가 절대 달라지지 않습니다.
 *
 * [누가 이 파일을 사용하나 — 연관 파일]
 *   - services/typhoon_notifier.js  → 실제 사용자에게 보낼 때 buildOnset/buildDissipation 호출
 *   - routes/admin.js               → 관리자 시연: dmdw 실데이터(6호 장미)로 문구 + buildDemoUrl 호출
 *
 * [입력으로 받는 "스냅샷" 형태]  (typhoon.json 의 태풍/통보문에서 골라 정리한 값)
 *   {
 *     seq,        // 태풍 식별번호(호수). 예: "6"
 *     name,       // 한글 이름. 예: "개미"
 *     nameEn,     // 영문 이름. 예: "GAEMI"
 *     current: { lat, lon, time } | null,  // 현재 위치(위도/경도) + 시각("YYYYMMDDHHmm", 한국시각)
 *     rem,        // 통보문 비고(=소멸 사유를 캐낼 글)
 *     tmFc        // 통보문 발표시각("YYYYMMDDHHmm", 한국시각)
 *   }
 *
 * [출력]  { title(제목), body(본문), url(탭하면 갈 주소) }
 *
 * [확정된 표기 규칙 — 사용자와 합의]
 *   - 호수: 식별값(seq)을 "제N호"로 표기하되, 정상 숫자(1~40)가 아니면 자동 생략.
 *   - 위치: 제주 중심부(33.4N/126.5E)를 기준점으로 방향(8방위) + 거리(해리)를 계산. 표시는 "제주도".
 *   - 발생 본문 끝에는 "앱에서 예상 진로를 확인하세요." / 소멸 본문에는 안내문구 없음.
 *   - 소멸 사유: 비고에 "열대저압부"→약화 / "온대저기압"→변질 / 그 외(종료)→"약화되어".
 * ============================================================================
 */
'use strict';

// 알림을 탭(클릭)하면 이동할 주소.
//   이 주소로 앱이 열리면 js/assistant_deeplink.js 가 알아서 "해양종합정보 탭 + 태풍 레이어 ON"을 켜준다.
const TYPHOON_DEEPLINK_URL = '/?assistant=ocean&layer=typhoon';

// 거리를 재는 "기준점" — 제주 중심부 좌표. (문구에 보일 때는 항상 "제주도"라고만 적는다.)
const JEJU_REF = { lat: 33.4, lon: 126.5 };

// 방위 8개. jejuBearingDistance() 가 계산한 각도를 이 배열에서 골라 한글 방향으로 바꾼다.
const DIRS_8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

// ---------------------------------------------------------------------------
// 소형 헬퍼들 (아래 buildOnset/buildDissipation 이 조합해서 사용)
// ---------------------------------------------------------------------------

/**
 * 태풍 호수를 "제N호 " 형태의 접두어로 만든다.
 *   - 정상 숫자(1~40)가 아니면 빈 문자열("")을 돌려줘서 "호수 없이" 나가게 한다(안전 폴백).
 *   - 사용처: buildOnset / buildDissipation 의 제목 앞부분.
 * @param {string|number} seq 태풍 식별번호
 * @returns {string} "제6호 " 또는 ""
 */
function formatTyphoonNumber(seq) {
    const n = parseInt(String(seq == null ? '' : seq).replace(/[^0-9]/g, ''), 10);
    return Number.isInteger(n) && n >= 1 && n <= 40 ? `제${n}호 ` : '';
}

/**
 * "YYYYMMDDHHmm"(한국시각 12자리)를 사람이 읽기 쉬운 "M월 D일 H시"로 바꾼다.
 *   - 형식이 어긋나면 ""(빈 문자열)을 돌려준다 → 호출부에서 "기준" 시각 문구를 통째로 생략.
 *   - 사용처: 본문 맨 앞 "M월 D일 H시 기준, ..." 부분.
 * @param {string} yyyymmddhhmm 예: "202607210900"
 * @returns {string} 예: "7월 21일 9시"
 */
function formatKstTime(yyyymmddhhmm) {
    const s = String(yyyymmddhhmm || '').replace(/[^0-9]/g, '');
    if (s.length < 12) return '';
    const mo = parseInt(s.slice(4, 6), 10);
    const d = parseInt(s.slice(6, 8), 10);
    const h = parseInt(s.slice(8, 10), 10);
    if (!mo || !d) return '';
    return `${mo}월 ${d}일 ${h}시`;
}

/**
 * 한국어 주격 조사("이"/"가")를 단어 끝 글자의 받침 유무로 골라준다.
 *   - 예: "개미"는 받침이 없으니 "가", "프라피룬"은 받침이 있으니 "이".
 *   - 한글이 아니면(영문 등) 기본값 "가".
 *   - 사용처: buildDissipation 본문의 "태풍 '이름'OO 소멸했습니다".
 * @param {string} word 검사할 단어(태풍 이름)
 * @returns {'이'|'가'}
 */
function subjectParticle(word) {
    if (!word) return '가';
    const code = word.charCodeAt(word.length - 1);
    // 한글 음절 영역(0xAC00~0xD7A3)에서 (코드-0xAC00)%28 != 0 이면 받침이 있는 글자.
    if (code >= 0xac00 && code <= 0xd7a3) return ((code - 0xac00) % 28) !== 0 ? '이' : '가';
    return '가';
}

/**
 * 제주(기준점)에서 태풍까지의 "방향(8방위)"과 "거리(해리)"를 계산한다.
 *   - 거리: 지구가 둥근 걸 감안한 하버사인(haversine) 공식으로 km를 구한 뒤 해리로 환산(1해리=1.852km).
 *   - 방향: 제주에서 태풍을 바라보는 각도를 구해 8방위 중 가장 가까운 쪽으로 표기.
 *   - 위도/경도가 없으면 null → 호출부(locationPhrase)에서 위치 문구를 생략.
 *   - 사용처: locationPhrase() → buildOnset/buildDissipation 본문의 위치 부분.
 * @param {number} lat 태풍 위도
 * @param {number} lon 태풍 경도
 * @returns {{dir:string, nm:number}|null} 예: { dir:"남서", nm:340 }
 */
function jejuBearingDistance(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return null;
    const toRad = (x) => x * Math.PI / 180;
    const R = 6371; // 지구 반지름(km)
    const φ1 = toRad(JEJU_REF.lat), φ2 = toRad(lat);
    const dφ = toRad(lat - JEJU_REF.lat);
    const dλ = toRad(lon - JEJU_REF.lon);
    // (1) 거리 — 하버사인 공식
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    let nm = km / 1.852;
    // 거리가 멀면 10해리, 가까우면 5해리 단위로 보기 좋게 반올림(최소 5해리)
    nm = nm >= 100 ? Math.round(nm / 10) * 10 : Math.max(5, Math.round(nm / 5) * 5);
    // (2) 방향 — 제주에서 태풍을 바라보는 초기 방위각
    const θ = Math.atan2(
        Math.sin(dλ) * Math.cos(φ2),
        Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
    );
    const deg = (θ * 180 / Math.PI + 360) % 360; // 0~360도
    const dir = DIRS_8[Math.round(deg / 45) % 8]; // 45도 간격으로 8방위 매핑
    return { dir, nm };
}

/**
 * 위치를 "제주도 OO쪽 약 N해리 해상에서 "라는 문장 조각으로 만든다.
 *   - 위치 정보가 없으면 ""(빈 문자열) → 본문에서 위치 부분을 자연스럽게 생략.
 *   - 사용처: buildOnset / buildDissipation 본문.
 * @param {{lat:number, lon:number}|null} current 태풍 현재 위치
 * @returns {string}
 */
function locationPhrase(current) {
    const bd = current ? jejuBearingDistance(current.lat, current.lon) : null;
    if (!bd) return '';
    return `제주도 ${bd.dir}쪽 약 ${bd.nm.toLocaleString('ko-KR')}해리 해상에서 `;
}

/**
 * 통보문 비고(rem)에서 "소멸 사유" 어구를 뽑아낸다(뒤에 "소멸했습니다"가 붙음).
 *   - "열대저압부"가 보이면 → "열대저압부로 약화되어 "
 *   - "온대저기압"이 보이면 → "온대저기압으로 변질되어 "
 *   - 둘 다 없지만 "종료"는 있으면 → "약화되어 "
 *   - 아무 단서도 없으면(예: 활성목록에서 그냥 사라진 경우) → "" (그냥 "소멸했습니다")
 *   - 사용처: buildDissipation.
 * @param {string} rem 통보문 비고
 * @returns {string}
 */
function dissipationReason(rem) {
    const s = String(rem || '');
    if (s.indexOf('열대저압부') >= 0) return '열대저압부로 약화되어 ';
    if (s.indexOf('온대저기압') >= 0) return '온대저기압으로 변질되어 ';
    if (s.indexOf('종료') >= 0) return '약화되어 ';
    return '';
}

/**
 * 태풍 이름에서 "제 N호" 접두를 떼어 순수 이름만 남긴다.
 *   - 방재기상플랫폼의 태풍 목록 이름은 "제 6호 장미"처럼 호수를 포함한다.
 *     호수는 formatTyphoonNumber(seq) 가 따로 붙이므로, 여기서 접두를 제거해 중복을 막는다.
 *   - 통보문 typName("장미")처럼 이미 순수 이름이면 그대로 둔다.
 * @param {string} name 예: "제 6호 장미" 또는 "장미"
 * @returns {string} 예: "장미"
 */
function pureName(name) {
    return String(name || '').replace(/^제\s*\d+\s*호\s*/, '').trim();
}

/**
 * "태풍 '이름'"에서 따옴표로 감싼 이름 조각을 만든다. 이름이 없으면 ""(따옴표 생략).
 *   - 한글 이름이 없으면 영문 이름이라도 사용. "제 N호" 접두는 제거(pureName).
 *   - 사용처: 제목·본문 공통.
 * @param {{name:string, nameEn:string}} snap
 * @returns {string} 예: " '장미'"
 */
function namePhrase(snap) {
    const name = pureName(snap.name) || (snap.nameEn || '').trim();
    return name ? ` '${name}'` : '';
}

// ---------------------------------------------------------------------------
// 공개 빌더 — 바깥(notifier, admin)에서 직접 호출하는 함수들
// ---------------------------------------------------------------------------

/**
 * [태풍 발생] 알림 문구를 만든다.
 *   - 조립: 호수 + 이름 + 발표/관측 시각 + 제주 기준 위치 + "앱에서 예상 진로를 확인하세요."
 *   - 호출: typhoon_notifier.detectAndNotify() / routes/admin.js(실데이터 테스트 발송).
 * @param {object} snap 스냅샷(파일 상단 설명 참고)
 * @returns {{title:string, body:string, url:string}}
 */
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

/**
 * [태풍 소멸] 알림 문구를 만든다(안내문구는 넣지 않음 — 소멸 후엔 볼 게 없으므로).
 *   - 조립: 호수 + 이름 + 시각 + 제주 기준 위치 + 소멸 사유 + "소멸했습니다."
 *   - 호출: typhoon_notifier.detectAndNotify() / routes/admin.js(실데이터 테스트 발송).
 * @param {object} snap 스냅샷(파일 상단 설명 참고)
 * @returns {{title:string, body:string, url:string}}
 */
function buildDissipation(snap) {
    const num = formatTyphoonNumber(snap.seq);
    const name = pureName(snap.name) || (snap.nameEn || '').trim();
    const np = namePhrase(snap);
    const particle = name ? subjectParticle(name) : '이'; // "태풍이" / "태풍 '개미'가"
    const when = formatKstTime((snap.current && snap.current.time) || snap.tmFc);
    const loc = locationPhrase(snap.current);
    const reason = dissipationReason(snap.rem);
    const title = `🌀 ${num}태풍${np} 소멸`;
    const lead = when ? `${when} 기준, ` : '';
    const body = `${lead}${loc}태풍${np}${particle} ${reason}소멸했습니다.`;
    return { title, body, url: TYPHOON_DEEPLINK_URL };
}

/**
 * 탭 시 "해당 통보문 위치로 지도 이동 + 태풍 버튼 강제 활성화"를 위한 시연 딥링크 URL.
 *   - 실제 통보문 위치(snap.current)를 파라미터로 실어 보낸다(가짜 좌표를 만들지 않는다).
 *   - 위치가 없으면 위치 이동 없이 일반 태풍 화면(TYPHOON_DEEPLINK_URL)으로만 연결.
 *   - 사용처: routes/admin.js 의 태풍 테스트 발송(실데이터 기반).
 *   - 처리: js/assistant_deeplink.js 가 demoTphn 파라미터를 읽어 ocean_typhoon.demoFocus 호출.
 * @param {object} snap { seq, name, current:{lat,lon,time}, tmFc }
 * @param {number} [grade] 강도(0~5) — 포인트 색상용
 * @returns {string}
 */
function buildDemoUrl(snap, grade) {
    const cur = snap && snap.current;
    if (!cur || typeof cur.lat !== 'number' || typeof cur.lon !== 'number') return TYPHOON_DEEPLINK_URL;
    return TYPHOON_DEEPLINK_URL
        + '&demoTphn=1'
        + '&dtLat=' + cur.lat + '&dtLon=' + cur.lon
        + '&dtSeq=' + encodeURIComponent(snap.seq || '')
        + '&dtName=' + encodeURIComponent(pureName(snap.name) || (snap.nameEn || ''))
        + '&dtTime=' + encodeURIComponent(cur.time || snap.tmFc || '')
        + '&dtGrade=' + (grade != null && !isNaN(grade) ? grade : '');
}

module.exports = {
    TYPHOON_DEEPLINK_URL,
    buildOnset,
    buildDissipation,
    buildDemoUrl,
    // 내부 헬퍼도 노출(단위 테스트/재사용 편의)
    formatTyphoonNumber,
    formatKstTime,
    jejuBearingDistance,
    dissipationReason,
    pureName
};
