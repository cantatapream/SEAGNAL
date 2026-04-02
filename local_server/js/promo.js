/**
 * ============================================================================
 * 파일명: js/promo.js
 * 역할: 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집)
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
        // 게시판 목록과 게시글을 병렬 로드
        const [promoRes, boardsRes] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/promo'),
            fetch(CONFIG.API_BASE + '/api/boards')
        ]);
        if (!promoRes.ok) throw new Error('API 오류');
        const posts = await promoRes.json();
        const boards = await boardsRes.json();

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
            mainTabBtn.appendChild(badge);
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

        return `
        <div class="promo-item ${isPinnedClass}" onclick="openPromoDetail(${post.id})">
            <div class="promo-item-title">
                ${badgeHtml}
                ${pinIcon}
                ${escapeHtml(post.title)}${newBadgeHtml}
            </div>
            <div class="promo-item-meta">
                <span class="promo-item-date">${formatPromoDate(post.createdAt)}</span>
                <span class="promo-item-views"><i class="fa-regular fa-eye"></i> ${post.views || 0}</span>
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
// Legacy openPromoAdminPanel removed. Using showPromoManagementModal instead.

// 8. 새 글 작성 에디터 열기
window.openPromoEditor = async function (editData = null) {
    // 기존 모달 닫기
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.add('hidden');
    const promoMgmtModal = document.getElementById('promo-management-modal');
    if (promoMgmtModal) promoMgmtModal.remove();
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

        // 이미지 업로드 핸들러 (서버로 업로드)
        promoQuillEditor.getModule('toolbar').addHandler('image', function () {
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

    const postData = {
        title: title,
        content: content,
        category: category,
        isPinned: isPinned,
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
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
            if (typeof loadUnifiedPromoList === 'function') loadUnifiedPromoList();
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
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        // console.error('삭제 오류:', e);
        alert('서버 오류로 삭제에 실패했습니다.');
    }
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

    // 스플래시 화면 제거 함수
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

    // 1. 데이터 로딩 대기
    try {
        await fetchAllData();
    } catch (e) {
        // console.error('Initial data fetch failed:', e);
    }

    // 2. 스플래시 종료 — 최소 대기 없이 데이터 로드 완료 즉시 종료
    hideSplash();

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

