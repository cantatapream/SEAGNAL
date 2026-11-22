# news  `client/js/notice/news/`

「뉴스·공지·어황」 탭의 **오늘의 뉴스** 화면. 서버(`local_server/services/news_collector.js`)가 1시간마다 모아 AI 로 고른 해양 뉴스 카드를 날짜별로 보여 준다.
설계·사용자 원문: [`../news_hub.design.md`](../news_hub.design.md)

## 화면에서 찾아가는 법
하단 탭 「뉴스·공지·어황」 → 「오늘의 뉴스」.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `news.js` | 날짜줄 · 최종 업데이트 · 카드 · 아코디언 · 달력 · 앱 안 브라우저로 기사 열기 | `load`, `renderDateline`, `renderUpdated`, `renderList`, `card`, `toggle`, `openCalendar`, `openArticle`, `window.NewsTab` |

## 화면 규칙(사용자 확정)
- 날짜줄: `◀ 11월 21일(토) ▶` 가 화면 가운데, **[오늘]은 ▶ 바로 오른쪽**, 달력은 맨 오른쪽. 오늘이면 ▶ 못 누름, 보관 첫날이면 ◀ 못 누름.
- 달력: **보관 중인 날짜만** 누를 수 있다(30일).
- 카드(시안 5-2 B): 왼쪽 대표사진(없거나 못 불러오면 분류 그림) 위에 분류 꼬리표 · 제목 · 요약 3줄 · 아래 줄 왼쪽 지역 꼬리표 + 「언론사 외 N건」, **오른쪽 끝 펼친 횟수(눈) + 발행 시각**.
- 누르면 펼침(요약 끝까지) + 펼친 횟수 1(`POST /api/news/:date/:id/open`, 관리자 기기 `?admin=true` 는 하루 1번) → **펼친 카드를 다시 누르면 기사**(앱 = `@capacitor/browser` 앱 안 브라우저 창, 웹 = 새 탭) → 다른 카드를 누르면 앞 카드는 접힘.
- 최종 업데이트가 3시간 넘게 지났으면 주황 + 「업데이트가 늦어지고 있어요」. 오늘 기사가 아직 없으면 「아직 오늘 기사가 없어요」 + [어제 뉴스 보기].
- http 사진은 앱(https) 안에서 막혀 `/api/news/img?u=` 로 받는다(서버는 우리 카드 사진만 전달).

## 연계
- 서버 API: `GET /api/news?date=` · `POST /api/news/:date/:id/open` · `GET /api/news/img` — `local_server/routes/news.js`
- 부르는 곳: `../hub/notice_hub.js`(`NewsTab.open` · `refresh`(당겨서 새로고침 — 보던 날짜를 조용히 다시 받는다, 새로 수집은 아님) · `prefetch` · `hasNew` · `markSeen`)
- 목록 맨 끝 「다 봤어요」(2026-11-22 사용자 「다 봤어요를 표출하는 곳은 오늘의 뉴스에만」) — 전날이 보관 날짜면 [어제 뉴스 보기]/[전날 뉴스 보기](누르면 안쪽 탭 줄로 올라간다)
- 시험: `local_server/scripts/test_news_hub_ui.js`
