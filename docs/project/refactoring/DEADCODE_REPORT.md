# SEAGNAL 데드코드 검증 리포트 (STEP 4b)

> 작성: 2026-07-13 (KST) · 방식: 자동 검출(find_unused.js) → 독립 에이전트 3인 병렬 교차 검증(§14.4)
> 판정 규칙: **3인 만장일치 "데드"만 ✅ 확실**. 1명이라도 살아있음/불확실/보류면 리스트 제외.
> 에이전트 렌즈 — A: 동적 참조 · B: 네이티브/빌드 · C: 의도/이력

---

## 1. 결론 요약

| 구분 | 건수 | 처리 |
|------|------|------|
| ✅ 확실(3/3 만장일치 데드) | **2건** | 격리 권고 (사용자 승인 후 archive → 관찰 → 삭제) |
| ⚠️ 의심(1명 이상 반대/불확실) | 다수 | **리스트 제외** — 보존 |
| ⏸ 보류(도구·계획·스토어 자산) | 미로드 JS 4건 등 | 데드 아님 — 보존, 일부는 이설 대상 |

**핵심: 미로드 JS 4건은 전원(A·B·C) "데드 아님" 판정 → 삭제 리스트에서 제외.**

---

## 2. ✅ 확실 데드 — 격리 권고 (2건)

| # | 파일 | 크기 | 검출 근거 | A | B | C | 판정 |
|---|------|------|-----------|---|---|---|------|
| 1 | `local_server/assets/Untitled-1.png` | 72K | 전 코드 참조 0 | 데드 | 데드 | 데드 | ✅ 확실 (3/3) |
| 2 | `local_server/images/splash_full_capture.png` | 892K | 전 코드 참조 0 | 데드 | 데드 | 데드 | ✅ 확실 (3/3) |

- **Untitled-1.png**: 이미지 편집기의 기본 내보내기 이름("Untitled") — 스크래치 파일. 정적·동적·네이티브·빌드 참조 전무, git 이력상 코드에서 참조된 적 없음(교체가 아니라 애초에 미연결).
- **splash_full_capture.png**: 스플래시 화면 "전체 캡처" — 디버그 아티팩트. 892KB로 용량도 큼. 참조·계획 전무.

> 이 2건도 §14.5 에 따라 **바로 삭제하지 않고** `archive/deadcode_20260713/` 로 격리 → 1~2주 관찰(에러 로그에 요청 없음 확인) → 삭제.

---

## 3. ⚠️ 의심 — 리스트 제외(보존) 주요 건

만장일치가 깨진(=1명 이상이 살아있음/불확실/보류로 본) 항목. **삭제 권고하지 않음.**

| 후보 | A | B | C | 제외 이유 |
|------|---|---|---|-----------|
| `assets/icons/icon-*.webp` (7건) | 데드 | 데드 | 불확실 | C: PWA 아이콘팩 — 향후 사용 배제 근거 없음 |
| `assets/splash_icon2.png` | 불확실 | 불확실 | 데드(중복) | 라이브 `images/splash_icon_transparent.png`와 **바이트 동일** — 마스터/트윈 가능성 |
| `assets/android-launchericon-512-512.png` | 불확실 | 불확실 | 데드(중복) | 라이브 PWA 아이콘 `icon_wave_pulse_square.png`와 **바이트 동일** |
| `dolhareubang_*` (7건) | 불확실 | 불확실 | 데드경향 | 미채택 마스코트 디자인 마스터 — `@capacitor/assets` 재생성 소스 가능성 |
| `assets/app_icon.jpg` | — | 불확실 | 데드경향 | 아이콘 소스 마스터 가능성 |
| `seagnal_feature_graphic_1024x500_*.png` | — | 불확실 | 보류 | 1024×500 = Google Play 피처그래픽 규격 — 스토어 등록 자산(코드 무참조가 정상) |
| `assets/vendor/*/definitions.js` (중복쌍) | — | 살아있음 | 살아있음 | Capacitor 벤더 플러그인 — 형제 index.js가 import(바이트 동일은 우연) |
| `tools/zone_crops*/07·08` | — | — | 도구데이터 | zone 편집 도구 산출물(두 해역이 크롭 공유) |

> 특히 **중복 복제본**(splash_icon2, android-launchericon-512)은 "삭제해도 라이브 파일이 남으니 안전" 같지만, 어느 쪽이 마스터인지 불확실해 만장일치가 안 났습니다. 정리하려면 별도 검토가 필요합니다.

---

## 4. ⏸ 보류 — 미로드 JS 4건 (전원 데드 아님)

| 파일 | A | B | C | 성격 |
|------|---|---|---|------|
| `js/admin/cctv7.js` | 보류 | 보류 | planned | CCTV 위치 편집 **개발 도구** — index2.html:4421에 "미사용" 명시 문서화. §14.3③이 데드 아님 예시로 지목 |
| `js/assistant/memory/user_memory_bridge.js` | 살아있음 | 살아있음 | planned | **구현 완료·배선 대기.** 라이브 `assistant.js`가 `window.SeagnalMemory` 15회+ 호출. 네이티브 Room DB(UserMemoryDao.java 등)까지 구현됨. n2 설계문서 "변경0 완성" |
| `js/assistant/memory/user_memory_web.js` | 살아있음 | 살아있음 | planned | 위 bridge의 짝(`SeagnalMemoryWeb`, IndexedDB) — 동일 세트 |
| `js/forecast/prediction/run_advisory_render_test.js` | 보류 | 보류 | planned | node 테스트 하네스 — 라이브 `advisory_prediction.js` 검증. 산출물 2026-07-13 재생성. §8.8 이설(server/scripts/tests/) 대상, 삭제 아님 |

> **중요**: user_memory 2건은 "죽은 코드"가 아니라 **"완성했지만 아직 `<script>` 태그로 연결 안 한 기능"**입니다. 삭제하면 웹+네이티브 사용자 기억 서브시스템이 끊깁니다.

---

## 5. 후속 조치 제안

1. **즉시 승인 가능**: §2의 확실 데드 2건(Untitled-1.png, splash_full_capture.png) 격리 — 총 964KB 정리
2. **별도 검토 필요(선택)**: §3의 중복 복제본·미채택 마스코트·구 아이콘팩 — "정리하면 좋지만 어느 게 마스터인지 확인 후". 급하지 않음
3. **STEP 7 이설**: `run_advisory_render_test.js` 를 `server/scripts/tests/` 로 (삭제 아님)
4. **미연결 기능 안내**: user_memory v2 는 배선(`<script>` 추가)만 남은 완성 기능 — 향후 활성화 시 §15 개발지침에 따라 로드 순서 추가

> 모든 판정은 git 이력이 대량 일괄 커밋이라 "교체 시점"을 커밋으로 특정하지 못한 한계가 있음 → 확실 데드도 격리→관찰 절차 생략 금지(§14.5).
