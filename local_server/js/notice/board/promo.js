/**
 * ============================================================================
 * 파일명: js/promo.js
 * 역할: 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : image_compress.js(compressImageToJpeg/blobToDataURL), promo_comment5.js(loadPromoComments), admin.js(showUnifiedLoginModal·adminAuthenticated), admin/pagination_helper.js
 *  - 서버 API      : /api/promo(/*), /api/boards, /api/comments/counts, /api/reactions(/counts), /api/upload, /api/upload-file
 *  - 마크업        : index2.html #promo-list(-pagination), #promo-detail-modal, #promo-editor-modal, #promo-tabs-container, #promo-attachment-list 등
 *  - 나를 쓰는 곳  : 자체 초기화 및 탭/검색 시 renderPromoPosts 호출; admin_trigger.js·댓글 파일들이 promo 전역·상세보기 참조
 * ============================================================================
 *
 * [설명]
 * - renderPromoPosts(): 홍보 게시판 목록 렌더링
 * - handleFileUpload(): 파일 업로드 처리
 * - renderAttachmentList(): 첨부파일 목록
 * - DOMContentLoaded #2: 스플래시 화면, 관리자 트리거, 네이티브 앱 감지
 *
 * [로딩 순서] 12번째 (admin_trigger.js 이후)
 * ============================================================================
 */

// ============================================================================
// [신규] 홍보정보 게시판 기능
// ============================================================================

// 전역 변수
let promoQuillEditor = null;
let currentEditingPromoId = null;
let currentAttachments = []; // [New] 현재 편집 중인 게시글의 첨부파일 목록
let _boardsCache = []; // 게시판 목록 캐시
let _commentCounts = {}; // 게시글별 댓글 수 캐시 { "postId": count }
let _reactionCounts = {}; // 게시글별 리액션 수 캐시 { "postId": { heartCount, thumbsCount, wowCount } }

// [New] 첨부파일 목록 렌더링
function renderAttachmentList() {
    const listEl = document.getElementById('promo-attachment-list');
    if (!listEl) return;

    if (currentAttachments.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.85rem; padding:10px;">첨부된 파일이 없습니다</div>';
        return;
    }

    listEl.innerHTML = currentAttachments.map((file, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                <i class="fa-solid ${getFileIcon(file.originalName)}" style="color:#4fc3f7;"></i>
                <span style="font-size:0.85rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.originalName}</span>
                <span style="font-size:0.75rem; color:#64748b;">(${formatFileSize(file.size || 0)})</span>
            </div>
            <button onclick="removeAttachment(${idx})" style="background:rgba(239,68,68,0.2); border:none; color:#f87171; width:24px; height:24px; border-radius:4px; cursor:pointer; font-size:0.8rem;">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `).join('');
}

// [New] 파일 아이콘 결정
function getFileIcon(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const icons = {
        'xlsx': 'fa-file-excel', 'xls': 'fa-file-excel',
        'hwp': 'fa-file-lines',
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word', 'docx': 'fa-file-word',
        'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
        'zip': 'fa-file-zipper', 'rar': 'fa-file-zipper'
    };
    return icons[ext] || 'fa-file';
}

// [New] 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// [New] 첨부파일 제거
window.removeAttachment = function (index) {
    currentAttachments.splice(index, 1);
    renderAttachmentList();
};

// [New] 파일 업로드 핸들러
async function handleFileUpload(files) {
    const statusEl = document.getElementById('promo-file-upload-status');
    if (statusEl) statusEl.style.display = 'block';

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/upload-file', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success || data.url) {
                currentAttachments.push({
                    url: data.url,
                    filename: data.filename,
                    originalName: data.originalName || file.name,
                    size: data.size || file.size,
                    type: data.type || file.type
                });
            } else {
                alert('파일 업로드 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (e) {
            // console.error('파일 업로드 오류:', e);
            alert('파일 업로드 중 오류가 발생했습니다.');
        }
    }

    if (statusEl) statusEl.style.display = 'none';
    renderAttachmentList();
}

// 1. 게시글 목록 불러오기
async function loadPromoPosts() {
    const container = document.getElementById('promo-list');
    if (!container) return;

    // 로딩 스피너 표시
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: #94a3b8;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: #38bdf8; margin-bottom: 15px;"></i>
            <div style="font-size: 0.95rem;">게시글을 불러오는 중입니다...</div>
        </div>
    `;

    try {
        // 게시판 목록, 게시글, 댓글 수, 리액션 수를 병렬 로드
        const [promoRes, boardsRes, countsRes, reactionsRes] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/promo'),
            fetch(CONFIG.API_BASE + '/api/boards'),
            fetch(CONFIG.API_BASE + '/api/comments/counts'),
            fetch(CONFIG.API_BASE + '/api/reactions/counts')
        ]);
        if (!promoRes.ok) throw new Error('API 오류');
        const posts = await promoRes.json();
        const boards = await boardsRes.json();
        _commentCounts = countsRes.ok ? await countsRes.json() : {};
        _reactionCounts = reactionsRes.ok ? await reactionsRes.json() : {};

        // 게시판 캐시 업데이트 및 탭 렌더링
        _boardsCache = boards || [];
        renderPromoTabs(_boardsCache);

        updateNewBadges(posts); // [New] 뱃지 업데이트
        renderPromoPosts(posts);
    } catch (e) {
        // console.error('게시글 로드 실패:', e);
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>게시글을 불러올 수 없습니다.</p>
            </div>
        `;
    }
}

// 게시판 탭 버튼 동적 렌더링
function renderPromoTabs(boards) {
    const tabsContainer = document.getElementById('promo-tabs-container');
    if (!tabsContainer) return;

    // "전체" 버튼은 항상 유지, 나머지는 동적 생성
    let html = `<button class="promo-tab-btn ${currentPromoCategory === 'ALL' ? 'active' : ''}" onclick="filterPromo('ALL')">전체</button>`;
    boards.forEach(board => {
        html += `<button class="promo-tab-btn ${currentPromoCategory === board.id ? 'active' : ''}" onclick="filterPromo('${board.id}')">${board.name}</button>`;
    });
    tabsContainer.innerHTML = html;
}

// 24시간 이내 새 게시글 체크 및 뱃지 표시
function updateNewBadges(posts) {
    if (!posts || posts.length === 0) return;

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24시간 (ms)

    // 카테고리별 새 글 유무 상태 (동적 게시판 지원)
    const hasNew = { 'ALL': false };
    _boardsCache.forEach(b => { hasNew[b.id] = false; });

    posts.forEach(post => {
        let postDateStr = post.createdAt;
        if (!postDateStr) return;

        postDateStr = postDateStr.replace(/\./g, '-');
        const postDate = new Date(postDateStr);

        if (!isNaN(postDate.getTime())) {
            const diff = now - postDate;
            if (diff >= 0 && diff < ONE_DAY) {
                hasNew['ALL'] = true;
                if (hasNew.hasOwnProperty(post.category)) {
                    hasNew[post.category] = true;
                }
            }
        }
    });

    // 1. 메인 탭 (공지사항) 뱃지 업데이트
    const mainTabBtn = document.querySelector('.main-tabs .tab-btn[data-target="promo-section"]');
    if (mainTabBtn) {
        const existingBadge = mainTabBtn.querySelector('.new-badge');
        if (existingBadge) existingBadge.remove();

        if (hasNew['ALL']) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = 'N';
            // [버튼 내부에 .tab-btn-label 이 있으면 그 안쪽에 인라인 삽입]
            //  index2 하단 메인탭은 아이콘+라벨 2단(flex column) 구조라, 뱃지를
            //  버튼 직접 자식으로 append 하면 3번째 자식으로 세로 추가되어
            //  탭 높이가 증가 → 하단 잘림 발생. 라벨 span 안으로 넣으면 라벨
            //  텍스트 옆에 인라인으로 붙어 탭 높이가 변하지 않음.
            //  index1 은 라벨 span 이 없는 단순 텍스트 버튼 → 기존 경로 유지.
            const labelEl = mainTabBtn.querySelector('.tab-btn-label');
            if (labelEl) {
                labelEl.appendChild(badge);
            } else {
                mainTabBtn.appendChild(badge);
            }
        }
    }

    // 2. 카테고리 필터 버튼 뱃지 업데이트 (동적 게시판 지원)
    const categoryBtns = document.querySelectorAll('.promo-tabs .promo-tab-btn');
    // 순서: 전체(0), 그 다음은 _boardsCache 순서대로
    const mapping = ['ALL', ..._boardsCache.map(b => b.id)];

    categoryBtns.forEach((btn, index) => {
        if (index >= mapping.length) return;
        const category = mapping[index];

        const existingBadge = btn.querySelector('.new-badge');
        if (existingBadge) existingBadge.remove();

        if (hasNew[category]) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = 'N';
            btn.appendChild(badge);
        }
    });
}

// 2. 게시글 목록 렌더링
let allPromoPosts = []; // 전체 게시글 원본 데이터 저장
let currentPromoCategory = 'ALL'; // 현재 선택된 카테고리
let currentSearchKeyword = ''; // 현재 검색어
const PROMO_ITEMS_PER_PAGE = 10; // 페이지당 게시글 수
let currentPromoPage = 1; // 현재 페이지

/**
 * 홍보 게시글 목록을 화면에 렌더링.
 *
 * [입력] posts (선택) — 처음 로드 시 전역 allPromoPosts 에 저장.
 *        후속 호출(필터/검색/페이지 변경) 에서는 인자 없이 호출하여
 *        기존 allPromoPosts 를 재사용.
 *
 * [필터링/검색]
 *   - 카테고리 필터
 *   - 검색어 (currentSearchKeyword)
 *   - 페이지네이션 (PROMO_ITEMS_PER_PAGE 단위)
 *
 * [연계] currentPromoPage / currentSearchKeyword / 카테고리 필터 변경 시
 *        이 함수를 다시 호출하여 화면 갱신.
 *
 * @param {Array<Object>=} posts - 게시글 배열 (최초 1회만 전달)
 */
function renderPromoPosts(posts) {
    // 렌더링 시 전역 변수 업데이트 (최초 로드 시)
    if (posts) allPromoPosts = posts;

    // 필터링 및 검색 로직 적용
    let displayPosts = allPromoPosts.filter(post => {
        // 1. 카테고리 필터
        if (currentPromoCategory !== 'ALL' && post.category !== currentPromoCategory) return false;
        // 2. 검색 필터
        if (currentSearchKeyword) {
            const keyword = currentSearchKeyword.toLowerCase();
            return (post.title || '').toLowerCase().includes(keyword) ||
                (post.content || '').toLowerCase().includes(keyword);
        }
        return true;
    });

    // 정렬 로직: 중요(Pinned) 게시글 상단 고정, 그 외는 최신순
    displayPosts.sort((a, b) => {
        // 둘 다 Pinned이면 날짜 비교
        if (a.isPinned && b.isPinned) return new Date(b.createdAt) - new Date(a.createdAt);
        // a만 Pinned이면 a가 먼저
        if (a.isPinned) return -1;
        // b만 Pinned이면 b가 먼저
        if (b.isPinned) return 1;
        // 둘 다 아니면 날짜 비교 (최신순)
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // [추가] 페이지네이션 로직 적용
    const totalItems = displayPosts.length;
    const totalPages = Math.ceil(totalItems / PROMO_ITEMS_PER_PAGE);

    // 페이지 범위 보정
    if (currentPromoPage < 1) currentPromoPage = 1;
    if (currentPromoPage > totalPages && totalPages > 0) currentPromoPage = totalPages;

    const startIndex = (currentPromoPage - 1) * PROMO_ITEMS_PER_PAGE;
    const endIndex = startIndex + PROMO_ITEMS_PER_PAGE;
    const paginatedPosts = displayPosts.slice(startIndex, endIndex);

    const container = document.getElementById('promo-list');
    const paginationContainer = document.getElementById('promo-pagination'); // [추가]
    if (!container) return;

    if (!paginatedPosts || paginatedPosts.length === 0) {
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>조건에 맞는 게시글이 없습니다.</p>
            </div>
        `;
        if (paginationContainer) paginationContainer.innerHTML = ''; // 빈 목록이면 페이지네이션 숨김
        return;
    }

    // 날짜 포맷 헬퍼 (함수 내부 이동: "yyyy.MM.dd HH:mm" 형태)
    function formatPromoDate(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
        if (match) {
            const [, year, month, day, ampm, hour, minute] = match;
            let h = parseInt(hour);
            if (ampm === '오후' && h !== 12) h += 12;
            if (ampm === '오전' && h === 12) h = 0;
            return `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')} ${String(h).padStart(2, '0')}:${minute}`;
        }
        // 기본적으로 날짜 형식이 이미 "YYYY.MM.DD HH:mm"으로 오는지 확인
        // 만약 서버에서 "YYYY.MM.DD HH:mm"으로 준다면 그대로 사용
        return dateStr;
    }

    // 카테고리 뱃지 생성 헬퍼 (동적 게시판 지원)
    function getCategoryBadge(category, isPinned) {
        if (currentPromoCategory !== 'ALL') return ''; // 개별 탭에서는 표시 X

        const board = _boardsCache.find(b => b.id === category);
        if (board) {
            const color = board.badgeColor || '#94a3b8';
            return `<span class="promo-badge" style="background:${_hexToRgba(color, 0.1)}; color:${color}; border:1px solid ${_hexToRgba(color, 0.6)}; box-shadow:0 0 8px ${_hexToRgba(color, 0.4)};">${board.badgeText}</span>`;
        }

        // 매칭되는 게시판이 없는 경우 (기본 회색)
        return `<span class="promo-badge promo-badge-gray">${category || '기타'}</span>`;
    }

    // 색상 변환 헬퍼 (프론트용)
    function _hexToRgba(hex, alpha) {
        if (!hex) return `rgba(148,163,184,${alpha})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    container.innerHTML = paginatedPosts.map(post => {
        const isPinnedClass = post.isPinned ? 'pinned-post' : '';
        const badgeHtml = getCategoryBadge(post.category, post.isPinned);
        const pinIcon = post.isPinned ? '<i class="fa-solid fa-thumbtack" style="color:#ff5252; margin-right:4px;"></i>' : '';

        // [New] 24시간 이내 새 글 뱃지 (리스트용)
        let newBadgeHtml = '';
        if (post.createdAt) {
            let pDate = new Date(post.createdAt.replace(/\./g, '-'));
            if (!isNaN(pDate.getTime()) && (now - pDate) >= 0 && (now - pDate) < ONE_DAY) {
                newBadgeHtml = '<span class="new-badge" style="vertical-align: middle; margin-left: 6px;">N</span>';
            }
        }

        // 카테고리 미지정 데이터 보정
        const category = post.category || 'PROMO';

        const commentCount = _commentCounts[String(post.id)] || 0;
        const commentCountHtml = '<span class="promo-item-comment-count">[' + commentCount + ']</span>';

        const rc = _reactionCounts[String(post.id)] || { heartCount: 0, thumbsCount: 0, wowCount: 0 };
        const reactionHtml = `<span class="promo-item-reactions">`
            + `<span class="promo-item-reaction-chip">❤️ ${rc.heartCount}</span>`
            + `<span class="promo-item-reaction-chip">👍 ${rc.thumbsCount}</span>`
            + `<span class="promo-item-reaction-chip">😮 ${rc.wowCount}</span>`
            + `</span>`;

        return `
        <div class="promo-item ${isPinnedClass}" onclick="openPromoDetail(${post.id})">
            <div class="promo-item-title">
                ${badgeHtml}
                ${pinIcon}
                ${escapeHtml(post.title)}${newBadgeHtml}${commentCountHtml}
            </div>
            <div class="promo-item-meta">
                <span class="promo-item-date">${formatPromoDate(post.createdAt)}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span class="promo-item-views"><i class="fa-regular fa-eye"></i> ${post.views || 0}</span>
                    ${reactionHtml}
                </div>
            </div>
        </div>
        `;
    }).join('');

    renderPagination(totalPages); // [추가] 페이지네이션 버튼 렌더링
}

// [추가] 페이지네이션 UI 렌더링 함수
function renderPagination(totalPages) {
    const container = document.getElementById('promo-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';

    // 이전 버튼
    if (currentPromoPage > 1) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
    }

    // 페이지 번호 (최대 5개 표시 예시: 1 2 3 4 5)
    // 간단하게 구현: 전체 다 보여주되 너무 많으면 스크롤 등 (여기서는 전체 표시하되 스타일로 조정)
    // 혹은 현재 페이지 주변만 표시하는 로직 추가 가능
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPromoPage) {
            html += `<button class="pagination-btn active">${i}</button>`;
        } else {
            html += `<button class="pagination-btn" onclick="changePromoPage(${i})">${i}</button>`;
        }
    }

    // 다음 버튼
    if (currentPromoPage < totalPages) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    }

    container.innerHTML = html;
}

// [추가] 페이지 변경 핸들러
window.changePromoPage = function (page) {
    currentPromoPage = page;
    renderPromoPosts();
    // 페이지 이동 시 목록 상단으로 스크롤은 선택 사항 (필요 시 구현)
    // document.getElementById('promo-list').scrollIntoView({ behavior: 'smooth' });
};

// 2-1. 카테고리 필터링 함수 (동적 게시판 지원)
window.filterPromo = function (category) {
    currentPromoCategory = category;
    currentPromoPage = 1;

    // 탭 UI 업데이트: onclick에서 전달된 카테고리 ID로 매칭
    document.querySelectorAll('.promo-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // 전체 탭 또는 동적 게시판 탭 활성화
    const btns = document.querySelectorAll('.promo-tab-btn');
    const mapping = ['ALL', ..._boardsCache.map(b => b.id)];
    const idx = mapping.indexOf(category);
    if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');

    renderPromoPosts();
};

// 2-2. 검색 함수
window.searchPromo = function () {
    const input = document.getElementById('promo-search-input');
    if (input) {
        currentSearchKeyword = input.value.trim();
        currentPromoPage = 1;
        renderPromoPosts();
    }
}

// 3. 게시글 상세 보기 열기
window.openPromoDetail = async function (postId) {
    const modal = document.getElementById('promo-detail-modal');
    if (!modal) return;

    try {
        // 상세 조회 API 호출 (조회수 자동 증가)
        // 관리자 기기이면 ?admin=true를 붙여서 하루 1회만 조회수 증가하도록 함
        const isAdmin = localStorage.getItem('seagnal_admin_mode') === 'true';
        const promoUrl = CONFIG.API_BASE + '/api/promo/' + postId + (isAdmin ? '?admin=true' : '');
        const res = await fetch(promoUrl);
        if (!res.ok) {
            alert('게시글을 불러올 수 없습니다.');
            return;
        }
        const post = await res.json();

        // 목록의 조회수도 업데이트하기 위해 목록 새로고침 (백그라운드)
        loadPromoPosts();

        document.getElementById('promo-detail-title').textContent = post.title;
        document.getElementById('promo-detail-date').textContent = post.createdAt;
        document.getElementById('promo-detail-views').textContent = post.views || 0;

        // 리액션 영역 삽입 (날짜/조회수 행 다음)
        _initPromoReactions(post.id);

        const contentEl = document.getElementById('promo-detail-content');
        contentEl.innerHTML = post.content;

        // [New] 첨부파일 표시 (전용 컨테이너 사용 및 극소형 레이아웃)
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) {
            attachmentContainer.innerHTML = ''; // 초기화
            if (post.attachments && post.attachments.length > 0) {
                const attachmentHtml = `
                    <div style="margin: 5px 15px 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); max-width: 400px;">
                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
                            <i class="fa-solid fa-paperclip"></i>
                            <span style="font-weight: 600;">첨부파일 (${post.attachments.length})</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${post.attachments.map(file => `
                                <a href="${file.url}" download="${file.originalName}" target="_blank" 
                                   style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; text-decoration: none; border: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                                    <i class="fa-solid ${getFileIcon(file.originalName)}" style="color: #4fc3f7; font-size: 1rem;"></i>
                                    <div style="flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 15px;">
                                        <span style="font-size: 0.85rem; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.originalName}</span>
                                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                            <span style="font-size: 0.75rem; color: #64748b;">${formatFileSize(file.size || 0)}</span>
                                            <i class="fa-solid fa-download" style="color: #4fc3f7; font-size: 0.85rem;"></i>
                                        </div>
                                    </div>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
                attachmentContainer.innerHTML = attachmentHtml;
            }
        }


        const images = contentEl.querySelectorAll('img');
        images.forEach(img => {
            // 이미 캐시되어 완료된 경우 패스
            if (img.complete) return;

            // 1. 이미지 숨김 및 투명도 설정 (페이드인 준비)
            const originalDisplay = img.style.display || 'block'; // Quill 이미지는 보통 block
            img.style.display = 'none';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.6s ease-out';
            img.style.maxWidth = '100%'; // 모바일 화면 넘침 방지

            // 2. 로딩 UI 생성
            const loader = document.createElement('div');
            loader.className = 'img-loader';
            loader.style.cssText = `
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                justify-content: center; 
                padding: 40px; 
                background: rgba(255, 255, 255, 0.03); 
                border-radius: 8px; 
                margin: 10px 0;
                border: 1px dashed rgba(255, 255, 255, 0.1);
                min-height: 150px;
            `;
            loader.innerHTML = `
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: #4fc3f7; margin-bottom: 15px;"></i>
                <div style="font-size: 0.9rem; color: #a0aec0; font-weight: 500;">이미지를 불러오는 중입니다...</div>
            `;

            // 이미지 앞에 삽입
            img.parentNode.insertBefore(loader, img);

            // 3. 로드 완료 핸들러
            img.onload = () => {
                loader.remove();
                img.style.display = originalDisplay;
                // 리플로우 후 페이드인
                requestAnimationFrame(() => {
                    img.style.opacity = '1';
                });
            };

            // 4. 에러 핸들러
            img.onerror = () => {
                loader.innerHTML = `
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef5350; margin-bottom: 10px;"></i>
                    <div style="color: #ef5350;">이미지를 불러올 수 없습니다.</div>
                `;
                // 에러난 이미지는 숨긴 상태 유지
            };
        });

        modal.classList.remove('hidden');

        // 댓글 섹션 렌더링: promo_comment.js의 함수 호출
        // allowComments 여부와 관계없이 loadPromoComments가 내부에서 판단하여 표시
        if (typeof loadPromoComments === 'function') {
            loadPromoComments(post.id, post.allowComments || false);
        }
    } catch (e) {
        // console.error('상세 보기 오류:', e);
        alert('게시글을 불러올 수 없습니다.');
    }
};

// 4. 게시글 상세 보기 닫기 (YouTube 영상 정지 포함)
window.closePromoDetail = function () {
    const modal = document.getElementById('promo-detail-modal');
    if (modal) {
        // YouTube iframe 정지 (src 초기화로 영상 중단)
        const iframes = modal.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            const src = iframe.src;
            iframe.src = ''; // 먼저 비우고
            iframe.src = src; // 다시 설정 (재생 중단됨)
        });
        modal.classList.add('hidden');
        // [New] 첨부파일 영역 초기화
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) attachmentContainer.innerHTML = '';
        // 댓글 섹션 초기화
        const commentsContainer = document.getElementById('promo-detail-comments');
        if (commentsContainer) commentsContainer.innerHTML = '';
        // 리액션 영역 초기화
        const reactionsWrap = document.getElementById('promo-detail-reactions');
        if (reactionsWrap) reactionsWrap.innerHTML = '';
    }
};

// 5. HTML 이스케이프 (XSS 방지)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// [관리자] 홍보 게시판 관리 기능
// ============================================================================
// 통합 관리자(unified-admin-modal) > "게시판 관리" 탭 > "게시글 관리" 서브탭에서
// 사용. 별도 오렌지 팝업(showPromoManagementModal) 은 제거됨.

// 8. 새 글 작성 에디터 열기
window.openPromoEditor = async function (editData = null) {
    // 기존 모달 닫기
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.add('hidden');
    const unifiedModal = document.getElementById('unified-admin-modal');
    if (unifiedModal) unifiedModal.style.display = 'none'; // 편집 중에는 잠깐 숨김

    currentEditingPromoId = editData ? editData.id : null;

    // 에디터 모달 생성
    let editorModal = document.getElementById('promo-editor-modal');
    if (!editorModal) {
        const html = `
            <div id="promo-editor-modal" class="modal">
                <div class="modal-content promo-editor-modal-content">
                    <div class="modal-header">
                        <h3 id="promo-editor-header-title"><i class="fa-solid fa-pen-to-square"></i> 새 글 작성</h3>
                        <!-- 댓글 허용 여부 토글: 관리자가 게시글 작성/수정 시 댓글 기능 on/off 결정 -->
                        <label id="promo-editor-comment-toggle-wrap" style="display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 10px; background:rgba(79,195,247,0.1); border:1px solid rgba(79,195,247,0.3); border-radius:20px; margin-right:8px; white-space:nowrap;">
                            <i class="fa-solid fa-comment-dots" style="color:#4fc3f7; font-size:0.85rem;"></i>
                            <span style="font-size:0.8rem; color:#4fc3f7; font-weight:600;">댓글 허용</span>
                            <div class="comment-toggle-switch">
                                <input type="checkbox" id="promo-editor-allow-comments" style="display:none;">
                                <span class="comment-toggle-slider"></span>
                            </div>
                        </label>
                        <button class="modal-close" onclick="closePromoEditor()">&times;</button>
                    </div>
                    <div class="promo-editor-body">
                        <div style="display:flex; gap:10px; margin-bottom:15px;">
                            <select id="promo-editor-category" style="flex:1; padding:12px; background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:1rem;">
                                <!-- 게시판 옵션은 동적으로 채워짐 -->
                            </select>
                            <label style="display:flex; align-items:center; gap:8px; padding:0 15px; background:rgba(255,82,82,0.1); border:1px solid rgba(255,82,82,0.3); border-radius:8px; cursor:pointer;">
                                <input type="checkbox" id="promo-editor-pinned">
                                <span style="font-size:0.9rem; color:#ff8a80; font-weight:600;"><i class="fa-solid fa-thumbtack"></i> 상단 고정</span>
                            </label>
                        </div>
                        <input type="text" id="promo-editor-title" class="promo-editor-title-input" placeholder="제목을 입력하세요">
                        <div id="promo-quill-editor"></div>
                        <!-- 이미지 업로드 진행률 표시 -->
                        <div id="promo-upload-progress" style="display:none; margin-top:10px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; position:relative; height:24px; border:1px solid rgba(255,255,255,0.2);">
                            <div id="promo-upload-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #4caf50, #8bc34a); transition:width 0.1s linear;"></div>
                            <div id="promo-upload-text" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#fff; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.5);">0%</div>
                        </div>
                        <!-- [New] 첨부파일 영역 -->
                        <div id="promo-attachment-section" style="margin-top:15px; padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px dashed rgba(255,255,255,0.2);">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                                <span style="font-size:0.9rem; color:#94a3b8;"><i class="fa-solid fa-paperclip" style="margin-right:6px;"></i>첨부파일</span>
                                <label style="cursor:pointer; padding:6px 12px; background:rgba(79,195,247,0.2); border:1px solid rgba(79,195,247,0.4); border-radius:6px; font-size:0.8rem; color:#4fc3f7;">
                                    <i class="fa-solid fa-plus" style="margin-right:4px;"></i>파일 추가
                                    <input type="file" id="promo-file-input" style="display:none;" multiple accept=".xlsx,.xls,.hwp,.pdf,.doc,.docx,.ppt,.pptx,.zip">
                                </label>
                            </div>
                            <div id="promo-attachment-list" style="display:flex; flex-direction:column; gap:8px;">
                                <!-- 첨부된 파일 목록이 여기에 표시됨 -->
                            </div>
                            <div id="promo-file-upload-status" style="display:none; margin-top:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; font-size:0.85rem; color:#aaa; text-align:center;">
                                <i class="fa-solid fa-spinner fa-spin"></i> 파일 업로드 중...
                            </div>
                        </div>
                    </div>
                    <div class="promo-editor-footer">
                        <button class="promo-btn-cancel" onclick="closePromoEditor()">취소</button>
                        <button class="promo-btn-save" onclick="savePromoPost()"><i class="fa-solid fa-check"></i> 저장</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        editorModal = document.getElementById('promo-editor-modal');
    }

    editorModal.classList.remove('hidden');

    // 댓글 허용 토글 슬라이더 인터랙션 등록 (promo_comment5.js)
    if (typeof initCommentToggleListener === 'function') {
        setTimeout(initCommentToggleListener, 0);
    }

    // Quill 에디터 초기화 (한 번만)
    if (!promoQuillEditor) {
        promoQuillEditor = new Quill('#promo-quill-editor', {
            theme: 'snow',
            placeholder: '내용을 입력하세요...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'align': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link', 'image', 'video'],
                    ['clean']
                ]
            }
        });

        // ═══════════════════════════════════════════════════════════════
        // [자동 이미지 압축] paste / drop / 이미지 파일 선택 시 이미지를
        //   JPEG 500KB 이하로 자동 축소하여 본문 크기를 제어한다.
        //   Base64 인라인 방식은 유지(본문 HTML 안에 data:image/jpeg 삽입).
        //   js/image_compress.js 의 compressImageToJpeg / blobToDataURL 사용.
        //   서버 body limit(5MB) 범위 내에서 게시글당 수 장 이미지 허용.
        // ═══════════════════════════════════════════════════════════════

        // 공통 유틸: 이미지 파일/블롭 → 압축 → 에디터 커서 위치에 삽입
        async function _insertCompressedImage(file) {
            try {
                if (!window.compressImageToJpeg || !window.blobToDataURL) {
                    // 압축 유틸이 로드되지 않은 경우 원본 삽입 (fallback)
                    const dataUrl = await new Promise((r) => {
                        const fr = new FileReader();
                        fr.onload = () => r(fr.result);
                        fr.readAsDataURL(file);
                    });
                    const range = promoQuillEditor.getSelection(true);
                    promoQuillEditor.insertEmbed(range.index, 'image', dataUrl);
                    return;
                }
                const blob = await window.compressImageToJpeg(file, {
                    maxWidth: 1600,
                    targetBytes: 500 * 1024,
                    minQuality: 0.5,
                    initialQuality: 0.85
                });
                const dataUrl = await window.blobToDataURL(blob);
                const range = promoQuillEditor.getSelection(true) || { index: promoQuillEditor.getLength() };
                promoQuillEditor.insertEmbed(range.index, 'image', dataUrl);
                promoQuillEditor.setSelection(range.index + 1, 0);
            } catch (err) {
                alert('이미지 삽입 실패: ' + (err && err.message ? err.message : '알 수 없는 오류'));
            }
        }

        // (a) 클립보드 붙여넣기(paste) 훅: Quill Clipboard matcher
        //     이미지 타입이 있으면 기본 동작(Delta 변환)을 막고 자체 삽입.
        const editorRoot = promoQuillEditor.root;
        editorRoot.addEventListener('paste', function (e) {
            const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
                    const file = it.getAsFile();
                    if (file) {
                        e.preventDefault();
                        _insertCompressedImage(file);
                        return;
                    }
                }
            }
            // 이미지 아니면 기본 동작 유지 (텍스트/HTML 붙여넣기)
        });

        // (b) 드래그 드롭 훅
        editorRoot.addEventListener('drop', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
            const file = e.dataTransfer.files[0];
            if (!file.type || file.type.indexOf('image/') !== 0) return;
            e.preventDefault();
            _insertCompressedImage(file);
        });

        // (c) 툴바 이미지 버튼 핸들러:
        //     종전에는 /api/upload 로 파일 업로드 후 URL 삽입.
        //     사용자 요구(500KB 이하 자동 압축 + base64 인라인) 에 맞춰 동일
        //     _insertCompressedImage 경로로 통일 → 붙여넣기/드롭/버튼 전부
        //     같은 압축·삽입 로직 사용.
        promoQuillEditor.getModule('toolbar').addHandler('image', function () {
            const input = document.createElement('input');
            input.setAttribute('type', 'file');
            input.setAttribute('accept', 'image/*');
            input.click();

            input.onchange = async () => {
                const file = input.files[0];
                if (!file) return;
                await _insertCompressedImage(file);
            };
        });

        // [참고] 아래는 이전 /api/upload 경로 (미사용).
        //        향후 이미지를 URL 참조 방식으로 재전환할 때 복원.
        if (false) {
            promoQuillEditor.getModule('toolbar').addHandler('__unused_legacy_image_upload', function () {
                const input = document.createElement('input');
                input.setAttribute('type', 'file');
                input.setAttribute('accept', 'image/*');
                input.click();

                input.onchange = async () => {
                    const file = input.files[0];
                    if (!file) return;

                    const formData = new FormData();
                    formData.append('file', file);

                // Progress Bar 요소
                const progressContainer = document.getElementById('promo-upload-progress');
                const progressBar = document.getElementById('promo-upload-bar');
                const progressText = document.getElementById('promo-upload-text');

                progressContainer.style.display = 'block';
                progressBar.style.width = '0%';
                progressText.innerText = '준비 중...';

                // XHR 사용 (진행률 추적)
                const xhr = new XMLHttpRequest();
                xhr.open('POST', CONFIG.API_BASE + '/api/upload', true);

                xhr.upload.onprogress = function (e) {
                    if (e.lengthComputable) {
                        const percentComplete = Math.floor((e.loaded / e.total) * 100);
                        progressBar.style.width = percentComplete + '%';
                        progressText.innerText = `이미지 업로드 중: ${percentComplete}%`;
                    }
                };

                xhr.onload = function () {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        if (data.url) {
                            const range = promoQuillEditor.getSelection(true);
                            promoQuillEditor.insertEmbed(range.index, 'image', data.url);
                        }
                    } else {
                        // console.error('업로드 실패:', xhr.statusText);
                        alert('이미지 업로드에 실패했습니다.');
                    }
                    // 완료 후 숨김 (잠시 후)
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 500);
                };

                xhr.onerror = function () {
                    // console.error('업로드 네트워크 오류');
                    alert('이미지 업로드 중 네트워크 오류가 발생했습니다.');
                    progressContainer.style.display = 'none';
                };

                xhr.send(formData);
            };
        });
        } // end if (false) — legacy upload 경로
    }

    // 카테고리 드롭다운 동적 채우기
    const categorySelect = document.getElementById('promo-editor-category');
    if (categorySelect) {
        try {
            const bRes = await fetch(CONFIG.API_BASE + '/api/boards');
            const boards = await bRes.json();
            categorySelect.innerHTML = boards.map(b =>
                `<option value="${b.id}">${b.name}</option>`
            ).join('');
        } catch (e) {
            // 게시판 로드 실패 시 캐시 사용
            if (_boardsCache.length > 0) {
                categorySelect.innerHTML = _boardsCache.map(b =>
                    `<option value="${b.id}">${b.name}</option>`
                ).join('');
            }
        }
    }

    // 수정 모드라면 기존 데이터 채우기
    document.getElementById('promo-editor-header-title').innerHTML = editData
        ? '<i class="fa-solid fa-pen-to-square"></i> 글 수정'
        : '<i class="fa-solid fa-pen-to-square"></i> 새 글 작성';
    document.getElementById('promo-editor-title').value = editData ? editData.title : '';
    document.getElementById('promo-editor-category').value = editData ? (editData.category || (_boardsCache[0] && _boardsCache[0].id) || 'PROMO') : (_boardsCache[0] && _boardsCache[0].id) || 'PROMO';
    document.getElementById('promo-editor-pinned').checked = editData ? (editData.isPinned || false) : false;
    // 댓글 허용 토글: 수정 시 기존 설정값 반영, 신규 시 기본 false
    const allowCommentsInput = document.getElementById('promo-editor-allow-comments');
    if (allowCommentsInput) {
        allowCommentsInput.checked = editData ? (editData.allowComments || false) : false;
        // 토글 슬라이더 시각적 상태 업데이트
        const slider = allowCommentsInput.nextElementSibling;
        if (slider) slider.style.background = allowCommentsInput.checked ? '#4fc3f7' : 'rgba(255,255,255,0.15)';
    }
    promoQuillEditor.root.innerHTML = editData ? editData.content : '';

    // [New] 첨부파일 초기화
    currentAttachments = editData && editData.attachments ? [...editData.attachments] : [];
    renderAttachmentList();

    // [New] 파일 선택 이벤트 핸들러 등록
    const fileInput = document.getElementById('promo-file-input');
    if (fileInput) {
        fileInput.value = ''; // 초기화
        fileInput.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFileUpload(e.target.files);
            }
        };
    }
};

window.closePromoEditor = function () {
    const modal = document.getElementById('promo-editor-modal');
    if (modal) modal.classList.add('hidden');
    const unifiedModal = document.getElementById('unified-admin-modal');
    if (unifiedModal) unifiedModal.style.display = 'flex'; // 다시 표시
    currentEditingPromoId = null;
};

// 9. 게시글 저장
window.savePromoPost = async function () {
    const title = document.getElementById('promo-editor-title').value.trim();
    const content = promoQuillEditor.root.innerHTML;

    if (!title) {
        alert('제목을 입력해주세요.');
        return;
    }
    if (!content || content === '<p><br></p>') {
        alert('내용을 입력해주세요.');
        return;
    }

    const category = document.getElementById('promo-editor-category').value;
    const isPinned = document.getElementById('promo-editor-pinned').checked;
    // 댓글 허용 여부: 에디터 팝업의 토글 체크박스 상태 읽기
    const allowCommentsEl = document.getElementById('promo-editor-allow-comments');
    const allowComments = allowCommentsEl ? allowCommentsEl.checked : false;

    const postData = {
        title: title,
        content: content,
        category: category,
        isPinned: isPinned,
        allowComments: allowComments,  // 댓글 허용 여부
        attachments: currentAttachments // [New] 첨부파일 배열
    };
    if (currentEditingPromoId) {
        postData.id = currentEditingPromoId;
    }

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData)
        });
        const result = await res.json();

        if (result.success) {
            alert(currentEditingPromoId ? '게시글이 수정되었습니다.' : '게시글이 등록되었습니다.');
            closePromoEditor();
            loadPromoPosts(); // 목록 새로고침
            // (A) 통합 관리자 게시글 관리 탭이 열려있다면 캐시 무효화 + 1페이지로 리셋
            if (window.__postMgmt && typeof window.__postMgmt.invalidateCache === 'function') {
                window.__postMgmt.invalidateCache();
            }
            if (typeof loadUnifiedPromoList === 'function') {
                // 모듈-로컬 _postMgmtPage 는 외부 접근 불가 → onchange 와 같은 패턴으로
                // 검색/필터 변경 후 호출 시점에도 page 가 1로 보정되도록 helper 의 첫 진입에서
                // 검사하지만, 명시적으로도 리셋: filter 셀렉터 변경과 동일하게 통보.
                if (window.__postMgmt && typeof window.__postMgmt.resetPage === 'function') {
                    window.__postMgmt.resetPage();
                }
                loadUnifiedPromoList();
            }
        } else {
            alert('저장 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        // console.error('저장 오류:', e);
        alert('서버 오류로 저장에 실패했습니다.');
    }
};

// 10. 게시글 수정 (에디터 열기)
window.editPromoPost = async function (postId) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        const posts = await res.json();
        const post = posts.find(p => String(p.id) === String(postId));
        if (post) {
            openPromoEditor(post);
        } else {
            alert('게시글을 찾을 수 없습니다.');
        }
    } catch (e) {
        // console.error('수정 로드 오류:', e);
    }
};

// 11. 게시글 삭제
window.deletePromoPost = async function (postId) {
    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, {
            method: 'DELETE'
        });
        const result = await res.json();

        if (result.success) {
            alert('삭제되었습니다.');
            // (A) 통합 관리자 게시글 관리 탭 캐시 무효화 후 재로드
            if (window.__postMgmt && typeof window.__postMgmt.invalidateCache === 'function') {
                window.__postMgmt.invalidateCache();
            }
            if (typeof loadUnifiedPromoList === 'function') loadUnifiedPromoList();
            loadPromoPosts();
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        // console.error('삭제 오류:', e);
        alert('서버 오류로 삭제에 실패했습니다.');
    }
};

// ============================================================================
// 리액션 기능 (❤️ 하트 / 👍 따봉 / 😮 놀람)
// ============================================================================

/**
 * 게시글 상세 모달에 리액션 버튼을 초기화하고 현재 상태를 표시한다.
 * @param {string|number} postId - 게시글 ID
 */
async function _initPromoReactions(postId) {
    const wrap = document.getElementById('promo-detail-reactions');
    if (!wrap) return;

    const deviceId = localStorage.getItem('seagnal_device_id') || '';

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reactions'
            + '?postId=' + encodeURIComponent(postId)
            + '&deviceId=' + encodeURIComponent(deviceId));
        const data = res.ok ? await res.json() : { heartCount: 0, thumbsCount: 0, wowCount: 0, myReaction: null };
        _renderReactions(wrap, postId, data);
    } catch (e) {
        _renderReactions(wrap, postId, { heartCount: 0, thumbsCount: 0, wowCount: 0, myReaction: null });
    }
}

/**
 * 게시글 하단 리액션(❤️👍😮) 버튼 영역을 렌더링.
 *
 * [입력 data]
 *   - heartCount/thumbsCount/wowCount : 각 종류별 카운트
 *   - myReaction : 사용자의 현재 리액션 ('heart'|'thumbs'|'wow'|null)
 *
 * [동작]
 *   - 각 버튼에 active 클래스로 사용자가 누른 것 강조
 *   - 클릭 시 toggleReaction(postId, type) 호출 → 서버 갱신 후 다시 _renderReactions 호출
 *
 * [연계] toggleReaction (전역) — 버튼 onclick 핸들러
 *
 * @param {HTMLElement} wrap - 리액션이 들어갈 wrapper div
 * @param {number} postId
 * @param {Object} data
 */
function _renderReactions(wrap, postId, data) {
    const { heartCount, thumbsCount, wowCount, myReaction } = data;

    const btn = (type, emoji, count) => {
        const active = myReaction === type ? ' reaction-btn-active' : '';
        return `<button class="reaction-btn${active}" onclick="toggleReaction(${postId}, '${type}')" data-type="${type}">
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">${count}</span>
        </button>`;
    };

    wrap.innerHTML = `<div class="promo-reactions">
        ${btn('heart', '❤️', heartCount)}
        ${btn('thumbs', '👍', thumbsCount)}
        ${btn('wow', '😮', wowCount)}
    </div>`;
}

window.toggleReaction = async function(postId, type) {
    const deviceId = localStorage.getItem('seagnal_device_id') || '';
    if (!deviceId) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/reactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId: String(postId), deviceId, type })
        });
        if (!res.ok) return;
        const data = await res.json();
        const wrap = document.getElementById('promo-detail-reactions');
        if (wrap) _renderReactions(wrap, postId, data);
    } catch (e) { /* 무시 */ }
};

// 12. 탭 전환 시 게시글 로드 및 관리자 인증 (15회 클릭)
document.addEventListener('DOMContentLoaded', async function () {
    // [New] 네이티브 스플래시(=검정화면) 종료 -> 웹 스플래시 시작
    if (window.hideNativeSplash) {
        // 약간의 딜레이를 주어 흰색 플래시를 완전히 방지할 수도 있음
        setTimeout(() => window.hideNativeSplash(), 100);
    }

    let unifiedAdminClickCount = 0;
    let unifiedAdminClickTimer = null;

    // [New] Capacitor 네이티브 환경 감지 (앱 접속 시 스플래시 스킵)
    const isNativeApp = window.Capacitor && window.Capacitor.isNativePlatform();

    // ── 스플래시 화면 제거 (이중 조건 방식) ──
    // 두 가지 조건이 모두 충족되어야 스플래시가 사라집니다:
    // 1) 데이터 로딩 완료 (fetchAllData 성공/실패)
    // 2) 스플래시 애니메이션 완료 (SEA:GNAL 타이틀이 완전히 나타남)
    //
    // [왜 이렇게 하는가?]
    // 데이터 로딩이 빨리 끝나면 로고/타이틀이 아직 나타나는 중에 화면이 전환되어
    // 사용자가 스플래시를 제대로 보지 못하는 문제를 방지합니다.
    // 반대로 데이터 로딩이 느리면 애니메이션은 이미 끝난 상태이므로
    // 로딩 완료 즉시 전환됩니다 (불필요한 대기 없음).
    //
    // [안전장치]
    // animationend 이벤트가 발생하지 않는 극히 드문 경우를 대비하여
    // 3초 타이머가 자동으로 애니메이션 완료 조건을 충족시킵니다.
    //
    // [연계]
    // - splash.css → .splash-title 애니메이션: fadeUp 1s ease-out 0.8s (총 1.8초)
    // - index.html → #splash-screen, .splash-title 요소

    let dataReady = false;  // fetchAllData() 완료 여부
    let animReady = false;  // 스플래시 애니메이션 완료 여부
    let splashHidden = false; // 중복 호출 방지 플래그

    // 스플래시 화면을 실제로 제거하는 함수
    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            // 앱/웹 모두 자연스러운 페이드 아웃 적용
            splash.classList.add('fade-out');
            setTimeout(() => {
                splash.remove();
                document.body.classList.remove('loading');
            }, 800); // splash.css의 transition 시간(0.8s)과 일치
        }
    };

    // 두 조건 모두 충족되었는지 확인하고, 충족되면 스플래시 제거
    const tryHideSplash = () => {
        if (dataReady && animReady && !splashHidden) {
            splashHidden = true;
            hideSplash();
        }
    };

    // 스플래시 타이틀(.splash-title) 애니메이션 완료 감지
    // .splash-title은 0.8초 딜레이 + 1초 애니메이션 = 1.8초 후 완료
    // 이것이 스플래시에서 가장 마지막으로 나타나는 요소
    const splashTitle = document.querySelector('.splash-title');
    if (splashTitle) {
        splashTitle.addEventListener('animationend', function onAnimEnd() {
            splashTitle.removeEventListener('animationend', onAnimEnd);
            animReady = true;
            tryHideSplash();
        });
    } else {
        // 스플래시 타이틀 요소가 없는 경우 (예: 점검 모드로 스플래시 숨김)
        animReady = true;
    }

    // 안전장치: 3초 후에도 animationend가 발생하지 않으면 강제 완료 처리
    // (브라우저 호환성 문제나 CSS 로드 실패 등 예외 상황 대비)
    setTimeout(() => {
        if (!animReady) {
            animReady = true;
            tryHideSplash();
        }
    }, 3000);

    // 1. 데이터 로딩 대기
    try {
        await fetchAllData();
    } catch (e) {
        // 데이터 로드 실패해도 앱은 표시해야 함
    }

    // 2. 데이터 로딩 완료 → 조건 1 충족
    dataReady = true;
    tryHideSplash();

    // [New] 푸시 알림 파라미터 확인 및 팝업 표시
    // checkForPushPopup 제거됨 (fix_popup_logic.js 이관)

    // === [New] 헤더 15회 클릭 시 통합 관리자 센터 진입 ===
    const headerContent = document.querySelector('.header-content');
    if (headerContent) {
        headerContent.addEventListener('click', function (e) {
            // 사용자 클릭만 카운트
            const isUserClick = e.detail > 0 || e.isTrusted;
            if (!isUserClick) return;

            unifiedAdminClickCount++;
            clearTimeout(unifiedAdminClickTimer);
            unifiedAdminClickTimer = setTimeout(() => { unifiedAdminClickCount = 0; }, 3000);

            // 관리자 모드: 10회 클릭으로 비밀번호 없이 진입
            const isAdminMode = localStorage.getItem('seagnal_admin_mode') === 'true';
            const threshold = isAdminMode ? 10 : 15;

            if (unifiedAdminClickCount >= threshold) {
                unifiedAdminClickCount = 0;
                if (isAdminMode) {
                    // 관리자 모드: 비밀번호 없이 바로 진입
                    adminAuthenticated.api = true;
                    adminAuthenticated.notice = true;
                    adminAuthenticated.promo = true;
                    adminAuthenticated.alert = true;
                    showUnifiedAdminModal('alert');
                } else {
                    // 일반 모드: 비밀번호 입력 필요
                    showUnifiedLoginModal('alert', '통합 관리자 인증', 'fa-user-shield');
                }
            }
        });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            // 홍보정보 탭 - 게시글 로드
            if (this.dataset.target === 'promo-section') {
                setTimeout(() => loadPromoPosts(), 100);
            }
        });
    });
});

