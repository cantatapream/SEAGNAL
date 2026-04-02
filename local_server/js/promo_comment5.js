/**
 * ============================================================================
 * 파일명: js/promo_comment5.js
 * 역할: 게시글 댓글 시스템 - 댓글 섹션 초기화 진입점 및 새로고침
 * ============================================================================
 *
 * [이 파일이 담당하는 것]
 * - loadPromoComments(): 게시글 상세 보기 시 댓글 섹션 전체 초기화
 *   promo.js의 openPromoDetail()에서 이 함수를 호출함
 * - refreshComments(): 댓글 등록/수정/삭제 후 목록만 새로고침
 * - 토글 슬라이더 인터랙션 (댓글 허용 에디터 토글)
 *
 * [전체 댓글 섹션 구조 (텍스트 설명)]
 * ┌─────────────────────────────────────┐
 * │ 💬 댓글 3개                         │  ← 헤더 (댓글 수 표시)
 * ├─────────────────────────────────────┤
 * │ [댓글 목록 영역]                    │  ← promo_comment2.js 렌더링
 * ├─────────────────────────────────────┤
 * │ [댓글 입력창]  [등록]               │  ← promo_comment3.js 렌더링
 * └─────────────────────────────────────┘
 * ============================================================================
 */

// ============================================================================
// 댓글 섹션 초기화 (외부 진입점)
// ============================================================================

/**
 * 게시글 상세 화면을 열 때 댓글 섹션 전체를 초기화하고 표시한다.
 * promo.js의 openPromoDetail()에서 게시글 로드 후 호출한다.
 *
 * 처리 순서:
 * 1. 전역 상태 변수 업데이트 (postId, allowComments)
 * 2. 댓글 섹션 골격 HTML 생성
 * 3. 서버에서 댓글 목록 로드
 * 4. 댓글 목록 렌더링
 * 5. 댓글 입력창 렌더링
 *
 * @param {string|number} postId - 게시글 ID
 * @param {boolean} allowComments - 해당 게시글의 댓글 허용 여부
 */
async function loadPromoComments(postId, allowComments) {
    // 전역 상태 업데이트
    _currentCommentPostId = postId;
    _currentAllowComments = allowComments;

    var container = document.getElementById('promo-detail-comments');
    if (!container) return;

    var isAdmin = isAdminMode();

    // 댓글 기능이 꺼져있고 일반 사용자인 경우: 섹션 자체를 숨김
    if (!allowComments && !isAdmin) {
        container.innerHTML = '';
        return;
    }

    // 댓글 섹션 골격 생성
    container.innerHTML = '<div class="comment-section">'
        + '<div class="comment-section-header">'
        + '<i class="fa-solid fa-comment-dots"></i> <span id="comment-count-label">댓글 로딩 중...</span>'
        + '</div>'
        // ── 댓글 가이드라인 (접이식)
        + '<div class="comment-guideline-wrap" id="comment-guideline-wrap">'
        + '<button class="comment-guideline-toggle" onclick="toggleCommentGuideline()">'
        + '<i class="fa-solid fa-circle-info"></i> 댓글 작성 가이드라인'
        + '<i class="fa-solid fa-chevron-down comment-guideline-arrow" id="comment-guideline-arrow"></i>'
        + '</button>'
        + '<div class="comment-guideline-body" id="comment-guideline-body">'
        + '<ul class="comment-guideline-list">'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>욕설/비방</b>: 타인을 모욕하거나 비하하는 표현</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>허위정보·안전위협</b>: 사실과 다른 해양 안전 정보 유포</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>스팸·도배</b>: 동일 또는 무의미한 내용의 반복 게시</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>정치·종교</b>: 분열을 조장하는 정치적·종교적 내용</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>저작권 침해</b>: 타인의 저작물 무단 게시</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>타 서비스 비방</b>: 경쟁 앱·서비스 비하 또는 광고</li>'
        + '<li><i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <b>개인정보</b>: 본인 또는 타인의 개인정보 포함 내용</li>'
        + '</ul>'
        + '<div class="comment-guideline-notice">위반 댓글은 사전 통보 없이 삭제되며 서비스 이용이 제한될 수 있습니다.</div>'
        + '</div>'
        + '</div>'
        + '<div id="comment-list-area" class="comment-list-area">'
        + '<div class="comment-loading"><i class="fa-solid fa-circle-notch fa-spin"></i></div>'
        + '</div>'
        + '<div id="comment-input-area"></div>'
        + '</div>';

    // 서버에서 댓글 목록 로드
    await _fetchAndRenderComments(postId, allowComments);
}

// ============================================================================
// 댓글 새로고침 (내부 액션 후 재로드)
// ============================================================================

/**
 * 댓글 등록/수정/삭제 후 목록만 새로고침한다.
 * 섹션 골격은 유지하고 목록과 입력창만 다시 그린다.
 */
async function refreshComments() {
    if (!_currentCommentPostId) return;
    await _fetchAndRenderComments(_currentCommentPostId, _currentAllowComments);
}

// ============================================================================
// 내부: 서버 조회 및 렌더링
// ============================================================================

/**
 * 서버에서 댓글 목록을 조회하고 화면에 렌더링한다.
 * loadPromoComments()와 refreshComments() 모두 이 함수를 통해 처리된다.
 *
 * @param {string|number} postId - 게시글 ID
 * @param {boolean} allowComments - 댓글 허용 여부
 */
async function _fetchAndRenderComments(postId, allowComments) {
    var listEl = document.getElementById('comment-list-area');
    var inputEl = document.getElementById('comment-input-area');
    var countLabel = document.getElementById('comment-count-label');
    var isAdmin = isAdminMode();
    var myDeviceId = getCommentDeviceId();

    try {
        // 서버에서 댓글 조회
        // - 관리자: admin=true 로 요청 → originalContent, 비밀댓글 원문 포함
        // - 일반: deviceId 포함 → 본인 비밀 댓글 내용 열람 가능
        var url = CONFIG.API_BASE + '/api/comments'
            + '?postId=' + encodeURIComponent(postId)
            + '&deviceId=' + encodeURIComponent(myDeviceId)
            + (isAdmin ? '&admin=true' : '');

        var res = await fetch(url);
        if (!res.ok) throw new Error('댓글 로드 실패');
        _commentsList = await res.json();

        // 댓글 수 표시 (삭제된 댓글도 포함하여 전체 수 표시)
        if (countLabel) {
            var visibleCount = _commentsList.length;
            countLabel.textContent = '댓글 ' + visibleCount + '개';
        }

        // 댓글 목록 렌더링 (promo_comment2.js)
        renderCommentList(listEl);

        // 댓글 입력창 렌더링 (promo_comment3.js)
        renderCommentInput(inputEl, allowComments);

    } catch (e) {
        if (listEl) {
            listEl.innerHTML = '<div class="comment-empty" style="color:#ef5350;">'
                + '<i class="fa-solid fa-triangle-exclamation"></i> 댓글을 불러올 수 없습니다.'
                + '</div>';
        }
    }
}

// ============================================================================
// 에디터 댓글 허용 토글 슬라이더 인터랙션
// ============================================================================

/**
 * 게시글 에디터 팝업의 "댓글 허용" 토글을 클릭할 때
 * 시각적으로 ON/OFF 색상을 변경한다.
 * 이 이벤트 리스너는 DOM이 준비된 후 에디터 모달이 생성될 때마다 등록된다.
 * promo.js의 openPromoEditor()에서 에디터 모달 생성 직후 호출한다.
 */
function initCommentToggleListener() {
    var checkbox = document.getElementById('promo-editor-allow-comments');
    if (!checkbox) return;

    var slider = checkbox.nextElementSibling;
    if (!slider) return;

    // 현재 상태에 맞는 색상 초기 설정
    slider.style.background = checkbox.checked ? '#4fc3f7' : 'rgba(255,255,255,0.15)';

    checkbox.addEventListener('change', function() {
        slider.style.background = checkbox.checked ? '#4fc3f7' : 'rgba(255,255,255,0.15)';
    });
}

// promo.js가 에디터 모달을 동적으로 생성한 뒤 토글 리스너를 등록할 수 있도록
// window에 노출
window.initCommentToggleListener = initCommentToggleListener;

// loadPromoComments를 전역에서 접근할 수 있도록 노출
// (promo.js의 openPromoDetail()에서 typeof loadPromoComments 체크 후 호출)
window.loadPromoComments = loadPromoComments;

// ============================================================================
// 댓글 가이드라인 토글
// ============================================================================

/**
 * 댓글 가이드라인 접이식 패널 열기/닫기
 */
window.toggleCommentGuideline = function() {
    var body = document.getElementById('comment-guideline-body');
    var arrow = document.getElementById('comment-guideline-arrow');
    if (!body) return;

    var isOpen = body.classList.contains('open');
    if (isOpen) {
        body.classList.remove('open');
        if (arrow) arrow.style.transform = '';
    } else {
        body.classList.add('open');
        if (arrow) arrow.style.transform = 'rotate(180deg)';
    }
};
