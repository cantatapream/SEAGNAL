/**
 * ============================================================================
 * 파일명: services/naver_search.js
 * 역할: 나리야 법률 챗봇 §4-U(모르는 구어 해소) 전용 — 네이버 검색 API 클라이언트.
 *       위키 검색이 실패했을 때만 호출되는 "단어 뜻 확인" 보조 도구다.
 * ============================================================================
 *
 * [설계 배경]
 * - 확정 근거: 2026-08-16 실측(GitHub Actions 경유, 이 서버 환경과 무관하게 검증됨).
 *   base host `https://naverapihub.apigw.ntruss.com`, 헤더 `X-NCP-APIGW-API-KEY-ID`/
 *   `X-NCP-APIGW-API-KEY`, 무료 쿼터 일 25,000건/월 775,000건.
 * - 불변식(`_CHATBOT.md` §4-U): 웹 검색 결과는 "이 단어가 뭘 뜻하는지" 확인용일 뿐,
 *   법적 근거로 인용하지 않는다. 법 조문·처벌은 항상 위키 원문에서만 가져온다.
 *
 * [연계]
 * - 사용처: `legal_retriever.js`의 §4-U 단계(위키 검색이 0건이거나 스코어가 낮을 때) —
 *   아직 미배선. 이 모듈은 독립적으로 호출 가능한 building block만 제공한다.
 * - 환경변수: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (local_server/.env, Fly secrets)
 * - [로드 순서] 다른 서비스 모듈처럼 `require('./services/naver_search')`로 필요할 때 로드.
 * ============================================================================
 */

const BASE = 'https://naverapihub.apigw.ntruss.com';

// <수산>·<어업> 등 네이버 지식백과 항목의 분야 태그. description 필드에 HTML 엔티티로
// 실려온다(실측 확인: "&lt;수산&gt; 저인망이나 통발 속에...").
const DOMAIN_TAG_RE = /&lt;(수산|어업|해양|선박|항만)&gt;/;
// 태그가 없어도 이 단어들이 스니펫에 있으면 도메인 신호로 간주(가산점).
const DOMAIN_KEYWORDS = ['어구', '통발', '그물', '어선', '수산업', '어업', '선박', '항만', '조업'];

function authHeaders() {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) throw new Error('NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 설정되지 않았습니다.');
  return { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret };
}

/**
 * 네이버 검색 API 공통 호출. 실패해도 예외를 던지지 않고 빈 결과를 반환한다
 * (§4-U는 이 검색이 실패해도 "확인 못 함" 흐름으로 넘어갈 수 있어야 하므로).
 * @param {string} path - 예: '/search/v1/encyc'
 * @param {Record<string,string>} params - query, display 등
 * @returns {Promise<{items: Array, total: number}>}
 */
async function callSearch(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: authHeaders() });
  if (!res.ok) return { items: [], total: 0 };
  const data = await res.json();
  return { items: data.items || [], total: data.total || 0 };
}

/**
 * 오타 변환 — 한/영 자판 오입력만 교정한다(일반 맞춤법 오류는 대상 아님, 실측 확인:
 * 정상 단어는 빈 문자열 반환).
 * @param {string} query
 * @returns {Promise<string>} 교정된 검색어. 오타가 아니면 원문 그대로.
 * @연계 §4-U 파이프라인의 맨 앞단(어떤 검색이든 타기 전).
 */
async function correctTypo(query) {
  const { errata } = await (async () => {
    const qs = new URLSearchParams({ query }).toString();
    const res = await fetch(`${BASE}/search/v1/errata?${qs}`, { headers: authHeaders() });
    if (!res.ok) return { errata: '' };
    return res.json();
  })();
  return errata && errata.trim() ? errata : query;
}

/**
 * 도메인 신호(§4-U 3단 필터링의 2단계) — <수산> 태그나 어업 키워드가 스니펫에
 * 있으면 우선순위를 높인다. 순수 문자열 매칭이라 비용이 들지 않는다.
 * @param {{description?:string,title?:string}} item
 * @returns {number} 가산점(0, 4, 또는 8)
 */
function domainScore(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  if (DOMAIN_TAG_RE.test(text)) return 8; // 명시적 분야 태그 = 가장 강한 신호
  if (DOMAIN_KEYWORDS.some(k => text.includes(k))) return 4;
  return 0;
}

/**
 * §4-U 웹검색 단계 — 백과사전+지식iN+카페글을 동시 조회해 도메인 신호로 재정렬한다.
 * 법적 근거로 쓰지 않는다는 전제(모듈 상단 불변식 참조) 위에서만 호출할 것.
 * @param {string} query - 미등재 용어(예: "깔때기")
 * @param {{display?: number}} opts - display 기본 10(넉넉히 받아도 API 호출 1회당 비용은 동일)
 * @returns {Promise<Array<{source:string,title:string,link:string,snippet:string,score:number}>>}
 *   score 내림차순 정렬. 상위 항목이 가장 유력한 후보.
 * @연계 이 결과를 그대로 사용자에게 보여주지 말고, Gemini에 우리 정체성 문맥과 함께
 *   넘겨 최종 해석을 받은 뒤(§4-U 3단계) 사용자에게 되물어 확인할 것.
 */
async function searchTermMeaning(query, opts = {}) {
  const display = opts.display || 10;
  const [encyc, kin, cafe] = await Promise.all([
    callSearch('/search/v1/encyc', { query, display: String(display) }),
    callSearch('/search/v1/kin', { query, display: String(display) }),
    callSearch('/search/v1/cafearticle', { query, display: String(display) }),
  ]);
  const tag = (items, source) => items.map(it => ({
    source,
    title: it.title,
    link: it.link,
    snippet: it.description || '',
    score: domainScore(it),
  }));
  const all = [...tag(encyc.items, 'encyc'), ...tag(kin.items, 'kin'), ...tag(cafe.items, 'cafearticle')];
  return all.sort((a, b) => b.score - a.score);
}

module.exports = { correctTypo, searchTermMeaning, domainScore };
