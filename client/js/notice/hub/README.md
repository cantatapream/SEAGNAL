# hub  `client/js/notice/hub/`

「뉴스·공지·어황」 탭(2026-11-21, 종전 「공지사항」)의 **안쪽 탭 3칸**(오늘의 뉴스 · 공지사항 · 어황정보)을 바꾸고,
하단 탭을 열 때 **어느 칸부터 보일지**와 **N(새 글) 표시**를 맞춘다. 설계: [`../news_hub.design.md`](../news_hub.design.md)

## 화면에서 찾아가는 법
하단 탭 「뉴스·공지·어황」 → 제목 아래 밑줄형 탭 3칸(아이콘 + 글자 — 시안 4-B).

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `notice_hub.js` | 칸 바꾸기 · 처음 칸(24시간 안 공지가 있으면 공지사항, 없으면 오늘의 뉴스) · 칸별·하단 탭 N | `show`, `choose`, `onMainOpen`, `refresh`, `hasRecent`, `window.NoticeHub.setNoticeNew` |

## 데이터 흐름
- 하단 탭이 이 탭으로 바뀌면(`core/index2_patch.js switchMainTab` 이 `body[data-active-tab]` 을 바꾼다 — 누름·딥링크 어느 길이든) `onMainOpen`.
  공지 판정이 있으면 바로 고르고, 없으면 `promo.js loadPromoPosts → updateNewBadges → NoticeHub.setNoticeNew` 를 최대 3초 기다린다(못 받으면 뉴스).
- N: 공지 = 24시간 안 글(종전 규칙) · 뉴스 = 마지막으로 본 뒤 새 기사(`news.js`, 기기 저장소) · 어황 = 마지막으로 본 뒤 새 글(`fishcond.js`). 하단 탭 N = 셋 중 하나라도.
- 앱이 켜지고 4초 뒤 `/api/promo` · `NewsTab.prefetch` · `FishcondTab.prefetch` 로 N 을 미리 알아 둔다.

- 당겨서 새로고침(2026-11-22): `shared/ui/pull_refresh.js` 를 `#promo-section` 에 붙인다(띠 `#nhub-ptr`). 이 탭이 보이고 팝업(PopupStack·보이는 `.modal`)이 없을 때만, 지금 보이는 칸만 다시 받는다 — 뉴스 `NewsTab.refresh` · 공지 `loadPromoPosts` · 어황 `FishcondTab.refresh`.

## 수정 시 주의
- 하단 탭 N 은 이제 이 파일이 단다. `promo.js updateNewBadges` 는 `window.NoticeHub` 가 있으면 공지 판정만 넘긴다.
- 시험: `local_server/scripts/test_news_hub_ui.js`(실제 Chromium).
