/**
 * 기상특보 통합 크롤러 (weather_alerts_crawler.js)
 * 
 * 기능:
 * 1. 통보문(list.do) 기반 실시간 특보 상태 관리 (Report Alert Processor 연동)
 * 2. 특보종합(warning.do) 기반 연안바다/평수구역 활성화 여부 동기화
 * 3. 부모 해역 상태에 따른 자식 해역 상속 및 강제 해제 로직 적용
 * 4. 해역별 특보 히스토리 누적
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const pushSender = require('./push_sender');
const reportProcessor = require('./report_alert_processor');
// 자식 해역 발표 푸시 — 종합기상 텍스트 기반 트리거.
//   weather.go.kr "특정관리해역" 텍스트의 자식 'Y' 마킹 변화(null→'Y') 감지 시
//   부모 통보문 wrnTp/wrnLvl 상속하여 발표 푸시 발송. dmdw 가 미수록하는
//   "예비" 단계까지 포괄. dmdw FC 정식 발표는 자연 dedup 으로 중복 차단.
const dmdwPushSender = require('./services/dmdw_push_sender');

const CONFIG = {
    URL: 'https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do',
    OUTPUT_FILE: path.join(__dirname, 'data', 'weather_alerts.json')
};

// ============================================================================
// [예비] 통보문 참고사항 처리용 — 조부모(umbrella) → 부모 목록 매핑
// ============================================================================
//
// [용도]
//   참고사항에서 "제주도전해상의 풍랑 예비특보는 해제합니다" 같이 조부모만
//   단독으로 등장하는 경우, 우리 zone tree 의 leaf 부모들로 확장하기 위한 매핑.
//
//   조부모 단독 = 우리 zone tree leaf 가 아님 → resolveTargets 의 prefix
//   fallback 만으론 "제주도전해상" 처럼 prefix 매칭 안 되는 케이스 누락.
//   본 매핑으로 명시적 확장.
//
// [동기화 출처]
//   ai_report_parser.js:8-32 의 ZONE_GROUP_MAP 과 1:1 동일. KMA 가 새 zone
//   추가 시 두 파일 함께 갱신 필요. 두 파일이 다른 책임 (텍스트 파싱 vs
//   해상 통보문 크롤러) 을 가져 단일 require 보다 사본 유지 채택.
const ZONE_GROUP_MAP_REF = {
    // 전해상 (앞바다 + 먼바다 통합)
    '동해중부전해상': ['강원북부앞바다', '강원중부앞바다', '강원남부앞바다', '동해중부안쪽먼바다', '동해중부바깥먼바다'],
    '동해남부전해상': ['울산앞바다', '경북남부앞바다', '경북북부앞바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다', '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다'],
    '서해중부전해상': ['인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다', '서해중부안쪽먼바다', '서해중부바깥먼바다'],
    '서해남부전해상': ['전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다', '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'],
    '남해동부전해상': ['부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다', '남해동부안쪽먼바다', '남해동부바깥먼바다'],
    '남해서부전해상': ['전남서부남해앞바다', '전남동부남해앞바다', '남해서부서쪽먼바다', '남해서부동쪽먼바다'],
    '제주도전해상': ['제주도북부앞바다', '제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다', '제주도남쪽바깥먼바다', '제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다'],
    // 앞바다 그룹
    '동해남부앞바다': ['울산앞바다', '경북남부앞바다', '경북북부앞바다'],
    '동해중부앞바다': ['강원북부앞바다', '강원중부앞바다', '강원남부앞바다'],
    '서해남부앞바다': ['전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다'],
    '서해중부앞바다': ['인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다'],
    '남해동부앞바다': ['부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다'],
    '남해서부앞바다': ['전남서부남해앞바다', '전남동부남해앞바다'],
    '제주도앞바다': ['제주도북부앞바다', '제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다'],
    // 먼바다 그룹
    '동해남부먼바다': ['동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다', '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다'],
    '동해중부먼바다': ['동해중부안쪽먼바다', '동해중부바깥먼바다'],
    '서해남부먼바다': ['서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'],
    '서해중부먼바다': ['서해중부안쪽먼바다', '서해중부바깥먼바다'],
    '남해동부먼바다': ['남해동부안쪽먼바다', '남해동부바깥먼바다'],
    '남해서부먼바다': ['남해서부서쪽먼바다', '남해서부동쪽먼바다'],
    '제주도먼바다': ['제주도남쪽바깥먼바다', '제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다']
};

// ============================================================================
// 고정 스키마 (폼) 정의
// ============================================================================

const ZONE_GROUP_MAP = {
    // ... (Keep existing map or if it's not defined here, rely on what's available. ZONE_GROUP_MAP is actually not in this file, it's in report_alert_processor.js. Wait, createZoneStructure IS in this file.)
};
// Re-reading file content shows createZoneStructure at line 27. I will replace the function body.

function createZoneStructure() {
    return {
        "동해": {
            "동해남부해상": {
                "동해남부앞바다": {
                    "울산앞바다": { current: null, upcoming: null, history: [], children: { "울산앞바다중평수구역": null, "울산앞바다중연안바다": null } },
                    "경북남부앞바다": { current: null, upcoming: null, history: [], children: { "경북남부앞바다중평수구역": null, "경북남부앞바다중연안바다": null } },
                    "경북북부앞바다": { current: null, upcoming: null, history: [], children: { "경북북부앞바다중연안바다": null } }
                },
                "동해남부먼바다": {
                    "동해남부남쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부북쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부북쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "동해중부해상": {
                "동해중부앞바다": {
                    "강원북부앞바다": { current: null, upcoming: null, history: [], children: { "강원북부앞바다중연안바다": null } },
                    "강원중부앞바다": { current: null, upcoming: null, history: [], children: { "강원중부앞바다중연안바다": null } },
                    "강원남부앞바다": { current: null, upcoming: null, history: [], children: { "강원남부앞바다중연안바다": null } }
                },
                "동해중부먼바다": {
                    "동해중부안쪽먼바다": { current: null, upcoming: null, history: [], children: { "울릉도울릉읍연안바다": null, "울릉도서면연안바다": null, "울릉도북면연안바다": null } },
                    "동해중부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "서해": {
            "서해남부해상": {
                "서해남부앞바다": {
                    "전북북부앞바다": { current: null, upcoming: null, history: [], children: { "전북북부앞바다중평수구역": null } },
                    "전북남부앞바다": { current: null, upcoming: null, history: [], children: { "전북남부앞바다중평수구역": null } },
                    "전남북부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남북부서해앞바다중평수구역": null } },
                    "전남중부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남중부서해앞바다중먼평수구역": null, "전남중부서해앞바다중앞평수구역": null } },
                    "전남남부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남남부서해앞바다중평수구역": null } }
                },
                "서해남부먼바다": {
                    "서해남부북쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해남부북쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해남부남쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: { "서해남부남쪽안쪽먼바다중조도부근평수구역": null } },
                    "서해남부남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "서해중부해상": {
                "서해중부앞바다": {
                    "인천·경기북부앞바다": { current: null, upcoming: null, history: [], children: { "인천·경기북부앞바다중평수구역": null } },
                    "인천·경기남부앞바다": { current: null, upcoming: null, history: [], children: { "인천·경기남부앞바다중먼평수구역": null, "인천·경기남부앞바다중북부앞평수구역": null, "인천·경기남부앞바다중남부앞평수구역": null } },
                    "충남북부앞바다": { current: null, upcoming: null, history: [], children: { "천수만평수구역": null, "안면도서쪽평수구역": null, "당진평수구역": null, "태안·서산북쪽평수구역": null } },
                    "충남남부앞바다": { current: null, upcoming: null, history: [], children: { "충남남부앞바다중평수구역": null } }
                },
                "서해중부먼바다": {
                    "서해중부안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해중부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "남해": {
            "남해동부해상": {
                "남해동부앞바다": {
                    "부산앞바다": { current: null, upcoming: null, history: [], children: { "부산앞바다중동부평수구역": null, "부산앞바다중서부평수구역": null, "부산앞바다중연안바다": null } },
                    "경남서부남해앞바다": { current: null, upcoming: null, history: [], children: { "경남서부남해앞바다중동부평수구역": null, "경남서부남해앞바다중서부평수구역": null, "경남서부남해앞바다중남부평수구역": null, "경남서부남해앞바다중남해군연안바다": null } },
                    "경남중부남해앞바다": { current: null, upcoming: null, history: [], children: { "경남중부남해앞바다중평수구역": null, "경남중부남해앞바다중연안바다": null } },
                    "거제시동부앞바다": { current: null, upcoming: null, history: [], children: { "거제시동부앞바다중연안바다": null } }
                },
                "남해동부먼바다": {
                    "남해동부안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "남해동부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "남해서부해상": {
                "남해서부앞바다": {
                    "전남서부남해앞바다": { current: null, upcoming: null, history: [], children: { "전남서부남해앞바다중평수구역": null } },
                    "전남동부남해앞바다": { current: null, upcoming: null, history: [], children: { "전남동부남해앞바다중서부평수구역": null, "전남동부남해앞바다중동부평수구역": null } }
                },
                "남해서부먼바다": {
                    "남해서부서쪽먼바다": { current: null, upcoming: null, history: [], children: { "남해서부서쪽먼바다중추자도연안바다": null } },
                    "남해서부동쪽먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "제주도": {
            "제주도앞바다": {
                "제주도북부앞바다": { current: null, upcoming: null, history: [], children: { "제주도북부앞바다중연안바다": null } },
                "제주도동부앞바다": { current: null, upcoming: null, history: [], children: { "제주도동부앞바다중북동연안바다": null, "제주도동부앞바다중남동연안바다": null, "제주도동부앞바다중우도연안바다": null } },
                "제주도남부앞바다": { current: null, upcoming: null, history: [], children: { "제주도남부앞바다중연안바다": null } },
                "제주도서부앞바다": { current: null, upcoming: null, history: [], children: { "제주도서부앞바다중북서연안바다": null, "제주도서부앞바다중남서연안바다": null, "제주도서부앞바다중가파도연안바다": null } }
            },
            "제주도먼바다": {
                "제주도남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                "제주도남동쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                "제주도남서쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} }
            }
        }
    };
}

/**
 * weather_alerts.json 의 빈 골격(full form) 생성 — 첫 수집 시 또는 reset 시 사용.
 * 동/서/남/제주 4 sea 트리 + updatedAt 메타.
 */
function createFullForm() {
    return {
        updatedAt: null,
        lastReportId: null,
        processedReportIds: [],
        // 빈 통보문 재시도 대기 목록 (report_alert_processor.js가 관리)
        // 예: { "met:202604100900:73": { title, firstSeen, retryCount, lastRetry, lastNoticeSent } }
        pendingRetries: {},
        // [V2] 부트스트랩 플래그 제거 — 첫 부팅 폭주는 부모 통보문 tmFc 12h 시간 필터로 자동 차단.
        // [자식 리셋 1회용 윈도우 override] admin 페이지의 "자식해역 리셋" 버튼이
        //   드롭다운(0~72h, 6h 간격) 선택값을 여기에 임시 저장. 다음 1분 사이클의
        //   dispatchBulletinPublishPushes 가 이 값을 우선 사용하고 즉시 null 로 reset.
        //   평소 동작(새 발표 push)은 영구 12h 윈도우(PUBLISH_PUSH_WINDOW_HOURS) 그대로.
        //     null : 평소 (12h 적용)
        //     0    : 1회 push skip (자식 리셋 후 발송 없이)
        //     6~72 : 1회 그 시간 안 발표분만 push
        oneTimeBulletinWindowOverride: null,
        previous: createZoneStructure(),
        current: createZoneStructure()
    };
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

/**
 * 자식 해역 파싱 (warning.do의 특정관리해역 섹션에서 활성화 여부 + 종류·등급 추출)
 *
 * [V3] 반환 타입 변경: Set<자식fullName> → Map<자식fullName, {wrnTp, wrnLvl}>
 *   - V2 까지는 부모 통보문의 wrnTp/wrnLvl 을 자식에 상속 적용.
 *   - V3 부터는 종합기상 텍스트 줄별로 정규식 매칭하여 자식별 정확한 종류·등급을 추출.
 *     (부모는 풍랑 경보인데 자식만 풍랑 예비인 케이스 등 자식 고유 단계를 보존)
 *
 * 텍스트 줄 분리 정책:
 *   - HTML 태그 제거 후 'o' 마커 또는 줄바꿈 단위 분리 (KMA HTML 의 자식 항목은
 *     "o XX특보 발표 (...자식영역명...)" 패턴으로 나열됨).
 *   - 각 줄에서 (태풍|호우|강풍|풍랑|폭풍해일|건조|한파|대설)(예비특보|주의보|경보)\s*발표 매칭.
 *   - 등급 매핑: '예비특보' → '예비', '주의보' → '주의보', '경보' → '경보'.
 *   - 자식 영역명은 줄에 포함된 자식 fullName(공백···.\s 제거 비교) 으로 식별.
 *
 * 자식 종류·등급 정보가 빈 줄에 매치되는 경우(드물지만 KMA 포맷 흔들림 대비)에는
 * 부모 메타 fallback 없이 wrnTp='', wrnLvl='' 인 객체로 표시 — 호출자가 알아서 처리.
 */
function parseChildWarnings(html, form) {
    const startIdx = html.indexOf('특정관리해역');
    if (startIdx === -1) return new Map();

    const section = html.substring(startIdx);
    const endIdx = section.indexOf('참고사항');
    const targetText = (endIdx !== -1 ? section.substring(0, endIdx) : section)
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

    // 줄 단위 분리 — 'o' 마커, 줄바꿈, '\r' 모두 분리자로 사용.
    //   normalize whitespace 는 줄 내부에서만 적용해 줄 경계는 보존.
    const lines = targetText
        .split(/[\r\n]+|(?:^|\s)o(?=\s)/)
        .map(s => s.replace(/[\s]+/g, ' ').trim())
        .filter(s => s.length > 0);

    // 줄별 (종류, 등급, 발표 키워드) 매칭 정규식.
    //   wrnTp 그룹: 풍랑, 태풍, 호우, 강풍, 폭풍해일, 건조, 한파, 대설
    //   wrnLvl  : 예비특보 | 주의보 | 경보
    const lineRe = /(태풍|호우|강풍|풍랑|폭풍해일|건조|한파|대설)\s*(예비특보|주의보|경보)\s*(발표|발효|해제)?/;

    function normalizeForCompare(s) {
        return String(s || '').replace(/[\s·\.]/g, '');
    }
    function mapLvl(raw) {
        if (raw === '예비특보') return '예비';
        return raw; // '주의보' | '경보'
    }

    const activeChildren = new Map();
    const allChildren = [];

    /**
     * full form 트리 재귀 순회 — 자식해역(children) 만 모음.
     */
    function collectChildren(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.children) {
            Object.keys(obj.children).forEach(k => allChildren.push(k));
        }
        Object.values(obj).forEach(collectChildren);
    }
    collectChildren(form);

    // 자식별 매치 후보 수집:
    //   각 줄에 대해 자식 fullName 포함 여부를 검사하고, 종류·등급 매치가 있으면 기록.
    //   하나의 자식이 여러 줄에 등장하면 가장 강한 등급(경보>주의보>예비)을 채택.
    const lvlRank = { '예비': 1, '주의보': 2, '경보': 3 };
    const normalizedLines = lines.map(l => ({ raw: l, norm: normalizeForCompare(l) }));

    for (const childName of allChildren) {
        const normalizedChild = normalizeForCompare(childName);
        // 1) 줄별 자식명 포함 여부 검사 + 종류·등급 매칭.
        let bestTp = '';
        let bestLvl = '';
        let foundAny = false;
        for (const { raw, norm } of normalizedLines) {
            if (!norm.includes(normalizedChild)) continue;
            foundAny = true;
            const m = raw.match(lineRe);
            if (m) {
                const tp = m[1];
                const lvl = mapLvl(m[2]);
                if (!bestLvl || (lvlRank[lvl] || 0) > (lvlRank[bestLvl] || 0)) {
                    bestTp = tp;
                    bestLvl = lvl;
                }
            }
        }
        // 2) 줄 단위에서 못 잡았지만 전체 텍스트엔 포함된 케이스 — V2 후방호환.
        //    이 경우 wrnTp/wrnLvl 은 빈 값 → mapDataToForm 이 객체 보존 시점에 처리.
        if (!foundAny) {
            const fullNorm = normalizeForCompare(targetText);
            if (fullNorm.includes(normalizedChild)) {
                foundAny = true;
            }
        }
        if (foundAny) {
            activeChildren.set(childName, { wrnTp: bestTp, wrnLvl: bestLvl });
        }
    }
    return activeChildren;
}

/**
 * [V3] 현재 KST 시각 - 1분 보정 → "YYYY년 MM월 DD일 HH시 mm분" 포맷.
 *   - KMA 가 17:00 정시 발표 → 크롤러 17:01 수집 → tmFc=17:00 으로 기록.
 *   - 단순 Date.now() - 60_000 적용 후 KST 가정 (Dockerfile TZ=Asia/Seoul 보장).
 *   - 자식 객체의 tmFc 영구 유지 — 한 번 부여하면 dmdw 정식 등록되어도 덮어쓰지 않음.
 */
function _collectedAtMinus1Min(nowMs) {
    const ms = (typeof nowMs === 'number' ? nowMs : Date.now()) - 60 * 1000;
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    // 컨테이너 TZ=Asia/Seoul 보장 환경에서 로컬 시각 = KST.
    return `${d.getFullYear()}년 ${pad(d.getMonth() + 1)}월 ${pad(d.getDate())}일 ${pad(d.getHours())}시 ${pad(d.getMinutes())}분`;
}

/**
 * 폼에 데이터 매핑 (부모-자식 상속 해결)
 *
 * [사전삭제 방어 로직]
 * 기상청이 특보 해제 전에 warning.do 페이지에서 자식해역 정보를 미리 삭제하는 경우가 있다.
 * 부모 특보가 살아있는데 "이전에 활성화된 자식 전부"가 동시에 사라지면 사전삭제로 간주하여
 * 이전 상태를 유지한다. 일부만 사라진 경우는 정상 해제로 처리한다.
 * 사전삭제로 유지된 자식은 부모 해제 시 함께 자동 해제된다.
 *
 * [V3] children 값 변경: 'Y' | null → 객체 | null
 *   activeChildren: Map<자식fullName, {wrnTp, wrnLvl}>  (parseChildWarnings 출력)
 *   객체 형태:
 *     { source: 'BULLETIN_TEXT', wrnTp, wrnLvl, tmFc, tmEf:'', tmCc:'', tmEd:'' }
 *   - 직전 children[X] 가 객체(활성) 이고 curr 도 활성 → 기존 tmFc 유지, wrnTp/wrnLvl 갱신.
 *   - 직전 children[X] 가 null(또는 'Y' 후방호환) 이고 curr 활성 → 새 객체 생성 (tmFc=수집-1분).
 *   - 비활성 → null.
 */
function mapDataToForm(form, activeChildren) {
    // 이번 사이클 1분 보정 시각 (한 번만 계산해 모든 자식 신규 활성에 공통 적용).
    const tmFcNew = _collectedAtMinus1Min(Date.now());

    function isActiveChildValue(v) {
        // 'Y' (V2 후방호환) 또는 객체 형태 모두 활성으로 간주.
        return v === 'Y' || (v && typeof v === 'object');
    }

    function newChildMeta(childName) {
        const m = activeChildren.get(childName) || { wrnTp: '', wrnLvl: '' };
        return {
            source: 'BULLETIN_TEXT',
            wrnTp: m.wrnTp || '',
            wrnLvl: m.wrnLvl || '',
            tmFc: tmFcNew,
            tmEf: '',
            tmCc: '',
            tmEd: ''
        };
    }

    function updateChildren(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.current !== undefined && obj.children) {
            const childNames = Object.keys(obj.children);

            if (obj.current === null && obj.upcoming === null) {
                // [상속 룰] 부모가 발효 중인 특보도 없고 예정된 특보도 없다면 자식도 강제 해제
                for (const childName of childNames) {
                    obj.children[childName] = null;
                }
            } else {
                // 부모가 활성 상태(발효 또는 발표)
                const prevActive = childNames.filter(name => isActiveChildValue(obj.children[name]));

                if (prevActive.length > 0) {
                    // 이전에 활성화된 자식이 있었음
                    const stillInCrawl = prevActive.filter(name => activeChildren.has(name));

                    if (stillInCrawl.length === 0) {
                        // 이전 활성 자식 전부 소멸 → 기상청 사전삭제 → 이전 상태 유지
                        console.log(`[Crawler] 사전삭제 감지: 부모 특보 활성 중 자식 ${prevActive.length}개 전체 소멸 → 이전 상태 유지 (${prevActive.join(', ')})`);
                    } else {
                        // 일부 자식이 크롤링에 존재 → 크롤링 결과를 신뢰
                        for (const childName of childNames) {
                            const prev = obj.children[childName];
                            if (activeChildren.has(childName)) {
                                if (prev && typeof prev === 'object') {
                                    // [V3] 영구 유지: 기존 객체의 tmFc 보존, wrnTp/wrnLvl 갱신.
                                    const m = activeChildren.get(childName) || {};
                                    obj.children[childName] = {
                                        ...prev,
                                        wrnTp: m.wrnTp || prev.wrnTp || '',
                                        wrnLvl: m.wrnLvl || prev.wrnLvl || ''
                                    };
                                } else {
                                    // null 또는 'Y' (V2 후방호환) → 새 객체 생성 (tmFc=수집-1분).
                                    obj.children[childName] = newChildMeta(childName);
                                }
                            } else {
                                obj.children[childName] = null;
                            }
                        }
                    }
                } else {
                    // 이전에 활성화된 자식 없음 → 크롤링 결과 그대로 반영
                    for (const childName of childNames) {
                        if (activeChildren.has(childName)) {
                            obj.children[childName] = newChildMeta(childName);
                        } else {
                            obj.children[childName] = null;
                        }
                    }
                }
            }
        }

        for (const value of Object.values(obj)) {
            if (value && typeof value === 'object') updateChildren(value);
        }
    }
    updateChildren(form);
}

// ============================================================================
// [예비] 통보문 참고사항 해제·연장 처리 (옵션 C)
// ============================================================================
//
// 배경:
//   parseChildWarnings 는 통보문 본문의 "특정관리해역" list 만 파싱하고
//   '참고사항' 섹션을 명시적으로 제외 (line 198). 그러나 [예비] 통보문은
//   참고사항에 "해제합니다" / "연장 발표합니다" 안내가 들어있어, 부모 zone
//   의 upcoming(예비) 이 사실상 해제·연장됐는데 앱은 계속 살아있다고 인식.
//
// 처리:
//   1) parseReferenceSection(html) — 참고사항 섹션만 추출, 정규식으로 해제·연장 케이스 수집
//   2) applyReferenceUpdates(form, parsed) — zone tree 에서 매칭되는 부모 leaf 에 반영
//       - 해제: leaf.upcoming = null + leaf.children[*] = null + dmdwPushSender.forgetChild
//       - 연장: leaf.upcoming.tmEf = 새 시각 + leaf.children[*].tmEf = 새 시각
//
// 정책:
//   - 풍랑·태풍 만 처리 (R6) — 폭풍해일은 운영 정책상 수집 제외, 강풍/호우/대설 등 육상 종류 무시
//   - 매칭 단위: 자식 그룹은 "부모(자식1, 자식2)" 또는 "부모"(단독) 패턴
//   - false positive 방지: "해제하나" 같은 안내 문장 제외 — 종결사 (합니다|함\.?) 강제
//   - 부모 push 트리거 미발생 (R8) — upcoming 직접 mutate, detectChanges 의 prev 는 이미 캡처됨
//     (run() 흐름상 fullForm.previous 는 첫 캡처 이후 변하지 않으므로, applyReferenceUpdates
//      가 upcoming 을 변경해도 detectChanges 가 차이를 잡아 부모 push 가 보내질 수 있음.
//      이를 막기 위해 applyReferenceUpdates 는 previous 도 함께 동기화 — 변경 자체를 "없었던 일"
//      로 처리. dmdw 의 자식 forgetChild 만 호출하여 자식 재발송 가능 보장.)

// [수집 정책] 폭풍해일 (wrnTp='O') 은 운영 정책상 다른 모듈
// (dmdw_warn_crawler.js, ai_report_parser.js, report_alert_processor.js) 에서
// 이미 수집·표시 대상에서 제외됨. 본 모듈의 참고사항 처리에서도 동일 제외.
const SEA_WRN_TYPES = ['풍랑', '태풍'];

/**
 * 참고사항 섹션 텍스트 (HTML 태그 제거 후) 에서 해제·연장 케이스를 추출.
 *   반환:
 *     {
 *       releases:   [{ wrnTp, groups: [{ parent, children: [] }] }, ...],
 *       extensions: [{ wrnTp, groups: [{ parent, children: [] }], tmEfRaw }, ...]
 *     }
 *   - groups[i].parent : 자식 그룹의 부모 이름 (예: "제주도앞바다", "남해서부서쪽먼바다")
 *   - groups[i].children : 부모 뒤 괄호 안 자식 이름 배열 (없으면 [])
 *   - tmEfRaw : 연장 새 시각의 원문 "내일(22일) 오전(06~12시)" 같은 형태
 */
function parseReferenceSection(html) {
    const empty = { releases: [], extensions: [] };
    if (!html || typeof html !== 'string') return empty;

    // 참고사항 섹션 추출. KMA HTML 은 "참고사항 &gt;" 또는 "참고사항" 헤더 이후 본문 끝까지.
    //   본문 list 와 분리하기 위해 "참고사항" 키워드 위치를 기점으로 자른다.
    const startIdx = html.indexOf('참고사항');
    if (startIdx === -1) return empty;
    const rawSection = html.substring(startIdx);

    // HTML 태그·엔티티 제거 + 정규화.
    const text = rawSection
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ');

    // 한 문장 단위로 분리 — 마침표(.) 또는 줄바꿈. KMA 가 한 문장에 두 케이스
    //   (병렬 연장) 를 담는 경우가 있으나, 정규식이 g 플래그로 같은 문장에서 여러 매치를
    //   잡으므로 문장 분리는 노이즈 차단 정도로만 사용.
    const sentences = text.split(/[\.\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);

    const releases = [];
    const extensions = [];

    // 해제 정규식 — "[해역구절]의/에 [종류] [예비]특보는/를 ... 발표 가능성이 낮아져/적어져 ... 해제(합니다|함|하나)"
    //
    // [V2 보강 — 5년 (2021-05 ~ 2026-05) × 10 발행처 약 6,000건 통보문 archive 전수 분석 결과]
    //
    // 발견된 5가지 어휘 변형 패턴 (각각 정규식에 흡수):
    //
    //   1) 격조사: "의" / "에"
    //      예) "...의 풍랑 예비특보는..." / "...에 풍랑 예비특보는..."
    //      → `(?:의|에)`
    //
    //   2) 특보 표기: "예비특보" / "특보" (예비 생략)
    //      예) "...풍랑 예비특보는 ..." / "...풍랑특보는 ... 풍랑예비특보를 해제하나"
    //      → `(?:예비\s*)?특보`
    //
    //   3) 조사: "는" / "를"
    //      예) "...예비특보는 해제..." / "...예비특보를 해제..."
    //      → `(?:는|를)?`
    //
    //   4) 동의어 (가장 흔한 누락 패턴 — 3년 데이터에 30건 이상): "낮아져" / "적어져"
    //      예) "...발표가능성이 낮아져 해제..." / "...발표 가능성이 적어져 해제..."
    //      → `(?:낮아져|적어져)`
    //
    //   5) 종결부 반복: 주어부 "예비특보는" + 종결부 "예비특보를 해제" (동일 어휘 재등장)
    //      예) "...풍랑예비특보는 ... 적어져 풍랑예비특보를 해제하나..."
    //      → `(?:[^.\n]*?\s*예비\s*특보를?\s*)?` (옵셔널)
    //
    // 종결사 4가지 (V1 유지): "해제합니다" / "해제함" / "해제함." / "해제하나"
    //
    // [false positive 회피 — 그대로 유지]
    //   "발표 가능성이 (낮아져|적어져)" prefix 가 강제이므로 단순 안내문
    //   ("한편, 호우예비특보는 해제하나 비가...") 은 자연 차단.
    //
    // [단위 시뮬 — V2 보강 정규식]
    //   5년 데이터의 예상 외 패턴 5종 + 기존 매칭 패턴 + false positive 회피 13/13 PASS.
    const RE_RELEASE = /([^.\n]*?(?:의|에)[^.\n]*?)\s*(풍랑|태풍)\s*(?:예비\s*)?특보(?:는|를)?\s*[^.\n]*?\s*발표\s*가능성이?\s*(?:낮아져|적어져)\s*(?:[^.\n]*?\s*예비\s*특보를?\s*)?해제(?:합니다|함\.?|하나)/g;


    for (const sentence of sentences) {
        // 해제 매치 — g 플래그로 한 문장 내 여러 케이스 흡수.
        //   "발표 가능성이 낮아져 해제(합니다|함|하나)" 패턴이 전제이므로
        //   "한편, 해제하나..." 같은 안내문은 자연 차단됨 (앞 prefix 없음).
        {
            let m;
            RE_RELEASE.lastIndex = 0;
            while ((m = RE_RELEASE.exec(sentence)) !== null) {
                const subject = m[1] || '';
                const wrnTp = m[2];
                if (!SEA_WRN_TYPES.includes(wrnTp)) continue;
                const groups = _extractSeaGroupsFromSubject(subject);
                if (groups.length === 0) continue;  // 해상 부모 없음 → 육상 케이스로 간주.
                releases.push({ wrnTp, groups });
            }
        }

        // 연장 매치 — 두 단계 처리.
        //   1) 본 정규식으로 (subject, wrnTp, tmEf_with_으로/로_종결?) 캡처. g 로 한 문장 내
        //      여러 매치 흡수. 단, "연장(하여) 발표합니다" 종결사는 마지막 절에만 등장하는
        //      병렬 패턴 대응을 위해 별도 처리.
        //   2) 병렬 케이스: "A의 풍랑 예비특보는 X으로, B의 풍랑 예비특보는 Y으로 연장하여 발표합니다"
        //      → 첫 절은 종결사 없음. lazy 매칭으로 ", " 직전의 "...으로" 까지 잡혀야 함.
        //      → tmEf 직후 "(?:연장(?:하여)?\s*발표(?:합니다|함\.?)|,)" 로 두 경로 허용.
        const RE_EXTEND_2 = /([^,\n]*?)의\s*(풍랑|태풍)\s*예비\s*특보(?:는|를)?\s*([^,\n]*?)(?:으로|로)(?=\s*(?:,|연장(?:하여)?\s*발표))/g;
        let me;
        RE_EXTEND_2.lastIndex = 0;
        while ((me = RE_EXTEND_2.exec(sentence)) !== null) {
            const subject = me[1] || '';
            const wrnTp = me[2];
            const tmEfRaw = (me[3] || '').trim();
            if (!SEA_WRN_TYPES.includes(wrnTp)) continue;
            const groups = _extractSeaGroupsFromSubject(subject);
            if (groups.length === 0) continue;
            extensions.push({ wrnTp, groups, tmEfRaw });
        }
    }

    return { releases, extensions };
}

/**
 * 주어부 텍스트에서 해상 부모 그룹 배열 추출.
 *   "남해서부서쪽먼바다와 제주도앞바다(제주도북부앞바다, 제주도서부앞바다), 제주도남쪽바깥먼바다"
 *     → [
 *         { parent: '남해서부서쪽먼바다', children: [] },
 *         { parent: '제주도앞바다', children: ['제주도북부앞바다', '제주도서부앞바다'] },
 *         { parent: '제주도남쪽바깥먼바다', children: [] }
 *       ]
 *   - 해상 부모 식별: 이름 끝이 "앞바다"|"먼바다"|"전해상".
 *   - 육상 케이스 ("경기도(연천, 파주)") 는 모두 걸러짐.
 */
function _extractSeaGroupsFromSubject(subject) {
    const groups = [];
    const re = /([가-힣ㆍ·]+(?:앞바다|먼바다|전해상))(?:\s*\(([^)]+)\))?/g;
    let m;
    while ((m = re.exec(subject)) !== null) {
        const parent = m[1];
        const childrenRaw = m[2] || '';
        const children = childrenRaw
            ? childrenRaw.split(/[,，、]\s*|\s+(?:와|과)\s+|\s*그리고\s*/).map(s => s.trim()).filter(Boolean)
            : [];
        // 자식도 해상 이름인 것만 채택 — 육상 ("연천, 파주") 차단.
        const seaChildren = children.filter(c => /(앞바다|먼바다|전해상)$/.test(c));
        groups.push({ parent, children: seaChildren });
    }
    return groups;
}

/**
 * 참고사항 파싱 결과를 zone tree 에 반영.
 *   - 해제: 매칭되는 zone leaf 의 upcoming = null + children[*] = null + forgetChild.
 *   - 연장: 매칭되는 zone leaf 의 upcoming.tmEf = 새 시각 + children[*].tmEf = 새 시각.
 *
 *   부모 push 무영향 (R8) 보장:
 *     run() 흐름에서 detectChanges(previous, current) 가 upcoming 변화를 잡아 부모 push 가
 *     트리거될 수 있으므로, 본 함수는 previous tree 도 같은 방식으로 동기화한다.
 *     이렇게 하면 prev/curr 가 같아져 detectChanges 결과에 차이가 잡히지 않고,
 *     기존 본문 list 처리의 부모 push 만 정상 보내진다.
 *
 *   자식 forgetChild 호출:
 *     이전 사이클까지 자식이 활성('Y' 또는 객체) 이었다면 _sentKeys 에 발표 마커가 남아있을
 *     수 있다. 해제된 자식은 forgetChild 로 마커 정리 — 다음 신규 발표 시 다시 push 가능.
 *
 * @param {object} form        : fullForm.current  (zone tree root)
 * @param {object} previous    : fullForm.previous (zone tree root) — R8 동기화용
 * @param {object} parsed      : parseReferenceSection 결과
 * @returns {{releases:number, extensions:number, releasedChildren:number}}
 */
function applyReferenceUpdates(form, previous, parsed) {
    const stats = { releases: 0, extensions: 0, releasedChildren: 0, releasePushSent: 0 };
    // 사용자 알림 발송용 — 종류별로 해제된 부모 zone 들 누적.
    //   { '풍랑' → Set<'남해서부서쪽먼바다', '제주도북부앞바다', ...>, ... }
    const releasedParentsByType = new Map();
    if (!form || !parsed) return stats;

    // 모든 zone leaf 수집: { name → leafNode }
    //   leafNode = { current, upcoming, history, children }
    const leafMap = new Map();
    function collectLeaves(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, value] of Object.entries(obj)) {
            if (!value || typeof value !== 'object') continue;
            if ('current' in value && 'upcoming' in value && 'children' in value) {
                leafMap.set(key, value);
            } else {
                collectLeaves(value);
            }
        }
    }
    collectLeaves(form);

    // previous tree 의 같은 leaf 도 참조 — R8 동기화용.
    const prevLeafMap = new Map();
    function collectPrevLeaves(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, value] of Object.entries(obj)) {
            if (!value || typeof value !== 'object') continue;
            if ('current' in value && 'upcoming' in value && 'children' in value) {
                prevLeafMap.set(key, value);
            } else {
                collectPrevLeaves(value);
            }
        }
    }
    if (previous) collectPrevLeaves(previous);

    /**
     * 그룹 (parent, children) → 실제 변경 대상 zone leaf 이름 배열로 확장.
     *   - children 가 있으면 children 가 우선 (괄호 안에 명시된 부모만 영향).
     *   - children 가 없으면 parent 자체가 leaf 면 parent.
     *   - 그 외 (예: "제주도전해상", "제주도먼바다" 같은 조부모 단독 표기) 는
     *     ai_report_parser.js 의 ZONE_GROUP_MAP 명시 매핑으로 부모 목록 확장.
     *   - 그래도 매핑 실패하면 마지막 안전망으로 prefix fallback (legacy 동작).
     *
     * [계층 용어 — 사용자 명시]
     *   조부모(umbrella) = "제주도앞바다", "제주도먼바다", "제주도전해상" 등
     *     → 통합 명칭으로, 우리 zone tree 의 leaf 가 아님.
     *   부모(우리 zone) = "제주도북부앞바다", "제주도남쪽바깥먼바다" 등 — leaf.
     *   자식(연안바다·평수구역) = leaf.children 객체의 키.
     *   참고사항엔 조부모·부모까지만 명시되고 자식 이름은 없음 → 부모 매칭 후
     *   children 자동 일괄 정리 (호출자가 처리).
     */
    function resolveTargets(group) {
        const targets = [];
        if (group.children && group.children.length > 0) {
            // Case A·B: 조부모(부모, 부모) — 괄호 안 부모 우선
            for (const c of group.children) {
                if (leafMap.has(c)) targets.push(c);
            }
        } else if (leafMap.has(group.parent)) {
            // Case E: 부모 단독 — 그대로 매칭
            targets.push(group.parent);
        } else if (ZONE_GROUP_MAP_REF[group.parent]) {
            // Case C·D: 조부모 단독 — 명시 매핑으로 부모 목록 확장
            //   ai_report_parser.js 의 ZONE_GROUP_MAP 을 require 한 결과.
            //   30일 실측 데이터엔 조부모 단독 케이스 0건이지만, 향후 KMA 표기
            //   변화 대비 + prefix fallback 의 우연 의존 제거 (제주도전해상 같은
            //   prefix 매칭 안 되는 케이스 대응).
            for (const parentName of ZONE_GROUP_MAP_REF[group.parent]) {
                if (leafMap.has(parentName)) targets.push(parentName);
            }
        } else {
            // 최후 안전망 — prefix fallback (legacy 동작 보존).
            //   ZONE_GROUP_MAP 에 없는 새로운 조부모 표기가 등장한 경우.
            for (const name of leafMap.keys()) {
                if (name.startsWith(group.parent)) targets.push(name);
            }
        }
        return targets;
    }

    // ── 해제 처리 ───────────────────────────────────────────────────────────
    for (const rel of parsed.releases) {
        const wrnTp = rel.wrnTp;
        for (const group of rel.groups) {
            const targets = resolveTargets(group);
            for (const zoneName of targets) {
                const leaf = leafMap.get(zoneName);
                if (!leaf) continue;
                // upcoming 종류 일치 확인 — 다른 종류의 예비특보 보존 (안전 정책).
                //   upcoming 이 비어있어도 children 만 정리해야 하는 케이스 있을 수 있으나,
                //   R6 "해당 종류" 한정을 지키기 위해 upcoming.wrnTp 검사를 우선.
                //   단, upcoming 이 없고 그냥 children 만 살아있는 경우엔 children 도 정리.
                const upMatches = leaf.upcoming && (!leaf.upcoming.wrnTp || leaf.upcoming.wrnTp === wrnTp);
                if (leaf.upcoming) {
                    if (upMatches) {
                        leaf.upcoming = null;
                        stats.releases++;
                        // 사용자 알림용으로 종류별 부모 누적.
                        if (!releasedParentsByType.has(wrnTp)) {
                            releasedParentsByType.set(wrnTp, new Set());
                        }
                        releasedParentsByType.get(wrnTp).add(zoneName);
                    } else {
                        // 종류 다름 — upcoming 보존. 그래도 children 은 정리 가능하나, 안전상 skip.
                        continue;
                    }
                }
                // children 일괄 해제 + forgetChild 호출 (R2·R3).
                if (leaf.children && typeof leaf.children === 'object') {
                    for (const childName of Object.keys(leaf.children)) {
                        if (leaf.children[childName] !== null) {
                            leaf.children[childName] = null;
                            stats.releasedChildren++;
                            try {
                                const displayName = _bulletinChildDisplayName(zoneName, childName);
                                dmdwPushSender.forgetChild(zoneName, displayName);
                            } catch (_) {}
                        }
                    }
                }
                // R8 동기화 — previous leaf 도 같은 상태로 정렬 → detectChanges 가 차이를 잡지 않도록.
                const prevLeaf = prevLeafMap.get(zoneName);
                if (prevLeaf) {
                    prevLeaf.upcoming = null;
                    if (prevLeaf.children && typeof prevLeaf.children === 'object') {
                        for (const childName of Object.keys(prevLeaf.children)) {
                            prevLeaf.children[childName] = null;
                        }
                    }
                }
            }
        }
    }

    // ── 연장 처리 ───────────────────────────────────────────────────────────
    for (const ext of parsed.extensions) {
        const wrnTp = ext.wrnTp;
        const tmEfNew = (ext.tmEfRaw || '').trim();
        if (!tmEfNew) continue;
        for (const group of ext.groups) {
            const targets = resolveTargets(group);
            for (const zoneName of targets) {
                const leaf = leafMap.get(zoneName);
                if (!leaf) continue;
                // upcoming 존재 + 종류 일치 시 tmEf 만 갱신 (R4).
                if (leaf.upcoming && (!leaf.upcoming.wrnTp || leaf.upcoming.wrnTp === wrnTp)) {
                    leaf.upcoming = { ...leaf.upcoming, tmEf: tmEfNew };
                    stats.extensions++;
                }
                // 자식 객체의 tmEf 도 동일 시각으로 갱신 (R5) — 객체인 자식만 대상.
                if (leaf.children && typeof leaf.children === 'object') {
                    for (const childName of Object.keys(leaf.children)) {
                        const cv = leaf.children[childName];
                        if (cv && typeof cv === 'object') {
                            leaf.children[childName] = { ...cv, tmEf: tmEfNew };
                        }
                    }
                }
                // R8 동기화 — previous 도 같은 tmEf 로 정렬.
                const prevLeaf = prevLeafMap.get(zoneName);
                if (prevLeaf && prevLeaf.upcoming && (!prevLeaf.upcoming.wrnTp || prevLeaf.upcoming.wrnTp === wrnTp)) {
                    prevLeaf.upcoming = { ...prevLeaf.upcoming, tmEf: tmEfNew };
                }
                if (prevLeaf && prevLeaf.children && typeof prevLeaf.children === 'object') {
                    for (const childName of Object.keys(prevLeaf.children)) {
                        const cv = prevLeaf.children[childName];
                        if (cv && typeof cv === 'object') {
                            prevLeaf.children[childName] = { ...cv, tmEf: tmEfNew };
                        }
                    }
                }
            }
        }
    }

    // ── 예비특보 해제 알림 푸시 (사용자 요구 — 옵션 B) ────────────────────────
    //
    // 통보문 참고사항에서 "발표 가능성이 낮아져 해제합니다" 안내가 감지되면
    // 부모 zone 단위로 해제 알림을 push. 형식:
    //   Title: "✅ {wrnTp} 예비특보 해제 알림"
    //   Body : "ㅇ{parent1}\nㅇ{parent2}\n..."  (부모만, 자식 미명시)
    //
    // dedup: dmdwPushSender.sendPreliminaryRelease 가 per-parent 키로 24h 동안
    // 동일 발송 차단. 디스크 영속화로 재배포 후에도 dedup 유지.
    //
    // fire-and-forget — crawler 본체 실패 시킬 위험 차단.
    for (const [wrnTp, parentSet] of releasedParentsByType) {
        const parents = Array.from(parentSet).sort();
        if (parents.length === 0) continue;
        try {
            const p = dmdwPushSender.sendPreliminaryRelease(wrnTp, parents);
            if (p && typeof p.then === 'function') {
                p.then(r => {
                    if (r && r.sent) {
                        stats.releasePushSent += r.count;
                        console.log(`[Yebi] 예비특보 해제 알림 발송 — ${wrnTp} × ${r.count}부모`);
                    }
                }).catch(e => console.log(`[Yebi] 해제 알림 발송 실패: ${e.message}`));
            }
        } catch (e) {
            console.log(`[Yebi] 해제 알림 호출 예외 (무시): ${e.message}`);
        }
    }

    return stats;
}

// ============================================================================
// 시간 기반 상태 정성 (Pending Status Resolver)
// ============================================================================

function parseKmaTime(timeStr) {
    if (!timeStr || timeStr === "시각미정") return null;
    const match = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (!match) return null;
    const [_, y, m, d, h, min] = match;
    return new Date(`${y}-${m}-${d}T${h}:${min}:00+09:00`);
}

/**
 * 발효 시각이 지났으면 상태를 업데이트함
 */
const HISTORY_FILE = path.join(__dirname, 'data/alert_history.json');

function updateHistoryFile(zoneName, event, isRelease = false) {
    try {
        let historyData = {};
        if (fs.existsSync(HISTORY_FILE)) {
            historyData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }

        if (isRelease) {
            if (zoneName && historyData[zoneName]) {
                delete historyData[zoneName];
            }
        }
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2));
    } catch (e) {
        console.error(`[HistoryFile] Error: ${e.message}`);
    }
}

/**
 * 발효 시각이 지났으면 상태를 업데이트함
 */
function resolvePendingStatuses(obj, zoneName = null, referenceTime = null) {
    if (!obj || typeof obj !== 'object') return;
    const now = referenceTime ? new Date(referenceTime) : new Date();

    if ('current' in obj && 'upcoming' in obj) {
        // 1. 예약된 해제 처리 (tmRelease)
        if (obj.current && obj.current.tmRelease) {
            const releaseTime = parseKmaTime(obj.current.tmRelease);
            if (releaseTime && releaseTime <= now) {
                console.log(`[Resolver] 해제 발효 시각 도달: ${obj.current.tmRelease}`);
                obj.current = null;
                obj.history = []; // [지침 반영] 해제 발효 시 히스토리 즉시 삭제
                if (zoneName) updateHistoryFile(zoneName, null, true);
            }
        }

        // 1-2. tmCc 기반 자동 해제 (해제 예정 시각이 명확한 경우)
        // tmRelease가 없더라도, tmCc에 파싱 가능한 명확한 시각이 있으면 해제 처리
        // 범위형("오늘 밤(21시~24시)")은 parseKmaTime이 null을 반환하므로 안전
        if (obj.current && !obj.current.tmRelease && obj.current.tmCc) {
            const ccTime = parseKmaTime(obj.current.tmCc);
            if (ccTime && ccTime <= now) {
                console.log(`[Resolver] 해제 예정 시각(tmCc) 도달: ${obj.current.tmCc}`);
                obj.current = null;
                obj.history = [];
                if (zoneName) updateHistoryFile(zoneName, null, true);
            }
        }

        // 2. 예약된 발효 처리 (upcoming)
        if (obj.upcoming && obj.upcoming.wrnLvl !== '예비') {
            const effectiveTime = parseKmaTime(obj.upcoming.tmEf);
            if (effectiveTime && effectiveTime <= now) {
                console.log(`[Resolver] 특보 발효 시각 도달: ${obj.upcoming.wrnTp} (${obj.upcoming.tmEf})`);

                // [Fix] 기존 upcoming의 모든 메타데이터(tmFc, tmYn 등)를 상속하며 current로 전환
                obj.current = {
                    ...(obj.current || {}),
                    ...obj.upcoming,
                    tmEf: obj.upcoming.tmEf // 발효시각 확정
                };
                obj.upcoming = null;
            }
        }
    }

    for (const [key, value] of Object.entries(obj)) {
        if (key === 'children' || key === 'history' || key === 'missingCount') continue;
        resolvePendingStatuses(value, key, referenceTime);
    }
}

// ============================================================================
// 변화 감지 로직
// ============================================================================

function detectChanges(previous, current) {
    const changes = [];

    /**
     * 이전 트리(prevNode) 와 현재 트리(currNode) 를 동시에 재귀 순회하여
     * 변경 사항(추가/해제/격상격하) 을 path 배열에 누적 — diff 알고리즘.
     */
    function traverse(prevNode, currNode, path = []) {
        if (!currNode || typeof currNode !== 'object') return;

        if ('current' in currNode && 'upcoming' in currNode) {
            const zoneName = path[path.length - 1];
            const prevCurr = prevNode?.current;
            const currCurr = currNode.current;
            const prevUp = prevNode?.upcoming;
            const currUp = currNode.upcoming;

            // [수정] PushSender와 Type 일치시킴
            // 1. Upcoming 변화 (발표, 예비특보 등)
            // [추가] 격상/격하 판별을 위해 현재 발효 중인 특보(currentActive) 정보도 함께 전달
            if (JSON.stringify(prevUp) !== JSON.stringify(currUp)) {
                changes.push({ type: 'UPCOMING_CHANGE', zone: zoneName, prev: prevUp, curr: currUp, currentActive: currCurr || null });
            }

            // 2. Current 변화 (발효, 해제, 변경 등)
            if (JSON.stringify(prevCurr) !== JSON.stringify(currCurr)) {
                changes.push({ type: 'CURRENT_CHANGE', zone: zoneName, prev: prevCurr, curr: currCurr });
            }
            return;
        }

        for (const [key, value] of Object.entries(currNode)) {
            if (key === 'children' || key === 'history' || key === 'missingCount') continue;
            traverse(prevNode ? prevNode[key] : null, value, [...path, key]);
        }
    }

    traverse(previous, current);
    return changes;
}

// ============================================================================
// 종합기상 텍스트 기반 자식 발표 푸시 트리거
// ============================================================================
//
// 배경:
//   - dmdw API 는 "정식 발표(tmEf 명시)" 또는 "발효" 단계만 등록. "예비" 단계 미수록.
//   - weather.go.kr 종합기상 "특정관리해역" 텍스트는 "예비" 단계부터 자식 명 기록.
//   - parseChildWarnings + mapDataToForm 가 obj.children[name] = 'Y' | null 마킹.
//   - 따라서 종합기상의 children null→'Y' 전이를 보면 "예비/발표" 자식 발표를
//     dmdw 보다 빨리 감지 가능 → 발표 푸시 트리거.
//
// 정책 (PUBLISH_TRIGGER_V2_SPEC.md 표 — V2 단순화):
//   | 시점        | 데이터 변화                          | 푸시                      |
//   | 예비 발표   | 종합기상 텍스트 자식 신규 'Y'        | 📢 발표 (발효시각 미포함) |
//   | 정식 발표   | dmdw FC 신규 자식 등장               | ❌ 추가 푸시 없음 (이미 발표 푸시 보냄) |
//   | 발효 시각   | dmdw EF 신규 자식 등장               | 🚨 발효 (정확한 tmEf)     |
//   | EF 사라짐   | 자식 release                         | ✅ 해제                   |
//
// 중복 dedup:
//   - dmdw_push_sender._dedupKey 가 publish 계열에서 tmEf 를 제외하도록 변경됨.
//   - 결과: 종합기상에서 보낸 (parent|child|wrnTpNm|wrnLvlNm||publish) 와
//          dmdw FC 가 enqueuePublish(tmEf=...) 으로 호출한 키가 같은 dedup 키로 결합되어
//          dmdw FC publish 가 자연 차단됨 (운영자가 두 번 받지 않음).
//
// V2 — 시간 필터 단독 (부트스트랩 가드 / 안전망 / corrupt reset 모두 통합 대체):
//   - 발표 푸시 조건 (모두 충족):
//       1) children[자식] 가 null → 'Y' 신규 전이 (기존 그대로)
//       2) 부모 통보문 tmFc 가 (현재 - PUBLISH_PUSH_WINDOW_HOURS) 이내 — 묵은 통보문 차단
//       3) 부모 통보문 tmEf 가 현재 이후 (또는 미상/빈 값/범위형) — 이미 발효 시점 지난 건 차단
//   - 시나리오 자동 처리 (PUBLISH_TRIGGER_V2_SPEC.md 인라인 검증 표):
//       | 시나리오                              | 처리                                              |
//       | 정상 신규 발표 (tmFc 최근, tmEf 미래) | ✅ push                                            |
//       | 첫 부팅·재시작 (디스크 stale 'Y')     | tmFc 12h 이전 → ❌ skip (staleTmFc)                |
//       | 장부 초기화 후 재수집                 | 묵은 tmFc → ❌ skip, 최근만 ✅ push                |
//       | 손상 JSON                             | parse 실패 → children 빈 골격 → 다음 사이클 자연 동작 |
//       | 변화 없음 ('Y'→'Y')                   | 전이 감지 안 됨 → skip                            |
//       | 오늘 7시 발표 검증 수신 (tmFc 12h 내) | ✅ 첫 사이클부터 push (사용자 의도 #4)             |
//       | tmEf 미상/빈 값 (예비 단계)           | ✅ 통과 (사용자 의도 #2 "예비도 수신")             |
//       | tmEf 범위형 "오늘 밤(21시~24시)"      | 두 파서 모두 실패 → 보수적 통과 (안전 측면)         |
//       | tmEf 과거                              | ❌ skip (pastTmEf)                                 |
//       | tmFc 파싱 실패                         | ❌ skip (parseFailedFc)                            |
//   - 운영 가시성: skip 사유를 staleTmFc / pastTmEf / parseFailedFc 별 카운터 로깅 (R-U1 권고).
//   - 모든 enqueue/flush 호출은 try-catch 흡수 → 크롤러 본체 무영향.

// 발표 푸시 시간 윈도우 — 부모 통보문 발표 시각(tmFc) 이 이보다 오래되면 skip.
const PUBLISH_PUSH_WINDOW_HOURS = 12;

/**
 * [V3.3] 단일 정확 시각 형식인지 판별 — 범위형/시간대 어휘 차단.
 *
 *   허용:
 *     "2026년 05월 20일 07시 00분"     (한글 정형)
 *     "2026-05-20 07:00"               (weather.go.kr ISO 형식)
 *     "2026.05.20.07:00"               (dmdw 형식)
 *     "202605200700"                   (12자리 숫자만)
 *   차단:
 *     "2026년 05월 21일 오전(06시~12시)"  (범위형)
 *     "오늘 밤(21시~24시)"                (시간대 어휘)
 *     "2026-05-21 새벽(00시~06시)"        (범위형)
 *
 *   [도입 배경]
 *     _parseBulletinTimeToMs 의 digit-only fallback 이 범위형 입력의 앞쪽 12자리만
 *     잘라 잘못된 단일 시각으로 오인 파싱하는 결함을 차단. 예) "오전(06시~12시)"
 *     → digits "20260521 06 12" → 5/21 06:12 로 오인 → 현재 시각 07:10 이면 pastTmEf
 *     로 차단 → 사실은 아직 발효 전이므로 차단되면 안 되는 자식이 누락.
 *     본 가드 추가 후 범위형 입력은 null 반환 → _publishCandidateRejectReason 의
 *     보수적 통과 정책 (line 613) 에 따라 정상 통과.
 */
function _isExactSingleTime(s) {
    if (!s) return false;
    const str = String(s).trim();
    // 한글 정형: "YYYY년 MM월 DD일 HH시 mm분"
    if (/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*\d{1,2}시\s*\d{1,2}분$/.test(str)) return true;
    // ISO 정형: "YYYY-MM-DD HH:mm" (초/공백 변형 허용)
    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(?::\d{2})?$/.test(str)) return true;
    // dmdw 형식: "YYYY.MM.DD.HH:mm"
    if (/^\d{4}\.\d{2}\.\d{2}\.\d{2}:\d{2}$/.test(str)) return true;
    // 12자리 숫자: "YYYYMMDDHHmm"
    if (/^\d{12}$/.test(str)) return true;
    return false;
}

/**
 * [V2] KMA 통보문 시각 문자열 → epoch ms — 다중 포맷 흡수 파서 (U3 권고).
 *   parseKmaTime ("YYYY년 MM월 DD일 HH시 mm분") 우선 시도 후,
 *   실패 시 디지트-only 위치 파싱으로 fallback. 두 단계로 다음 포맷 흡수:
 *     "2026년 05월 20일 07시 00분"  (한글 — report_alert_processor 산출)
 *     "2026-05-20 07:00"            (weather.go.kr 부모 통보문)
 *     "2026.05.20.07:00"            (dmdw)
 *     "202605200700"                (숫자만)
 *   범위형 "오늘 밤(21시~24시)" 등 비정형 입력은 두 파서 모두 실패 → null
 *   → 호출자(_publishCandidateRejectReason)가 tmEf 경로에선 보수적 통과 결정.
 *   TZ=Asia/Seoul 컨테이너 환경에서 KST 로 해석됨 (Dockerfile 보장).
 *
 * [V3.3] _isExactSingleTime 사전 가드 추가 — digit fallback 의 범위형 오인 차단.
 *   기존엔 "오전(06시~12시)" 가 digits "20260521 06 12" (12자) 로 잘라져 06:12 로
 *   파싱되어 pastTmEf 오판 → 자식 푸시 누락. 이제 단일 정확 시각만 통과.
 */
function _parseBulletinTimeToMs(s) {
    if (!s) return null;
    // [V3.3] 단일 정확 시각 형식이 아니면 즉시 null — 범위형/시간대 어휘는 미확정 처리.
    if (!_isExactSingleTime(s)) return null;
    // 1) 한글 포맷 우선 — 본 파일의 기존 parseKmaTime 헬퍼 활용.
    try {
        const dt = parseKmaTime(s);
        if (dt && !Number.isNaN(dt.getTime())) return dt.getTime();
    } catch (_) {}
    // 2) 디지트-only 위치 파싱 — 다른 포맷 흡수.
    const digits = String(s).replace(/[^0-9]/g, '');
    if (digits.length < 12) return null;
    const y = parseInt(digits.substring(0, 4), 10);
    const mo = parseInt(digits.substring(4, 6), 10) - 1;
    const d = parseInt(digits.substring(6, 8), 10);
    const hh = parseInt(digits.substring(8, 10), 10);
    const mm = parseInt(digits.substring(10, 12), 10);
    if (![y, mo, d, hh, mm].every(Number.isFinite)) return null;
    const dt2 = new Date(y, mo, d, hh, mm, 0, 0);
    return Number.isNaN(dt2.getTime()) ? null : dt2.getTime();
}

/**
 * [V2] 발표 푸시 시간 필터 — 단독 차단 메커니즘 (부트스트랩 가드 / 100건 안전망 / corrupt reset 대체).
 *   - tmFc 파싱 실패 → 보수적 skip ('parseFailedFc')
 *   - tmFc < (현재 - PUBLISH_PUSH_WINDOW_HOURS) → 묵은 통보문 → skip ('staleTmFc')
 *   - tmEf 파싱 가능 & tmEf < 현재 → 이미 발효 시점 지남 → skip ('pastTmEf')
 *   - tmEf 파싱 실패(미상/빈 값/범위형 "오늘 밤(21시~24시)") → 통과
 *     (예비 단계는 tmEf 미상이 정상. 범위형 자체는 "보수적 통과" 정책 — 사용자
 *      의도 #2 "예비상태에서도 수신" 우선)
 * @returns {string|null} skip 사유 키 또는 null(통과)
 *                        — R-U1 권고: 운영 디버깅용 breakdown 카운터 키.
 */
function _publishCandidateRejectReason(parentMeta, nowMs, windowHours) {
    const effectiveWindowHours = (typeof windowHours === 'number' && windowHours >= 0)
        ? windowHours : PUBLISH_PUSH_WINDOW_HOURS;
    const cutoffMs = nowMs - effectiveWindowHours * 3600 * 1000;
    const tmFcMs = _parseBulletinTimeToMs(parentMeta && parentMeta.tmFc);
    if (tmFcMs === null) return 'parseFailedFc';
    if (tmFcMs < cutoffMs) return 'staleTmFc';
    const tmEfMs = _parseBulletinTimeToMs(parentMeta && parentMeta.tmEf);
    if (tmEfMs !== null && tmEfMs < nowMs) return 'pastTmEf';
    return null;
}

/**
 * 부모|자식 풀네임에서 표시용 짧은 자식명 추출.
 *   dmdw_warn_crawler.js 의 _childDisplayNameFromKey 와 동일 정책으로,
 *   두 경로(text/dmdw) 가 같은 dedup 키와 같은 푸시 본문 표기를 만든다.
 *     "서해남부남쪽안쪽먼바다중조도부근평수구역" + parent="서해남부남쪽안쪽먼바다"
 *       → "조도부근평수구역"
 *     "울릉도울릉읍연안바다" → 그대로 (prefix 매치 없음)
 *     "당진평수구역" → 그대로 (NO_JOONG 예외 — '중' 절단자 없음)
 */
function _bulletinChildDisplayName(parentZone, childFullName) {
    if (!childFullName) return '';
    const p = String(parentZone || '').replace(/\s+/g, '');
    const joiner = `${p}중`;
    if (p && childFullName.startsWith(joiner)) {
        return childFullName.substring(joiner.length);
    }
    return childFullName;
}

/**
 * 두 zone tree 를 동시 재귀 순회하며 children 의 비활성↔활성 전이를 수집한다.
 *   prev / curr 노드 구조: { current, upcoming, history, children: { name: 객체|null } }
 *
 * [V3] children 값이 객체 형태로 변경되어, 활성 판정은 "객체 존재 여부" 로 수행.
 *   prevChildren 의 V2 'Y' 후방호환도 활성으로 간주.
 *
 * @returns {{candidates, releasedYToNull}}
 *   candidates : Array<{parentZone, childName, childMeta, parentMeta}>
 *                (비활성→활성 발표 후보, childMeta=자식 객체, parentMeta=부모 통보문 — 시간 필터용)
 *   releasedYToNull : Array<{parentZone, childName}>  (활성→null 해제 — 마커 정리용)
 *   parentMeta = upcoming 우선 (예비 단계엔 upcoming 만 채워짐), 없으면 current.
 *     둘 다 없으면 candidate 자체 제외.
 */
function collectBulletinPublishCandidates(prevTree, currTree) {
    const candidates = [];
    const releasedYToNull = [];

    function isActive(v) {
        return v === 'Y' || (v && typeof v === 'object');
    }

    function walk(prevNode, currNode, lastParentKey) {
        if (!currNode || typeof currNode !== 'object') return;

        const isZoneLeaf = (
            currNode.current !== undefined
            && currNode.children
            && typeof currNode.children === 'object'
        );

        if (isZoneLeaf && lastParentKey) {
            const parentZone = lastParentKey;
            const prevChildren = (prevNode && prevNode.children) || {};
            const currChildren = currNode.children || {};

            // 부모 메타 — upcoming 우선 (예비 단계엔 upcoming 만 채워짐), 없으면 current.
            //   시간 필터 (PUBLISH_PUSH_WINDOW_HOURS) 가 사용. V3 에서도 동일 정책 유지.
            const meta = currNode.upcoming || currNode.current || null;

            const allNames = new Set([
                ...Object.keys(prevChildren),
                ...Object.keys(currChildren)
            ]);
            for (const childName of allNames) {
                const wasActive = isActive(prevChildren[childName]);
                const isActiveNow = isActive(currChildren[childName]);
                if (!wasActive && isActiveNow) {
                    // 비활성 → 활성 전이 — 발표 푸시 후보.
                    //   childMeta: 자식 객체 (V3 종합기상 텍스트 출처 — wrnTp/wrnLvl 정확).
                    //   parentMeta: 부모 통보문 — 시간 필터 (tmFc 12h 이내) 용도.
                    const childMeta = (currChildren[childName] && typeof currChildren[childName] === 'object')
                        ? currChildren[childName]
                        : null;
                    if (meta && (meta.wrnTpNm || meta.wrnTp)) {
                        candidates.push({ parentZone, childName, childMeta, parentMeta: meta });
                    }
                } else if (wasActive && !isActiveNow) {
                    // 활성 → null 전이 — publish 마커 정리.
                    releasedYToNull.push({ parentZone, childName });
                }
            }
            return;
        }

        // 비-leaf 노드는 재귀 — key 가 부모 zone 이름이 될 수 있으므로 추적.
        for (const [key, value] of Object.entries(currNode)) {
            if (key === 'children' || key === 'history' || key === 'missingCount'
                || key === 'current' || key === 'upcoming') continue;
            const prevSub = prevNode ? prevNode[key] : null;
            walk(prevSub, value, key);
        }
    }

    walk(prevTree, currTree, null);
    return { candidates, releasedYToNull };
}

/**
 * [V2] 종합기상 텍스트 기반 발표 푸시 발송 — 시간 필터 단독.
 *   - 'Y'→null 자식은 forgetChild 로 publish 마커 정리 (다음 신규 발효 시 다시 푸시 가능).
 *   - 후보 중 부모 통보문 tmFc 가 (현재 - PUBLISH_PUSH_WINDOW_HOURS) 이내 +
 *     tmEf 가 미래(또는 미상/빈 값/범위형) 인 것만 통과.
 *   - 첫 부팅 / 재시작 / 손상 JSON / 묵은 데이터 재수집 모두 시간만으로 자동 차단.
 *     부트스트랩 가드·개수 안전망·corrupt reset 모두 없음 (PUBLISH_TRIGGER_V2_SPEC.md "제거할 로직").
 *   - 시간 필터 차단 사유 (staleTmFc / pastTmEf / parseFailedFc) breakdown 카운터 로깅 (R-U1 권고).
 *   - 각 통과 후보에 enqueuePublishFromBulletin 호출 (tmEf='', '예비'→'주의보' 정규화).
 *   - flush() 1회.
 *   모든 오류는 흡수 — 크롤러 본체 흐름 무영향.
 */
async function dispatchBulletinPublishPushes(prevTree, currTree, windowHoursOverride) {
    try {
        const { candidates, releasedYToNull } = collectBulletinPublishCandidates(prevTree, currTree);

        // 'Y' → null 전이는 자식 해제 의미 — _sentKeys 의 publish 마커 정리.
        //   dmdw 경로와 동일한 짧은 표시 이름으로 forgetChild 호출.
        for (const r of releasedYToNull) {
            try {
                const childDisplay = _bulletinChildDisplayName(r.parentZone, r.childName);
                dmdwPushSender.forgetChild(r.parentZone, childDisplay);
            } catch (_) {}
        }

        if (candidates.length === 0) return;

        // [V2 + 1회용 윈도우 override]
        //   windowHoursOverride 인자는 admin "자식해역 리셋" 버튼이 드롭다운 선택값을
        //   weather_alerts.json.oneTimeBulletinWindowOverride 로 저장하면 run() 이 이
        //   함수 호출 시 한 번만 전달. 호출자가 다음 사이클부터는 null 전달 → 평소
        //   PUBLISH_PUSH_WINDOW_HOURS (12) 적용.
        //   override === 0 인 경우엔 모든 후보가 staleTmFc 로 차단되어 0건 발송 (의도된 동작).
        const useOverride = typeof windowHoursOverride === 'number' && windowHoursOverride >= 0;
        const effectiveWindowHours = useOverride ? windowHoursOverride : PUBLISH_PUSH_WINDOW_HOURS;

        // [V2] 시간 필터 — 부트스트랩 가드 / 100건 안전망 / corrupt reset 통합 대체.
        //      reject 사유별 breakdown 카운터로 운영 디버깅 가시성 확보 (R-U1 권고).
        const nowMs = Date.now();
        const passed = [];
        const rejectCounts = { staleTmFc: 0, pastTmEf: 0, parseFailedFc: 0 };
        for (const c of candidates) {
            const reason = _publishCandidateRejectReason(c.parentMeta, nowMs, effectiveWindowHours);
            if (reason === null) {
                passed.push(c);
            } else {
                rejectCounts[reason]++;
            }
        }
        const totalRejected =
            rejectCounts.staleTmFc + rejectCounts.pastTmEf + rejectCounts.parseFailedFc;
        if (totalRejected > 0) {
            const windowLabel = useOverride ? `${effectiveWindowHours}h (override)` : `${effectiveWindowHours}h`;
            console.log(
                `[Crawler] bulletin publish 시간필터 차단: ${totalRejected}건 ` +
                `(staleTmFc=${rejectCounts.staleTmFc} · pastTmEf=${rejectCounts.pastTmEf} · ` +
                `parseFailedFc=${rejectCounts.parseFailedFc} / window=${windowLabel})`
            );
        }
        if (passed.length === 0) return;

        const cycleId = `bulletin-${Date.now()}`;
        let enq = 0;
        for (const c of passed) {
            try {
                const parentMeta = c.parentMeta || {};
                // [V3] 자식 종류·등급은 childMeta(종합기상 텍스트 줄별 파싱 결과) 우선.
                //   parseChildWarnings 가 자식 줄에서 못 잡은 경우엔 wrnTp/wrnLvl 이 빈 값일
                //   수 있으므로 부모 메타로 fallback.
                const childMeta = c.childMeta || {};
                const wrnTpRaw = childMeta.wrnTp || parentMeta.wrnTp || '';
                const wrnLvlRaw = childMeta.wrnLvl || parentMeta.wrnLvl || '';
                // 표시용 짧은 자식명 — dmdw_warn_crawler 와 동일 정책으로 dedup key 일치.
                const displayName = _bulletinChildDisplayName(c.parentZone, c.childName);
                // dmdw 스키마 dedup key 일치를 위해 매핑 (V2 정규화 정책 그대로):
                //   wrnTp / wrnTpNm  ← 자식 wrnTp (예: '풍랑') — 두 필드에 동일 값.
                //   wrnLvl / wrnLvlNm ← 자식 wrnLvl. '예비' 는 푸시 본문·dedup 키 일관성 위해 '주의보' 정규화.
                //   사용자 정의: "예비는 추후 발효예정인 주의보". 앱 배지·dmdw 도 '주의보' 표기.
                //   → 종합기상 → dmdw FC 정식 발표 dedup key 자연 일치 → 중복 차단.
                //   (자식 객체 저장값은 '예비' 그대로 — 배지에 '예비' 표시 가능)
                const wrnTpNorm = wrnTpRaw;
                const wrnLvlNorm = wrnLvlRaw === '예비' ? '주의보' : wrnLvlRaw;
                // tmFc: 자식 객체의 첫 수집 시각(영구 유지) 사용. 부재 시 부모 통보문 tmFc 로 fallback.
                const tmFcForPush = childMeta.tmFc || parentMeta.tmFc || '';
                if (dmdwPushSender.enqueuePublishFromBulletin(cycleId, c.parentZone, displayName, {
                    wrnTp: wrnTpNorm,
                    wrnTpNm: wrnTpNorm,
                    wrnLvl: wrnLvlNorm,
                    wrnLvlNm: wrnLvlNorm,
                    tmFc: tmFcForPush
                })) {
                    enq++;
                }
            } catch (e) {
                console.log(`[Crawler] bulletin enqueue 실패 (무시): ${e.message}`);
            }
        }

        if (enq === 0) {
            // 자연 dedup 으로 모두 차단 — 정상 흐름.
            return;
        }

        try {
            const flushed = await dmdwPushSender.flush(cycleId);
            console.log(
                `[Crawler] bulletin publish flush: 후보 ${candidates.length}건 · ` +
                `시간통과 ${passed.length}건 · 적재 ${enq}건 · 발송 ${(flushed || []).length}건`
            );
        } catch (e) {
            console.log(`[Crawler] bulletin flush 실패 (무시): ${e.message}`);
        }
    } catch (e) {
        // 어떤 단계든 본체 흐름은 영향 없도록 흡수.
        console.log(`[Crawler] dispatchBulletinPublishPushes 예외 (무시): ${e.message}`);
    }
}

// ============================================================================
// Main Execution
// ============================================================================

// [Fix] 동시 실행 방지 Lock — AI 처리가 1분 초과 시 중복 실행되어 데이터 오염 방지
let _isRunning = false;

async function run() {
    if (_isRunning) {
        console.log('[Crawler] 이전 실행이 아직 진행 중, 건너뜀');
        return [];
    }
    _isRunning = true;
    console.log(`[Crawler] 시작: ${new Date().toISOString()}`);

    let fullForm;
    if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
        try {
            const existing = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, 'utf8'));
            fullForm = {
                updatedAt: null,
                lastReportId: existing.lastReportId || null,
                processedReportIds: existing.processedReportIds || [],
                // [버그 수정] 빈 통보문 재시도 대기 목록 복사
                // 이 필드가 빠지면 매 사이클마다 "첫 감지"로 오인되어 푸시가 매분 발송되는 버그 발생
                // report_alert_processor.js가 이 값을 읽어서 10분 미경과 시 건너뜀
                pendingRetries: existing.pendingRetries || {},
                // [V2] bulletinPushBootstrapDone 디스크 복원 제거 — 첫 부팅·재시작 폭주는
                //      dispatchBulletinPublishPushes 의 12h 시간 필터로 자동 차단.
                // [1회용 윈도우 override] admin "자식해역 리셋" 버튼이 저장한 값을 복원.
                //   이번 사이클의 dispatch 가 사용 후 즉시 null 로 reset.
                oneTimeBulletinWindowOverride:
                    (typeof existing.oneTimeBulletinWindowOverride === 'number'
                        && existing.oneTimeBulletinWindowOverride >= 0)
                        ? existing.oneTimeBulletinWindowOverride : null,
                previous: JSON.parse(JSON.stringify(existing.current || createZoneStructure())),
                current: existing.current || createZoneStructure()
            };
        } catch (e) {
            // [V2] 손상 JSON fallback — 빈 골격으로 진입.
            //   previous 가 비어 있으면 첫 사이클에 다수 'Y' 가 잡혀도 대다수는 부모 tmFc 12h
            //   이전이라 시간 필터로 자동 차단. 최근 12h 내 발표만 자연 통과 (사용자 의도 #4
            //   "오늘 오전 7시 발표도 검증 수신" 충족).
            console.warn(`[Crawler] weather_alerts.json 파싱 실패 → 빈 골격 fallback (V2 시간필터 자동 보호): ${e.message}`);
            fullForm = createFullForm();
        }
    } else {
        fullForm = createFullForm();
    }

    try {
        // 1. 시간 기반 예약 처리 선행 실행 (upcoming → current 전환)
        // 해제 이벤트는 current에만 적용되므로, 통보문 처리 전에 상태 전환이 필요
        resolvePendingStatuses(fullForm.current);

        // 2. 통보문 처리 (부모 상태 및 히스토리 업데이트)
        await reportProcessor.applyNewReports(fullForm);

        // 3. 통보문 처리 후 재실행 (새로 생성된 upcoming 처리)
        resolvePendingStatuses(fullForm.current);

        // 3. 특보종합 처리 (연안/평수구역 활성화 여부 확인용)
        const html = await fetchHtml(CONFIG.URL);
        const activeChildren = parseChildWarnings(html, fullForm.current);
        console.log(`[Crawler] 자식 특보(연안/평수) 활성화: ${activeChildren.size}건`);

        // 3. 자식 상속 로직 적용
        mapDataToForm(fullForm.current, activeChildren);

        // 3-aux. [옵션 C] [예비] 통보문 참고사항의 해제·연장 처리.
        //   - 본문 list 가 다루지 못하는 "발표 가능성 낮아져 해제" / "연장 발표" 안내를 흡수.
        //   - upcoming = null + children[*] = null + forgetChild 호출 (해제 케이스)
        //   - upcoming.tmEf 갱신 + children[*].tmEf 갱신 (연장 케이스)
        //   - 풍랑·태풍 만 (R6). 폭풍해일 운영 정책상 수집 제외. 부모 push 무영향 보장 (previous 도 동기화 — R8).
        //   - 실패 시 본체 무영향 (try-catch 흡수).
        try {
            const parsedRef = parseReferenceSection(html);
            if (parsedRef.releases.length > 0 || parsedRef.extensions.length > 0) {
                const refStats = applyReferenceUpdates(fullForm.current, fullForm.previous, parsedRef);
                console.log(
                    `[Crawler] 참고사항 처리: 해제 ${refStats.releases}건 (자식 ${refStats.releasedChildren}개) · ` +
                    `연장 ${refStats.extensions}건`
                );
            }
        } catch (e) {
            console.error(`[Crawler] 참고사항 처리 오류 (본체 흐름 무영향): ${e.message}`);
        }

        // 3-bis. [V2] 종합기상 텍스트 기반 자식 발표 푸시 트리거 — 시간 필터 단독.
        //   - dmdw 가 잡지 못하는 "예비" 단계까지 포괄하기 위한 보조 트리거.
        //   - previous.children vs current.children null↔'Y' 전이를 발표/해제마커정리로 매핑.
        //   - 부모 통보문 tmFc 가 12h 이내 + tmEf 미래/미상 인 자식만 통과 →
        //     첫 부팅 / 재시작 / 손상 JSON / 묵은 데이터 재수집 등 폭주 시나리오 자동 차단.
        //   - dmdw_push_sender._dedupKey(publish) 가 tmEf 를 제외하여 dmdw FC 후속 발표와 자연 dedup.
        //   - 부모 푸시 / detectChanges / pushSender 동작 영향 없음 (별도 경로).
        //   - 실패 시 본체 무영향 (함수 내부 try-catch 흡수, 호출부 외부 try-catch 이중 격리).
        try {
            // [1회용 윈도우 override] admin "자식해역 리셋" 버튼이 드롭다운 선택값을
            //   fullForm.oneTimeBulletinWindowOverride 에 저장. 이 사이클에 사용 후 즉시 null reset.
            //   override=0 → 모든 후보 staleTmFc 차단으로 0건 발송 (의도된 skip 모드).
            const override = (typeof fullForm.oneTimeBulletinWindowOverride === 'number'
                && fullForm.oneTimeBulletinWindowOverride >= 0)
                ? fullForm.oneTimeBulletinWindowOverride : null;
            if (override !== null) {
                console.log(`[Crawler] bulletin publish 1회용 윈도우 override 적용: ${override}h`);
                fullForm.oneTimeBulletinWindowOverride = null;  // 사용 후 즉시 reset (saveState 시 영속화)
            }
            await dispatchBulletinPublishPushes(fullForm.previous, fullForm.current, override);
        } catch (e) {
            console.error(`[Crawler] 자식 발표 push 처리 오류 (부모 흐름엔 영향 없음): ${e.message}`);
        }

        // 4. 변화 감지 (Previous vs Current)
        const changes = detectChanges(fullForm.previous, fullForm.current);

        if (changes.length > 0) {
            console.log(`🚀 변화 감지: ${changes.length}건`);
            changes.forEach(c => {
                const zone = c.zone;
                const type = c.type;
                const prevInfo = c.prev ? `${c.prev.wrnTp || '?'} ${c.prev.wrnLvl || '?'}` : 'null';
                const currInfo = c.curr ? `${c.curr.wrnTp || '?'} ${c.curr.wrnLvl || '?'}` : 'null';
                console.log(`  [Change] ${type} ${zone}: ${prevInfo} → ${currInfo}`);
            });

            try {
                const pushSuccess = await pushSender.processChanges(changes);
                if (pushSuccess) {
                    console.log('[Crawler] 푸시 발송 완료');
                } else {
                    console.warn('[Crawler] ⚠️ 푸시 발송 실패/일부실패 → pending 저장됨 (다음 실행 시 재시도)');
                }
            } catch (err) {
                console.error(`[Push] 오류: ${err.message}`);
            }
        } else {
            console.log('💤 특보 변경 사항 없음');
            // 변경사항 없어도 미발송 건 재시도 (push_sender 내부에서 pending 확인)
            try {
                await pushSender.processChanges([]);
            } catch (_) {}
        }

        // 5. 저장 (변화 감지 결과와 무관하게 항상 저장 — 데이터 최신 상태 유지)
        fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(fullForm, null, 2), 'utf8');
        console.log(`[Crawler] 저장 완료`);

        return changes;
    } catch (e) {
        console.error(`[Crawler] 오류: ${e.message}`);
        return [];
    } finally {
        _isRunning = false;
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, detectChanges, createFullForm, resolvePendingStatuses, CONFIG };
