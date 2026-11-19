# board  `local_server/js/notice/board/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `image_compress.js` | 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티 | `_redraw`, `_tryEncode`, `compressImageToJpeg`, `blobToDataURL` |
| `markdown_import.js` | 관리자 글쓰기 [마크다운 파일 불러오기] — .md 글·사진(파일 안 data URI)을 본문 HTML 로 바꿔 편집기에 채운다(저장은 관리자가 확인 뒤 [저장]). 규칙: 저장소 `NOTICE.md`. 목록 단계(ql-indent-1·2)·`==중요==` 노랑·`!!주의!!` 주황. 불러온 글은 `format:'md'` 로 저장되고 보기·편집기에 `.promo-md`(style.css — 단계별 글자 크기·간격)가 걸린다 | `toHtml` |
| `promo.js` | ※ 마크다운 글 보기 칸의 줄 맞춤은 공용 `shared/ui/text_fit.js`(`textFit`)를 부른다(2026-11-18 — 처음엔 이 폴더 md_fit.js 였으나 해상 기상 전망·안내 팝업도 쓰게 되어 옮김). |  |
| `promo.js` | 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집). 상세 팝업(2026-11-19 사용자 확정 시안 — artifact 6qqYwX14Hotmb3zz7JAi3i)은 머리(제목·날짜, 고정) · 몸통(`#promo-detail-scroll` — 본문·반응 줄·댓글 목록, 이 칸만 스크롤, 좌우 여백 최소) · 발(`#comment-input-area` — 댓글 입력, 고정) 세 칸이고, ❤️👍😮 반응 버튼은 제목 아래에서 본문 끝 「댓글 N개」 자리로 옮겼다(그 줄 오른쪽 끝 「작성 가이드라인」). 시험 `test_promo_detail_ui` | `renderAttachmentList`, `getFileIcon`, `formatFileSize`, `handleFileUpload`, `loadPromoPosts`, `renderPromoTabs` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## 게시글에 유튜브 넣기 (2026-11-19)

- 편집기 툴바의 **「동영상」(필름 모양) 버튼**에 유튜브 주소를 넣으면 본문에 재생 화면(iframe)이 들어가고, 게시글 화면에서 그 자리에서 재생된다.
  저장·표시 과정에서 지우는 곳은 없다(`openPromoDetail` 이 본문 HTML 을 그대로 넣는다). 게시글을 닫으면 `closePromoDetail` 이 영상을 멈춘다.
- 받는 주소: `youtube.com/watch?v=…`·`m.youtube.com/watch?v=…`·`youtu.be/…`(Quill 1.3.6 이 embed 로 바꿈) · **`youtube.com/shorts/…`(이 파일의 `promoYoutubeEmbedUrl` 이 embed 로 바꿈 — 쇼츠 주소는 유튜브가 다른 사이트 안에서 띄우기를 막아 그대로 넣으면 빈 칸이 된다)**.
  변환은 `registerPromoVideoFormat` 이 Quill 의 video 형식 `sanitize` 를 감싸 한다(편집기를 처음 만들 때 한 번).
- 사슬 모양 **「링크」 버튼**: 글자를 선택하고 누르면 그 글자에 링크를 건다(Quill 원본). **선택 없이 누르면 주소 입력 팝업이 뜨고, 넣은 주소가 그대로 링크 글자로 들어간다**(`enablePromoLinkWithoutSelection`, 2026-11-19 — 종전에는 아무 반응이 없었다). 주소에 `https://` 가 없으면 붙인다(`promoNormalizeLinkUrl`). `javascript:` 같은 주소는 Quill 이 `about:blank` 로 바꾼다.
  링크로 넣은 유튜브 주소는 재생 화면이 아니라 유튜브로 넘어가는 글자가 된다 — 글 안에서 재생하려면 「동영상」 버튼.
- 재생 화면 크기: 게시글 화면에서 **본문 좌우 너비를 꽉 채우고 16:9 비율**(`style.css .promo-content-view iframe.ql-video`, 2026-11-19 사용자 요청 — 종전에는 크기를 정하지 않아 300×150 으로 작았다). 편집기 안 크기는 그대로다. 앱(Capacitor 7 `BridgeWebChromeClient.onShowCustomView`)의 전체화면은 앱 화면 크기만큼 채우는 방식이다.
- 영상 주인이 「다른 사이트에 넣기」를 막아 둔 영상은 어떤 방법으로도 재생되지 않는다.
- 시험: `local_server/scripts/test_promo_youtube_shorts.js` (쇼츠 변환 + 링크 버튼).

## 게시글 상세 창 — 키보드가 떠도 제자리 (2026-11-19)

- 사용자 지적: 댓글 입력창을 누르면 머리(제목)가 위로 밀려 올라가고 본문이 휴대폰 상태표시줄 밑까지 넘어갔다.
- 원인: 키보드가 뜨면 이 앱의 웹 화면은 「보이는 화면」(`visualViewport`)만 줄고 전체 화면 크기는 그대로다. 전체 화면 기준으로 가운데 놓인 창이 키보드 뒤로 들어가고, 브라우저가 입력창을 보이려고 화면을 위로 밀었다.
- 고침: 창이 열려 있는 동안 `promo.js fitPromoDetailToViewport` 가 바깥 칸(`#promo-detail-modal`)의 위치·높이를 보이는 화면에 맞춘다(나리야 채팅 `ai_chat.js fitChat` 과 같은 방식). `style.css` 는 폰에서 창 높이를 `vh`(키보드가 떠도 그대로) 대신 바깥 칸 기준(`max-height:100%`)으로 잡고, 위 여백을 상태표시줄 높이(`safe-area-inset-top`) 이상·기본 40px 로, 키보드가 떠 있으면(`promo-kb-open`) 아래 여백을 6px 로 둔다.
  → 키보드가 뜨면 제목·댓글 입력은 그대로 보이고 가운데 본문 칸만 줄어든다. 키보드가 없을 때 모양은 종전과 같다(위아래 40px).
- 켜고 끄기: `openPromoDetail` → `bindPromoDetailKeyboardFit`, `closePromoDetail` → `unbindPromoDetailKeyboardFit`(뒤로가기 버튼으로 닫아도 `closePromoDetail` 을 거친다).
- 시험: `local_server/scripts/test_promo_detail_keyboard.js`. 실기기에서 키보드를 띄워 본 것은 아니다 — 브라우저에서 보이는 화면 크기를 바꿔 재 봤다.
