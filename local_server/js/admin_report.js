/**
 * ============================================================================
 * 파일명: js/admin_report.js
 * 역할: 관리자 제보 관리 + 차단 관리 UI
 * ============================================================================
 *
 * [설명]
 * - renderUnifiedReportContent(body): 제보 관리 탭 렌더링
 * - renderUnifiedBlockContent(body): 차단 관리 탭 렌더링
 *
 * [로딩 순서] admin_survey.js 이후
 * ============================================================================
 */

// XSS 방지용 이스케이프
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================================
// 1. 제보 관리 탭 렌더링 (하위탭: [기능 제보] / [댓글 신고])
// ============================================================================

let _currentReportSubTab = 'feature'; // 'feature' | 'comment'

window.renderUnifiedReportContent = async function (body) {
    body.innerHTML = `
        <div style="padding:15px;">
            <!-- 하위탭 선택 -->
            <div style="display:flex;gap:6px;margin-bottom:14px;">
                <button id="report-subtab-feature" class="report-subtab-btn active"
                        onclick="window._switchReportSubTab('feature')">
                    <i class="fa-solid fa-envelope"></i> 기능 제보
                    <span id="feature-report-badge" style="display:none;background:#ef4444;color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:8px;margin-left:3px;"></span>
                </button>
                <button id="report-subtab-comment" class="report-subtab-btn"
                        onclick="window._switchReportSubTab('comment')">
                    <i class="fa-solid fa-flag"></i> 댓글 신고
                    <span id="comment-report-badge" style="display:none;background:#ef4444;color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:8px;margin-left:3px;"></span>
                </button>
            </div>

            <!-- 기능 제보 패널 -->
            <div id="report-panel-feature">
                <!-- 필터 탭 -->
                <div id="report-filter-tabs" style="display:flex;gap:6px;margin-bottom:15px;flex-wrap:wrap;">
                    <button class="report-filter-btn active" data-filter="all" onclick="window._filterReports('all')">전체</button>
                    <button class="report-filter-btn" data-filter="접수" onclick="window._filterReports('접수')">접수 <span id="report-pending-badge" style="background:#ef4444;color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:8px;margin-left:3px;"></span></button>
                    <button class="report-filter-btn" data-filter="답변완료" onclick="window._filterReports('답변완료')">답변완료</button>
                </div>
                <!-- 일괄 작업 바 -->
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <label style="display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:0.75rem;cursor:pointer;">
                        <input type="checkbox" id="report-select-all" onchange="window._toggleSelectAllReports(this.checked)"> 전체 선택
                    </label>
                    <button onclick="window._bulkDeleteReports()" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:5px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-trash"></i> 일괄 삭제
                    </button>
                </div>
                <!-- 제보 목록 -->
                <div id="report-list" style="display:flex;flex-direction:column;gap:8px;">
                    <div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>
                </div>
            </div>

            <!-- 댓글 신고 패널 (초기 숨김) -->
            <div id="report-panel-comment" style="display:none;">
                <div id="comment-report-list" style="display:flex;flex-direction:column;gap:8px;">
                    <div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>
                </div>
            </div>
        </div>
    `;

    // 스타일 추가
    if (!document.getElementById('report-admin-styles')) {
        const style = document.createElement('style');
        style.id = 'report-admin-styles';
        style.textContent = `
            .report-filter-btn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#94a3b8; padding:6px 14px; border-radius:6px; font-size:0.75rem; cursor:pointer; transition:all 0.2s; }
            .report-filter-btn.active { background:rgba(59,130,246,0.2); border-color:#3b82f6; color:#60a5fa; }
            .report-item { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px; cursor:pointer; transition:background 0.2s; }
            .report-item:hover { background:rgba(255,255,255,0.06); }
            .report-subtab-btn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#94a3b8; padding:8px 16px; border-radius:8px; font-size:0.8rem; cursor:pointer; transition:all 0.2s; flex:1; }
            .report-subtab-btn.active { background:rgba(59,130,246,0.2); border-color:#3b82f6; color:#60a5fa; font-weight:600; }
        `;
        document.head.appendChild(style);
    }

    _currentReportSubTab = 'feature';
    await loadReportList();
    await _loadCommentReportList();
};

window._switchReportSubTab = function(tab) {
    _currentReportSubTab = tab;
    document.getElementById('report-panel-feature').style.display = tab === 'feature' ? 'block' : 'none';
    document.getElementById('report-panel-comment').style.display = tab === 'comment' ? 'block' : 'none';
    document.getElementById('report-subtab-feature').classList.toggle('active', tab === 'feature');
    document.getElementById('report-subtab-comment').classList.toggle('active', tab === 'comment');
};

let _allReports = [];
let _currentFilter = 'all';

/**
 * 게시글 신고 목록을 서버에서 조회 → renderReportList 로 화면 갱신.
 * 관리자 화면 진입 시 + 신고 처리 후 다시 호출되어 목록을 최신 상태로 유지.
 *
 * [연계] /api/reports 응답을 _reports 전역에 저장.
 */
async function loadReportList() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reports');
        if (!res.ok) throw new Error('API 오류');
        _allReports = await res.json();
    } catch (e) {
        _allReports = [];
    }
    renderReportList();
}

/**
 * _reports 배열을 카드 형태로 #report-list 에 렌더.
 * 각 카드는 신고자/사유/대상 게시글 미리보기 + "처리/무시" 버튼 포함.
 *
 * [호출 시점] loadReportList 직후 + 처리 결과 반영 후.
 */
function renderReportList() {
    const container = document.getElementById('report-list');
    if (!container) return;

    let filtered = _allReports;
    if (_currentFilter !== 'all') {
        filtered = _allReports.filter(r => r.status === _currentFilter);
    }

    // 기능 제보 뱃지 업데이트
    const pendingBadge = document.getElementById('report-pending-badge');
    if (pendingBadge) {
        const pendingCount = _allReports.filter(r => r.status === '접수' && !r.isRead).length;
        pendingBadge.textContent = pendingCount > 0 ? pendingCount : '';
    }
    const featureBadge = document.getElementById('feature-report-badge');
    if (featureBadge) {
        const pendingCount = _allReports.filter(r => r.status === '접수' && !r.isRead).length;
        featureBadge.textContent = pendingCount > 0 ? String(pendingCount) : '';
        featureBadge.style.display = pendingCount > 0 ? 'inline' : 'none';
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:50px;color:#64748b;">
                <i class="fa-solid fa-inbox" style="font-size:2rem;margin-bottom:10px;display:block;"></i>
                <div>제보가 없습니다.</div>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(r => {
        const date = new Date(r.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const statusIcon = r.status === '접수' ? '🔴' : '✅';
        const hasAttach = r.attachments && r.attachments.length > 0 ? `<span style="color:#64748b;font-size:0.65rem;"><i class="fa-solid fa-paperclip"></i> ${r.attachments.length}장</span>` : '';

        return `
            <div class="report-item" style="display:flex;align-items:flex-start;gap:10px;">
                <input type="checkbox" class="report-checkbox" value="${r.id}" style="margin-top:4px;flex-shrink:0;" onclick="event.stopPropagation();">
                <div style="flex:1;min-width:0;" onclick="window._showReportDetail('${r.id}')">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:0.7rem;color:#64748b;background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;">${r.category}</span>
                        <span style="font-size:0.65rem;color:#64748b;">${date} ${statusIcon}</span>
                    </div>
                    <div style="color:#e2e8f0;font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.title}</div>
                    <div style="display:flex;gap:8px;margin-top:4px;align-items:center;">
                        ${hasAttach}
                        <span style="color:#475569;font-size:0.6rem;">${r.deviceId.substring(0, 15)}...</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window._filterReports = function (filter) {
    _currentFilter = filter;
    document.querySelectorAll('.report-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderReportList();
};

window._toggleSelectAllReports = function (checked) {
    document.querySelectorAll('.report-checkbox').forEach(cb => { cb.checked = checked; });
};

window._bulkDeleteReports = async function () {
    const ids = Array.from(document.querySelectorAll('.report-checkbox:checked')).map(cb => cb.value);
    if (ids.length === 0) { alert('삭제할 제보를 선택해주세요.'); return; }
    if (!confirm(`${ids.length}건의 제보를 삭제하시겠습니까?`)) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reports/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) {
            alert(`${ids.length}건 삭제되었습니다.`);
            await loadReportList();
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

// ============================================================================
// 댓글 신고 목록 로드 및 렌더링
// ============================================================================

let _allCommentReports = [];

/**
 * 댓글 신고 목록을 서버에서 조회 → _renderCommentReportList 로 화면 갱신.
 * loadReportList 의 댓글 버전 — 같은 패턴, 다른 엔드포인트.
 */
async function _loadCommentReportList() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/comment-reports');
        _allCommentReports = res.ok ? await res.json() : [];
    } catch (e) { _allCommentReports = []; }
    _renderCommentReportList();
}

/**
 * _commentReports 배열을 카드로 #comment-report-list 에 렌더.
 * renderReportList 의 댓글 버전 — 신고된 댓글 본문/작성자/처리 버튼.
 */
function _renderCommentReportList() {
    const container = document.getElementById('comment-report-list');
    if (!container) return;

    // 댓글 신고 뱃지 업데이트
    const badge = document.getElementById('comment-report-badge');
    if (badge) {
        const count = _allCommentReports.filter(r => r.status === 'pending').length;
        badge.textContent = count > 0 ? String(count) : '';
        badge.style.display = count > 0 ? 'inline' : 'none';
    }

    if (_allCommentReports.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:50px;color:#64748b;"><i class="fa-solid fa-flag" style="font-size:2rem;margin-bottom:10px;display:block;"></i><div>신고된 댓글이 없습니다.</div></div>`;
        return;
    }

    const statusLabel = { pending: '🔴 대기중', deleted: '🗑️ 삭제됨', blocked: '🚫 차단', ignored: '⬜ 무시', done: '✅ 처리완료' };
    const statusColor = { pending: '#f87171', deleted: '#94a3b8', blocked: '#fb923c', ignored: '#64748b', done: '#4ade80' };

    container.innerHTML = _allCommentReports.map(r => {
        const sl = statusLabel[r.status] || r.status;
        const sc = statusColor[r.status] || '#94a3b8';
        const dateStr = r.createdAt || '';
        const isPending = r.status === 'pending';
        return `
        <div class="report-item" style="${isPending ? 'border-color:rgba(239,68,68,0.3);' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                <span style="background:rgba(239,68,68,0.1);color:#f87171;padding:2px 8px;border-radius:4px;font-size:0.7rem;">${escapeHTML(r.reason)}</span>
                <span style="font-size:0.65rem;color:${sc};">${sl} · ${dateStr}</span>
            </div>
            <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;">
                신고 대상: <span style="color:#e2e8f0;font-weight:600;">${escapeHTML(r.commentNickname)}</span>
            </div>
            <div style="color:#cbd5e1;font-size:0.8rem;background:rgba(0,0,0,0.2);padding:8px;border-radius:6px;margin-bottom:10px;white-space:pre-wrap;word-break:break-all;">${escapeHTML(r.commentContent || '(내용 없음)')}</div>
            ${isPending ? `
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
                <button onclick="window._processCommentReport('${r.id}', 'deleted')"
                        style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:5px 10px;border-radius:5px;font-size:0.72rem;cursor:pointer;">
                    <i class="fa-solid fa-trash-can"></i> 댓글 삭제 후 처리
                </button>
                <button onclick="window._processCommentReport('${r.id}', 'blocked')"
                        style="background:rgba(251,146,60,0.15);border:1px solid rgba(251,146,60,0.3);color:#fb923c;padding:5px 10px;border-radius:5px;font-size:0.72rem;cursor:pointer;">
                    <i class="fa-solid fa-ban"></i> 작성자 차단
                </button>
                <button onclick="window._processCommentReport('${r.id}', 'ignored')"
                        style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;padding:5px 10px;border-radius:5px;font-size:0.72rem;cursor:pointer;">
                    <i class="fa-solid fa-eye-slash"></i> 무시
                </button>
                <button onclick="window._processCommentReport('${r.id}', 'done')"
                        style="background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#4ade80;padding:5px 10px;border-radius:5px;font-size:0.72rem;cursor:pointer;">
                    <i class="fa-solid fa-check"></i> 처리완료
                </button>
            </div>
            ` : `<div style="font-size:0.7rem;color:#64748b;">처리됨: ${r.processedAt || ''}</div>`}
        </div>`;
    }).join('');
}

window._processCommentReport = async function(id, status) {
    const labels = { deleted: '댓글 삭제 후 처리', blocked: '작성자 차단', ignored: '무시', done: '처리완료' };
    if (!confirm(`"${labels[status]}"로 처리하시겠습니까?`)) return;

    // 댓글 삭제 처리인 경우: 먼저 해당 댓글을 소프트 삭제
    if (status === 'deleted') {
        const report = _allCommentReports.find(r => r.id === id);
        if (report && report.commentId) {
            try {
                await fetch(CONFIG.API_BASE + '/api/comments/' + report.commentId, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isAdmin: true, deletedBy: 'admin' })
                });
            } catch (e) { /* 이미 삭제된 경우 무시 */ }
        }
    }

    // 차단 처리인 경우: 작성자 기기 ID 차단 (comment_reports에서 commentId로 신고된 댓글 찾아서 deviceId 차단)
    if (status === 'blocked') {
        const report = _allCommentReports.find(r => r.id === id);
        if (report && report.commentId) {
            // 댓글 목록에서 해당 댓글의 deviceId를 찾아서 차단
            try {
                await fetch(CONFIG.API_BASE + '/api/comments/' + report.commentId, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isAdmin: true, deletedBy: 'admin' })
                });
            } catch (e) { /* 무시 */ }
        }
    }

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/comment-reports/' + id + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            await _loadCommentReportList();
            // 헤더 봉투 뱃지 갱신
            if (typeof window.updateReportBadge === 'function') window.updateReportBadge();
        }
    } catch (e) { alert('처리 실패: ' + e.message); }
};

// ============================================================================
// 2. 제보 상세 보기
// ============================================================================
window._showReportDetail = async function (id) {
    const report = _allReports.find(r => r.id === id);
    if (!report) return;

    // 관리자가 제보를 열람했으므로 읽음 처리합니다.
    // - 서버에 isRead: true 저장 → 뱃지 카운트에서 제외
    // - 로컬 배열도 즉시 업데이트 → 목록 돌아왔을 때 뱃지 즉시 반영
    if (!report.isRead) {
        try {
            await fetch(CONFIG.API_BASE + '/api/reports/' + id + '/read', { method: 'PATCH' });
            report.isRead = true; // 로컬 상태 즉시 반영
            // 헤더 봉투 뱃지도 즉시 갱신
            if (typeof window.updateReportBadge === 'function') window.updateReportBadge();
        } catch (e) { /* 읽음 처리 실패해도 상세보기는 정상 진행 */ }
    }

    const body = document.getElementById('unified-admin-body');
    if (!body) return;

    const date = new Date(report.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const answeredDate = report.answeredAt ? new Date(report.answeredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';

    const attachHTML = (report.attachments && report.attachments.length > 0)
        ? report.attachments.map((f, idx) => `
            <div style="display:inline-block;position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;border:1px solid #334155;">
                <div onclick="window._openImageViewer('${report.id}', ${idx})" style="width:100%;height:100%;cursor:pointer;">
                    <img src="/uploads/reports/${f}" style="width:100%;height:100%;object-fit:cover;">
                </div>
                <a href="${CONFIG.API_BASE}/api/reports/${report.id}/download/${encodeURIComponent(f)}" download
                   onclick="event.stopPropagation();"
                   style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,0.7);color:#fff;width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;text-decoration:none;"
                   title="다운로드">
                    <i class="fa-solid fa-download"></i>
                </a>
            </div>
        `).join('')
        : '<span style="color:#64748b;font-size:0.8rem;">첨부파일 없음</span>';

    body.innerHTML = `
        <div style="padding:15px;">
            <button onclick="window.renderUnifiedReportContent(document.getElementById('unified-admin-body'))"
                    style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;padding:6px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;margin-bottom:15px;">
                <i class="fa-solid fa-arrow-left"></i> 목록으로
            </button>

            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:15px;margin-bottom:15px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:3px 8px;border-radius:4px;font-size:0.7rem;">${report.category}</span>
                    <span style="color:#64748b;font-size:0.7rem;">${report.status === '접수' ? '🔴 접수' : '✅ 답변완료'}</span>
                </div>
                <h4 style="color:#e2e8f0;margin:0 0 8px;font-size:1rem;">${escapeHTML(report.title)}</h4>
                <div style="display:flex;gap:15px;color:#64748b;font-size:0.7rem;margin-bottom:12px;">
                    <span><i class="fa-solid fa-clock"></i> ${date}</span>
                    <span><i class="fa-solid fa-mobile-screen"></i> ${report.deviceId.substring(0, 20)}...</span>
                </div>
                <div style="color:#cbd5e1;font-size:0.85rem;line-height:1.6;white-space:pre-wrap;background:rgba(0,0,0,0.2);padding:12px;border-radius:6px;">${escapeHTML(report.content)}</div>
            </div>

            <!-- 첨부파일 -->
            <div style="margin-bottom:15px;">
                <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-paperclip"></i> 첨부사진</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">${attachHTML}</div>
            </div>

            <!-- ── 대화 스레드: 관리자 답변 → 사용자 추가 의견 → 관리자 추가 답변 ── -->

            ${report.answer ? `
                <!-- 관리자 최초 답변 (읽기 전용) -->
                <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.15);border-radius:8px;padding:12px;margin-bottom:15px;">
                    <div style="color:#4ade80;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-reply"></i> 관리자 답변 (${answeredDate})</div>
                    <div style="color:#e2e8f0;font-size:0.85rem;white-space:pre-wrap;">${escapeHTML(report.answer)}</div>
                    ${(report.answerAttachments && report.answerAttachments.length > 0) ? `
                        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;">
                            ${report.answerAttachments.map(f => `<img src="/uploads/reports/${f}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #334155;">`).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            ${report.userComment ? `
                <!-- 사용자 추가 의견 (읽기 전용) -->
                <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:12px;margin-bottom:15px;">
                    <div style="color:#60a5fa;font-size:0.75rem;margin-bottom:6px;">
                        <i class="fa-solid fa-comment"></i> 사용자 추가 의견
                        (${report.userCommentAt ? new Date(report.userCommentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''})
                    </div>
                    <div style="color:#e2e8f0;font-size:0.85rem;white-space:pre-wrap;">${escapeHTML(report.userComment)}</div>
                </div>
            ` : ''}

            ${report.additionalAnswer ? `
                <!-- 관리자 추가 답변 (읽기 전용) -->
                <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.15);border-radius:8px;padding:12px;margin-bottom:15px;">
                    <div style="color:#4ade80;font-size:0.75rem;margin-bottom:6px;">
                        <i class="fa-solid fa-reply-all"></i> 관리자 추가 답변
                        (${report.additionalAnsweredAt ? new Date(report.additionalAnsweredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''})
                    </div>
                    <div style="color:#e2e8f0;font-size:0.85rem;white-space:pre-wrap;">${escapeHTML(report.additionalAnswer)}</div>
                </div>
            ` : ''}

            <!-- 답변/추가 답변 작성 영역 -->
            ${report.userComment && !report.additionalAnswer ? `
                <!-- 사용자 추가 의견이 있고, 아직 추가 답변을 안 한 경우 → 추가 답변 작성 -->
                <div style="margin-bottom:15px;">
                    <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-pen"></i> 관리자 추가 답변 작성</div>
                    <textarea id="admin-additional-answer-text" rows="4" placeholder="추가 답변을 입력하세요..."
                              style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button onclick="window._blockReportUser('${report.deviceId}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-ban"></i> 사용자 차단
                    </button>
                    <button onclick="window._deleteReport('${report.id}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-trash"></i> 삭제
                    </button>
                    <button onclick="window._sendAdditionalAnswer('${report.id}', false)"
                            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-paper-plane"></i> 추가 답변 발송
                    </button>
                    <button onclick="window._sendAdditionalAnswer('${report.id}', true)"
                            style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600;">
                        <i class="fa-solid fa-bell"></i> 추가 답변 + 푸시
                    </button>
                </div>
            ` : !report.answer ? `
                <!-- 최초 답변 미작성 → 답변 작성 영역 -->
                <div style="margin-bottom:15px;">
                    <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-pen"></i> 관리자 답변 작성</div>
                    <textarea id="admin-answer-text" rows="4" placeholder="답변을 입력하세요..."
                              style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-paperclip"></i> 답변 이미지 첨부 <span style="color:#64748b;font-size:0.65rem;">(최대 3장, 5MB)</span></div>
                    <div id="admin-answer-attach-area" style="display:flex;gap:8px;flex-wrap:wrap;">
                        <label style="width:70px;height:70px;border:2px dashed #334155;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#64748b;font-size:1.5rem;" id="admin-answer-add-btn">
                            <input type="file" accept="image/*" style="display:none;" onchange="window._addAnswerAttachment(this)">
                            <i class="fa-solid fa-plus"></i>
                        </label>
                    </div>
                    <div id="admin-answer-previews" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button onclick="window._blockReportUser('${report.deviceId}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-ban"></i> 사용자 차단
                    </button>
                    <button onclick="window._deleteReport('${report.id}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-trash"></i> 삭제
                    </button>
                    <button onclick="window._sendAnswer('${report.id}', false)"
                            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-paper-plane"></i> 답변 발송
                    </button>
                    <button onclick="window._sendAnswer('${report.id}', true)"
                            style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600;">
                        <i class="fa-solid fa-bell"></i> 답변 발송 + 푸시
                    </button>
                </div>
            ` : `
                <!-- 답변 완료 + 추가 의견 없거나 추가 답변도 완료된 경우 → 답변 수정 영역 -->
                <div style="margin-bottom:15px;">
                    <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-pen"></i> 관리자 답변 수정</div>
                    <textarea id="admin-answer-text" rows="4" placeholder="답변을 수정하세요..."
                              style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;">${report.answer || ''}</textarea>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-paperclip"></i> 답변 이미지 첨부 <span style="color:#64748b;font-size:0.65rem;">(최대 3장, 5MB)</span></div>
                    <div id="admin-answer-attach-area" style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${(report.answerAttachments || []).map(f => `
                            <div class="admin-answer-existing-img" data-filename="${f}" style="position:relative;width:70px;height:70px;border-radius:6px;overflow:hidden;border:1px solid #334155;">
                                <img src="/uploads/reports/${f}" style="width:100%;height:100%;object-fit:cover;">
                                <button onclick="this.parentElement.remove();" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);border:none;color:#fff;width:18px;height:18px;border-radius:50%;font-size:0.6rem;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        `).join('')}
                        <label style="width:70px;height:70px;border:2px dashed #334155;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#64748b;font-size:1.5rem;" id="admin-answer-add-btn">
                            <input type="file" accept="image/*" style="display:none;" onchange="window._addAnswerAttachment(this)">
                            <i class="fa-solid fa-plus"></i>
                        </label>
                    </div>
                    <div id="admin-answer-previews" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button onclick="window._blockReportUser('${report.deviceId}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-ban"></i> 사용자 차단
                    </button>
                    <button onclick="window._deleteReport('${report.id}')"
                            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-trash"></i> 삭제
                    </button>
                    <button onclick="window._sendAnswer('${report.id}', false)"
                            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;">
                        <i class="fa-solid fa-paper-plane"></i> 답변 발송
                    </button>
                    <button onclick="window._sendAnswer('${report.id}', true)"
                            style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600;">
                        <i class="fa-solid fa-bell"></i> 답변 발송 + 푸시
                    </button>
                </div>
            `}
        </div>
    `;
};

// ============================================================================
// 2-1. 이미지 뷰어 팝업 (스와이프 넘기기, 핀치 확대 지원)
// ============================================================================
window._openImageViewer = function (reportId, startIndex) {
    const existing = document.getElementById('image-viewer-modal');
    if (existing) existing.remove();

    const report = _allReports.find(r => r.id === reportId);
    if (!report || !report.attachments || report.attachments.length === 0) return;

    const attachments = report.attachments;
    let currentIndex = startIndex || 0;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX, startY, lastTranslateX, lastTranslateY;
    // 스와이프 감지용
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swiping = false;

    const modal = document.createElement('div');
    modal.id = 'image-viewer-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;';

    /**
     * 첨부파일명을 받아 서버 다운로드 URL 생성. 외부 링크 a[download] href 에 사용.
     */
    function getDownloadUrl(filename) {
        return CONFIG.API_BASE + '/api/reports/' + reportId + '/download/' + encodeURIComponent(filename);
    }

    /**
     * 모달 본문(이미지 + 좌우 네비/다운로드 버튼) 을 다시 그림.
     * currentIndex 변경 후 호출되어 이미지 src 와 인디케이터(1/N) 를 갱신.
     * 줌 상태(scale, translateX/Y) 는 매 render 시 1배·중앙 으로 초기화.
     */
    function render() {
        const filename = attachments[currentIndex];
        const src = '/uploads/reports/' + filename;
        const indicator = attachments.length > 1 ? `<span style="color:rgba(255,255,255,0.5);font-size:0.75rem;">${currentIndex + 1} / ${attachments.length}</span>` : '';

        modal.innerHTML = `
            <div style="position:relative;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:48px 16px 12px 16px;z-index:10003;background:linear-gradient(to bottom,rgba(0,0,0,0.7),transparent);flex-shrink:0;">
                <div style="display:flex;gap:10px;align-items:center;">
                    <a id="iv-download" href="${getDownloadUrl(filename)}" download
                       style="background:rgba(59,130,246,0.4);border:none;color:#fff;width:40px;height:40px;border-radius:10px;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none;" title="다운로드">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    ${indicator}
                </div>
                <button id="iv-close" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:40px;height:40px;border-radius:10px;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div id="iv-container" style="flex:1;width:100%;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;touch-action:none;">
                ${attachments.length > 1 && currentIndex > 0 ? `
                <button id="iv-prev" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);z-index:10004;background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>` : ''}
                <img id="iv-image" src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;transition:transform 0.15s ease;user-select:none;-webkit-user-drag:none;" draggable="false">
                ${attachments.length > 1 && currentIndex < attachments.length - 1 ? `
                <button id="iv-next" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:10004;background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>` : ''}
            </div>
        `;

        // 줌 초기화
        scale = 1;
        translateX = 0;
        translateY = 0;

        bindEvents();
    }

    /**
     * 인덱스 idx 의 첨부파일로 이동(범위 밖이면 무시) + render 재호출.
     * 스와이프/이전·다음 버튼/스와이프 제스처가 호출.
     */
    function goTo(idx) {
        if (idx < 0 || idx >= attachments.length) return;
        currentIndex = idx;
        render();
    }

    /**
     * 모달의 모든 인터랙션(닫기/네비/줌/스와이프/드래그) 이벤트를 한 번에 등록.
     * render 가 innerHTML 을 다시 쓸 때마다 새 DOM 에 다시 바인딩.
     */
    function bindEvents() {
        const img = document.getElementById('iv-image');
        const container = document.getElementById('iv-container');

        // 닫기 버튼
        document.getElementById('iv-close').onclick = () => { cleanup(); modal.remove(); };

        // 이전/다음 버튼
        const prevBtn = document.getElementById('iv-prev');
        const nextBtn = document.getElementById('iv-next');
        if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); goTo(currentIndex - 1); };
        if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); goTo(currentIndex + 1); };

        /**
         * 현재 scale + translate 값으로 img 의 CSS transform 갱신.
         * scale, translateX/Y 가 closure 변수로 공유되어 모든 핸들러가 사용.
         */
        function updateTransform() {
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        }

        /**
         * 새 줌 배율 적용 — 1.0~10.0 범위로 클램프.
         * scale=1 이 되면 평행이동 누적값(translateX/Y) 도 0 으로 리셋.
         */
        function zoomTo(newScale) {
            scale = Math.max(1, Math.min(10, newScale));
            if (scale === 1) { translateX = 0; translateY = 0; }
            updateTransform();
        }

        // 마우스 휠 확대 (축소는 1 이하로 안 됨)
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoomTo(scale * delta);
        }, { passive: false });

        // 마우스 드래그 (확대 시 이동)
        container.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            if (scale > 1) {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                lastTranslateX = translateX;
                lastTranslateY = translateY;
                container.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        const onMouseMove = (e) => {
            if (!isDragging) return;
            translateX = lastTranslateX + (e.clientX - startX);
            translateY = lastTranslateY + (e.clientY - startY);
            img.style.transition = 'none';
            updateTransform();
        };
        const onMouseUp = () => {
            isDragging = false;
            if (container) container.style.cursor = '';
            if (img) img.style.transition = 'transform 0.15s ease';
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // 터치: 핀치 줌 + 스와이프 넘기기 + 드래그 이동
        let lastTouchDist = 0;
        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // 핀치 줌 시작
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastTouchDist = Math.sqrt(dx * dx + dy * dy);
            } else if (e.touches.length === 1) {
                swipeStartX = e.touches[0].clientX;
                swipeStartY = e.touches[0].clientY;
                if (scale > 1) {
                    // 확대 상태: 드래그 이동
                    isDragging = true;
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    lastTranslateX = translateX;
                    lastTranslateY = translateY;
                } else {
                    // 원본 크기: 스와이프 모드
                    swiping = true;
                }
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (lastTouchDist > 0) {
                    zoomTo(scale * (dist / lastTouchDist));
                }
                lastTouchDist = dist;
            } else if (e.touches.length === 1 && isDragging && scale > 1) {
                e.preventDefault();
                translateX = lastTranslateX + (e.touches[0].clientX - startX);
                translateY = lastTranslateY + (e.touches[0].clientY - startY);
                img.style.transition = 'none';
                updateTransform();
            }
            // 스와이프는 touchend에서 판정
        }, { passive: false });

        container.addEventListener('touchend', (e) => {
            if (swiping && scale === 1 && e.changedTouches.length > 0) {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const diffX = endX - swipeStartX;
                const diffY = Math.abs(endY - swipeStartY);
                // 수평 스와이프 감지 (50px 이상, 수직 이동보다 수평이 클 때)
                if (Math.abs(diffX) > 50 && Math.abs(diffX) > diffY) {
                    if (diffX < 0 && currentIndex < attachments.length - 1) {
                        goTo(currentIndex + 1); return;
                    } else if (diffX > 0 && currentIndex > 0) {
                        goTo(currentIndex - 1); return;
                    }
                }
            }
            isDragging = false;
            swiping = false;
            lastTouchDist = 0;
            if (img) img.style.transition = 'transform 0.15s ease';
        });

        // 배경 클릭 시 닫기
        container.addEventListener('click', (e) => {
            if (e.target === container) { cleanup(); modal.remove(); }
        });

        // 리스너 정리 함수 저장
        modal._cleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('keydown', onKey);
        };
    }

    /**
     * 모달 닫기 직전 호출 — bindEvents 에서 등록한 document 단위 listener
     * (mousemove/mouseup 등) 를 해제하기 위한 hook.
     * modal._cleanup 은 bindEvents 안에서 closure 로 만들어진 해제 함수.
     */
    function cleanup() {
        if (modal._cleanup) modal._cleanup();
    }

    document.body.appendChild(modal);
    render();

    // ESC / 좌우 화살표 키
    const onKey = (e) => {
        if (e.key === 'Escape') { cleanup(); modal.remove(); }
        else if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
        else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
    };
    document.addEventListener('keydown', onKey);
    // 첫 render에서 onKey가 아직 없으므로 여기서 저장
    modal._cleanup = () => {
        document.removeEventListener('keydown', onKey);
    };
};

// 답변 이미지 첨부 관리
const _answerFiles = []; // { file, dataUrl }

window._addAnswerAttachment = function (input) {
    if (!input.files || !input.files[0]) return;
    const existingCount = document.querySelectorAll('.admin-answer-existing-img').length;
    if (_answerFiles.length + existingCount >= 3) {
        alert('이미지는 최대 3장까지 첨부할 수 있습니다.');
        input.value = '';
        return;
    }
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
        alert('파일 크기는 5MB 이하만 가능합니다.');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        _answerFiles.push({ file, dataUrl: e.target.result });
        _renderAnswerPreviews();
        input.value = '';
    };
    reader.readAsDataURL(file);
};

/**
 * 신고 답변 임시저장 미리보기를 #admin-answer-previews 에 렌더.
 * 작성 중인 답변(localStorage 등에 임시 저장된 것) 을 카드로 보여 줘 다시
 * 신고 처리할 때 작성을 이어갈 수 있게 도와줌.
 */
function _renderAnswerPreviews() {
    const container = document.getElementById('admin-answer-previews');
    if (!container) return;
    container.innerHTML = _answerFiles.map((item, i) => `
        <div style="position:relative;width:70px;height:70px;border-radius:6px;overflow:hidden;border:1px solid #334155;">
            <img src="${item.dataUrl}" style="width:100%;height:100%;object-fit:cover;">
            <button onclick="window._removeAnswerAttachment(${i})" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);border:none;color:#fff;width:18px;height:18px;border-radius:50%;font-size:0.6rem;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');

    // 3장 이상이면 추가 버튼 숨김
    const addBtn = document.getElementById('admin-answer-add-btn');
    const existingCount = document.querySelectorAll('.admin-answer-existing-img').length;
    if (addBtn) addBtn.style.display = (_answerFiles.length + existingCount >= 3) ? 'none' : 'flex';
}

window._removeAnswerAttachment = function (index) {
    _answerFiles.splice(index, 1);
    _renderAnswerPreviews();
};

window._sendAnswer = async function (reportId, sendPush) {
    const answer = document.getElementById('admin-answer-text').value.trim();
    if (!answer) { alert('답변 내용을 입력해주세요.'); return; }

    try {
        const formData = new FormData();
        formData.append('answer', answer);
        formData.append('sendPush', sendPush ? 'true' : 'false');

        // 기존 이미지 유지 (삭제되지 않은 것)
        const existingImgs = document.querySelectorAll('.admin-answer-existing-img');
        existingImgs.forEach(el => {
            formData.append('existingAttachments', el.dataset.filename);
        });

        // 새 이미지 추가
        _answerFiles.forEach(item => {
            formData.append('answerAttachments', item.file);
        });

        const res = await fetch(CONFIG.API_BASE + '/api/reports/' + reportId + '/answer', {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            _answerFiles.length = 0; // 초기화
            alert(sendPush ? '답변이 발송되었습니다. (푸시 포함)' : '답변이 저장되었습니다.');
            const body = document.getElementById('unified-admin-body');
            if (body) await renderUnifiedReportContent(body);
        } else {
            const data = await res.json();
            alert(data.error || '답변 발송 실패');
        }
    } catch (e) { alert('서버 오류: ' + e.message); }
};

/**
 * 관리자 추가 답변 발송 함수
 * 사용자가 추가 의견을 보낸 제보에 대해 관리자가 추가 답변을 작성하여 전송
 *
 * [동작]
 * 1. 추가 답변 텍스트를 서버에 전송 (POST /api/reports/:id/additional-answer)
 * 2. 성공 시 제보 목록으로 돌아감
 * 3. 푸시 옵션이 있으면 사용자에게 알림 발송
 *
 * [연계] _showReportDetail() → 추가 답변 발송 버튼의 onclick에서 호출
 * [연계] routes/report.js → POST /api/reports/:id/additional-answer
 *
 * @param {string} reportId - 제보 ID
 * @param {boolean} sendPush - 사용자에게 푸시 알림 발송 여부
 */
window._sendAdditionalAnswer = async function (reportId, sendPush) {
    var answerEl = document.getElementById('admin-additional-answer-text');
    if (!answerEl) return;
    var answer = answerEl.value.trim();
    if (!answer) { alert('추가 답변 내용을 입력해주세요.'); return; }

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/reports/' + reportId + '/additional-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: answer, sendPush: sendPush ? 'true' : 'false' })
        });
        if (res.ok) {
            alert(sendPush ? '추가 답변이 발송되었습니다. (푸시 포함)' : '추가 답변이 저장되었습니다.');
            var body = document.getElementById('unified-admin-body');
            if (body) await renderUnifiedReportContent(body);
        } else {
            var data = await res.json();
            alert(data.error || '추가 답변 발송 실패');
        }
    } catch (e) { alert('서버 오류: ' + e.message); }
};

window._deleteReport = async function (reportId) {
    if (!confirm('이 제보를 삭제하시겠습니까?')) return;
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reports/' + reportId, { method: 'DELETE' });
        if (res.ok) {
            alert('삭제되었습니다.');
            const body = document.getElementById('unified-admin-body');
            if (body) await renderUnifiedReportContent(body);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

// ============================================================================
// 3. 사용자 차단 모달
// ============================================================================
window._blockReportUser = function (deviceId) {
    const existing = document.getElementById('block-user-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'block-user-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;';

    modal.innerHTML = `
        <div style="background:#1e2435;border-radius:12px;padding:20px;max-width:350px;width:90%;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
            <h3 style="color:#fff;margin:0 0 15px;font-size:1rem;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-ban" style="color:#ef4444;"></i> 사용자 차단
            </h3>
            <div style="color:#64748b;font-size:0.7rem;margin-bottom:12px;">기기 ID: ${deviceId.substring(0, 20)}...</div>

            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">차단 유형</label>
                <select id="block-type" style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;">
                    <option value="report">제보 차단</option>
                    <option value="app">앱 차단</option>
                </select>
            </div>

            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">차단 사유</label>
                <input type="text" id="block-reason" placeholder="차단 사유를 입력하세요"
                       style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">차단 기간</label>
                <select id="block-duration" style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;">
                    <option value="1d">1일</option>
                    <option value="7d">7일</option>
                    <option value="30d">1개월</option>
                    <option value="90d">3개월</option>
                    <option value="180d">6개월</option>
                    <option value="permanent">영구</option>
                </select>
            </div>

            <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('block-user-modal').remove();"
                        style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;color:#aaa;cursor:pointer;">취소</button>
                <button onclick="window._confirmBlockUser('${deviceId}')"
                        style="flex:1;padding:10px;background:#ef4444;border:none;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;">차단</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
};

window._confirmBlockUser = async function (deviceId) {
    const type = document.getElementById('block-type').value;
    const reason = document.getElementById('block-reason').value.trim();
    const duration = document.getElementById('block-duration').value;

    if (!reason) { alert('차단 사유를 입력해주세요.'); return; }

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/blocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, type, reason, duration })
        });
        if (res.ok) {
            alert('차단이 등록되었습니다.');
            document.getElementById('block-user-modal').remove();
        } else {
            const data = await res.json();
            alert(data.error || '차단 등록 실패');
        }
    } catch (e) { alert('서버 오류: ' + e.message); }
};

// ============================================================================
// 4. 차단 관리 탭 렌더링
// ============================================================================
window.renderUnifiedBlockContent = async function (body) {
    body.innerHTML = `
        <div style="padding:15px;">
            <div id="block-filter-tabs" style="display:flex;gap:6px;margin-bottom:15px;flex-wrap:wrap;">
                <button class="report-filter-btn active" data-bfilter="all" onclick="window._filterBlocks('all')">전체</button>
                <button class="report-filter-btn" data-bfilter="report" onclick="window._filterBlocks('report')">제보 차단</button>
                <button class="report-filter-btn" data-bfilter="tide" onclick="window._filterBlocks('tide')">조석 조회 차단</button>
                <button class="report-filter-btn" data-bfilter="app" onclick="window._filterBlocks('app')">앱 차단</button>
            </div>

            <div id="block-list" style="display:flex;flex-direction:column;gap:8px;">
                <div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>
            </div>
        </div>
    `;

    await loadBlockList();
};

let _allBlocks = { reportBlocks: [], tideBlocks: [], appBlocks: [] };
let _currentBlockFilter = 'all';

/**
 * 차단 목록을 서버에서 조회 → renderBlockList 로 화면 갱신.
 * 관리자 차단 관리 탭 진입 + 차단 추가/해제 후 다시 호출.
 */
async function loadBlockList() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/blocks');
        if (!res.ok) throw new Error('API 오류');
        _allBlocks = await res.json();
    } catch (e) {
        _allBlocks = { reportBlocks: [], tideBlocks: [], appBlocks: [] };
    }
    renderBlockList();
}

/**
 * _blocks 배열을 카드로 #block-list 에 렌더.
 * 사용자별 차단 사유, 등록 일시, 해제 버튼 표시.
 */
function renderBlockList() {
    const container = document.getElementById('block-list');
    if (!container) return;

    // 모든 차단을 통합 리스트로 변환
    let items = [];
    if (_currentBlockFilter === 'all' || _currentBlockFilter === 'report') {
        items = items.concat((_allBlocks.reportBlocks || []).map(b => ({ ...b, type: '제보 차단', typeKey: 'report' })));
    }
    if (_currentBlockFilter === 'all' || _currentBlockFilter === 'tide') {
        items = items.concat((_allBlocks.tideBlocks || []).map(b => ({ ...b, type: '조석 조회 차단', typeKey: 'tide' })));
    }
    if (_currentBlockFilter === 'all' || _currentBlockFilter === 'app') {
        items = items.concat((_allBlocks.appBlocks || []).map(b => ({ ...b, type: '앱 차단', typeKey: 'app' })));
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:50px;color:#64748b;">
                <i class="fa-solid fa-shield-halved" style="font-size:2rem;margin-bottom:10px;display:block;"></i>
                <div>차단된 사용자가 없습니다.</div>
            </div>`;
        return;
    }

    container.innerHTML = items.map(b => {
        const now = new Date();
        let remainText;
        if (b.until === 'permanent') {
            remainText = '<span style="color:#ef4444;">영구</span>';
        } else {
            const untilDate = new Date(b.until);
            if (untilDate <= now) {
                remainText = '<span style="color:#22c55e;">만료됨</span>';
            } else {
                const diffMs = untilDate - now;
                const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                if (diffDays < 1) {
                    remainText = '<span style="color:#fbbf24;">오늘 자정 해제</span>';
                } else {
                    remainText = `<span style="color:#fbbf24;">${diffDays}일 남음</span>`;
                }
            }
        }

        const typeColor = b.typeKey === 'app' ? '#ef4444' : (b.typeKey === 'report' ? '#f59e0b' : '#3b82f6');

        return `
            <div class="report-item" style="display:flex;align-items:center;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
                        <span style="background:${typeColor}22;color:${typeColor};padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:600;">${b.type}</span>
                        ${remainText}
                    </div>
                    <div style="color:#e2e8f0;font-size:0.8rem;margin-bottom:2px;">${b.deviceId.substring(0, 25)}...</div>
                    <div style="color:#64748b;font-size:0.7rem;">사유: ${b.reason || '-'}</div>
                </div>
                <button onclick="window._unblockUser('${b.deviceId}', '${b.typeKey}')"
                        style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:6px 10px;border-radius:6px;font-size:0.7rem;cursor:pointer;flex-shrink:0;">
                    해제
                </button>
            </div>
        `;
    }).join('');
}

window._filterBlocks = function (filter) {
    _currentBlockFilter = filter;
    document.querySelectorAll('#block-filter-tabs .report-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bfilter === filter);
    });
    renderBlockList();
};

window._unblockUser = async function (deviceId, type) {
    if (!confirm('이 사용자의 차단을 해제하시겠습니까?')) return;
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/blocks/' + encodeURIComponent(deviceId) + '/' + type, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert('차단이 해제되었습니다.');
            await loadBlockList();
        }
    } catch (e) { alert('해제 실패: ' + e.message); }
};
