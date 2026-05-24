/**
 * ============================================================================
 * 파일명: js/report_user.js
 * 역할: 사용자 제보 기능 (제보 작성, 답변 팝업, 차단 상태 확인)
 * ============================================================================
 *
 * [설명]
 * - openReportModal(): 제보 작성 모달 열기
 * - checkReportAnswer(): 미확인 답변 팝업 표시
 * - checkBlockStatus(): 차단 상태 확인 (앱 차단/제보 차단)
 * - initReportButton(): 제보 버튼 표시/숨김 제어
 *
 * [로딩 순서] admin_survey.js 이후
 * ============================================================================
 */

(function () {
    // XSS 방지용 이스케이프
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ========================================================================
    // Device ID (survey_user.js와 동일 키 공유)
    // ========================================================================
    function getDeviceId() {
        let id = localStorage.getItem('seagnal_device_id');
        if (!id) {
            id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('seagnal_device_id', id);
        }
        return id;
    }

    // ========================================================================
    // 초기화: 제보 버튼 표시 + 차단 상태 확인 + 미확인 답변 체크
    // ========================================================================
    async function initReport() {
        const deviceId = getDeviceId();

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/blocks/check/' + encodeURIComponent(deviceId));
            if (!res.ok) return;
            const status = await res.json();

            // 앱 차단 확인
            if (status.appBlocked) {
                showAppBlockedScreen(status.appBlockReason, status.appBlockUntil);
                return;
            }

            // 제보 버튼 표시/숨김
            const reportBtn = document.getElementById('header-report-btn');
            if (reportBtn) {
                if (status.reportBlocked) {
                    reportBtn.style.display = 'none';
                } else {
                    reportBtn.style.display = 'flex';
                }
            }

            // 관리자 모드일 때 미처리 제보 건수 표시
            if (localStorage.getItem('seagnal_admin_mode') === 'true') {
                updateReportBadge();
            }

            // 미확인 답변 확인
            checkReportAnswer(deviceId);

        } catch (e) {
            // 서버 연결 실패 시 기본적으로 제보 버튼 표시
            const reportBtn = document.getElementById('header-report-btn');
            if (reportBtn) reportBtn.style.display = 'flex';
        }
    }

    // ========================================================================
    // 미처리 제보 건수 뱃지 업데이트 (관리자용)
    // 기능 제보(미읽음) + 댓글 신고(대기중) 합산
    // ========================================================================
    async function updateReportBadge() {
        try {
            const [featureRes, commentRes] = await Promise.all([
                fetch(CONFIG.API_BASE + '/api/reports/pending-count'),
                fetch(CONFIG.API_BASE + '/api/comment-reports/pending-count')
            ]);
            const featureData = featureRes.ok ? await featureRes.json() : { count: 0 };
            const commentData = commentRes.ok ? await commentRes.json() : { count: 0 };
            const total = (featureData.count || 0) + (commentData.count || 0);

            const badge = document.getElementById('report-badge');
            if (badge) {
                if (total > 0) {
                    badge.textContent = total;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (e) { /* 무시 */ }
    }

    // ========================================================================
    // 앱 차단 화면 표시
    // ========================================================================
    function showAppBlockedScreen(reason, until) {
        const untilText = until === 'permanent'
            ? '영구 차단'
            : new Date(until).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

        const html = `
            <div id="app-blocked-screen" style="position:fixed;inset:0;z-index:99999;background:#0f172a;display:flex;align-items:center;justify-content:center;">
                <div style="text-align:center;padding:40px 30px;max-width:350px;">
                    <i class="fa-solid fa-ban" style="font-size:3rem;color:#ef4444;margin-bottom:20px;display:block;"></i>
                    <h2 style="color:#f87171;font-size:1.3rem;margin:0 0 15px;">앱 이용 제한</h2>
                    <p style="color:#e2e8f0;font-size:0.95rem;line-height:1.6;margin:0 0 20px;">
                        앱 이용이 <strong style="color:#fbbf24;">${reason || '관리자 판단'}</strong>으로 제한되었습니다.
                    </p>
                    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;color:#94a3b8;font-size:0.85rem;">
                        차단 해제일: <strong style="color:#e2e8f0;">${untilText}</strong>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    // ========================================================================
    // 제보 작성 모달
    // ========================================================================
    window.openReportModal = function () {
        // 관리자 모드일 때는 관리자 센터의 제보관리 탭으로 이동
        if (localStorage.getItem('seagnal_admin_mode') === 'true') {
            if (typeof showUnifiedAdminModal === 'function') {
                showUnifiedAdminModal('report');
            }
            return;
        }

        const existing = document.getElementById('report-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'report-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;';

        modal.innerHTML = `
            <div style="background:#1e2435;border-radius:12px;width:95%;max-width:400px;max-height:85vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;">
                <div style="background:#2d3548;padding:14px 18px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <h3 style="margin:0;color:#fff;font-size:1rem;display:flex;align-items:center;gap:8px;">
                        <i class="fa-solid fa-envelope" style="color:#fbbf24;"></i> 제보
                    </h3>
                    <button onclick="document.getElementById('report-modal').remove();" style="background:none;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- 탭 버튼 -->
                <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
                    <button id="report-tab-write" onclick="window._switchReportTab('write')"
                            style="flex:1;padding:10px;background:none;border:none;color:#fbbf24;font-size:0.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid #fbbf24;">
                        ✏️ 제보하기
                    </button>
                    <button id="report-tab-history" onclick="window._switchReportTab('history')"
                            style="flex:1;padding:10px;background:none;border:none;color:#64748b;font-size:0.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;">
                        📋 제보내역
                    </button>
                </div>

                <!-- 제보하기 탭 내용 -->
                <div id="report-panel-write" style="padding:18px;overflow-y:auto;">
                    <!-- 카테고리 -->
                    <div style="margin-bottom:14px;">
                        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">카테고리 <span style="color:#ef4444;">*</span></label>
                        <select id="report-category" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;">
                            <option value="">선택하세요</option>
                            <option value="오류 제보">오류 제보</option>
                            <option value="기능 건의">기능 건의</option>
                            <option value="기타 문의">기타 문의</option>
                        </select>
                    </div>

                    <!-- 제목 -->
                    <div style="margin-bottom:14px;">
                        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">제목 <span style="color:#ef4444;">*</span> <span style="color:#64748b;font-size:0.65rem;">(50자 이내)</span></label>
                        <input type="text" id="report-title" maxlength="50" placeholder="제목을 입력하세요"
                               style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;">
                    </div>

                    <!-- 내용 -->
                    <div style="margin-bottom:14px;">
                        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:4px;">내용 <span style="color:#ef4444;">*</span> <span style="color:#64748b;font-size:0.65rem;">(1000자 이내)</span></label>
                        <textarea id="report-content" maxlength="1000" rows="5" placeholder="내용을 상세히 입력해주세요"
                                  style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
                    </div>

                    <!-- 사진 첨부 -->
                    <div style="margin-bottom:18px;">
                        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">사진 첨부 <span style="color:#64748b;font-size:0.65rem;">(최대 3장, 5MB)</span></label>
                        <div id="report-attachments" style="display:flex;gap:8px;flex-wrap:wrap;">
                            <label class="report-attach-btn" style="width:70px;height:70px;border:2px dashed #334155;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#64748b;font-size:1.5rem;transition:border-color 0.2s;">
                                <input type="file" accept="image/*" style="display:none;" onchange="window._addReportAttachment(this)">
                                <i class="fa-solid fa-plus"></i>
                            </label>
                        </div>
                        <div id="report-attach-previews" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>
                    </div>

                    <!-- 제출 버튼 -->
                    <button id="report-submit-btn" onclick="window._submitReport()"
                            style="width:100%;padding:12px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a1f2e;border:none;border-radius:8px;font-weight:700;font-size:0.9rem;cursor:pointer;">
                        <i class="fa-solid fa-paper-plane"></i> 제보 제출하기
                    </button>
                </div>

                <!-- 제보내역 탭 내용 -->
                <div id="report-panel-history" style="padding:18px;overflow-y:auto;display:none;">
                    <div style="text-align:center;padding:40px 0;color:#64748b;">
                        <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;"></i>
                        <p style="margin-top:10px;font-size:0.85rem;">불러오는 중...</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    };

    // ========================================================================
    // 탭 전환
    // ========================================================================
    window._switchReportTab = function (tab) {
        const writePanel = document.getElementById('report-panel-write');
        const historyPanel = document.getElementById('report-panel-history');
        const writeTab = document.getElementById('report-tab-write');
        const historyTab = document.getElementById('report-tab-history');
        if (!writePanel || !historyPanel || !writeTab || !historyTab) return;

        if (tab === 'write') {
            writePanel.style.display = 'block';
            historyPanel.style.display = 'none';
            writeTab.style.color = '#fbbf24';
            writeTab.style.borderBottom = '2px solid #fbbf24';
            historyTab.style.color = '#64748b';
            historyTab.style.borderBottom = '2px solid transparent';
        } else {
            writePanel.style.display = 'none';
            historyPanel.style.display = 'block';
            writeTab.style.color = '#64748b';
            writeTab.style.borderBottom = '2px solid transparent';
            historyTab.style.color = '#fbbf24';
            historyTab.style.borderBottom = '2px solid #fbbf24';
            // 내역 로드 (2단계에서 구현)
            if (typeof window._loadReportHistory === 'function') {
                window._loadReportHistory();
            }
        }
    };

    // ========================================================================
    // 제보내역 로드
    // ========================================================================
    window._loadReportHistory = async function () {
        const panel = document.getElementById('report-panel-history');
        if (!panel) return;

        panel.innerHTML = '<div style="text-align:center;padding:40px 0;color:#64748b;"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;"></i><p style="margin-top:10px;font-size:0.85rem;">불러오는 중...</p></div>';

        try {
            const deviceId = getDeviceId();
            const res = await fetch(CONFIG.API_BASE + '/api/reports?deviceId=' + encodeURIComponent(deviceId));
            if (!res.ok) throw new Error('조회 실패');
            const reports = await res.json();

            if (!reports || reports.length === 0) {
                panel.innerHTML = '<div style="text-align:center;padding:50px 0;color:#64748b;"><i class="fa-regular fa-envelope-open" style="font-size:2rem;margin-bottom:10px;display:block;"></i><p style="font-size:0.85rem;">제보 내역이 없습니다.</p></div>';
                return;
            }

            let html = '<div style="font-size:0.7rem;color:#64748b;margin-bottom:12px;padding:6px 10px;background:rgba(100,116,139,0.1);border-radius:6px;"><i class="fa-solid fa-circle-info" style="margin-right:4px;"></i>제보 내역은 90일 후 자동 삭제됩니다.</div>';

            reports.forEach(r => {
                const statusColor = r.status === '답변완료' ? '#22c55e' : '#eab308';
                const statusIcon = r.status === '답변완료' ? '🟢' : '🟡';
                const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('ko-KR') : '';
                html += `
                    <div onclick="window._showMyReportDetail('${r.id}')" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'">
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <span style="font-size:0.75rem;">${statusIcon}</span>
                            <span style="font-size:0.7rem;color:${statusColor};font-weight:600;">${escapeHTML(r.status)}</span>
                        </div>
                        <div style="color:#e2e8f0;font-size:0.85rem;font-weight:500;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(r.title)}</div>
                        <div style="font-size:0.7rem;color:#64748b;">${date}</div>
                    </div>
                `;
            });

            panel.innerHTML = html;
        } catch (e) {
            panel.innerHTML = '<div style="text-align:center;padding:40px 0;color:#ef4444;"><p style="font-size:0.85rem;">내역을 불러올 수 없습니다.</p></div>';
        }
    };

    // ========================================================================
    // 제보 상세 보기
    // ========================================================================
    window._showMyReportDetail = async function (reportId) {
        const panel = document.getElementById('report-panel-history');
        if (!panel) return;

        panel.innerHTML = '<div style="text-align:center;padding:40px 0;color:#64748b;"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;"></i></div>';

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/reports/' + encodeURIComponent(reportId));
            if (!res.ok) throw new Error('조회 실패');
            const r = await res.json();

            const statusColor = r.status === '답변완료' ? '#22c55e' : '#eab308';
            const statusIcon = r.status === '답변완료' ? '🟢' : '🟡';
            const date = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

            // 첨부 이미지 HTML
            let attachHtml = '';
            if (r.attachments && r.attachments.length > 0) {
                attachHtml = '<div style="margin-top:10px;"><div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">📎 첨부 이미지</div><div style="display:flex;gap:6px;flex-wrap:wrap;">';
                r.attachments.forEach(filename => {
                    const imgUrl = CONFIG.API_BASE + '/api/reports/' + r.id + '/download/' + encodeURIComponent(filename);
                    attachHtml += `<div style="width:70px;height:70px;border-radius:6px;overflow:hidden;border:1px solid #334155;cursor:pointer;" onclick="window._previewReportImage('${escapeHTML(imgUrl)}')"><img src="${escapeHTML(imgUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'"></div>`;
                });
                attachHtml += '</div></div>';
            }

            // 답변 HTML
            let answerHtml = '';
            if (r.answer) {
                const answerDate = r.answeredAt ? new Date(r.answeredAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

                // 답변 첨부 이미지
                let answerImgHtml = '';
                if (r.answerAttachments && r.answerAttachments.length > 0) {
                    answerImgHtml = '<div style="margin-top:10px;"><div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">📎 답변 첨부 이미지</div><div style="display:flex;gap:6px;flex-wrap:wrap;">';
                    r.answerAttachments.forEach(filename => {
                        const imgUrl = CONFIG.API_BASE + '/api/reports/' + r.id + '/download/' + encodeURIComponent(filename);
                        answerImgHtml += `<div style="width:70px;height:70px;border-radius:6px;overflow:hidden;border:1px solid #334155;cursor:pointer;" onclick="window._previewReportImage('${escapeHTML(imgUrl)}')"><img src="${escapeHTML(imgUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'"></div>`;
                    });
                    answerImgHtml += '</div></div>';
                }

                answerHtml = `
                    <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">답변일시: ${answerDate}</div>
                    <div style="border-left:3px solid rgba(59,130,246,0.4);padding:2px 0 2px 12px;font-size:0.85rem;line-height:1.7;color:#cbd5e1;word-break:keep-all;">${escapeHTML(r.answer).replace(/\n/g, '<br>')}</div>
                    ${answerImgHtml}
                `;
            } else {
                answerHtml = '<div style="text-align:center;padding:20px 0;color:#64748b;font-size:0.85rem;"><i class="fa-regular fa-comment-dots" style="margin-right:4px;"></i>아직 답변이 등록되지 않았습니다.</div>';
            }

            // ── 추가 의견 영역 (관리자 답변이 있을 때만 표시) ──
            // 1) 이미 추가 의견을 보낸 경우 → 의견 내용 표시 (읽기 전용)
            // 2) 아직 보내지 않은 경우 → 입력란 + 보내기 버튼 표시
            // 3) 관리자 추가 답변이 있으면 그것도 표시
            let userCommentHtml = '';
            if (r.answer) {
                if (r.userComment) {
                    // 이미 보낸 추가 의견 표시
                    var commentDate = r.userCommentAt ? new Date(r.userCommentAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                    userCommentHtml += `
                        <div style="font-size:0.7rem;color:#94a3b8;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);">── 추가 의견 ──</div>
                        <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">의견일시: ${commentDate}</div>
                        <div style="border-left:3px solid rgba(168,85,247,0.4);padding:2px 0 2px 12px;font-size:0.85rem;line-height:1.7;color:#cbd5e1;word-break:keep-all;">${escapeHTML(r.userComment).replace(/\n/g, '<br>')}</div>
                    `;

                    // 관리자 추가 답변이 있으면 표시
                    if (r.additionalAnswer) {
                        var addAnswerDate = r.additionalAnsweredAt ? new Date(r.additionalAnsweredAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                        userCommentHtml += `
                            <div style="font-size:0.7rem;color:#94a3b8;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);">── 관리자 추가 답변 ──</div>
                            <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">답변일시: ${addAnswerDate}</div>
                            <div style="border-left:3px solid rgba(59,130,246,0.4);padding:2px 0 2px 12px;font-size:0.85rem;line-height:1.7;color:#cbd5e1;word-break:keep-all;">${escapeHTML(r.additionalAnswer).replace(/\n/g, '<br>')}</div>
                        `;
                    }
                } else {
                    // 추가 의견 미작성 → 입력란 표시
                    userCommentHtml += `
                        <div style="font-size:0.7rem;color:#94a3b8;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);">── 추가 의견 ──</div>
                        <textarea id="user-comment-input" rows="3" placeholder="관리자에게 전달할 추가 의견을 입력하세요..."
                            style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:0.85rem;resize:vertical;box-sizing:border-box;margin-bottom:8px;"></textarea>
                        <button onclick="window._sendUserComment('${r.id}')"
                            style="width:100%;padding:10px;background:linear-gradient(135deg,rgba(168,85,247,0.3),rgba(139,92,246,0.2));border:1px solid rgba(168,85,247,0.3);color:#c4b5fd;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer;">
                            <i class="fa-solid fa-paper-plane" style="margin-right:4px;"></i>추가 의견 보내기
                        </button>
                    `;
                }
            }

            panel.innerHTML = `
                <div style="display:flex;flex-direction:column;height:100%;">
                    <div style="flex-shrink:0;margin-bottom:12px;">
                        <button onclick="window._loadReportHistory()" style="background:none;border:none;color:#94a3b8;font-size:0.8rem;cursor:pointer;padding:0;margin-bottom:10px;"><i class="fa-solid fa-arrow-left" style="margin-right:4px;"></i>뒤로</button>
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <span>${statusIcon}</span>
                            <span style="font-size:0.8rem;color:${statusColor};font-weight:600;">${escapeHTML(r.status)}</span>
                            <span style="font-size:0.7rem;color:#64748b;margin-left:auto;">${escapeHTML(r.category || '')}</span>
                        </div>
                        <div style="font-size:0.7rem;color:#64748b;">${date}</div>
                    </div>

                    <div style="flex:1;overflow-y:auto;">
                        <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);">── 내 질문 ──</div>
                        <div style="font-size:0.9rem;color:#e2e8f0;font-weight:600;margin-bottom:6px;">${escapeHTML(r.title)}</div>
                        <div style="font-size:0.85rem;color:#cbd5e1;line-height:1.7;word-break:keep-all;">${escapeHTML(r.content).replace(/\n/g, '<br>')}</div>
                        ${attachHtml}

                        <div style="font-size:0.7rem;color:#94a3b8;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);">── 관리자 답변 ──</div>
                        ${answerHtml}

                        ${userCommentHtml}
                    </div>
                </div>
            `;
        } catch (e) {
            panel.innerHTML = '<div style="text-align:center;padding:40px 0;color:#ef4444;"><p style="font-size:0.85rem;">상세 정보를 불러올 수 없습니다.</p><button onclick="window._loadReportHistory()" style="margin-top:10px;background:none;border:1px solid #64748b;color:#94a3b8;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;">뒤로</button></div>';
        }
    };

    // 첨부 이미지 확대 보기
    window._previewReportImage = function (url) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;';
        overlay.onclick = () => overlay.remove();
        overlay.innerHTML = `<img src="${url}" style="max-width:90%;max-height:90%;object-fit:contain;border-radius:8px;">`;
        document.body.appendChild(overlay);
    };

    // ========================================================================
    // 사진 첨부 관리
    // ========================================================================
    const reportFiles = [];     // { file: File, dataUrl: string }

    window._addReportAttachment = function (input) {
        if (!input.files || !input.files[0]) return;
        if (reportFiles.length >= 3) {
            alert('사진은 최대 3장까지 첨부할 수 있습니다.');
            input.value = '';
            return;
        }

        const file = input.files[0];
        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기는 5MB 이하만 가능합니다.');
            input.value = '';
            return;
        }

        // FileReader로 data URL 생성 (Android WebView 호환)
        const reader = new FileReader();
        reader.onload = function (e) {
            reportFiles.push({ file: file, dataUrl: e.target.result });
            renderAttachPreviews();
            // input 리셋은 파일 읽기 완료 후 수행해야 함
            // (Android WebView에서 읽기 전에 리셋하면 content:// URI 권한이 해제됨)
            input.value = '';
        };
        reader.onerror = function () {
            input.value = '';
        };
        reader.readAsDataURL(file);
    };

    /**
     * 신고서 첨부 이미지 미리보기 영역(#report-attach-previews) 갱신.
     * 사용자가 추가한 _attachFiles 배열을 기반으로 썸네일 + 삭제 버튼 렌더.
     * 첨부 추가/삭제 후 호출되어 UI 동기화.
     */
    function renderAttachPreviews() {
        const container = document.getElementById('report-attach-previews');
        if (!container) return;

        container.innerHTML = reportFiles.map((item, i) => `
            <div style="position:relative;width:70px;height:70px;border-radius:8px;overflow:hidden;border:1px solid #334155;">
                <img src="${item.dataUrl}" style="width:100%;height:100%;object-fit:cover;">
                <button onclick="window._removeReportAttachment(${i})"
                        style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);border:none;color:#fff;width:18px;height:18px;border-radius:50%;font-size:0.6rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `).join('');

        // 3장 미만이면 추가 버튼 표시
        const attachArea = document.getElementById('report-attachments');
        if (attachArea) {
            const addBtn = attachArea.querySelector('.report-attach-btn');
            if (addBtn) {
                addBtn.style.display = reportFiles.length >= 3 ? 'none' : 'flex';
            }
        }
    }

    window._removeReportAttachment = function (index) {
        reportFiles.splice(index, 1);
        renderAttachPreviews();
    };

    // ========================================================================
    // 제보 제출
    // ========================================================================
    window._submitReport = async function () {
        const category = document.getElementById('report-category').value;
        const title = document.getElementById('report-title').value.trim();
        const content = document.getElementById('report-content').value.trim();

        if (!category) { alert('카테고리를 선택해주세요.'); return; }
        if (!title) { alert('제목을 입력해주세요.'); return; }
        if (!content) { alert('내용을 입력해주세요.'); return; }

        const submitBtn = document.getElementById('report-submit-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 전송 중...';
        }

        try {
            const formData = new FormData();
            formData.append('deviceId', getDeviceId());
            // 댓글과 동일한 해양 닉네임 동봉 (관리자 화면에서 dev_xxx 대신 표시)
            if (typeof getOrCreateNickname === 'function') {
                formData.append('nickname', getOrCreateNickname());
            }
            formData.append('category', category);
            formData.append('title', title);
            formData.append('content', content);

            reportFiles.forEach(item => {
                formData.append('attachments', item.file);
            });

            const res = await fetch(CONFIG.API_BASE + '/api/reports', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (res.ok && data.success) {
                // 성공 화면
                const modal = document.getElementById('report-modal');
                if (modal) {
                    const inner = modal.querySelector('div > div');
                    if (inner) {
                        inner.innerHTML = `
                            <div style="padding:60px 30px;text-align:center;">
                                <i class="fa-solid fa-circle-check" style="font-size:3rem;color:#22c55e;margin-bottom:15px;display:block;"></i>
                                <h3 style="color:#e2e8f0;margin:0 0 10px;font-size:1.1rem;">제보가 접수되었습니다</h3>
                                <p style="color:#94a3b8;font-size:0.85rem;margin:0 0 20px;">소중한 의견 감사합니다.</p>
                                <button onclick="document.getElementById('report-modal').remove();"
                                        style="padding:10px 30px;background:#3b82f6;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;">
                                    확인
                                </button>
                            </div>
                        `;
                    }
                }
                reportFiles.length = 0;
            } else {
                alert(data.error || '제보 전송에 실패했습니다.');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 제보 제출하기';
                }
            }
        } catch (e) {
            alert('서버 연결에 실패했습니다.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 제보 제출하기';
            }
        }
    };

    // ========================================================================
    // 미확인 답변 팝업 (앱 접속 시 자동 체크)
    // ========================================================================
    async function checkReportAnswer(deviceId) {
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/reports/pending-answer?deviceId=' + encodeURIComponent(deviceId));
            if (!res.ok) return;
            const data = await res.json();

            if (data.hasAnswer) {
                showAnswerPopup(data);
            }
        } catch (e) { /* 무시 */ }
    }

    /**
     * 운영자가 작성한 신고 답변을 사용자에게 보여주는 팝업.
     * 같은 ID 의 팝업이 떠 있으면 제거 후 새로 그림 (중복 방지).
     *
     * @param {Object} data - { title, content, answeredAt, ... }
     */
    function showAnswerPopup(data) {
        const existing = document.getElementById('report-answer-popup');
        if (existing) existing.remove();

        // 답변 첨부 이미지 HTML
        let answerImgHtml = '';
        if (data.answerAttachments && data.answerAttachments.length > 0) {
            answerImgHtml = '<div style="margin-top:10px;"><div style="font-size:0.7rem;color:#94a3b8;margin-bottom:6px;">📎 첨부 이미지</div><div style="display:flex;gap:6px;flex-wrap:wrap;">';
            data.answerAttachments.forEach(filename => {
                const imgUrl = CONFIG.API_BASE + '/api/reports/' + data.reportId + '/download/' + encodeURIComponent(filename);
                answerImgHtml += `<div style="width:70px;height:70px;border-radius:6px;overflow:hidden;border:1px solid #334155;cursor:pointer;" onclick="window._previewReportImage('${escapeHTML(imgUrl)}')"><img src="${escapeHTML(imgUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'"></div>`;
            });
            answerImgHtml += '</div></div>';
        }

        const html = `
            <div class="notice-modal-overlay" id="report-answer-popup" style="z-index:10001;">
                <!-- 제보 답변 팝업: CSS .notice-popup에 max-height/flex 정의됨 -->
                <div class="notice-popup">
                    <div class="notice-header-area" style="background:linear-gradient(135deg,#1e40af,#3b82f6);">
                        <div class="notice-icon-badge" style="background:rgba(255,255,255,0.15);">
                            <i class="fa-solid fa-reply"></i>
                        </div>
                        <div class="notice-title">제보 답변</div>
                    </div>
                    <div class="notice-body">
                        <div style="margin-bottom:10px;">
                            <span style="font-size:0.75rem;color:#94a3b8;">제보 제목</span>
                            <div style="color:#e2e8f0;font-size:0.9rem;font-weight:600;">${escapeHTML(data.title)}</div>
                        </div>
                        <div class="notice-body-inner" style="border-left-color:#3b82f6;">
                            ${escapeHTML(data.answer).replace(/\n/g, '<br>')}
                        </div>
                        ${answerImgHtml}
                    </div>
                    <div class="notice-footer" style="justify-content:center;gap:8px;">
                        <button class="notice-close-btn" onclick="window._dismissReportAnswer('${data.reportId}', '${data.type || 'answer'}')">확인</button>
                        ${(data.type || 'answer') === 'answer' ? `
                            <button class="notice-close-btn" style="background:rgba(168,85,247,0.2);color:#c4b5fd;border:1px solid rgba(168,85,247,0.3);"
                                onclick="window._dismissReportAnswer('${data.reportId}', '${data.type || 'answer'}'); window._goToReportDetail('${data.reportId}');">
                                추가 의견 작성
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    /**
     * 답변 확인 처리 (팝업 닫기 + 서버에 확인 상태 저장)
     *
     * [동작]
     * 1. 팝업 제거
     * 2. 서버에 type(answer/additionalAnswer)에 따라 확인 처리 요청
     *
     * [연계] pending-answer API → type 파라미터로 최초/추가 답변 구분
     *
     * @param {string} reportId - 제보 ID
     * @param {string} type - "answer" 또는 "additionalAnswer"
     */
    window._dismissReportAnswer = async function (reportId, type) {
        const popup = document.getElementById('report-answer-popup');
        if (popup) popup.remove();

        try {
            await fetch(CONFIG.API_BASE + '/api/reports/dismiss-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: getDeviceId(), reportId, type: type || 'answer' })
            });
        } catch (e) { /* 무시 */ }
    };

    /**
     * 사용자 추가 의견 전송 함수
     * 관리자 답변을 받은 후 1회에 한해 추가 의견을 보내는 기능
     *
     * [동작]
     * 1. 입력란의 텍스트를 서버에 전송 (POST /api/reports/:id/user-comment)
     * 2. 성공 시 화면 새로고침 (추가 의견이 표시되고 입력란은 사라짐)
     * 3. 관리자 기기에 자동으로 푸시 알림 발송 (서버 측 처리)
     *
     * [연계] _showMyReportDetail() → 추가 의견 보내기 버튼의 onclick에서 호출
     * [연계] routes/report.js → POST /api/reports/:id/user-comment
     *
     * @param {string} reportId - 제보 ID
     */
    window._sendUserComment = async function (reportId) {
        var input = document.getElementById('user-comment-input');
        if (!input) return;
        var comment = input.value.trim();
        if (!comment) { alert('추가 의견을 입력해주세요.'); return; }

        try {
            var res = await fetch(CONFIG.API_BASE + '/api/reports/' + reportId + '/user-comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: getDeviceId(), comment: comment })
            });
            var data = await res.json();
            if (res.ok && data.success) {
                alert('추가 의견이 전송되었습니다.');
                // 상세 화면 새로고침 (추가 의견 표시로 전환)
                window._showMyReportDetail(reportId);
            } else {
                alert(data.error || '전송에 실패했습니다.');
            }
        } catch (e) {
            alert('서버 연결에 실패했습니다.');
        }
    };

    /**
     * 답변 팝업에서 "추가 의견 작성" 클릭 시 해당 제보 상세로 이동하는 함수
     *
     * [동작]
     * 1. 제보 모달이 없으면 생성
     * 2. 제보내역 탭 활성화
     * 3. 해당 제보의 상세 화면으로 이동 (추가 의견 입력란이 표시됨)
     *
     * [연계] showAnswerPopup() → "추가 의견 작성" 버튼의 onclick에서 호출
     *
     * @param {string} reportId - 제보 ID
     */
    window._goToReportDetail = function (reportId) {
        // 제보 모달 열기
        if (typeof window.openReportModal === 'function') {
            window.openReportModal();
        }
        // 약간의 딜레이 후 제보내역 탭 전환 + 상세 이동
        setTimeout(function() {
            if (typeof window._switchReportTab === 'function') {
                window._switchReportTab('history');
            }
            setTimeout(function() {
                window._showMyReportDetail(reportId);
            }, 300);
        }, 300);
    };

    // ========================================================================
    // 전역 노출
    // ========================================================================
    window.updateReportBadge = updateReportBadge;
    window.getDeviceId = getDeviceId;

    // ========================================================================
    // 앱 로드 시 초기화 (스플래시 종료 후)
    // ========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initReport, 2000);
    });
})();
