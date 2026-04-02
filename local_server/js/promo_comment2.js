/**
 * ============================================================================
 * 파일명: js/promo_comment2.js
 * 역할: 게시글 댓글 시스템 - 댓글 렌더링 (화면 표시)
 * ============================================================================
 *
 * [이 파일이 담당하는 것]
 * - 댓글 목록 전체를 화면에 그리는 로직
 * - 최상위 댓글과 답글(들여쓰기)의 계층 구조 표시
 * - 닉네임 뱃지, 수정됨 표시, 비밀 댓글 자물쇠 아이콘
 * - 삭제된 댓글: "사용자가 삭제한 댓글입니다." / "삭제된 댓글입니다."
 * - 관리자에게만 [원문 보기] 버튼 표시
 * - 수정/삭제 버튼 (본인 댓글 또는 관리자)
 * - 관리자에게만 [답글 달기] 버튼 표시
 *
 * [UI 구조 (텍스트 설명)]
 * ┌──────────────────────────────────┐
 * │ [파란돌고래742]  04.02 14:30 ✏️🗑️│  ← 최상위 댓글
 * │ 댓글 내용 텍스트                 │
 * │                       [수정됨]   │  ← 수정 시만 표시
 * │  ┌────────────────────────────┐  │
 * │  │ [관리자] 04.02 15:00 ✏️🗑️  │  │  ← 들여쓰기 답글
 * │  │ 답글 내용                  │  │
 * │  │              [답글 달기]   │  │  ← 관리자만 보임
 * │  └────────────────────────────┘  │
 * └──────────────────────────────────┘
 * ┌──────────────────────────────────┐
 * │ [붉은오징어123] 🔒 04.02 16:00  │  ← 비밀 댓글
 * │ 비밀 댓글입니다.                  │
 * └──────────────────────────────────┘
 * ============================================================================
 */

// ============================================================================
// 댓글 목록 렌더링 진입점
// ============================================================================

/**
 * 서버에서 받아온 댓글 배열(_commentsList)을 화면에 그린다.
 * 최상위 댓글과 그 아래 달린 답글을 계층 구조로 표시한다.
 *
 * 렌더링 순서:
 * 1. 최상위 댓글(parentId=null)만 골라냄
 * 2. 각 최상위 댓글을 렌더링
 * 3. 해당 댓글의 답글(parentId=해당 댓글 id)도 들여쓰기로 렌더링
 *
 * @param {HTMLElement} listEl - 댓글 목록을 담을 DOM 요소
 */
function renderCommentList(listEl) {
    if (!listEl) return;

    var myDeviceId = getCommentDeviceId();
    var isAdmin = isAdminMode();

    // 최상위 댓글만 추출 (parentId가 null인 것)
    var topLevelComments = _commentsList.filter(function(c) {
        return !c.parentId;
    });

    if (topLevelComments.length === 0) {
        listEl.innerHTML = '<div class="comment-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</div>';
        return;
    }

    var html = '';
    topLevelComments.forEach(function(comment) {
        // 최상위 댓글 HTML 생성
        html += renderCommentItem(comment, myDeviceId, isAdmin, false);

        // 이 댓글의 답글 목록 (parentId = 해당 댓글 id인 것들, 시간순)
        var replies = _commentsList.filter(function(c) {
            return c.parentId === comment.id;
        });
        if (replies.length > 0) {
            html += '<div class="comment-replies">';
            replies.forEach(function(reply) {
                html += renderCommentItem(reply, myDeviceId, isAdmin, true);
            });
            html += '</div>';
        }

        // 모든 사용자가 최상위 댓글에 답글 달 수 있음 (삭제된 댓글 제외)
        if (!comment.isDeleted) {
            html += '<div class="comment-reply-btn-wrap">'
                + '<button class="comment-reply-btn" onclick="openReplyInput(\'' + comment.id + '\')">'
                + '<i class="fa-solid fa-reply"></i> 답글 달기</button></div>';
        }
    });

    listEl.innerHTML = html;
}

// ============================================================================
// 개별 댓글 아이템 HTML 생성
// ============================================================================

/**
 * 댓글 하나의 HTML 문자열을 생성하여 반환한다.
 *
 * [표시 규칙]
 * - 삭제된 댓글: 내용 대신 안내 문구 표시, 관리자는 [원문 보기] 버튼 추가
 * - 비밀 댓글(__SECRET__): 본인/관리자 외에는 "비밀 댓글입니다." 표시
 * - 수정된 댓글: 내용 오른쪽에 작은 "수정됨" 뱃지
 * - 본인 댓글 또는 관리자: 수정(✏️)/삭제(🗑️) 버튼 표시
 *
 * @param {Object} comment - 댓글 데이터 객체
 * @param {string} myDeviceId - 현재 사용자의 기기 ID
 * @param {boolean} isAdmin - 관리자 여부
 * @param {boolean} isReply - 답글 여부 (들여쓰기 클래스 적용)
 * @returns {string} HTML 문자열
 */
function renderCommentItem(comment, myDeviceId, isAdmin, isReply) {
    var isMine = (comment.deviceId === myDeviceId); // 내가 쓴 댓글인지
    var isAdminComment = (comment.authorType === 'admin');
    var itemClass = isReply ? 'comment-item comment-item-reply' : 'comment-item';

    // ── 뱃지 색상: 관리자=파란계열, 사용자=기본 청록
    var badgeStyle = isAdminComment
        ? 'background:linear-gradient(135deg,#4fc3f7,#0277BD);color:#fff;'
        : 'background:linear-gradient(135deg,#80cbc4,#00695c);color:#fff;';

    // ── 비밀 댓글 아이콘 (🔒)
    var secretIcon = comment.isSecret
        ? '<i class="fa-solid fa-lock" style="font-size:0.7rem;color:#f59e0b;margin-left:4px;" title="비밀 댓글"></i>'
        : '';

    // ── 닉네임 뱃지 + 날짜 + 수정됨 표시
    var headerHtml = '<div class="comment-header">'
        + '<span class="comment-nickname-badge" style="' + badgeStyle + '">'
        + escapeCommentHtml(comment.nickname) + '</span>'
        + secretIcon
        + '<span class="comment-date">' + formatCommentDate(comment.createdAt) + '</span>'
        + (comment.isEdited && !comment.isDeleted ? '<span class="comment-edited-badge">수정됨</span>' : '')
        + '</div>';

    // ── 본문 내용 결정
    var bodyHtml = '';
    if (comment.isDeleted) {
        // 삭제된 댓글 처리
        var deletedMsg = comment.deletedBy === 'user'
            ? '사용자가 삭제한 댓글입니다.'
            : '삭제된 댓글입니다.';
        bodyHtml = '<div class="comment-deleted-text">' + deletedMsg + '</div>';

        // 관리자에게만 [원문 보기] 버튼 표시
        if (isAdmin) {
            bodyHtml += '<button class="comment-view-original-btn" '
                + 'onclick="viewOriginalComment(\'' + comment.id + '\')">'
                + '<i class="fa-solid fa-eye"></i> 원문 보기</button>';
        }
    } else if (comment.content === '__SECRET__') {
        // 비밀 댓글: 본인/관리자 아닌 경우 내용 숨김
        bodyHtml = '<div class="comment-secret-text">'
            + '<i class="fa-solid fa-lock" style="margin-right:6px;"></i>비밀 댓글입니다.</div>';
    } else {
        // 일반 댓글 내용 표시 (줄바꿈 처리 포함)
        bodyHtml = '<div class="comment-content">'
            + escapeCommentHtml(comment.content).replace(/\n/g, '<br>')
            + '</div>';
    }

    // ── 수정/삭제 버튼 (본인 댓글 or 관리자, 단 삭제된 댓글엔 표시 안 함)
    var actionsHtml = '';
    if (!comment.isDeleted && comment.content !== '__SECRET__') {
        var canEdit = isMine || isAdmin; // 수정: 본인 또는 관리자
        var canDelete = isMine || isAdmin; // 삭제: 본인 또는 관리자

        if (canEdit || canDelete) {
            actionsHtml = '<div class="comment-actions">';
            if (canEdit) {
                actionsHtml += '<button class="comment-action-btn" '
                    + 'onclick="openCommentEdit(\'' + comment.id + '\')" title="수정">'
                    + '<i class="fa-solid fa-pencil"></i></button>';
            }
            if (canDelete) {
                actionsHtml += '<button class="comment-action-btn comment-action-delete" '
                    + 'onclick="deleteComment(\'' + comment.id + '\')" title="삭제">'
                    + '<i class="fa-solid fa-trash-can"></i></button>';
            }
            actionsHtml += '</div>';
        }
    }

    // ── 답글 아이템 아래에도 [답글 달기] 표시 (모든 사용자, 삭제된 댓글 제외)
    var replyBtnHtml = '';
    if (isReply && !comment.isDeleted) {
        replyBtnHtml = '<div class="comment-reply-btn-wrap" style="margin-top:4px;">'
            + '<button class="comment-reply-btn" onclick="openReplyInput(\'' + comment.id + '\')">'
            + '<i class="fa-solid fa-reply"></i> 답글 달기</button></div>';
    }

    return '<div class="' + itemClass + '" data-comment-id="' + comment.id + '">'
        + headerHtml
        + '<div class="comment-body">'
        + actionsHtml
        + bodyHtml
        + replyBtnHtml
        + '</div>'
        + '</div>';
}
