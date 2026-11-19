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

## 게시글 팝업 안 자리 (2026-11-19 사용자 확정 시안)

> *"댓글 쓰는 부분이 기존에는 스크롤를 모두 내려야 나왔는데 아예 게시글 하단에 고정되도록 하되, 댓글 입력창의 영역 상하를 1/3로 줄이고 등록버튼도 댓글입력창의 오른쪽에 배치 / 관리자 오른쪽 끝에 비밀댓글 체크박스와 텍스트를 붙이고, 댓글작성 가이드라인은 댓글 0개 오른쪽 끝에 작게 붙여줘. 텍스트도 작성 가이드라인 이라고만 표현. 그리고 댓글 0개 부분은 삭제하고 …"* → 시안 확인 뒤 *"이대로 반영해보자"*

- 입력칸(`promo_comment3.js` `renderCommentInput`)은 `index2.html` 의 고정 칸 `#comment-input-area`(팝업 맨 아래, 비면 숨김)에 그린다: [닉네임 ……… ☐🔒비밀댓글] / [입력창(42px, 오른쪽 아래 0/500) | 등록]. 모양은 `style.css` `.promo-detail-comment-footer` 아래에서만 바꿨다(답글 입력칸은 같은 class 를 쓰므로 그대로).
- 「댓글 N개」 줄은 없앴다. 「작성 가이드라인」 단추(`promo_comment5.js`)는 반응 줄 오른쪽 끝 `#comment-guideline-slot` 에 작게, 펼친 내용은 댓글 목록 위.
- 댓글을 못 쓰는 글(일반 사용자)은 입력칸·가이드라인 단추를 비운다. 등록 뒤에는 몸통(`#promo-detail-scroll`)을 끝까지 내려 방금 단 댓글을 보인다.
- 시험: `local_server/scripts/test_promo_detail_ui.js`

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
