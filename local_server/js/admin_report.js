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
// 1. 제보 관리 탭 렌더링
// ============================================================================
window.renderUnifiedReportContent = async function (body) {
    body.innerHTML = `
        <div style="padding:15px;">
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
        `;
        document.head.appendChild(style);
    }

    await loadReportList();
};

let _allReports = [];
let _currentFilter = 'all';

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

function renderReportList() {
    const container = document.getElementById('report-list');
    if (!container) return;

    let filtered = _allReports;
    if (_currentFilter !== 'all') {
        filtered = _allReports.filter(r => r.status === _currentFilter);
    }

    // 미처리 건수 뱃지 업데이트
    const pendingBadge = document.getElementById('report-pending-badge');
    if (pendingBadge) {
        const pendingCount = _allReports.filter(r => r.status === '접수').length;
        pendingBadge.textContent = pendingCount > 0 ? pendingCount : '';
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
// 2. 제보 상세 보기
// ============================================================================
window._showReportDetail = async function (id) {
    const report = _allReports.find(r => r.id === id);
    if (!report) return;

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

            ${report.answer ? `
                <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.15);border-radius:8px;padding:12px;margin-bottom:15px;">
                    <div style="color:#4ade80;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-reply"></i> 관리자 답변 (${answeredDate})</div>
                    <div style="color:#e2e8f0;font-size:0.85rem;white-space:pre-wrap;">${escapeHTML(report.answer)}</div>
                </div>
            ` : ''}

            <!-- 답변 작성 -->
            <div style="margin-bottom:15px;">
                <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:6px;"><i class="fa-solid fa-pen"></i> 관리자 답변 작성</div>
                <textarea id="admin-answer-text" rows="4" placeholder="답변을 입력하세요..."
                          style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;">${report.answer || ''}</textarea>
            </div>

            <!-- 액션 버튼 -->
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

    function getDownloadUrl(filename) {
        return CONFIG.API_BASE + '/api/reports/' + reportId + '/download/' + encodeURIComponent(filename);
    }

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

    function goTo(idx) {
        if (idx < 0 || idx >= attachments.length) return;
        currentIndex = idx;
        render();
    }

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

        function updateTransform() {
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        }

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

window._sendAnswer = async function (reportId, sendPush) {
    const answer = document.getElementById('admin-answer-text').value.trim();
    if (!answer) { alert('답변 내용을 입력해주세요.'); return; }

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reports/' + reportId + '/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer, sendPush })
        });
        if (res.ok) {
            alert(sendPush ? '답변이 발송되었습니다. (푸시 포함)' : '답변이 저장되었습니다.');
            // 목록으로 돌아가기
            const body = document.getElementById('unified-admin-body');
            if (body) await renderUnifiedReportContent(body);
        } else {
            const data = await res.json();
            alert(data.error || '답변 발송 실패');
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
