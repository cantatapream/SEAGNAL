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
