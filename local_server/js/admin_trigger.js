/**
 * ============================================================================
 * 파일명: js/admin_trigger.js
 * 역할: 관리자 트리거(15회 클릭), 공지/점검/오류 팝업
 * ============================================================================
 *
 * [설명]
 * - initAdminTrigger(): 헤더 15회 클릭 시 관리자 모드 진입
 * - showNoticePopup(): 공지 팝업
 * - showMaintenancePopup(): 서버 점검 메시지
 * - showNetworkErrorPopup(): 네트워크 오류 메시지
 * - showMyLocationWeather(): 위치 기반 날씨 표시
 *
 * [로딩 순서] 11번째 (windy.js 이후)
 * ============================================================================
 */

let adminTriggerCount = 0;
let adminTriggerTimer = null;

// 1. 관리자 모드 진입 트리거 초기화
// 1. 관리자 모드 진입 트리거 초기화
// function initAdminTrigger() REMOVED
/*
function initAdminTrigger() {
    // [탭 15회 클릭 -> 통합 로그인 모달]
 
    // (1) 태풍정보 탭 -> 공지 팝업 관리
    const typhoonTab = document.querySelector('button[data-target="typhoon-section"]');
    if (typhoonTab) {
        let count = 0;
        let timer = null;
        typhoonTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (공지 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('notice', '공지 팝업 관리자 로그인', 'fa-bell');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
 
    // (2) 공지사항 탭 -> 게시글 관리
    const promoTab = document.querySelector('button[data-target="promo-section"]');
    if (promoTab) {
        let count = 0;
        let timer = null;
        promoTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (홍보 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('promo', '게시판 관리자 로그인', 'fa-bullhorn');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
 
    // (3) 해구기상 탭 -> API 관리
    const zoneTab = document.querySelector('button[data-target="sea-zone-section"]');
    if (zoneTab) {
        let count = 0;
        let timer = null;
        zoneTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (API 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('api', 'API 관리자 로그인', 'fa-server');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
}
*/

// 2. 앱 실행 시 공지사항 확인 (오프라인 캐싱 기능 추가)
async function checkNoticeStatus() {
    try {
        // 서버 연결 확인 (타임아웃 3초)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(CONFIG.NOTICE_API_URL, {
            signal: controller.signal,
            headers: { 'Cache-Control': 'no-cache' } // 캐시 방지
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('Server Error');

        const noticeData = await response.json();

        // 1. 공지 활성화 상태라면
        if (noticeData.isActive) {
            // [New] 클라이언트 측 만료 시간 확인
            if (noticeData.expiresAt) {
                const now = new Date();
                const expDate = new Date(noticeData.expiresAt.replace(' ', 'T') + ':00');
                if (expDate <= now) {
                    // console.log('공지 기한 만료됨:', noticeData.expiresAt);
                    localStorage.removeItem('offline_notice_cache');
                    return;
                }
            }

            // [중요] 오프라인 대비: 로컬 스토리지에 공지 내용 저장
            localStorage.setItem('offline_notice_cache', JSON.stringify(noticeData));

            // "다시 보지 않기" 체크 확인
            const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
            if (hiddenNoticeId !== String(noticeData.id)) {
                // 스플래시 화면 종료 대기
                const checkSplash = setInterval(() => {
                    const splash = document.getElementById('splash-screen');
                    if (!splash || getComputedStyle(splash).display === 'none') {
                        clearInterval(checkSplash);
                        showNoticePopup(noticeData); // 공지 팝업 호출
                    }
                }, 500);
            }
        }
        // 2. 공지 비활성화 상태라면
        else {
            // [중요] 저장된 공지 삭제 (서버에서 내려갔으므로)
            localStorage.removeItem('offline_notice_cache');
        }

    } catch (error) {
        // console.error('Connection Check Failed:', error);

        // 3. 서버 연결 실패 시, 캐시된 공지가 있는지 확인
        const cachedNotice = localStorage.getItem('offline_notice_cache');

        if (cachedNotice) {
            try {
                const noticeData = JSON.parse(cachedNotice);
                // 캐시된 공지 표시 (다시 보지 않기 체크 확인)
                const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
                if (hiddenNoticeId !== String(noticeData.id)) {
                    // 스플래시 화면이 끝날 때까지 대기 후 표시
                    const checkSplash = setInterval(() => {
                        const splash = document.getElementById('splash-screen');
                        if (!splash || getComputedStyle(splash).display === 'none') {
                            clearInterval(checkSplash);
                            showNoticePopup(noticeData); // 공지 팝업 호출
                        }
                    }, 500);
                }
                return; // 캐시 공지를 띄웠으므로 점검 팝업은 스킵
            } catch (e) {
                // console.error('Cache parse error', e);
            }
        }

        // 4. 캐시된 공지도 없다면 기존 에러 처리
        if (navigator.onLine) {
            showMaintenancePopup(); // 서버 점검/다운
        } else {
            showNetworkErrorPopup(); // 사용자 인터넷 끊김
        }
    }
}

// 3. 관리자 비밀번호 입력 모달 (Legacy removed - using showUnifiedLoginModal)
// 3-1. 게시글 관리 모달 (Legacy removed - using showPromoManagementModal)

// 4. 공지사항 팝업 작성/관리 모달 (태풍정보 탭 15회 클릭 시)
async function showAdminNoticeModal() {
    // 공지 데이터 가져오기
    let notices = { active: [], expired: [] };
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (res.ok) notices = await res.json();
    } catch (e) {
        // console.error(e);
        // 기존 단일 공지 호환
        try {
            const res2 = await fetch(CONFIG.NOTICE_API_URL);
            if (res2.ok) {
                const old = await res2.json();
                if (old.isActive) notices.active = [old];
            }
        } catch (e2) { }
    }

    // 시간 드롭다운 옵션 생성
    const hourOptions = Array.from({ length: 24 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}시</option>`
    ).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}분</option>`
    ).join('');

    // 현재 날짜 기본값
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];

    const modalHtml = `
        <div class="notice-modal-overlay" id="admin-modal-overlay">
            <div class="notice-popup" style="background: #1f2937; width: 95%; max-width: 400px; max-height: 85vh; overflow-y: auto; border-radius: 10px;">
                <div class="notice-header" style="background: #4b5563; padding: 8px 12px; position: sticky; top: 0; z-index: 10;">
                    <span style="font-size: 0.9rem;">🔔 공지 팝업 관리</span>
                    <button class="notice-close-btn" onclick="document.getElementById('admin-modal-overlay').remove()" style="padding: 2px 8px; font-size: 1rem;">×</button>
                </div>
                <div class="notice-content" style="padding: 8px !important;">
                    
                    <!-- 현재 진행 중인 공지사항 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #065f46; color: #a7f3d0; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-bell"></i> 현재 진행 중인 공지사항
                        </div>
                        <div id="active-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '제목 없음'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">~ ${n.expiresAt || '기한 없음'}</div>
                                    </div>
                                    <div style="display: flex; gap: 3px; flex-shrink: 0;">
                                        <button onclick="editNotice(${n.id})" style="background: #3b82f6; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">수정</button>
                                        <button onclick="deleteNoticeById(${n.id})" style="background: #ef4444; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">삭제</button>
                                    </div>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">진행 중인 공지가 없습니다</div>'}
                        </div>
                    </div>

                    <!-- 자동 종료된 공지사항 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #44403c; color: #d6d3d1; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-clock-rotate-left"></i> 자동 종료된 공지사항
                        </div>
                        <div id="expired-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '제목 없음'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">종료: ${n.expiresAt || '-'}</div>
                                    </div>
                                    <button onclick="reactivateNotice(${n.id})" style="background: #6366f1; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer; flex-shrink: 0;">재등록</button>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">종료된 공지가 없습니다</div>'}
                        </div>
                    </div>

                    <!-- 공지사항 작성 -->
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 8px;">
                        <div style="font-weight: 600; font-size: 0.8rem; color: #e2e8f0; margin-bottom: 6px;">
                            <i class="fa-solid fa-pen"></i> 공지사항 작성
                        </div>
                        
                        <input type="hidden" id="notice-edit-id" value="">
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">게시글 제목</label>
                            <input type="text" id="notice-title" style="width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.85rem; box-sizing: border-box;" placeholder="예: 서버 점검 안내">
                        </div>
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">게시글 내용</label>
                            <textarea id="notice-content" style="width: 100%; height: 60px; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem; resize: none; box-sizing: border-box;" placeholder="내용을 입력하세요..."></textarea>
                        </div>
                        
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">공지 종료 기한</label>
                            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                <input type="date" id="notice-expire-date" value="${defaultDate}" style="flex: 1; min-width: 110px; padding: 5px 6px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                <select id="notice-expire-hour" style="width: 60px; padding: 5px 3px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                    ${hourOptions}
                                </select>
                                <select id="notice-expire-minute" style="width: 60px; padding: 5px 3px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                    ${minuteOptions}
                                </select>
                            </div>
                        </div>
                        
                        <!-- 게시글 링크 선택 -->
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;"><i class="fa-solid fa-link"></i> 게시글 연결 (선택)</label>
                            <div style="background: #0f172a; border: 1px solid #334155; border-radius: 4px; overflow: hidden;">
                                <div id="notice-promo-selected" style="display:none; padding:6px 8px; background:rgba(59,130,246,0.1); border-bottom:1px solid #334155;">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
                                            <i class="fa-solid fa-file-lines" style="color:#3b82f6; font-size:0.7rem;"></i>
                                            <span id="notice-promo-title" style="font-size:0.75rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
                                        </div>
                                        <button onclick="window.clearLinkedPromoLegacy()" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.65rem; padding:2px 6px;">해제</button>
                                    </div>
                                </div>
                                <div style="padding:4px 4px 2px;">
                                    <input id="notice-promo-search" type="text" placeholder="게시글 검색..." oninput="window.filterPromoListLegacy(this.value)"
                                           style="width:100%; padding:4px 6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:3px; color:#e2e8f0; font-size:0.68rem; box-sizing:border-box; outline:none;" />
                                </div>
                                <div id="notice-promo-list" style="max-height:100px; overflow-y:auto; padding:4px;">
                                    <div style="text-align:center; color:#64748b; font-size:0.7rem; padding:6px;">불러오는 중...</div>
                                </div>
                            </div>
                            <input type="hidden" id="notice-linked-promo" value="">
                        </div>

                        <button onclick="saveNotice()" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 4px; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
                            <i class="fa-solid fa-paper-plane"></i> 공지 등록
                        </button>
                    </div>
                    
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 현재 시간 + 1시간으로 기본값 설정
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;

    // 게시글 목록 로드 (공지 연결용)
    loadPromoListForNoticeLegacy();
}

// 5. 공지사항 저장 (POST)
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value.trim();
    const content = document.getElementById('notice-content').value.trim();
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;
    const linkedPromoEl = document.getElementById('notice-linked-promo');
    const linkedPromoId = linkedPromoEl ? linkedPromoEl.value : '';

    if (!title || !content) {
        alert("제목과 내용을 모두 입력해주세요.");
        return;
    }

    if (!expireDate) {
        alert("공지 종료 기한을 설정해주세요.");
        return;
    }

    const expiresAt = `${expireDate} ${String(expireHour).padStart(2, '0')}:${String(expireMinute).padStart(2, '0')}`;

    const payload = {
        isActive: true,
        id: editId ? parseInt(editId) : Date.now(),
        title: title,
        content: content,
        expiresAt: expiresAt,
        linkedPromoId: linkedPromoId ? Number(linkedPromoId) : null,
        updatedAt: new Date().toLocaleString()
    };

    await requestNoticeUpdate(payload);
};

// 5-1. 게시글 목록 로드/선택/해제 (독립 공지 모달용) - 전체 로드 + 검색 필터
var _legacyPromoCache = [];

async function loadPromoListForNoticeLegacy() {
    const listEl = document.getElementById('notice-promo-list');
    if (!listEl) return;
    const searchEl = document.getElementById('notice-promo-search');
    if (searchEl) searchEl.value = '';
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (!res.ok) throw new Error();
        const posts = await res.json();
        _legacyPromoCache = posts || [];
        window.renderPromoListLegacy(_legacyPromoCache);
    } catch (e) {
        listEl.innerHTML = '<div style="color:#ef4444; font-size:0.7rem; padding:6px;">불러오기 실패</div>';
    }
}

window.renderPromoListLegacy = function (posts) {
    const listEl = document.getElementById('notice-promo-list');
    if (!listEl) return;
    if (!posts || posts.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.7rem; padding:6px;">게시글 없음</div>';
        return;
    }
    listEl.innerHTML = posts.map(p => `
        <div onclick="window.selectLinkedPromoLegacy(${p.id}, '${(p.title || '').replace(/'/g, "\\'")}')"
             style="padding:4px 6px; cursor:pointer; border-radius:3px; font-size:0.7rem; color:#cbd5e1; display:flex; align-items:center; gap:6px;"
             onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
            <i class="fa-solid fa-file-lines" style="color:#64748b; font-size:0.6rem;"></i>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${p.title}</span>
        </div>
    `).join('');
};

window.filterPromoListLegacy = function (keyword) {
    if (!keyword || !keyword.trim()) {
        window.renderPromoListLegacy(_legacyPromoCache);
        return;
    }
    var lower = keyword.trim().toLowerCase();
    var filtered = _legacyPromoCache.filter(function (p) {
        return (p.title || '').toLowerCase().indexOf(lower) !== -1;
    });
    window.renderPromoListLegacy(filtered);
};

window.selectLinkedPromoLegacy = function (id, title) {
    document.getElementById('notice-linked-promo').value = id;
    document.getElementById('notice-promo-title').textContent = title;
    document.getElementById('notice-promo-selected').style.display = 'block';
    document.getElementById('notice-promo-list').style.display = 'none';
};

window.clearLinkedPromoLegacy = function () {
    document.getElementById('notice-linked-promo').value = '';
    document.getElementById('notice-promo-selected').style.display = 'none';
    document.getElementById('notice-promo-list').style.display = 'block';
};

// 6. 공지사항 삭제 (ID로)
window.deleteNoticeById = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert("삭제되었습니다.");
            document.getElementById('admin-modal-overlay').remove();
            showAdminNoticeModal(); // 새로고침
        } else {
            // 기존 방식으로 폴백
            const payload = { isActive: false, id: id, title: "", content: "" };
            await requestNoticeUpdate(payload);
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// 6-1. 공지 수정 모드
window.editNotice = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (!res.ok) throw new Error('API 오류');
        const notices = await res.json();
        const notice = [...(notices.active || []), ...(notices.expired || [])].find(n => String(n.id) === String(id));

        if (notice) {
            document.getElementById('notice-edit-id').value = notice.id;
            document.getElementById('notice-title').value = notice.title || '';
            document.getElementById('notice-content').value = notice.content || '';

            if (notice.expiresAt) {
                const parts = notice.expiresAt.split(' ');
                if (parts[0]) document.getElementById('notice-expire-date').value = parts[0];
                if (parts[1]) {
                    const timeParts = parts[1].split(':');
                    document.getElementById('notice-expire-hour').value = parseInt(timeParts[0]) || 0;
                    document.getElementById('notice-expire-minute').value = parseInt(timeParts[1]) || 0;
                }
            }

            // 연결된 게시글 복원
            if (notice.linkedPromoId) {
                try {
                    // 관리자 패널에서 게시글 조회 → admin=true로 조회수 중복 증가 방지
                    const pRes = await fetch(CONFIG.API_BASE + '/api/promo/' + notice.linkedPromoId + '?admin=true');
                    if (pRes.ok) {
                        const post = await pRes.json();
                        window.selectLinkedPromoLegacy(post.id, post.title);
                    }
                } catch (pe) { /* 게시글 삭제됨 */ }
            } else {
                window.clearLinkedPromoLegacy();
            }

            // 스크롤을 작성 영역으로
            document.querySelector('#admin-modal-overlay .notice-content').scrollTop = 9999;
        }
    } catch (e) {
        // console.error(e);
        alert("공지 정보를 불러올 수 없습니다.");
    }
};

// 6-2. 종료된 공지 재등록
window.reactivateNotice = async function (id) {
    await editNotice(id);
    // 기한을 현재 시간 + 1일로 재설정
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    document.getElementById('notice-expire-date').value = tomorrow.toISOString().split('T')[0];
    document.getElementById('notice-expire-hour').value = 23;
    document.getElementById('notice-expire-minute').value = 59;
};

// 기존 deleteNotice 호환
window.deleteNotice = async function () {
    if (!confirm("현재 게시 중인 공지를 내리시겠습니까?")) return;
    const payload = { isActive: false, id: Date.now(), title: "", content: "" };
    await requestNoticeUpdate(payload);
};

async function requestNoticeUpdate(payload) {
    try {
        // 새로운 다중 공지 API 사용
        let res = await fetch(CONFIG.API_BASE + '/api/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 실패 시 기존 단일 공지 API로 폴백
        if (!res.ok) {
            res = await fetch(CONFIG.NOTICE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            alert("적용되었습니다.");
            document.getElementById('admin-modal-overlay').remove();
            // 모달 다시 열어서 목록 갱신
            showAdminNoticeModal();
        } else {
            alert("서버 저장 실패");
        }
    } catch (e) {
        alert("오류 발생: " + e.message);
    }
}

// 7. 일반 사용자용 공지 팝업 (리디자인)
function showNoticePopup(noticeData) {
    // 이미 팝업이 있으면 제거
    const existing = document.getElementById('main-notice-popup');
    if (existing) existing.remove();

    const isMaintenance = noticeData.title.includes('점검');
    const typeClass = isMaintenance ? 'maintenance' : '';
    const iconEmoji = isMaintenance ? '<i class="fa-solid fa-wrench"></i>' : '<i class="fa-solid fa-bullhorn"></i>';

    // 만료일 포맷
    let expiresText = '';
    if (noticeData.expiresAt) {
        const parts = noticeData.expiresAt.split(' ');
        if (parts[0]) {
            const dateParts = parts[0].split('-');
            expiresText = `${dateParts[0]}.${dateParts[1]}.${dateParts[2]}`;
            if (parts[1]) expiresText += ` ${parts[1]}`;
            expiresText += ' 까지';
        }
    }

    // 게시글 연결 버튼 (linkedPromoId가 있을 때만)
    const promoButtonHtml = noticeData.linkedPromoId
        ? `<button class="notice-detail-btn" onclick="window.goToLinkedPromo(${noticeData.linkedPromoId}, ${noticeData.id})">
            <i class="fa-solid fa-arrow-right"></i> 자세히 보기
          </button>`
        : '';

    const html = `
        <div class="notice-modal-overlay" id="main-notice-popup">
            <div class="notice-popup">
                <div class="notice-header-area ${typeClass}">
                    <div class="notice-icon-badge ${typeClass}">
                        ${iconEmoji}
                    </div>
                    <div class="notice-title">${noticeData.title}</div>
                    ${expiresText ? `<div class="notice-expires">${expiresText}</div>` : ''}
                </div>
                <div class="notice-body">
                    <div class="notice-body-inner ${typeClass}">
                        ${(noticeData.content || '').trim().replace(/\n/g, '<br>')}
                    </div>
                    ${promoButtonHtml}
                </div>
                <div class="notice-footer">
                    <label class="notice-checkbox-label" onclick="window._toggleNoticeCheck()">
                        <span class="notice-checkbox-custom" id="notice-check-box">
                            <svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="2.5 6 5 8.5 9.5 3.5"></polyline>
                            </svg>
                        </span>
                        다시 보지 않기
                    </label>
                    <input type="checkbox" id="notice-dont-show" style="display:none;">
                    <button class="notice-close-btn" onclick="closeNoticePopup(${noticeData.id})">확인</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

// 7-0. 커스텀 체크박스 토글
window._toggleNoticeCheck = function () {
    const box = document.getElementById('notice-check-box');
    const hidden = document.getElementById('notice-dont-show');
    if (!box || !hidden) return;
    hidden.checked = !hidden.checked;
    box.classList.toggle('checked', hidden.checked);
};

// 7-1. 게시글 이동 핸들러
window.goToLinkedPromo = function (promoId, noticeId) {
    // 공지 팝업 닫기
    window.closeNoticePopup(noticeId);

    // 공지사항 탭으로 이동
    if (typeof window.switchMainTab === 'function') {
        window.switchMainTab('promo-section');
    }

    // 게시글 상세 열기
    setTimeout(function () {
        if (typeof window.openPromoDetail === 'function') {
            window.openPromoDetail(promoId);
        }
    }, 300);
};

// 8. 팝업 닫기 ("다시 보지 않기" 처리)
window.closeNoticePopup = function (noticeId) {
    const checkbox = document.getElementById('notice-dont-show');
    if (checkbox && checkbox.checked) {
        localStorage.setItem('hidden_notice_id', String(noticeId));
    }
    const popup = document.getElementById('main-notice-popup');
    if (popup) popup.remove();
};

// 9. 하드코딩 팝업: 서버 점검 중 (연결 불가) - 리디자인
function showMaintenancePopup() {
    const html = `
        <div class="notice-modal-overlay" id="server-maintenance-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header-area maintenance">
                    <div class="notice-icon-badge maintenance">
                        <i class="fa-solid fa-server"></i>
                    </div>
                    <div class="notice-title">서버 연결 불가</div>
                </div>
                <div class="notice-body">
                    <div class="notice-body-inner maintenance" style="text-align:center; border-left:none; padding-left:0;">
                        현재 서버와 연결할 수 없습니다.<br><br>
                        <span style="font-size:0.85rem; color:#94a3b8;">
                            서버(PC) 전원이 꺼져 있거나<br>점검 중일 수 있습니다.
                        </span>
                    </div>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('server-maintenance-popup').remove(); window.location.reload();">
                        <i class="fa-solid fa-power-off"></i> 앱 재시작
                    </button>
                </div>
            </div>
        </div>
    `;
    // 중복 방지
    if (!document.getElementById('server-maintenance-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// 10. 하드코딩 팝업: 네트워크 오류 - 리디자인
function showNetworkErrorPopup() {
    const html = `
        <div class="notice-modal-overlay" id="network-error-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header-area error">
                    <div class="notice-icon-badge error">
                        <i class="fa-solid fa-wifi"></i>
                    </div>
                    <div class="notice-title">네트워크 오류</div>
                </div>
                <div class="notice-body">
                    <div class="notice-body-inner error" style="text-align:center; border-left:none; padding-left:0;">
                        인터넷 연결이 끊겨 있습니다.<br><br>
                        <span style="font-size:0.85rem; color:#94a3b8;">
                            Wi-Fi 또는 데이터 설정을<br>확인해 주세요.
                        </span>
                    </div>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('network-error-popup').remove(); window.location.reload();">
                        <i class="fa-solid fa-power-off"></i> 앱 재시작
                    </button>
                </div>
            </div>
        </div>
    `;
    if (!document.getElementById('network-error-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// [참고] showMyLocationWeather는 settings.js에 정의됨

