/**
 * ============================================================================
 * 파일명: js/survey_user.js
 * 역할: 사용자 설문조사 팝업 (앱 접속 시 자동 표시)
 * ============================================================================
 *
 * [설명]
 * - 앱 접속 시 active 설문이 있으면 팝업 표시
 * - 완료한 설문은 localStorage에 기록되어 다시 표시되지 않음
 * - "나중에"를 누르면 아무것도 저장하지 않아 다음 접속 시 재표시
 * - 설문 진행 중에는 닫기 불가 (완료까지 유지)
 *
 * [로딩 순서] 마지막 (DOMContentLoaded 이벤트 기반)
 * ============================================================================
 */

(function () {
    // 기기 ID 생성/조회 (중복 응답 방지용)
    function getDeviceId() {
        let id = localStorage.getItem('seagnal_device_id');
        if (!id) {
            id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('seagnal_device_id', id);
        }
        return id;
    }

    // 해당 설문을 이미 완료했는지 확인
    function isSurveyDone(surveyId) {
        return localStorage.getItem('seagnal_survey_done_' + surveyId) === 'true';
    }

    // 설문 완료 기록
    function markSurveyDone(surveyId) {
        localStorage.setItem('seagnal_survey_done_' + surveyId, 'true');
    }

    // 스플래시 이후 설문 팝업 체크 (지연 호출)
    function initSurveyCheck() {
        // 스플래시가 끝난 후 체크 (3초 딜레이)
        setTimeout(async () => {
            try {
                const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/surveys/active');
                if (!res.ok) return;
                const activeSurveys = await res.json();
                if (!activeSurveys || activeSurveys.length === 0) return;

                // 아직 완료하지 않은 첫 번째 설문 찾기
                const pending = activeSurveys.find(s => !isSurveyDone(s.id));
                if (!pending) return;

                showSurveyInvitePopup(pending);
            } catch (e) {
                // 무시 - 설문 로드 실패해도 앱 사용에는 문제 없음
            }
        }, 3000);
    }

    // ========================================================================
    // 화면 1: 초대 팝업 (참여하기 / 나중에)
    // ========================================================================
    function showSurveyInvitePopup(survey) {
        const old = document.getElementById('survey-user-popup');
        if (old) old.remove();

        const qCount = (survey.questions || []).length;
        const endDate = survey.endDate ? survey.endDate.slice(5).replace('-', '/') : '';

        const popup = document.createElement('div');
        popup.id = 'survey-user-popup';
        popup.style.cssText = 'position:fixed;inset:0;z-index:10100;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;animation:svFadeIn 0.3s ease-out;';

        popup.innerHTML = `
            <style>
                @keyframes svFadeIn { from { opacity:0; } to { opacity:1; } }
                @keyframes svSlideUp { from { transform:translateY(30px); opacity:0; } to { transform:translateY(0); opacity:1; } }
                .sv-invite-card { animation: svSlideUp 0.3s ease-out; }
            </style>
            <div class="sv-invite-card" style="background:linear-gradient(145deg,#1e293b,#0f172a);border-radius:20px;padding:32px 24px;max-width:340px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
                <div style="width:60px;height:60px;margin:0 auto 16px;background:linear-gradient(135deg,#10b981,#059669);border-radius:16px;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-clipboard-list" style="font-size:1.5rem;color:#fff;"></i>
                </div>
                <h3 style="color:#fff;font-size:1.15rem;margin:0 0 8px;font-weight:700;line-height:1.4;">${escSurveyHtml(survey.title)}</h3>
                ${survey.description ? `<p style="color:#94a3b8;font-size:0.85rem;margin:0 0 16px;line-height:1.5;">${escSurveyHtml(survey.description)}</p>` : '<div style="margin-bottom:16px;"></div>'}
                <div style="display:flex;justify-content:center;gap:16px;margin-bottom:20px;color:#64748b;font-size:0.78rem;">
                    <span><i class="fa-solid fa-clock"></i> 약 1분</span>
                    <span><i class="fa-solid fa-list-check"></i> ${qCount}문항</span>
                    ${endDate ? `<span><i class="fa-solid fa-calendar"></i> ~${endDate}</span>` : ''}
                </div>
                <button id="sv-btn-participate" style="width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:12px;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;margin-bottom:10px;box-shadow:0 4px 15px rgba(16,185,129,0.3);transition:transform 0.15s;">
                    참여하기
                </button>
                <button id="sv-btn-later" style="width:100%;padding:12px;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:#64748b;font-size:0.88rem;cursor:pointer;transition:color 0.2s;">
                    나중에
                </button>
            </div>
        `;

        document.body.appendChild(popup);

        // 참여하기 → 설문 진행 시작
        document.getElementById('sv-btn-participate').onclick = () => {
            popup.remove();
            showSurveyForm(survey);
        };

        // 나중에 → 팝업만 닫기 (아무것도 저장하지 않음 → 다음 접속 시 재표시)
        document.getElementById('sv-btn-later').onclick = () => {
            popup.remove();
        };
    }

    // ========================================================================
    // 화면 2: 설문 진행 (스텝 방식, 닫기 불가)
    // ========================================================================
    function showSurveyForm(survey) {
        const questions = survey.questions || [];
        if (questions.length === 0) return;

        let currentStep = 0;
        const answers = {};

        const popup = document.createElement('div');
        popup.id = 'survey-user-popup';
        popup.style.cssText = 'position:fixed;inset:0;z-index:10100;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);display:flex;flex-direction:column;animation:svFadeIn 0.2s ease-out;';

        function render() {
            const q = questions[currentStep];
            const pct = Math.round(((currentStep + 1) / questions.length) * 100);
            const isLast = currentStep === questions.length - 1;
            const isFirst = currentStep === 0;

            popup.innerHTML = `
                <style>
                    @keyframes svFadeIn { from { opacity:0; } to { opacity:1; } }
                    .sv-form-body { animation: svFadeIn 0.2s ease-out; }
                    .sv-option { padding:14px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:8px; cursor:pointer; transition:all 0.15s; display:flex; align-items:center; gap:10px; color:#cbd5e1; font-size:0.92rem; }
                    .sv-option:hover { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15); }
                    .sv-option.selected { background:rgba(16,185,129,0.12); border-color:rgba(16,185,129,0.4); color:#fff; }
                    .sv-option .sv-indicator { width:20px; height:20px; border-radius:50%; border:2px solid rgba(255,255,255,0.2); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
                    .sv-option.selected .sv-indicator { border-color:#10b981; background:#10b981; }
                    .sv-option .sv-check-indicator { width:20px; height:20px; border-radius:4px; border:2px solid rgba(255,255,255,0.2); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
                    .sv-option.selected .sv-check-indicator { border-color:#10b981; background:#10b981; }
                    .sv-star { font-size:1.8rem; cursor:pointer; transition:transform 0.1s; padding:2px; }
                    .sv-star:hover { transform:scale(1.2); }
                </style>
                <div style="padding:16px 20px; display:flex; align-items:center; gap:12px;">
                    <div style="flex:1;">
                        <div style="color:#fff; font-weight:700; font-size:0.95rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escSurveyHtml(survey.title)}</div>
                        <div style="color:#64748b; font-size:0.78rem; margin-top:2px;">${currentStep + 1} / ${questions.length}</div>
                    </div>
                </div>
                <div style="padding:0 20px;">
                    <div style="background:rgba(255,255,255,0.06); border-radius:4px; height:4px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#10b981,#34d399); border-radius:4px; transition:width 0.3s;"></div>
                    </div>
                </div>
                <div class="sv-form-body" style="flex:1; overflow-y:auto; padding:24px 20px;">
                    <div style="margin-bottom:8px;">
                        <span style="color:#fff; font-weight:700; font-size:1.05rem; line-height:1.5;">Q${currentStep + 1}. ${escSurveyHtml(q.title)}</span>
                        ${q.required ? '<span style="color:#ef4444; margin-left:6px; font-size:0.8rem;">*필수</span>' : ''}
                    </div>
                    <div id="sv-answer-area" style="margin-top:16px;"></div>
                </div>
                <div style="padding:16px 20px; display:flex; gap:10px; border-top:1px solid rgba(255,255,255,0.06);">
                    ${!isFirst ? `<button id="sv-btn-prev" style="flex:1; padding:14px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:12px; color:#94a3b8; font-size:0.92rem; cursor:pointer; font-weight:600;"><i class="fa-solid fa-chevron-left"></i> 이전</button>` : ''}
                    <button id="sv-btn-next" style="flex:2; padding:14px; background:linear-gradient(135deg,#10b981,#059669); border:none; border-radius:12px; color:#fff; font-size:0.95rem; cursor:pointer; font-weight:700; box-shadow:0 4px 15px rgba(16,185,129,0.3);">
                        ${isLast ? '<i class="fa-solid fa-check"></i> 제출하기' : '다음 <i class="fa-solid fa-chevron-right"></i>'}
                    </button>
                </div>
            `;

            const area = popup.querySelector('#sv-answer-area');
            renderAnswerInput(area, q, answers);

            // 이전 버튼
            const prevBtn = popup.querySelector('#sv-btn-prev');
            if (prevBtn) prevBtn.onclick = () => { currentStep--; render(); };

            // 다음/제출 버튼
            popup.querySelector('#sv-btn-next').onclick = async () => {
                // 필수 체크
                if (q.required) {
                    const a = answers[q.qId];
                    if (a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0)) {
                        alert('이 질문은 필수 응답입니다.');
                        return;
                    }
                }

                if (isLast) {
                    await submitSurvey(survey, answers, popup);
                } else {
                    currentStep++;
                    render();
                }
            };
        }

        document.body.appendChild(popup);
        render();
    }

    // 답변 입력 영역 렌더링
    function renderAnswerInput(area, q, answers) {
        if (q.type === 'radio' || q.type === 'dropdown') {
            const opts = q.options || [];
            area.innerHTML = opts.map((opt, i) => {
                const sel = answers[q.qId] === opt ? 'selected' : '';
                return `<div class="sv-option ${sel}" data-value="${escSurveyAttr(opt)}" onclick="this.parentElement.querySelectorAll('.sv-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');">
                    <div class="sv-indicator">${sel ? '<i class="fa-solid fa-check" style="color:#fff;font-size:0.6rem;"></i>' : ''}</div>
                    <span>${escSurveyHtml(opt)}</span>
                </div>`;
            }).join('');

            area.querySelectorAll('.sv-option').forEach(el => {
                el.addEventListener('click', () => {
                    answers[q.qId] = el.dataset.value;
                    area.querySelectorAll('.sv-option').forEach(e => {
                        e.classList.remove('selected');
                        e.querySelector('.sv-indicator').innerHTML = '';
                    });
                    el.classList.add('selected');
                    el.querySelector('.sv-indicator').innerHTML = '<i class="fa-solid fa-check" style="color:#fff;font-size:0.6rem;"></i>';
                });
            });

        } else if (q.type === 'checkbox') {
            const opts = q.options || [];
            const current = answers[q.qId] || [];
            area.innerHTML = opts.map((opt) => {
                const sel = current.includes(opt) ? 'selected' : '';
                return `<div class="sv-option ${sel}" data-value="${escSurveyAttr(opt)}">
                    <div class="sv-check-indicator">${sel ? '<i class="fa-solid fa-check" style="color:#fff;font-size:0.6rem;"></i>' : ''}</div>
                    <span>${escSurveyHtml(opt)}</span>
                </div>`;
            }).join('');

            area.querySelectorAll('.sv-option').forEach(el => {
                el.addEventListener('click', () => {
                    const val = el.dataset.value;
                    if (!answers[q.qId]) answers[q.qId] = [];
                    const idx = answers[q.qId].indexOf(val);
                    if (idx >= 0) {
                        answers[q.qId].splice(idx, 1);
                        el.classList.remove('selected');
                        el.querySelector('.sv-check-indicator').innerHTML = '';
                    } else {
                        answers[q.qId].push(val);
                        el.classList.add('selected');
                        el.querySelector('.sv-check-indicator').innerHTML = '<i class="fa-solid fa-check" style="color:#fff;font-size:0.6rem;"></i>';
                    }
                });
            });

        } else if (q.type === 'rating') {
            const max = q.maxRating || 5;
            const current = answers[q.qId] || 0;
            area.innerHTML = `<div style="display:flex;justify-content:center;gap:4px;padding:10px 0;" id="sv-rating-stars"></div>
                <div style="text-align:center;color:#64748b;font-size:0.85rem;margin-top:6px;" id="sv-rating-label">${current > 0 ? current + '점 선택됨' : '별을 터치해주세요'}</div>`;

            const starsDiv = area.querySelector('#sv-rating-stars');
            for (let i = 1; i <= max; i++) {
                const star = document.createElement('span');
                star.className = 'sv-star';
                star.style.color = i <= current ? '#fbbf24' : '#334155';
                star.textContent = '★';
                star.onclick = () => {
                    answers[q.qId] = i;
                    starsDiv.querySelectorAll('.sv-star').forEach((s, si) => {
                        s.style.color = si < i ? '#fbbf24' : '#334155';
                    });
                    area.querySelector('#sv-rating-label').textContent = i + '점 선택됨';
                };
                starsDiv.appendChild(star);
            }

        } else if (q.type === 'text') {
            area.innerHTML = `<textarea id="sv-text-input" placeholder="자유롭게 의견을 입력해주세요" style="width:100%;height:120px;padding:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:0.95rem;resize:none;box-sizing:border-box;line-height:1.5;outline:none;" maxlength="${q.maxLength || 500}">${escSurveyHtml(answers[q.qId] || '')}</textarea>
                <div style="text-align:right;color:#475569;font-size:0.75rem;margin-top:4px;"><span id="sv-char-count">${(answers[q.qId] || '').length}</span>/${q.maxLength || 500}</div>`;

            const ta = area.querySelector('#sv-text-input');
            ta.addEventListener('input', () => {
                answers[q.qId] = ta.value;
                area.querySelector('#sv-char-count').textContent = ta.value.length;
            });
        }
    }

    // 설문 제출
    async function submitSurvey(survey, answers, popup) {
        const btn = popup.querySelector('#sv-btn-next');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 제출 중...';

        try {
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + `/api/surveys/${survey.id}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: getDeviceId(), answers })
            });

            if (res.ok) {
                // 완료 기록 → 이후 이 설문은 다시 표시되지 않음
                markSurveyDone(survey.id);
                showSurveyComplete(popup);
            } else {
                const err = await res.json();
                if (err.error === '이미 응답한 설문입니다.') {
                    markSurveyDone(survey.id);
                    showSurveyComplete(popup);
                } else {
                    throw new Error(err.error || '제출 실패');
                }
            }
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 제출하기';
            alert('제출 실패: ' + e.message + '\n다시 시도해주세요.');
        }
    }

    // ========================================================================
    // 화면 3: 완료 화면
    // ========================================================================
    function showSurveyComplete(popup) {
        popup.innerHTML = `
            <style>
                @keyframes svBounce { 0% { transform:scale(0); } 50% { transform:scale(1.2); } 100% { transform:scale(1); } }
            </style>
            <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px;">
                <div style="text-align:center;">
                    <div style="width:80px;height:80px;margin:0 auto 20px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:svBounce 0.5s ease-out;">
                        <i class="fa-solid fa-check" style="font-size:2rem;color:#fff;"></i>
                    </div>
                    <h3 style="color:#fff;font-size:1.2rem;margin:0 0 8px;font-weight:700;">설문이 완료되었습니다!</h3>
                    <p style="color:#94a3b8;font-size:0.9rem;margin:0 0 28px;line-height:1.5;">소중한 의견 감사합니다.<br>더 나은 서비스로 보답하겠습니다.</p>
                    <button onclick="document.getElementById('survey-user-popup').remove();" style="padding:14px 40px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:12px;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 4px 15px rgba(16,185,129,0.3);">
                        닫기
                    </button>
                </div>
            </div>
        `;
    }

    // HTML 이스케이프 헬퍼
    function escSurveyHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escSurveyAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ========================================================================
    // 초기화: DOMContentLoaded 시 설문 체크 시작
    // ========================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSurveyCheck);
    } else {
        initSurveyCheck();
    }
})();
