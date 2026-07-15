# comments  `local_server/js/notice/comments/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `promo_comment1.js` | 게시글 댓글 시스템 - 공통 유틸리티 (닉네임, 기기ID, 헬퍼) | `getOrCreateNickname`, `getCommentDeviceId`, `isAdminMode`, `formatCommentDate`, `escapeCommentHtml` |
| `promo_comment2.js` | 게시글 댓글 시스템 - 댓글 렌더링 (화면 표시) | `renderCommentList`, `_renderCommentSubtree`, `renderCommentItem` |
| `promo_comment3.js` | 게시글 댓글 시스템 - 댓글 등록/수정/삭제 (사용자 액션) | `renderCommentInput`, `submitComment`, `openCommentEdit`, `cancelCommentEdit`, `saveCommentEdit`, `permanentDeleteComment` |
| `promo_comment4.js` | 게시글 댓글 시스템 - 답글 입력 및 관리자 전용 기능 (원문 보기) | `showCommentOriginalModal`, `openReplyInput`, `closeReplyInput`, `submitReply`, `viewOriginalComment` |
| `promo_comment5.js` | 게시글 댓글 시스템 - 댓글 섹션 초기화 진입점 및 새로고침 | `loadPromoComments`, `refreshComments`, `_fetchAndRenderComments`, `initCommentToggleListener`, `toggleCommentGuideline` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
