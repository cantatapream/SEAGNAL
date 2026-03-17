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
    // ========================================================================
    async function updateReportBadge() {
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/reports/pending-count');
            if (!res.ok) return;
            const data = await res.json();
            const badge = document.getElementById('report-badge');
            if (badge) {
                if (data.count > 0) {
                    badge.textContent = data.count;
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
            <div style="background:#1e2435;border-radius:12px;width:95%;max-width:400px;max-height:85vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
                <div style="background:#2d3548;padding:14px 18px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;color:#fff;font-size:1rem;display:flex;align-items:center;gap:8px;">
                        <i class="fa-solid fa-envelope" style="color:#fbbf24;"></i> 제보하기
                    </h3>
                    <button onclick="document.getElementById('report-modal').remove();" style="background:none;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div style="padding:18px;">
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
            </div>
        `;

        document.body.appendChild(modal);
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
        };
        reader.readAsDataURL(file);
        input.value = '';
    };

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

    function showAnswerPopup(data) {
        const existing = document.getElementById('report-answer-popup');
        if (existing) existing.remove();

        const html = `
            <div class="notice-modal-overlay" id="report-answer-popup" style="z-index:10001;">
                <div class="notice-popup" style="max-width:380px;">
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
                    </div>
                    <div class="notice-footer" style="justify-content:center;">
                        <button class="notice-close-btn" onclick="window._dismissReportAnswer('${data.reportId}')">확인</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    window._dismissReportAnswer = async function (reportId) {
        const popup = document.getElementById('report-answer-popup');
        if (popup) popup.remove();

        try {
            await fetch(CONFIG.API_BASE + '/api/reports/dismiss-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: getDeviceId(), reportId })
            });
        } catch (e) { /* 무시 */ }
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
