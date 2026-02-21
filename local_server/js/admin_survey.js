/**
 * ============================================================================
 * 파일명: js/admin_survey.js
 * 역할: 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과/이력)
 * ============================================================================
 *
 * [설명]
 * - renderUnifiedSurveyContent(): 설문조사 메인 탭 렌더링
 * - 서브탭: 설문 생성, 진행 현황, 결과/분석, 이력 관리
 * - Chart.js를 활용한 설문 결과 시각화
 * - CSV 다운로드 기능
 *
 * [로딩 순서] admin.js, admin_collect.js 이후
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
        switchSurveySubTab('survey-status');
    } catch (e) {
        alert('저장 실패: ' + e.message);
    }
};

// ============================================================================
// 서브탭 2: 진행 현황
// ============================================================================
async function renderSurveyStatusTab(container) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/surveys');
        const surveys = await res.json();

        if (!surveys || surveys.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:#64748b;">
                    <i class="fa-solid fa-inbox" style="font-size:2.5rem; color:#334155; margin-bottom:15px; display:block;"></i>
                    <div style="font-size:1rem; font-weight:700; color:#cbd5e1; margin-bottom:6px;">등록된 설문이 없습니다</div>
                    <div style="font-size:0.85rem;">설문 생성 탭에서 새 설문을 만들어보세요.</div>
                </div>`;
            return;
        }

        const active = surveys.filter(s => s.status === 'active');
        const draft = surveys.filter(s => s.status === 'draft');
        let html = '';

        if (active.length > 0) {
            html += `<div style="color:#10b981; font-weight:700; font-size:0.9rem; margin-bottom:10px;"><i class="fa-solid fa-circle-play"></i> 진행 중 (${active.length})</div>`;
            html += active.map(s => buildSurveyCard(s)).join('');
        }
        if (draft.length > 0) {
            html += `<div style="color:#f59e0b; font-weight:700; font-size:0.9rem; margin:16px 0 10px;"><i class="fa-solid fa-file-pen"></i> 초안 (${draft.length})</div>`;
            html += draft.map(s => buildSurveyCard(s)).join('');
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">데이터 로드 실패: ${e.message}</div>`;
    }
}

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
        switchSurveySubTab('survey-status');
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
        switchSurveySubTab('survey-status');
    } catch (e) { alert('발행 실패: ' + e.message); }
};

window.deleteSurvey = async function (id) {
    if (!confirm('이 설문을 삭제하시겠습니까? 모든 응답 데이터도 함께 삭제됩니다.')) return;
    try {
        await fetch(CONFIG.API_BASE + `/api/surveys/${id}`, { method: 'DELETE' });
        alert('삭제되었습니다.');
        switchSurveySubTab('survey-status');
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.editSurvey = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/surveys');
        const surveys = await res.json();
        const survey = surveys.find(s => s.id === id);
        if (!survey) return alert('설문을 찾을 수 없습니다.');

        _editingSurveyId = id;
        _surveyQuestions = (survey.questions || []).map(q => ({ ...q }));
        switchSurveySubTab('survey-create');

        setTimeout(() => {
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
                <button onclick="downloadSurveyCsv(${surveyId})" style="padding:8px 14px; background:linear-gradient(135deg,#3b82f6,#2563eb); border:none; border-radius:8px; color:#fff; cursor:pointer; font-size:0.82rem; font-weight:600;">
                    <i class="fa-solid fa-file-csv"></i> CSV 다운로드
                </button>
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
