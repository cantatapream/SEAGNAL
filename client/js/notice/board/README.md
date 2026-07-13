# board  `local_server/js/notice/board/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `image_compress.js` | 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티 | `_redraw`, `_tryEncode`, `compressImageToJpeg`, `blobToDataURL` |
| `promo.js` | 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집) | `renderAttachmentList`, `getFileIcon`, `formatFileSize`, `handleFileUpload`, `loadPromoPosts`, `renderPromoTabs` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
