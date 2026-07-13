/**
 * ============================================================================
 * 파일명: js/promo_comment4.js
 * 역할: 게시글 댓글 시스템 - 답글 입력 및 관리자 전용 기능 (원문 보기)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : promo_comment1.js(isAdminMode·getCommentDeviceId·_currentCommentPostId), promo_comment5.js(refreshComments)
 *  - 서버 API      : /api/comments (답글 등록 — parentId 포함)
 *  - 마크업        : index2.html #comment-original-modal (삭제 댓글 원문 보기 팝업)
 *  - 나를 쓰는 곳  : promo_comment2.js (답글 버튼 openReplyInput, 관리자 원문보기 showOriginalComment)
 * ============================================================================
 *
 * [이 파일이 담당하는 것]
 * - 답글 입력창 열기/닫기 (일반 사용자 + 관리자 모두 사용)
 * - 답글 등록 (parentId 포함하여 서버 전송)
 * - 삭제된 댓글 원문 보기 (팝업, 관리자 전용)
 *
 * [답글 UI - 사용자]
 * ┌─────────────────────────────────┐
 * │ [파란돌고래742]  ↩ 답글          │
 * │ ┌───────────────────────────┐   │
 * │ │ 답글을 입력하세요...       │   │
 * │ └───────────────────────────┘   │
 * │ [🔒 비밀]  [취소]  [등록]       │
 * └─────────────────────────────────┘
 *
 * [답글 UI - 관리자]
 * ┌─────────────────────────────────┐
 * │ [관리자]  ↩ 답글                 │
 * │ ...동일...                       │
 * └─────────────────────────────────┘
 * ============================================================================
 */

// ============================================================================
// 관리자 답글 입력창 열기
// ============================================================================

/**
 * 특정 댓글 아래에 답글 입력창을 동적으로 생성한다.
 * 이미 답글 입력창이 열려있으면 닫고 새로 연다 (토글 방식).
 * 일반 사용자와 관리자 모두 사용 가능.
 * 입력창 상단에 자신의 닉네임 뱃지가 표시된다.
 *
 * @param {string} parentCommentId - 답글을 달 대상 댓글의 ID
 */
window.openReplyInput = function(parentCommentId) {
    // 기존에 열려있는 답글 입력창이 있으면 모두 제거
    var existingInputs = document.querySelectorAll('.comment-reply-input-wrap');
    existingInputs.forEach(function(el) { el.remove(); });

    // 대상 댓글 DOM 요소 찾기
    var targetItem = document.querySelector('[data-comment-id="' + parentCommentId + '"]');
    if (!targetItem) return;

    // 현재 사용자 정보 (관리자/일반 구분)
    var isAdmin = isAdminMode();
    var myNickname = isAdmin ? '관리자' : getOrCreateNickname();
    var badgeStyle = isAdmin
        ? 'background:linear-gradient(135deg,#4fc3f7,#0277BD);color:#fff;'
        : 'background:linear-gradient(135deg,#80cbc4,#00695c);color:#fff;';

    // 답글 입력창 HTML 생성 (닉네임 뱃지는 사용자/관리자에 따라 다르게 표시)
    var replyInputHtml = '<div class="comment-reply-input-wrap" id="reply-input-' + parentCommentId + '">'
        + '<div class="comment-input-header">'
        + '<span class="comment-nickname-badge" style="' + badgeStyle + '">' + escapeCommentHtml(myNickname) + '</span>'
        + '<span style="font-size:0.75rem;color:#64748b;margin-left:8px;">↩ 답글</span>'
        + '</div>'
        + '<textarea class="comment-textarea" id="reply-textarea-' + parentCommentId + '" '
        + 'placeholder="답글을 입력하세요... (최대 500자)" maxlength="500" rows="2"></textarea>'
        + '<div class="comment-input-footer">'
        + '<label class="comment-secret-label">'
        + '<input type="checkbox" id="reply-secret-' + parentCommentId + '"> '
        + '<i class="fa-solid fa-lock" style="color:#f59e0b;margin-right:3px;"></i>비밀'
        + '</label>'
        + '<div style="display:flex;gap:6px;">'
        + '<button class="comment-edit-cancel-btn" onclick="closeReplyInput(\'' + parentCommentId + '\')">'
        + '취소</button>'
        + '<button class="comment-submit-btn" onclick="submitReply(\'' + parentCommentId + '\')">'
        + '<i class="fa-solid fa-paper-plane"></i> 등록</button>'
        + '</div>'
        + '</div>'
        + '</div>';

    // 대상 댓글 뒤에 입력창 삽입
    targetItem.insertAdjacentHTML('afterend', replyInputHtml);

    // 자동 포커스
    var replyTextarea = document.getElementById('reply-textarea-' + parentCommentId);
    if (replyTextarea) replyTextarea.focus();
};

/**
 * 답글 입력창을 닫고 제거한다.
 * @param {string} parentCommentId - 닫을 답글 입력창의 부모 댓글 ID
 */
window.closeReplyInput = function(parentCommentId) {
    var inputWrap = document.getElementById('reply-input-' + parentCommentId);
    if (inputWrap) inputWrap.remove();
};

// ============================================================================
// 관리자 답글 등록
// ============================================================================

/**
 * 답글 입력창의 내용을 읽어 서버에 답글을 등록한다.
 * parentId에 대상 댓글의 ID를 포함하여 전송한다.
 * 일반 사용자와 관리자 모두 사용 가능.
 * 등록 성공 시 댓글 목록을 새로고침한다.
 *
 * @param {string} parentCommentId - 답글 대상 댓글 ID
 */
window.submitReply = async function(parentCommentId) {
    var replyTextarea = document.getElementById('reply-textarea-' + parentCommentId);
    if (!replyTextarea) return;

    var content = replyTextarea.value.trim();
    if (!content) {
        alert('답글 내용을 입력해주세요.');
        return;
    }

    var isAdmin = isAdminMode();
    var secretCheck = document.getElementById('reply-secret-' + parentCommentId);
    var isSecret = secretCheck ? secretCheck.checked : false;

    var payload = {
        postId: String(_currentCommentPostId),
        parentId: parentCommentId,  // 답글임을 나타내는 부모 댓글 ID
        authorType: isAdmin ? 'admin' : 'user',
        deviceId: getCommentDeviceId(),
        nickname: isAdmin ? '관리자' : getOrCreateNickname(),  // 사용자면 해양 닉네임, 관리자면 "관리자"
        content: content,
        isSecret: isSecret
    };

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var result = await res.json();
        if (result.success) {
            closeReplyInput(parentCommentId);
            await refreshComments();
        } else {
            alert('답글 등록 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('답글 등록 중 오류가 발생했습니다.');
    }
};

// ============================================================================
// 삭제된 댓글 원문 보기 (관리자 전용)
// ============================================================================

/**
 * 삭제된 댓글의 원문을 팝업으로 표시한다.
 * 서버에서 admin=true로 다시 조회하여 originalContent를 가져온다.
 * 관리자만 [원문 보기] 버튼을 볼 수 있으므로 관리자만 실행 가능.
 *
 * @param {string} commentId - 원문을 볼 댓글 ID
 */
window.viewOriginalComment = async function(commentId) {
    try {
        // 관리자 모드로 댓글 목록 재조회 (originalContent 포함)
        var res = await fetch(
            CONFIG.API_BASE + '/api/comments'
            + '?postId=' + encodeURIComponent(_currentCommentPostId)
            + '&admin=true'
            + '&deviceId=' + encodeURIComponent(getCommentDeviceId())
        );
        var comments = await res.json();
        var comment = comments.find(function(c) { return c.id === commentId; });

        if (!comment) {
            alert('댓글 정보를 찾을 수 없습니다.');
            return;
        }

        var originalText = comment.originalContent || '(원문 없음)';
        var deletedByText = comment.deletedBy === 'user' ? '사용자가 삭제' : '관리자가 삭제';
        var editedText = comment.isEdited ? ' (수정 후 삭제됨)' : '';

        // 간단한 모달 팝업으로 원문 표시
        showCommentOriginalModal(
            comment.nickname,
            originalText,
            deletedByText + editedText,
            comment.createdAt
        );
    } catch (e) {
        alert('원문을 불러오는 중 오류가 발생했습니다.');
    }
};

/**
 * 삭제된 댓글의 원문을 표시하는 모달 팝업을 생성하여 화면에 띄운다.
 *
 * @param {string} nickname - 댓글 작성자 닉네임
 * @param {string} originalContent - 삭제 전 원문 내용
 * @param {string} deletedByText - "사용자가 삭제" 또는 "관리자가 삭제"
 * @param {string} createdAt - 댓글 작성 시각
 */
function showCommentOriginalModal(nickname, originalContent, deletedByText, createdAt) {
    // 기존 모달 제거
    var existing = document.getElementById('comment-original-modal');
    if (existing) existing.remove();

    var modalHtml = '<div id="comment-original-modal" '
        + 'style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);'
        + 'display:flex;align-items:center;justify-content:center;z-index:99999;">'
        + '<div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;'
        + 'padding:20px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
        + '<div style="font-size:0.85rem;color:#94a3b8;">'
        + '<span style="background:linear-gradient(135deg,#80cbc4,#00695c);color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;">'
        + escapeCommentHtml(nickname) + '</span>'
        + '<span style="margin-left:8px;">' + formatCommentDate(createdAt) + '</span>'
        + '</div>'
        + '<button onclick="document.getElementById(\'comment-original-modal\').remove()" '
        + 'style="background:none;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>'
        + '</div>'
        + '<div style="font-size:0.75rem;color:#f59e0b;margin-bottom:10px;">'
        + '<i class="fa-solid fa-triangle-exclamation"></i> ' + escapeCommentHtml(deletedByText)
        + '</div>'
        + '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;'
        + 'font-size:0.9rem;color:#e2e8f0;line-height:1.6;white-space:pre-wrap;word-break:break-all;">'
        + escapeCommentHtml(originalContent)
        + '</div>'
        + '<div style="text-align:right;margin-top:12px;">'
        + '<button onclick="document.getElementById(\'comment-original-modal\').remove()" '
        + 'style="padding:6px 16px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);'
        + 'border-radius:6px;color:#e2e8f0;cursor:pointer;font-size:0.85rem;">닫기</button>'
        + '</div>'
        + '</div>'
        + '</div>';

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
