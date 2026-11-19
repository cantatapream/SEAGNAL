# board  `local_server/js/notice/board/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `image_compress.js` | 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티 | `_redraw`, `_tryEncode`, `compressImageToJpeg`, `blobToDataURL` |
| `markdown_import.js` | 관리자 글쓰기 [마크다운 파일 불러오기] — .md 글·사진(파일 안 data URI)을 본문 HTML 로 바꿔 편집기에 채운다(저장은 관리자가 확인 뒤 [저장]). 규칙: 저장소 `NOTICE.md`. 목록 단계(ql-indent-1·2)·`==중요==` 노랑·`!!주의!!` 주황. 불러온 글은 `format:'md'` 로 저장되고 보기·편집기에 `.promo-md`(style.css — 단계별 글자 크기·간격)가 걸린다 | `toHtml` |
| `promo.js` | ※ 마크다운 글 보기 칸의 줄 맞춤은 공용 `shared/ui/text_fit.js`(`textFit`)를 부른다(2026-11-18 — 처음엔 이 폴더 md_fit.js 였으나 해상 기상 전망·안내 팝업도 쓰게 되어 옮김). |  |
| `promo.js` | 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집) | `renderAttachmentList`, `getFileIcon`, `formatFileSize`, `handleFileUpload`, `loadPromoPosts`, `renderPromoTabs` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## 게시글에 유튜브 넣기 (2026-11-19)

- 편집기 툴바의 **「동영상」(필름 모양) 버튼**에 유튜브 주소를 넣으면 본문에 재생 화면(iframe)이 들어가고, 게시글 화면에서 그 자리에서 재생된다.
  저장·표시 과정에서 지우는 곳은 없다(`openPromoDetail` 이 본문 HTML 을 그대로 넣는다). 게시글을 닫으면 `closePromoDetail` 이 영상을 멈춘다.
- 받는 주소: `youtube.com/watch?v=…`·`m.youtube.com/watch?v=…`·`youtu.be/…`(Quill 1.3.6 이 embed 로 바꿈) · **`youtube.com/shorts/…`(이 파일의 `promoYoutubeEmbedUrl` 이 embed 로 바꿈 — 쇼츠 주소는 유튜브가 다른 사이트 안에서 띄우기를 막아 그대로 넣으면 빈 칸이 된다)**.
  변환은 `registerPromoVideoFormat` 이 Quill 의 video 형식 `sanitize` 를 감싸 한다(편집기를 처음 만들 때 한 번).
- 사슬 모양 **「링크」 버튼은 글자를 먼저 선택해야 반응한다**(Quill 원본 동작). 링크로 넣은 유튜브 주소는 재생 화면이 아니라 유튜브로 넘어가는 글자가 된다.
- 재생 화면 크기는 정하지 않았다(작게 보인다) — 사용자 판단: 전체화면으로 보면 된다. 앱(Capacitor 7 `BridgeWebChromeClient.onShowCustomView`)에서는 전체화면이 앱 화면 크기만큼 채우는 방식이다.
- 영상 주인이 「다른 사이트에 넣기」를 막아 둔 영상은 어떤 방법으로도 재생되지 않는다.
- 시험: `local_server/scripts/test_promo_youtube_shorts.js`.
