/**
 * ============================================================================
 * 파일명: js/admin_survey.js
 * 역할: 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과분석/이력관리)
 * ============================================================================
 *
 * [개요 - 초보자 안내]
 * 이 파일은 SEAGNAL(바다날씨) 앱의 "관리자 센터 → 설문조사" 탭의 전체 UI를 담당합니다.
 * 관리자가 설문을 만들고, 현황을 확인하고, 결과를 차트로 분석하는 모든 화면이 여기에 있습니다.
 *
 * [4개 서브탭 구성]
 * 1. 설문 생성   - 질문 추가/삭제/순서변경, 유형 선택(단일선택/복수선택/주관식/별점/드롭다운)
 * 2. 진행 현황   - 활성/초안 설문 목록, 발행/마감/수정/삭제 액션
 * 3. 결과/분석   - Chart.js 도넛/막대/별점 차트, 주관식 답변 목록, CSV 다운로드
 * 4. 이력 관리   - 월별 그룹화된 전체 설문 이력, 복제/삭제
 *
 * [전체 시스템에서의 위치]
 * 관리자가 관리자 센터를 열면 → admin.js에서 탭 목록을 렌더링 →
 * "설문조사" 탭 클릭 시 → 이 파일의 renderUnifiedSurveyContent() 호출 →
 * 각 서브탭에서 routes/survey.js의 API를 fetch()로 호출하여 데이터 CRUD
 *
 * [연계 파일]
 * - js/admin.js              → 탭 시스템의 부모. '설문조사' 탭 선택 시 이 파일의 메인 함수 호출
 * - routes/survey.js         → 백엔드 API. 이 파일에서 fetch()로 호출
 * - js/config.js             → CONFIG.API_BASE (API 서버 주소)
 * - index.html               → <script src="js/admin_survey.js"> 로 로딩
 * - Chart.js (CDN)           → 결과 시각화에 사용 (index.html에서 CDN 로드)
 *
 * [주요 전역 함수]
 * - renderUnifiedSurveyContent(container): 설문조사 탭 메인 렌더러 (admin.js에서 호출)
 * - switchSurveySubTab(tabId): 서브탭 전환
 * - saveSurvey(status): 설문 저장 (draft 또는 active)
 * - viewSurveyResult(id): 특정 설문 결과 보기
 *
 * [로딩 순서]
 * index.html에서 admin.js → admin_collect.js → admin_survey.js 순서로 로드
 * admin.js의 renderUnifiedSurveyContent() 호출을 통해 실행됨
 * ============================================================================
 */

// ============================================================================
// 메인 렌더러
// ============================================================================
async function renderUnifiedSurveyContent(container) {
    const subTabs = [
        { id: 'survey-create', name: '설문 생성', icon: 'fa-plus-circle' },
        { id: 'survey-status', name: '진행 현황', icon: 'fa-chart-bar' },
        { id: 'survey-result', name: '결과/분석', icon: 'fa-chart-pie' },
        { id: 'survey-history', name: '이력 관리', icon: 'fa-clock-rotate-left' }
    ];

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-clipboard-list" style="color:#10b981;"></i> 설문조사 관리
        </div>
        <div class="admin-sub-tabs">
            ${subTabs.map(t => `
                <button class="survey-sub-tab" data-tab="${t.id}" onclick="switchSurveySubTab('${t.id}')">
                    <i class="fa-solid ${t.icon}"></i> ${t.name}
                </button>
            `).join('')}
        </div>
        <div id="survey-inner-content"></div>
    `;

    window.switchSurveySubTab = function (tabId) {
        document.querySelectorAll('.survey-sub-tab').forEach(btn => {
            btn.dataset.tab === tabId ? btn.classList.add('active') : btn.classList.remove('active');
        });
        const inner = document.getElementById('survey-inner-content');
        if (!inner) return;
        if (tabId === 'survey-create') renderSurveyCreateTab(inner);
        else if (tabId === 'survey-status') renderSurveyStatusTab(inner);
        else if (tabId === 'survey-result') renderSurveyResultTab(inner);
        else if (tabId === 'survey-history') renderSurveyHistoryTab(inner);
    };

    switchSurveySubTab('survey-create');
}

// ============================================================================
// 질문 유형 정의
// ============================================================================
const QUESTION_TYPES = [
    { value: 'radio', label: '단일 선택', icon: 'fa-circle-dot' },
    { value: 'checkbox', label: '복수 선택', icon: 'fa-square-check' },
    { value: 'text', label: '주관식', icon: 'fa-pen' },
    { value: 'rating', label: '별점 평가', icon: 'fa-star' },
    { value: 'dropdown', label: '드롭다운', icon: 'fa-caret-down' }
];

// HTML 속성용 이스케이프
function escSvAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// 서브탭 1: 설문 생성
// ============================================================================
let _surveyQuestions = [];
let _editingSurveyId = null;

/**
 * 설문 생성/편집 탭 본문(container) 을 렌더.
 * _surveyQuestions 배열을 비운 뒤 빈 입력 폼 + "질문 추가" 버튼 등을 그림.
 * 편집 모드(_editingSurveyId 셋팅됨) 면 기존 질문 데이터를 미리 채움.
 *
 * [연계] 관리자 메뉴의 "설문 생성" 버튼이 호출. _editingSurveyId 는 다른 곳에서 set.
 */
async function renderSurveyCreateTab(container) {
    _surveyQuestions = [];
    _editingSurveyId = null;

    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const monthLater = new Date(Date.now() + 9 * 60 * 60 * 1000 + 30 * 86400000).toISOString().slice(0, 10);

    container.innerHTML = `
        <div class="admin-card" style="padding:18px; margin-bottom:16px;">
            <div style="font-weight:700; color:#fff; margin-bottom:14px; font-size:0.95rem;">
                <i class="fa-solid fa-file-circle-plus" style="color:#10b981;"></i> 기본 정보
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:4px;">설문 제목 *</label>
                <input type="text" id="sv-title" placeholder="예: 서비스 만족도 조사" style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:4px;">설문 설명</label>
                <textarea id="sv-desc" placeholder="설문 목적이나 안내 문구를 입력하세요" style="width:100%; height:60px; padding:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; resize:none; font-size:0.9rem; box-sizing:border-box;"></textarea>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:12px;">
                <div style="flex:1;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:4px;">시작일</label>
                    <input type="date" id="sv-start" value="${today}" style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box; color-scheme:dark;">
                </div>
                <div style="flex:1;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:4px;">종료일</label>
                    <input type="date" id="sv-end" value="${monthLater}" style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box; color-scheme:dark;">
                </div>
            </div>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
                <label style="color:#cbd5e1; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="checkbox" id="sv-anonymous" checked style="accent-color:#10b981;"> 익명 허용
                </label>
                <label style="color:#cbd5e1; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="checkbox" id="sv-multiple" style="accent-color:#10b981;"> 중복 응답 허용
                </label>
            </div>
        </div>

        <div class="admin-card" style="padding:18px; margin-bottom:16px;">
            <div style="font-weight:700; color:#fff; margin-bottom:14px; font-size:0.95rem; display:flex; justify-content:space-between; align-items:center;">
                <div><i class="fa-solid fa-list-ol" style="color:#3b82f6;"></i> 질문 항목</div>
                <span id="sv-q-count" style="color:#64748b; font-size:0.8rem;">0개</span>
            </div>
            <div id="sv-questions-list"></div>
            <button onclick="addSurveyQuestion()" style="width:100%; padding:12px; background:rgba(59,130,246,0.1); border:1px dashed rgba(59,130,246,0.4); border-radius:8px; color:#60a5fa; cursor:pointer; font-size:0.85rem; font-weight:600; margin-top:8px;">
                <i class="fa-solid fa-plus"></i> 질문 추가
            </button>
        </div>

        <div style="display:flex; gap:10px;">
            <button onclick="saveSurvey('draft')" style="flex:1; padding:12px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#cbd5e1; cursor:pointer; font-weight:600; font-size:0.9rem;">
                <i class="fa-solid fa-save"></i> 초안 저장
            </button>
            <button onclick="saveSurvey('active')" style="flex:2; padding:12px; background:linear-gradient(135deg,#10b981,#059669); border:none; border-radius:8px; color:#fff; cursor:pointer; font-weight:700; font-size:0.9rem;">
                <i class="fa-solid fa-paper-plane"></i> 설문 시작(발행)
            </button>
        </div>
    `;

    renderQuestionsList();
}

// 질문 추가/삭제/이동/유형변경/선택지 관리
window.addSurveyQuestion = function () {
    _surveyQuestions.push({
        qId: Date.now(), type: 'radio', title: '', required: true,
        options: ['선택지 1', '선택지 2'], maxRating: 5, maxLength: 500
    });
    renderQuestionsList();
};

window.removeSurveyQuestion = function (idx) {
    _surveyQuestions.splice(idx, 1);
    renderQuestionsList();
};

window.moveSurveyQuestion = function (idx, dir) {
    const ni = idx + dir;
    if (ni < 0 || ni >= _surveyQuestions.length) return;
    [_surveyQuestions[idx], _surveyQuestions[ni]] = [_surveyQuestions[ni], _surveyQuestions[idx]];
    renderQuestionsList();
};

window.changeSurveyQType = function (idx, type) {
    _surveyQuestions[idx].type = type;
    renderQuestionsList();
};

window.addSurveyOption = function (idx) {
    const q = _surveyQuestions[idx];
    q.options = q.options || [];
    q.options.push('선택지 ' + (q.options.length + 1));
    renderQuestionsList();
};

window.removeSurveyOption = function (qi, oi) {
    _surveyQuestions[qi].options.splice(oi, 1);
    renderQuestionsList();
};

/**
 * _surveyQuestions 배열을 기반으로 화면의 질문 목록(#sv-questions-list) 을 다시 그림.
 * 질문 추가/삭제/순서 변경 후 이 함수를 호출하면 UI 가 동기화됨.
 */
function renderQuestionsList() {
    const listEl = document.getElementById('sv-questions-list');
    const countEl = document.getElementById('sv-q-count');
    if (!listEl) return;
    if (countEl) countEl.textContent = _surveyQuestions.length + '개';

    if (_surveyQuestions.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b; font-size:0.85rem;"><i class="fa-solid fa-inbox"></i> 질문을 추가해주세요</div>';
        return;
    }

    listEl.innerHTML = _surveyQuestions.map((q, idx) => {
        const needsOpts = ['radio', 'checkbox', 'dropdown'].includes(q.type);
        const optsHtml = needsOpts ? `
            <div style="margin-top:8px; padding-left:8px;">
                ${(q.options || []).map((opt, oi) => `
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <i class="fa-solid ${q.type === 'radio' ? 'fa-circle' : q.type === 'checkbox' ? 'fa-square' : 'fa-caret-right'}" style="color:#475569; font-size:0.65rem; width:14px;"></i>
                        <input type="text" value="${escSvAttr(opt)}" onchange="_surveyQuestions[${idx}].options[${oi}]=this.value" style="flex:1; padding:6px 8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:#e2e8f0; font-size:0.82rem; box-sizing:border-box;">
                        <button onclick="removeSurveyOption(${idx},${oi})" style="background:none; border:none; color:#64748b; cursor:pointer; font-size:0.75rem; padding:4px;" title="삭제"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `).join('')}
                <button onclick="addSurveyOption(${idx})" style="padding:4px 10px; background:rgba(255,255,255,0.05); border:1px dashed rgba(255,255,255,0.15); border-radius:6px; color:#94a3b8; cursor:pointer; font-size:0.75rem;">
                    <i class="fa-solid fa-plus"></i> 선택지 추가
                </button>
            </div>
        ` : q.type === 'rating' ? `
            <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
                <span style="color:#94a3b8; font-size:0.8rem;">최대 점수:</span>
                <select onchange="_surveyQuestions[${idx}].maxRating=Number(this.value)" style="padding:4px 8px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; font-size:0.8rem;">
                    ${[3, 5, 7, 10].map(n => `<option value="${n}" ${q.maxRating === n ? 'selected' : ''}>${n}점</option>`).join('')}
                </select>
            </div>
        ` : q.type === 'text' ? `
            <div style="margin-top:8px; color:#64748b; font-size:0.8rem; padding:10px; background:rgba(0,0,0,0.15); border-radius:6px; border:1px dashed rgba(255,255,255,0.08);">
                <i class="fa-solid fa-pen"></i> 주관식 답변 입력 영역
            </div>
        ` : '';

        return `
            <div style="padding:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:10px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="color:#10b981; font-weight:700; font-size:0.85rem; min-width:30px;">Q${idx + 1}</span>
                    <input type="text" value="${escSvAttr(q.title)}" placeholder="질문을 입력하세요" onchange="_surveyQuestions[${idx}].title=this.value" style="flex:1; padding:8px 10px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; font-size:0.88rem; box-sizing:border-box;">
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <select onchange="changeSurveyQType(${idx},this.value)" style="padding:6px 10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#e2e8f0; font-size:0.8rem;">
                        ${QUESTION_TYPES.map(t => `<option value="${t.value}" ${q.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                    </select>
                    <label style="color:#94a3b8; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" ${q.required ? 'checked' : ''} onchange="_surveyQuestions[${idx}].required=this.checked" style="accent-color:#10b981;"> 필수
                    </label>
                    <div style="margin-left:auto; display:flex; gap:4px;">
                        <button onclick="moveSurveyQuestion(${idx},-1)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#94a3b8; cursor:pointer; padding:4px 6px; font-size:0.7rem;" title="위로"><i class="fa-solid fa-arrow-up"></i></button>
                        <button onclick="moveSurveyQuestion(${idx},1)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#94a3b8; cursor:pointer; padding:4px 6px; font-size:0.7rem;" title="아래로"><i class="fa-solid fa-arrow-down"></i></button>
                        <button onclick="removeSurveyQuestion(${idx})" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:4px; color:#f87171; cursor:pointer; padding:4px 6px; font-size:0.7rem;" title="삭제"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                ${optsHtml}
            </div>
        `;
    }).join('');
}

// 설문 저장
window.saveSurvey = async function (status) {
    const title = document.getElementById('sv-title').value.trim();
    if (!title) return alert('설문 제목을 입력해주세요.');
    if (_surveyQuestions.length === 0) return alert('최소 1개 이상의 질문을 추가해주세요.');

    const emptyQ = _surveyQuestions.find(q => !q.title.trim());
    if (emptyQ) return alert('질문 내용이 비어있는 항목이 있습니다.');

    const payload = {
        title,
        description: document.getElementById('sv-desc').value.trim(),
        status,
        startDate: document.getElementById('sv-start').value,
        endDate: document.getElementById('sv-end').value,
        allowAnonymous: document.getElementById('sv-anonymous').checked,
        allowMultipleSubmit: document.getElementById('sv-multiple').checked,
        questions: _surveyQuestions.map((q, i) => ({ ...q, qId: i + 1 }))
    };

    try {
        const url = _editingSurveyId
            ? CONFIG.API_BASE + '/api/surveys/' + _editingSurveyId
            : CONFIG.API_BASE + '/api/surveys';
        const method = _editingSurveyId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || '저장 실패');

        alert(status === 'active' ? '설문이 발행되었습니다!' : '초안이 저장되었습니다.');
        _editingSurveyId = null;
        // 작성/편집 후엔 탭 자체가 바뀌므로(create → status) 1페이지 리셋 정책 유지
        switchSurveySubTab('survey-status');
    } catch (e) {
        alert('저장 실패: ' + e.message);
    }
};

// ============================================================================
// 서브탭 2: 진행 현황
// ----------------------------------------------------------------------------
// 페이지네이션: 서버 측 `?page=&limit=` 동반 호출 → { data, pagination } 새 포맷.
// 다른 호출자(결과/이력 탭, 사용자측 등)는 쿼리 없이 raw array 를 받으므로 영향 없음.
// 25개/페이지, 탭 진입 시 1페이지로 리셋, 페이지 전환 시 목록 상단으로 스크롤.
// ============================================================================
let _surveyListPage = 1;
const _SURVEY_LIST_LIMIT = 25;
// 페이지 연타 race 토큰: 매 fetch 진입마다 증가, await 직후 최신값이 아니면 응답 폐기
let _surveyStatusSeq = 0;

async function renderSurveyStatusTab(container) {
    // 탭 진입(필터 전환과 동일 효과) 시 1페이지로 리셋
    _surveyListPage = 1;
    container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
    await _loadSurveyStatusPage(container);
}

/**
 * 진행 현황 탭 reload helper.
 * 마감/삭제/발행/수정 후 호출 — 현재 _surveyListPage 를 유지한 채 데이터만 갱신.
 * `switchSurveySubTab('survey-status')` 와 달리 페이지 리셋이 일어나지 않는다.
 * (빈 페이지 폴백 가드는 _loadSurveyStatusPage 안에 이미 있음)
 */
async function _reloadSurveyStatusKeepPage() {
    const inner = document.getElementById('survey-inner-content');
    if (!inner) return;
    await _loadSurveyStatusPage(inner);
}

/**
 * 진행 현황 탭의 페이지 1건을 fetch → render.
 * _surveyListPage 값을 그대로 사용. 페이지네이션 UI 는 공용 helper 로 그린다.
 *
 * [연계] GET /api/surveys?page=&limit= — 새 포맷 { data, pagination } 사용.
 */
async function _loadSurveyStatusPage(container) {
    // 진입 시 시퀀스 토큰 캡처 — 응답 처리 직전 최신값과 다르면 stale 응답으로 폐기
    const myReq = ++_surveyStatusSeq;
    try {
        const url = CONFIG.API_BASE + '/api/surveys?page=' + _surveyListPage
            + '&limit=' + _SURVEY_LIST_LIMIT;
        const res = await fetch(url);
        const result = await res.json();
        // 페이지 연타 race: 이후 더 새 요청이 들어왔다면 이 응답은 무시
        if (myReq !== _surveyStatusSeq) return;

        // 새 포맷 우선, 만에 하나 raw 배열이 오면 fallback (하위호환 안전망)
        const surveys = Array.isArray(result) ? result : (result && result.data) || [];
        const pagination = (result && result.pagination) || {
            page: _surveyListPage,
            limit: _SURVEY_LIST_LIMIT,
            total: surveys.length,
            totalPages: 1
        };

        // 삭제 등으로 현재 페이지가 비었지만 앞쪽에 데이터가 남아있는 경우 → 1페이지로 리셋 후 재호출
        if (surveys.length === 0 && pagination.total > 0 && _surveyListPage > 1) {
            _surveyListPage = 1;
            return _loadSurveyStatusPage(container);
        }

        if (!surveys || surveys.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:#64748b;">
                    <i class="fa-solid fa-inbox" style="font-size:2.5rem; color:#334155; margin-bottom:15px; display:block;"></i>
                    <div style="font-size:1rem; font-weight:700; color:#cbd5e1; margin-bottom:6px;">등록된 설문이 없습니다</div>
                    <div style="font-size:0.85rem;">설문 생성 탭에서 새 설문을 만들어보세요.</div>
                </div>
                <div id="survey-list-pagination" class="pagination"></div>`;
            return;
        }

        const active = surveys.filter(s => s.status === 'active');
        const draft = surveys.filter(s => s.status === 'draft');
        const closed = surveys.filter(s => s.status === 'closed');
        let html = '';

        if (active.length > 0) {
            html += `<div style="color:#10b981; font-weight:700; font-size:0.9rem; margin-bottom:10px;"><i class="fa-solid fa-circle-play"></i> 진행 중 (${active.length})</div>`;
            html += active.map(s => buildSurveyCard(s)).join('');
        }
        if (draft.length > 0) {
            html += `<div style="color:#f59e0b; font-weight:700; font-size:0.9rem; margin:16px 0 10px;"><i class="fa-solid fa-file-pen"></i> 초안 (${draft.length})</div>`;
            html += draft.map(s => buildSurveyCard(s)).join('');
        }
        if (closed.length > 0) {
            html += `<div style="color:#64748b; font-weight:700; font-size:0.9rem; margin:16px 0 10px;"><i class="fa-solid fa-circle-check"></i> 마감 (${closed.length})</div>`;
            html += closed.map(s => buildSurveyCard(s)).join('');
        }

        // 페이지네이션 컨테이너를 마지막에 부착 (목록 갱신 시마다 함께 재생성)
        html += '<div id="survey-list-pagination" class="pagination" style="margin-top:14px;"></div>';
        container.innerHTML = html;

        // 페이지네이션 UI 렌더 (공용 helper 재사용)
        const pager = document.getElementById('survey-list-pagination');
        if (pager && typeof window.renderStandardPagination === 'function') {
            window.renderStandardPagination(
                pager,
                pagination.page,
                pagination.totalPages,
                function (page) {
                    _surveyListPage = page;
                    _loadSurveyStatusPage(container);
                    // 페이지 전환 시 목록 상단으로 스크롤 (큰 페이지 이동 시 UX 개선)
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            );
        }
    } catch (e) {
        // race: 이후 더 새 요청이 들어왔다면 에러 메시지도 덮어쓰지 않는다
        if (myReq !== _surveyStatusSeq) return;
        container.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">데이터 로드 실패: ${e.message}</div>`;
    }
}

/**
 * 설문 1건(s)을 카드 HTML 문자열로 변환.
 * status 별 배지 색(active=초록 / draft=주황 / closed=회색) + 제목·기간·응답수·버튼.
 *
 * [입력] s = { id, title, status, startAt, endAt, responseCount, ... }
 * [연계] 관리자 설문 목록 탭에서 각 설문 카드를 그릴 때 호출.
 *
 * @returns {string} - innerHTML 으로 삽입할 카드 마크업
 */
function buildSurveyCard(s) {
    const colors = { active: '#10b981', draft: '#f59e0b', closed: '#64748b' };
    const labels = { active: '진행 중', draft: '초안', closed: '마감' };
    const color = colors[s.status] || '#64748b';

    let periodText = '', progressHtml = '';
    if (s.startDate && s.endDate) {
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const start = new Date(s.startDate);
        const end = new Date(s.endDate + 'T23:59:59');
        const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
        const elapsed = Math.ceil((now - start) / 86400000);
        const remaining = Math.max(0, Math.ceil((end - now) / 86400000));
        const pct = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
        periodText = `${s.startDate.slice(5)} ~ ${s.endDate.slice(5)} (${remaining > 0 ? '남은 ' + remaining + '일' : '기한 만료'})`;
        if (s.status === 'active') progressHtml = `<div style="margin-top:8px; background:rgba(255,255,255,0.05); border-radius:4px; height:6px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:${color}; border-radius:4px;"></div></div>`;
    }

    const actions = s.status === 'active' ? `
        <button onclick="viewSurveyResult(${s.id})" style="padding:6px 12px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.3); border-radius:6px; color:#60a5fa; cursor:pointer; font-size:0.78rem;"><i class="fa-solid fa-chart-pie"></i> 결과</button>
        <button onclick="closeSurveyEarly(${s.id})" style="padding:6px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:6px; color:#f87171; cursor:pointer; font-size:0.78rem;"><i class="fa-solid fa-stop"></i> 마감</button>
        <button onclick="editSurvey(${s.id})" style="padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#94a3b8; cursor:pointer; font-size:0.78rem;"><i class="fa-solid fa-pen"></i> 수정</button>
    ` : s.status === 'draft' ? `
        <button onclick="publishSurvey(${s.id})" style="padding:6px 12px; background:linear-gradient(135deg,#10b981,#059669); border:none; border-radius:6px; color:#fff; cursor:pointer; font-size:0.78rem; font-weight:600;"><i class="fa-solid fa-rocket"></i> 발행</button>
        <button onclick="editSurvey(${s.id})" style="padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#94a3b8; cursor:pointer; font-size:0.78rem;"><i class="fa-solid fa-pen"></i> 수정</button>
        <button onclick="deleteSurvey(${s.id})" style="padding:6px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:6px; color:#f87171; cursor:pointer; font-size:0.78rem;"><i class="fa-solid fa-trash"></i> 삭제</button>
    ` : '';

    return `
        <div class="admin-card" style="padding:16px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                <div style="font-weight:700; color:#fff; font-size:0.95rem; flex:1;">${escSvAttr(s.title)}</div>
                <span style="background:${color}22; color:${color}; padding:2px 10px; border-radius:10px; font-size:0.72rem; font-weight:600; white-space:nowrap;">${labels[s.status]}</span>
            </div>
            <div style="display:flex; gap:12px; color:#94a3b8; font-size:0.8rem; margin-bottom:4px; flex-wrap:wrap;">
                <span><i class="fa-solid fa-users"></i> ${s.responseCount || 0}명 응답</span>
                ${periodText ? `<span><i class="fa-solid fa-calendar"></i> ${periodText}</span>` : ''}
            </div>
            ${progressHtml}
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">${actions}</div>
        </div>
    `;
}

// 액션 핸들러
window.closeSurveyEarly = async function (id) {
    if (!confirm('이 설문을 마감하시겠습니까?')) return;
    try {
        await fetch(CONFIG.API_BASE + `/api/surveys/${id}/close`, { method: 'POST' });
        alert('설문이 마감되었습니다.');
        // 보던 페이지 유지 (#4) — 탭 재진입이 아니라 같은 탭의 데이터 갱신.
        // 빈 페이지 폴백 가드는 _loadSurveyStatusPage 내부에 있어 안전.
        await _reloadSurveyStatusKeepPage();
    } catch (e) { alert('마감 실패: ' + e.message); }
};

window.publishSurvey = async function (id) {
    if (!confirm('이 설문을 발행하시겠습니까? 사용자에게 즉시 노출됩니다.')) return;
    try {
        await fetch(CONFIG.API_BASE + `/api/surveys/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' })
        });
        alert('설문이 발행되었습니다!');
        // 보던 페이지 유지 (#4)
        await _reloadSurveyStatusKeepPage();
    } catch (e) { alert('발행 실패: ' + e.message); }
};

window.deleteSurvey = async function (id) {
    if (!confirm('이 설문을 삭제하시겠습니까? 모든 응답 데이터도 함께 삭제됩니다.')) return;
    try {
        await fetch(CONFIG.API_BASE + `/api/surveys/${id}`, { method: 'DELETE' });
        alert('삭제되었습니다.');
        // 보던 페이지 유지 (#4) — 마지막 항목 삭제 시 빈 페이지 폴백으로 1페이지 자동 복귀
        await _reloadSurveyStatusKeepPage();
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.editSurvey = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/surveys');
        const surveys = await res.json();
        const survey = surveys.find(s => s.id === id);
        if (!survey) return alert('설문을 찾을 수 없습니다.');

        // 먼저 탭 전환 (renderSurveyCreateTab이 _surveyQuestions=[], _editingSurveyId=null 초기화)
        switchSurveySubTab('survey-create');

        // 탭 전환(초기화) 이후에 수정 데이터를 세팅
        setTimeout(() => {
            _editingSurveyId = id;
            _surveyQuestions = (survey.questions || []).map(q => ({ ...q }));

            const el = (sid) => document.getElementById(sid);
            if (el('sv-title')) el('sv-title').value = survey.title || '';
            if (el('sv-desc')) el('sv-desc').value = survey.description || '';
            if (el('sv-start')) el('sv-start').value = survey.startDate || '';
            if (el('sv-end')) el('sv-end').value = survey.endDate || '';
            if (el('sv-anonymous')) el('sv-anonymous').checked = survey.allowAnonymous !== false;
            if (el('sv-multiple')) el('sv-multiple').checked = survey.allowMultipleSubmit || false;
            renderQuestionsList();
        }, 50);
    } catch (e) { alert('데이터 로드 실패: ' + e.message); }
};

// ============================================================================
// 서브탭 3: 결과/분석
// ============================================================================
let _surveyCharts = [];

async function renderSurveyResultTab(container) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
    _surveyCharts.forEach(c => c.destroy());
    _surveyCharts = [];

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/surveys');
        const surveys = await res.json();
        const analyzable = surveys.filter(s => s.status === 'active' || s.status === 'closed');

        if (analyzable.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:60px; color:#64748b;"><i class="fa-solid fa-chart-pie" style="font-size:2rem; margin-bottom:10px; display:block;"></i>분석할 설문이 없습니다.</div>';
            return;
        }

        container.innerHTML = `
            <div style="margin-bottom:14px;">
                <label style="color:#94a3b8; font-size:0.8rem;">설문 선택</label>
                <select id="sv-result-select" onchange="loadSurveyResult()" style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; margin-top:4px;">
                    ${analyzable.map(s => `<option value="${s.id}">${escSvAttr(s.title)} (${s.responseCount || 0}건)</option>`).join('')}
                </select>
            </div>
            <div id="sv-result-body"></div>
        `;
        loadSurveyResult();
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">로드 실패: ${e.message}</div>`;
    }
}

window.viewSurveyResult = function (id) {
    switchSurveySubTab('survey-result');
    setTimeout(() => {
        const sel = document.getElementById('sv-result-select');
        if (sel) { sel.value = id; loadSurveyResult(); }
    }, 200);
};

window.loadSurveyResult = async function () {
    const sel = document.getElementById('sv-result-select');
    const body = document.getElementById('sv-result-body');
    if (!sel || !body) return;

    const surveyId = Number(sel.value);
    body.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    _surveyCharts.forEach(c => c.destroy());
    _surveyCharts = [];

    try {
        const [sRes, rRes] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/surveys'),
            fetch(CONFIG.API_BASE + `/api/surveys/${surveyId}/responses`)
        ]);
        const surveys = await sRes.json();
        const responses = await rRes.json();
        const survey = surveys.find(s => s.id === surveyId);
        if (!survey) { body.innerHTML = '<div style="color:#ef4444;">설문 데이터 없음</div>'; return; }

        const questions = survey.questions || [];
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                <div>
                    <div style="color:#fff; font-weight:700; font-size:1rem;">${escSvAttr(survey.title)}</div>
                    <div style="color:#94a3b8; font-size:0.8rem; margin-top:2px;">총 ${responses.length}건 | ${survey.startDate || ''} ~ ${survey.endDate || ''}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button onclick="viewSurveyResponses(${surveyId}, &quot;${escSvAttr(survey.title || '')}&quot;)" style="padding:8px 14px; background:linear-gradient(135deg,#8b5cf6,#6d28d9); border:none; border-radius:8px; color:#fff; cursor:pointer; font-size:0.82rem; font-weight:600;">
                        <i class="fa-solid fa-list-check"></i> 응답 목록
                    </button>
                    <button onclick="downloadSurveyCsv(${surveyId})" style="padding:8px 14px; background:linear-gradient(135deg,#3b82f6,#2563eb); border:none; border-radius:8px; color:#fff; cursor:pointer; font-size:0.82rem; font-weight:600;">
                        <i class="fa-solid fa-file-csv"></i> CSV 다운로드
                    </button>
                </div>
            </div>
        `;

        if (responses.length === 0) {
            html += '<div style="text-align:center; padding:40px; color:#64748b;">아직 응답이 없습니다.</div>';
            body.innerHTML = html;
            return;
        }

        questions.forEach((q, qi) => {
            html += `<div class="admin-card" style="padding:16px; margin-bottom:12px;">`;
            html += `<div style="font-weight:700; color:#e2e8f0; font-size:0.9rem; margin-bottom:10px;">Q${qi + 1}. ${escSvAttr(q.title)} <span style="color:#64748b; font-size:0.75rem; font-weight:400;">(${responses.length}건)</span></div>`;

            if (q.type === 'radio' || q.type === 'dropdown') {
                const counts = {};
                (q.options || []).forEach(o => counts[o] = 0);
                responses.forEach(r => { const a = r.answers[q.qId]; if (a) counts[a] = (counts[a] || 0) + 1; });
                const cId = `sv-chart-${surveyId}-${qi}`;
                html += `<div style="height:200px; position:relative;"><canvas id="${cId}"></canvas></div>`;
                html += buildBarSummary(counts, responses.length);
                setTimeout(() => createDoughnutChart(cId, counts), 100);

            } else if (q.type === 'checkbox') {
                const counts = {};
                (q.options || []).forEach(o => counts[o] = 0);
                responses.forEach(r => { const a = r.answers[q.qId]; if (Array.isArray(a)) a.forEach(v => { counts[v] = (counts[v] || 0) + 1; }); });
                const cId = `sv-chart-${surveyId}-${qi}`;
                html += `<div style="height:200px; position:relative;"><canvas id="${cId}"></canvas></div>`;
                html += buildBarSummary(counts, responses.length);
                setTimeout(() => createHBarChart(cId, counts), 100);

            } else if (q.type === 'rating') {
                const max = q.maxRating || 5;
                const counts = {};
                for (let i = 1; i <= max; i++) counts[i] = 0;
                let sum = 0, cnt = 0;
                responses.forEach(r => { const a = Number(r.answers[q.qId]); if (a >= 1 && a <= max) { counts[a]++; sum += a; cnt++; } });
                const avg = cnt > 0 ? (sum / cnt).toFixed(1) : '0';
                const stars = Math.round(avg);
                html += `<div style="text-align:center; margin-bottom:10px;"><div style="font-size:1.5rem; color:#fbbf24;">${'★'.repeat(stars)}${'☆'.repeat(max - stars)}</div><div style="font-size:1.2rem; font-weight:800; color:#fff;">${avg} <span style="color:#64748b; font-size:0.85rem;">/ ${max}</span></div></div>`;
                const cId = `sv-chart-${surveyId}-${qi}`;
                html += `<div style="height:160px; position:relative;"><canvas id="${cId}"></canvas></div>`;
                setTimeout(() => {
                    createVBarChart(cId, Object.keys(counts).map(k => k + '점'), Object.values(counts), '#fbbf24');
                }, 100);

            } else if (q.type === 'text') {
                const texts = responses.map(r => r.answers[q.qId]).filter(Boolean);
                html += '<div style="max-height:200px; overflow-y:auto;">';
                texts.slice(0, 10).forEach(t => { html += `<div style="padding:8px 10px; margin-bottom:4px; background:rgba(0,0,0,0.2); border-radius:6px; color:#cbd5e1; font-size:0.82rem; line-height:1.4;">"${escSvAttr(t)}"</div>`; });
                if (texts.length > 10) html += `<div style="color:#64748b; font-size:0.78rem; padding:8px; text-align:center;">외 ${texts.length - 10}건 더...</div>`;
                html += '</div>';
            }
            html += '</div>';
        });

        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<div style="color:#ef4444; padding:20px;">로드 실패: ${e.message}</div>`;
    }
};

/**
 * 객관식 응답 집계(counts) 를 가로 막대 + 비율(%) 텍스트로 표시하는 HTML 빌드.
 *
 * [입력]
 *   counts = { '선택지A': 12, '선택지B': 7, ... }
 *   total  = 전체 응답 수 (비율 계산용)
 *
 * [출력] HTML 문자열 — 응답 결과 카드에 innerHTML 으로 삽입.
 */
function buildBarSummary(counts, total) {
    let html = '<div style="margin-top:8px;">';
    Object.entries(counts).forEach(([label, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:0.8rem;">
            <span style="color:#cbd5e1; min-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escSvAttr(label)}</span>
            <div style="flex:1; background:rgba(255,255,255,0.05); border-radius:3px; height:8px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:#3b82f6; border-radius:3px;"></div></div>
            <span style="color:#94a3b8; min-width:60px; text-align:right;">${pct}% (${count})</span>
        </div>`;
    });
    return html + '</div>';
}

// Chart.js 헬퍼
const SV_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function createDoughnutChart(id, counts) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = new Chart(el, {
        type: 'doughnut',
        data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: SV_COLORS.slice(0, Object.keys(counts).length), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, padding: 8 } } } }
    });
    _surveyCharts.push(c);
}

/**
 * 가로 막대(Horizontal Bar) Chart.js 차트 생성 후 _surveyCharts 에 등록.
 * 응답이 많아 라벨이 길 때 좋은 표현 (indexAxis:'y').
 *
 * [입력] id = canvas 의 DOM id, counts = { 라벨: 갯수 } 객체.
 */
function createHBarChart(id, counts) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = new Chart(el, {
        type: 'bar',
        data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: SV_COLORS.slice(0, Object.keys(counts).length), borderWidth: 0, borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } } } }
    });
    _surveyCharts.push(c);
}

/**
 * 세로 막대(Vertical Bar) Chart.js 차트 생성 후 _surveyCharts 에 등록.
 * createHBarChart 와 달리 labels/values 배열을 직접 받음 — 척도형 응답에 적합.
 *
 * @param {string} id     - canvas DOM id
 * @param {Array<string>} labels - x 축 라벨 배열
 * @param {Array<number>} values - 각 라벨의 값
 * @param {string=} color - 막대 색 (미지정 시 파랑)
 */
function createVBarChart(id, labels, values, color) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: color || '#3b82f6', borderWidth: 0, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#cbd5e1' }, grid: { display: false } }, y: { ticks: { color: '#64748b', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
    _surveyCharts.push(c);
}

// CSV 다운로드
window.downloadSurveyCsv = function (surveyId) {
    const a = document.createElement('a');
    a.href = CONFIG.API_BASE + `/api/surveys/${surveyId}/csv`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
};

// ============================================================================
// 응답 목록 모달 (페이지네이션)
// ----------------------------------------------------------------------------
// `결과/분석` 탭의 [응답 목록] 버튼 → 모달로 raw 응답을 50건/페이지로 열람.
// 서버는 `?page=&limit=` 가 동반되면 { data, pagination } 새 포맷을 반환하고,
// 쿼리가 없으면 기존 raw 배열을 반환(loadSurveyResult 의 차트 집계용) — 하위호환.
//
// 모달을 다시 열 때마다 _surveyResponsePage = 1 로 리셋한다.
// ============================================================================
let _surveyResponsePage = 1;
const _SURVEY_RESPONSE_LIMIT = 50;
let _surveyResponseModalSurveyId = null;
// 페이지 연타 race 토큰
let _surveyResponseSeq = 0;

/**
 * 응답 목록 모달 열기.
 *
 * [#6] 컨텍스트 명확화를 위해 surveyTitle 을 옵션 매개변수로 받아 헤더에 표시한다.
 *      (호출처가 제목을 모르면 미지정 OK — 헤더는 "응답 목록" 만 표시)
 *
 * @param {number} surveyId
 * @param {string=} surveyTitle - 모달 헤더에 표시할 설문 제목 (선택)
 */
window.viewSurveyResponses = function (surveyId, surveyTitle) {
    // 같은 surveyId 든 다른 것이든 모달을 열 때마다 1페이지로 리셋
    _surveyResponsePage = 1;
    _surveyResponseModalSurveyId = Number(surveyId);

    // 기존 모달 잔존 시 제거 (재오픈 안전)
    const prev = document.getElementById('survey-response-modal');
    if (prev) prev.remove();

    const titlePart = surveyTitle
        ? ` <span style="color:#cbd5e1; font-weight:600; font-size:0.85rem;">— "${escSvAttr(surveyTitle)}"</span>`
        : '';

    const modal = document.createElement('div');
    modal.id = 'survey-response-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px;';
    modal.innerHTML = `
        <div style="background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:16px; width:100%; max-width:680px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden;">
            <div style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.08); gap:10px;">
                <div style="color:#fff; font-weight:700; font-size:0.95rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    <i class="fa-solid fa-list-check" style="color:#a78bfa;"></i> 응답 목록${titlePart}
                </div>
                <button onclick="document.getElementById('survey-response-modal').remove();" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:1.1rem; flex-shrink:0;" aria-label="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div id="survey-response-modal-body" style="flex:1; overflow-y:auto; padding:14px 18px;">
                <div style="text-align:center; padding:40px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>
            </div>
            <div id="survey-response-pagination" class="pagination" style="padding:10px 16px; border-top:1px solid rgba(255,255,255,0.06);"></div>
        </div>
    `;
    // 배경 클릭 시 닫기 (모달 컨테이너 자체를 클릭한 경우만)
    modal.addEventListener('click', function (ev) {
        if (ev.target === modal) modal.remove();
    });
    document.body.appendChild(modal);

    _loadSurveyResponsePage();
};

/**
 * 응답 목록 모달의 현재 페이지를 fetch → render.
 * _surveyResponseModalSurveyId / _surveyResponsePage 를 그대로 사용.
 */
async function _loadSurveyResponsePage() {
    const body = document.getElementById('survey-response-modal-body');
    const pager = document.getElementById('survey-response-pagination');
    if (!body) return;

    const surveyId = _surveyResponseModalSurveyId;
    if (!surveyId) return;

    // 진입 시 시퀀스 토큰 캡처 — 페이지 연타 race 방어
    const myReq = ++_surveyResponseSeq;

    try {
        const url = CONFIG.API_BASE + `/api/surveys/${surveyId}/responses?page=`
            + _surveyResponsePage + '&limit=' + _SURVEY_RESPONSE_LIMIT;
        const res = await fetch(url);
        const result = await res.json();
        // 이후 더 새 요청이 들어왔다면 이 응답은 무시
        if (myReq !== _surveyResponseSeq) return;

        const items = Array.isArray(result) ? result : (result && result.data) || [];
        const pagination = (result && result.pagination) || {
            page: _surveyResponsePage,
            limit: _SURVEY_RESPONSE_LIMIT,
            total: items.length,
            totalPages: 1
        };

        // 빈 페이지인데 데이터는 존재 → 1페이지로 리셋
        if (items.length === 0 && pagination.total > 0 && _surveyResponsePage > 1) {
            _surveyResponsePage = 1;
            return _loadSurveyResponsePage();
        }

        if (items.length === 0) {
            body.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">아직 응답이 없습니다.</div>';
            if (pager) pager.innerHTML = '';
            return;
        }

        // 헤더 요약
        let html = `<div style="color:#94a3b8; font-size:0.78rem; margin-bottom:10px;">총 ${pagination.total}건 (페이지 ${pagination.page}/${pagination.totalPages})</div>`;

        // 각 응답: 제출일시 + answers 직렬화 (자세히는 차트에서 보므로 간단 표시)
        items.forEach((r) => {
            const dt = r.submittedAt ? r.submittedAt.replace('T', ' ').substring(0, 19) : '';
            const answersStr = (() => {
                try {
                    return Object.entries(r.answers || {}).map(([k, v]) => {
                        const val = Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v);
                        return `Q${k}: ${val}`;
                    }).join(' · ');
                } catch (e) { return ''; }
            })();
            html += `
                <div style="padding:10px 12px; margin-bottom:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:8px;">
                    <div style="display:flex; gap:10px; align-items:center; margin-bottom:4px;">
                        <span style="color:#cbd5e1; font-size:0.78rem; font-weight:600;">${r.responseId ? '#' + r.responseId : '(레거시 응답)'}</span>
                        <span style="color:#64748b; font-size:0.72rem;">${dt}</span>
                    </div>
                    <div style="color:#94a3b8; font-size:0.78rem; line-height:1.4; word-break:break-word;">${escSvAttr(answersStr)}</div>
                </div>
            `;
        });
        body.innerHTML = html;

        // 페이지네이션 UI (공용 helper)
        if (pager && typeof window.renderStandardPagination === 'function') {
            window.renderStandardPagination(
                pager,
                pagination.page,
                pagination.totalPages,
                function (page) {
                    _surveyResponsePage = page;
                    _loadSurveyResponsePage();
                    // 모달 내부 스크롤을 최상단으로
                    body.scrollTop = 0;
                }
            );
        }
    } catch (e) {
        // race: 이후 더 새 요청이 들어왔다면 에러도 덮어쓰지 않는다
        if (myReq !== _surveyResponseSeq) return;
        body.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">로드 실패: ${e.message}</div>`;
        if (pager) pager.innerHTML = '';
    }
}

// ============================================================================
// 서브탭 4: 이력 관리
// ============================================================================
async function renderSurveyHistoryTab(container) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/surveys');
        const surveys = await res.json();

        if (!surveys || surveys.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:60px; color:#64748b;"><i class="fa-solid fa-clock-rotate-left" style="font-size:2rem; margin-bottom:10px; display:block;"></i>설문 이력이 없습니다.</div>';
            return;
        }

        const groups = {};
        surveys.forEach(s => {
            const month = (s.createdAt || '').substring(0, 7) || '날짜없음';
            if (!groups[month]) groups[month] = [];
            groups[month].push(s);
        });

        const icons = { active: 'fa-circle-play', draft: 'fa-file-pen', closed: 'fa-circle-check' };
        const colors = { active: '#10b981', draft: '#f59e0b', closed: '#64748b' };
        const labels = { active: '진행 중', draft: '초안', closed: '마감' };

        let html = '';
        Object.keys(groups).sort().reverse().forEach(month => {
            html += `<div style="color:#94a3b8; font-weight:700; font-size:0.85rem; margin:16px 0 8px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.06);"><i class="fa-solid fa-calendar"></i> ${month}</div>`;
            groups[month].forEach(s => {
                const period = s.startDate && s.endDate ? `${s.startDate.slice(5)} ~ ${s.endDate.slice(5)}` : '';
                html += `
                    <div class="admin-card" style="padding:14px; margin-bottom:8px; display:flex; align-items:center; gap:12px;">
                        <i class="fa-solid ${icons[s.status] || 'fa-circle'}" style="color:${colors[s.status] || '#64748b'}; font-size:1.1rem; flex-shrink:0;"></i>
                        <div style="flex:1; min-width:0;">
                            <div style="color:#e2e8f0; font-weight:600; font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escSvAttr(s.title)}</div>
                            <div style="color:#64748b; font-size:0.75rem; margin-top:2px;">${labels[s.status] || s.status} | ${s.responseCount || 0}명 | ${period}</div>
                        </div>
                        <div style="display:flex; gap:4px; flex-shrink:0;">
                            ${s.status !== 'draft' ? `<button onclick="viewSurveyResult(${s.id})" style="padding:5px 8px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2); border-radius:5px; color:#60a5fa; cursor:pointer; font-size:0.72rem;" title="결과"><i class="fa-solid fa-chart-pie"></i></button>` : ''}
                            <button onclick="duplicateSurvey(${s.id})" style="padding:5px 8px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:5px; color:#94a3b8; cursor:pointer; font-size:0.72rem;" title="복제"><i class="fa-solid fa-copy"></i></button>
                            ${s.status !== 'draft' ? `<button onclick="downloadSurveyCsv(${s.id})" style="padding:5px 8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.2); border-radius:5px; color:#34d399; cursor:pointer; font-size:0.72rem;" title="CSV"><i class="fa-solid fa-file-csv"></i></button>` : ''}
                            <button onclick="deleteSurvey(${s.id})" style="padding:5px 8px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:5px; color:#f87171; cursor:pointer; font-size:0.72rem;" title="삭제"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `;
            });
        });
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">로드 실패: ${e.message}</div>`;
    }
}

window.duplicateSurvey = async function (id) {
    if (!confirm('이 설문을 복제하시겠습니까?')) return;
    try {
        await fetch(CONFIG.API_BASE + `/api/surveys/${id}/duplicate`, { method: 'POST' });
        alert('설문이 복제되었습니다.');
        switchSurveySubTab('survey-status');
    } catch (e) { alert('복제 실패: ' + e.message); }
};
