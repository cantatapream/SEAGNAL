# board  `local_server/js/notice/board/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `image_compress.js` | 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티 | `_redraw`, `_tryEncode`, `compressImageToJpeg`, `blobToDataURL` |
| `markdown_import.js` | 관리자 글쓰기 [마크다운 파일 불러오기] — .md 글·사진(파일 안 data URI)을 본문 HTML 로 바꿔 편집기에 채운다(저장은 관리자가 확인 뒤 [저장]). 규칙: 저장소 `NOTICE.md`. 목록 단계(ql-indent-1·2)·`==중요==` 노랑·`!!주의!!` 주황. 불러온 글은 `format:'md'` 로 저장되고 보기·편집기에 `.promo-md`(style.css — 단계별 글자 크기·간격)가 걸린다 | `toHtml` |
| `md_fit.js` | 마크다운 글(패치노트) 보기 칸의 줄 맞춤 — 다음 줄로 넘어갈 낱말이 2~3글자만 모자라면 그 줄의 글자 간격을 좁혀(한도 0.12em) 한 줄에 넣는다. 낱말 중간 줄바꿈 금지는 style.css `.promo-md` 의 `word-break:keep-all`. 보기 칸(#promo-detail-content)에만 — 편집기에는 안 건다(낱말마다 span 을 씌우므로). 미리보기(build_notice.js)도 같은 파일을 넣는다. 시험 `test_notice_md_fit` | `promoMdFit` |
| `promo.js` | 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집) | `renderAttachmentList`, `getFileIcon`, `formatFileSize`, `handleFileUpload`, `loadPromoPosts`, `renderPromoTabs` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
