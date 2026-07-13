/**
 * ============================================================================
 * 파일명: js/promo_comment3.js
 * 역할: 게시글 댓글 시스템 - 댓글 등록/수정/삭제 (사용자 액션)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : promo_comment1.js(isAdminMode·getCommentDeviceId·_currentCommentPostId), promo_comment5.js(refreshComments)
 *  - 서버 API      : /api/comments, /api/comments/* (등록·수정·삭제), /api/comment-reports (신고)
 *  - 마크업        : index2.html #comment-input-textarea, #comment-char-count, #comment-secret-check, #comment-report-modal
 *  - 나를 쓰는 곳  : promo_comment5.js(renderCommentInput 호출), promo_comment2.js(수정/삭제 버튼)
 * ============================================================================
 *
 * [이 파일이 담당하는 것]
 * - 댓글 입력창 렌더링 (일반 사용자용)
 * - 댓글 등록 API 호출 및 화면 갱신
 * - 댓글 수정 인라인 UI 및 저장
 * - 댓글 삭제 확인 및 soft delete API 호출
 * - 비밀 댓글 체크박스 UI 포함
 *
 * [UI - 댓글 입력창]
 * ┌─────────────────────────────────────────┐
 * │ [파란돌고래742]                          │  ← 내 닉네임 뱃지 표시
 * │ ┌─────────────────────────────────────┐ │
 * │ │ 댓글을 입력하세요... (최대 500자)    │ │
 * │ └─────────────────────────────────────┘ │
 * │ [🔒 비밀 댓글]              [등록]      │
 * └─────────────────────────────────────────┘
 * ============================================================================
 */

// ============================================================================
// 댓글 입력창 렌더링
// ============================================================================

/**
 * 게시글 댓글 섹션 하단에 댓글 입력 UI를 그린다.
 * 댓글 허용 여부에 따라 입력창을 보여주거나 "댓글 기능이 비활성화" 안내를 표시.
 *
 * @param {HTMLElement} inputWrapEl - 입력창을 담을 DOM 요소
 * @param {boolean} allowComments - 댓글 허용 여부
 */
function renderCommentInput(inputWrapEl, allowComments) {
    if (!inputWrapEl) return;
    var isAdmin = isAdminMode();

    if (!allowComments && !isAdmin) {
        // 일반 사용자에게는 입력창 자체를 숨김 (댓글 비활성화)
        inputWrapEl.innerHTML = '';
        return;
    }

    var myNickname = isAdmin ? '관리자' : getOrCreateNickname();
    var badgeStyle = isAdmin
        ? 'background:linear-gradient(135deg,#4fc3f7,#0277BD);color:#fff;'
        : 'background:linear-gradient(135deg,#80cbc4,#00695c);color:#fff;';

    // 관리자이지만 댓글 비활성화 상태인 경우 안내 표시
    var disabledNotice = (!allowComments && isAdmin)
        ? '<div class="comment-disabled-notice"><i class="fa-solid fa-ban"></i> 댓글 기능이 비활성화된 게시글입니다. (관리자는 댓글 확인 가능)</div>'
        : '';

    inputWrapEl.innerHTML = disabledNotice
        + '<div class="comment-input-wrap">'
        + '<div class="comment-input-header">'
        + '<span class="comment-nickname-badge" style="' + badgeStyle + '">' + escapeCommentHtml(myNickname) + '</span>'
        + '</div>'
        + '<textarea id="comment-input-textarea" class="comment-textarea" '
        + 'placeholder="댓글을 입력하세요... (최대 500자)" maxlength="500" rows="3"'
        + ((!allowComments && isAdmin) ? ' disabled' : '')
        + '></textarea>'
        + '<div class="comment-input-footer">'
        // 비밀 댓글 체크박스
        + '<label class="comment-secret-label">'
        + '<input type="checkbox" id="comment-secret-check"> '
        + '<i class="fa-solid fa-lock" style="color:#f59e0b;margin-right:3px;"></i>비밀 댓글'
        + '</label>'
        + '<div style="display:flex;gap:6px;">'
        + '<span id="comment-char-count" class="comment-char-count">0/500</span>'
        + '<button class="comment-submit-btn" onclick="submitComment()" '
        + ((!allowComments && isAdmin) ? 'disabled' : '')
        + '><i class="fa-solid fa-paper-plane"></i> 등록</button>'
        + '</div>'
        + '</div>'
        + '</div>';

    // 글자 수 카운터 이벤트 등록
    var textarea = document.getElementById('comment-input-textarea');
    var charCount = document.getElementById('comment-char-count');
    if (textarea && charCount) {
        textarea.addEventListener('input', function() {
            charCount.textContent = textarea.value.length + '/500';
        });
    }
}

// ============================================================================
// 댓글 등록
// ============================================================================

/**
 * 입력창의 내용을 읽어 서버에 댓글을 등록한다.
 * 등록 성공 시 댓글 목록을 새로고침한다.
 *
 * 이 함수는 "등록" 버튼 클릭 시 호출된다.
 */
window.submitComment = async function() {
    var textarea = document.getElementById('comment-input-textarea');
    if (!textarea) return;

    var content = textarea.value.trim();
    if (!content) {
        alert('댓글 내용을 입력해주세요.');
        return;
    }

    var isAdmin = isAdminMode();
    var isSecretCheck = document.getElementById('comment-secret-check');
    var isSecret = isSecretCheck ? isSecretCheck.checked : false;

    var payload = {
        postId: String(_currentCommentPostId),
        parentId: null, // 최상위 댓글
        authorType: isAdmin ? 'admin' : 'user',
        deviceId: getCommentDeviceId(),
        nickname: isAdmin ? '관리자' : getOrCreateNickname(),
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
            textarea.value = ''; // 입력창 초기화
            var charCount = document.getElementById('comment-char-count');
            if (charCount) charCount.textContent = '0/500';
            if (isSecretCheck) isSecretCheck.checked = false;
            // 댓글 목록 새로고침
            await refreshComments();
        } else {
            alert('댓글 등록 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('댓글 등록 중 오류가 발생했습니다.');
    }
};

// ============================================================================
// 댓글 수정
// ============================================================================

/**
 * 특정 댓글의 내용을 인라인 편집 모드로 전환한다.
 * 기존 내용이 textarea로 교체되어 직접 수정할 수 있다.
 *
 * @param {string} commentId - 수정할 댓글의 ID
 */
window.openCommentEdit = function(commentId) {
    var comment = _commentsList.find(function(c) { return c.id === commentId; });
    if (!comment) return;

    var itemEl = document.querySelector('[data-comment-id="' + commentId + '"]');
    if (!itemEl) return;

    var bodyEl = itemEl.querySelector('.comment-body');
    if (!bodyEl) return;

    // 기존 내용을 textarea로 교체
    var originalContent = comment.content;
    bodyEl.innerHTML = '<div class="comment-edit-wrap">'
        + '<textarea class="comment-edit-textarea" maxlength="500" rows="3">'
        + escapeCommentHtml(originalContent)
        + '</textarea>'
        + '<div class="comment-edit-footer">'
        + '<button class="comment-edit-cancel-btn" onclick="cancelCommentEdit(\'' + commentId + '\')">'
        + '취소</button>'
        + '<button class="comment-edit-save-btn" onclick="saveCommentEdit(\'' + commentId + '\')">'
        + '<i class="fa-solid fa-check"></i> 저장</button>'
        + '</div>'
        + '</div>';

    // textarea에 기존 내용 설정 (HTML 엔티티 해제)
    var editTextarea = bodyEl.querySelector('.comment-edit-textarea');
    if (editTextarea) editTextarea.value = originalContent;
};

/**
 * 댓글 수정을 취소하고 원래 화면으로 되돌린다.
 * @param {string} commentId - 수정 취소할 댓글 ID
 */
window.cancelCommentEdit = async function(commentId) {
    // 목록 재렌더링으로 원래 상태 복구
    await refreshComments();
};

/**
 * 수정된 내용을 서버에 저장한다.
 * 저장 성공 시 댓글 목록을 새로고침한다.
 *
 * @param {string} commentId - 저장할 댓글 ID
 */
window.saveCommentEdit = async function(commentId) {
    var itemEl = document.querySelector('[data-comment-id="' + commentId + '"]');
    if (!itemEl) return;

    var editTextarea = itemEl.querySelector('.comment-edit-textarea');
    if (!editTextarea) return;

    var newContent = editTextarea.value.trim();
    if (!newContent) {
        alert('수정할 내용을 입력해주세요.');
        return;
    }

    var isAdmin = isAdminMode();

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/comments/' + commentId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: newContent,
                deviceId: getCommentDeviceId(),
                isAdmin: isAdmin
            })
        });
        var result = await res.json();
        if (result.success) {
            await refreshComments();
        } else {
            alert('수정 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('수정 중 오류가 발생했습니다.');
    }
};

// ============================================================================
// 댓글 삭제
// ============================================================================

// ============================================================================
// 댓글 영구 삭제 (관리자 전용)
// ============================================================================

/**
 * soft-delete된 댓글을 완전히 제거한다. 관리자만 호출 가능.
 * 해당 댓글과 그 답글이 목록에서 완전히 사라진다.
 *
 * @param {string} commentId - 영구 삭제할 댓글 ID
 */
window.permanentDeleteComment = async function(commentId) {
    if (!confirm('이 댓글을 영구적으로 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.')) return;

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/comments/' + commentId + '/permanent', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isAdmin: true })
        });
        var result = await res.json();
        if (result.success) {
            await refreshComments();
        } else {
            alert('영구 삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('영구 삭제 중 오류가 발생했습니다.');
    }
};

// ============================================================================
// 댓글 신고
// ============================================================================

/**
 * 댓글 신고 팝업을 띄운다.
 * @param {string} commentId - 신고할 댓글 ID
 */
window.openCommentReport = function(commentId) {
    var comment = _commentsList.find(function(c) { return c.id === commentId; });
    if (!comment) return;

    // 기존 팝업 제거
    var existing = document.getElementById('comment-report-modal');
    if (existing) existing.remove();

    var reasons = ['욕설/비방', '허위정보/안전위협', '스팸/도배', '정치적 내용', '저작권 침해', '개인정보 노출', '기타'];

    var reasonOptions = reasons.map(function(r) {
        return '<label class="comment-report-reason-label">'
            + '<input type="radio" name="report-reason" value="' + r + '"> ' + r
            + '</label>';
    }).join('');

    var modalHtml = '<div id="comment-report-modal" '
        + 'style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);'
        + 'display:flex;align-items:center;justify-content:center;z-index:99999;">'
        + '<div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;'
        + 'padding:20px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'
        + '<h4 style="margin:0;color:#e2e8f0;font-size:0.95rem;"><i class="fa-solid fa-flag" style="color:#f87171;margin-right:6px;"></i>댓글 신고</h4>'
        + '<button onclick="document.getElementById(\'comment-report-modal\').remove()" '
        + 'style="background:none;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>'
        + '</div>'
        + '<div style="font-size:0.75rem;color:#94a3b8;margin-bottom:12px;">신고 사유를 선택해주세요.</div>'
        + '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">'
        + reasonOptions
        + '</div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
        + '<button onclick="document.getElementById(\'comment-report-modal\').remove()" '
        + 'style="padding:6px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);'
        + 'border-radius:6px;color:#94a3b8;cursor:pointer;font-size:0.82rem;">취소</button>'
        + '<button onclick="submitCommentReport(\'' + commentId + '\')" '
        + 'style="padding:6px 14px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);'
        + 'border-radius:6px;color:#f87171;cursor:pointer;font-size:0.82rem;font-weight:600;">'
        + '<i class="fa-solid fa-flag"></i> 신고</button>'
        + '</div>'
        + '</div>'
        + '</div>';

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

/**
 * 선택한 사유로 댓글 신고를 서버에 전송한다.
 * @param {string} commentId - 신고 댓글 ID
 */
window.submitCommentReport = async function(commentId) {
    var selected = document.querySelector('input[name="report-reason"]:checked');
    if (!selected) {
        alert('신고 사유를 선택해주세요.');
        return;
    }

    var comment = _commentsList.find(function(c) { return c.id === commentId; });
    var reason = selected.value;

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/comment-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commentId: commentId,
                postId: String(_currentCommentPostId),
                reason: reason,
                reporterDeviceId: getCommentDeviceId(),
                commentNickname: comment ? comment.nickname : '',
                commentContent: comment ? comment.content : ''
            })
        });
        var result = await res.json();
        if (result.success) {
            document.getElementById('comment-report-modal').remove();
            alert('신고가 접수되었습니다. 검토 후 조치하겠습니다.');
        } else {
            alert(result.error || '신고 처리 중 오류가 발생했습니다.');
        }
    } catch (e) {
        alert('신고 중 오류가 발생했습니다.');
    }
};

/**
 * 댓글 삭제를 확인 후 서버에 soft delete 요청을 보낸다.
 * 삭제 후 화면에서는 "삭제된 댓글입니다." 또는 "사용자가 삭제한 댓글입니다."로 표시.
 *
 * @param {string} commentId - 삭제할 댓글 ID
 */
window.deleteComment = async function(commentId) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;

    var isAdmin = isAdminMode();
    var deletedBy = isAdmin ? 'admin' : 'user';

    try {
        var res = await fetch(CONFIG.API_BASE + '/api/comments/' + commentId, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: getCommentDeviceId(),
                isAdmin: isAdmin,
                deletedBy: deletedBy
            })
        });
        var result = await res.json();
        if (result.success) {
            await refreshComments();
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('삭제 중 오류가 발생했습니다.');
    }
};
