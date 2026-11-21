# fishcond  `client/js/notice/fishcond/`

「뉴스·공지·어황」 탭의 **어황정보** 화면. 서버(`local_server/services/fishcond_collector.js`)가 1시간마다 국립수산과학원 어황정보 게시판에서 받아 둔 글을
공지사항과 같은 목록으로 보이고, 누르면 게시글 팝업에서 PDF 를 쪽마다 그림으로 보여 준다. 설계·사용자 원문: [`../news_hub.design.md`](../news_hub.design.md)

## 화면에서 찾아가는 법
하단 탭 「뉴스·공지·어황」 → 「어황정보」.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `fishcond.js` | 목록(바다 꼬리표 · 오른쪽 끝 조회·날짜·주관부서, 쪽수 없음) · 게시글 팝업(쪽 그림 · [PDF 받기] · [원문 보기]) | `render`, `load`, `window.openFishcondDetail`, `window.closeFishcondDetail`, `window.FishcondTab` |

## 동작
- 팝업 몸통 = `GET /api/fishcond/:id/view`(서버가 PDF 를 쪽마다 그림으로 바꿔 둔 보기 페이지 — **열 때 조회 수 1**, 관리자 기기는 하루 1번). 미리보기가 없는 글은 안내 + PDF 받기만(조회 수는 센다).
- [PDF 받기] = `shared/ui/ui_modal.js downloadKmaFile`(앱은 시스템 브라우저로 넘겨 받는다 — 기상특보 원문 받기와 같은 길). 파일 이름은 글 제목.
- 댓글·반응은 없다(사용자 「불필요. 공지사항에만」). 뒤로가기로 팝업이 닫힌다(`core/backbutton.js PopupStack`).

## 연계
- 서버 API: `GET /api/fishcond` · `/:id/view` · `/:id/pdf` — `local_server/routes/fishcond.js`
- 마크업: `index2.html #nhub-fishcond` · `#fishcond-detail-modal`
- 부르는 곳: `../hub/notice_hub.js`(`FishcondTab.open` · `prefetch` · `hasNew`)
- 시험: `local_server/scripts/test_news_hub_ui.js`
