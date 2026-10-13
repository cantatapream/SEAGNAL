# 현재 사용자 요구 — 지난 유향·유속·수온 슬롯 제거

2026-10-13 KST 사용자가 **지난 날짜/시간대의 유향·유속·수온 자료를 남기지 않도록 삭제**하라고 추가 지시했다. 초기 제안의과거24시간/최대97슬롯은 폐기하고, 최종 수정은 **현재 시간대~향후72시간/최대73슬롯**으로 변경했다.

기존 코드에는 cache Map에서 오래된 성공 항목을 삭제하는 처리가 없었다. TTL1시간은 다시 받을지 판단할 뿐, 메모리를 해제하지 않는다. 순차 가상8일 실험에서 슬롯이73→241까지 늘어나고 지난 생성본이 백업에도 계속 들어가는 것을 확인했다.

최종 수정은 읽기·수집·백업게시·백업복원에서 과거 슬롯을 빼고, **외부호출 없는1분 unref 타이머**로 조회가 없거나 수집이 멈춰도 지난 슬롯의 메모리를 정리한다. 새 백업을 게시할 때도 지난 슬롯은 제외하며, 기존 디스크 파일의 과거 항목도 복원하지 않는다.1분 메모리 정리마다 백업 전체를 재압축하는 동작은 하지 않는다.

**예보시각**과 **생성본 나이**는 구분한다. 예를 들어 지금15시이면14시 자료는 삭제하지만,16시 예보를2시간 전에 받아 놓은 경우16시 자체는 아직 미래이므로 갱신 실패 시 기존24시간 stale 정책에 따라 사용할 수 있다. 명시적으로 과거 시각을 요청하면 진짜 외부 원천 응답을 반환할 수 있지만 메모리/백업에 보관하지 않는다. 누락·실패를0으로 꾸미지 않는다.

최종 회귀검사40건과 기존 HTTPS6건은 UTC/Los_Angeles 모두 통과했다. 실제 Fly 장애의 마지막 JSON은 미확정이다. 이하 상세조사에는 관측근거·격리환경·측정치·원천호환·배포 후 확인사항이 기록되어 있다.

# Fly Node heap OOM parallel investigation — 2026-10-13 KST

Scope: initial investigation used read-only source and isolated fixtures. The bounded cache and per-file reuse fixes are now applied in this server PR; deployment, Fly machine writes, paid APIs and live collectors remain unexecuted. UI work is separate PR #1373. Logs contain credential URLs: only selected GC/fatal lines inspected/reported.

## Established facts

User Fly log shows two V8 `Reached heap limit / JavaScript heap out of memory` failures (~21:06 and 21:10 KST), heap surviving major GC ~480 MiB, JsonParser<unsigned short> stack, process exit 134. Thus Node heap exhaustion is established. The stack does **not** identify the filename or collector performing the final allocation. `SIGINT`, lease conflicts and proxy connection failures from later restarts are consequences or management events, not proof of the original allocating source.

User dashboard reports 1 GiB-class VM (mem_total ~961.9 MB), average overall guest used ~730 MB and peaks near900 MB, HTTP p95 ~22s and p99 ~26s, >100s spikes, VMserviceconcurrency spikes ~100. These are aggregate dashboard values, not a count of100users and not Node RSS. The8s major GC pauses in logs plausibly explain eventloop stalls and queued requests. A large heap-limit increase alone could consume native/Buffer/child-process/OS headroom and move the crash to guest OOM.

## Independently proven defect: KHOA stream cache is unbounded

Before this change, `local_server/services/khoa_stream_cache.js` had `.set` for successful slots, no cache.delete/clear/cap. TTL changes hit/re-fetch behavior; it never evicts cached points. refreshCycle polls current+72h every30minutes, continually adding a new key as time advances. `persistToDisk()` serializes **all** entries, including expired ones. `_failCache` similarly retains failed-key entries until the same key succeeds. `hydrateFromDisk()` drops >24h old items only **after** parsing the whole gzip JSON.

`probe_cache_growth.cjs`: actual current module in VM, mocked single-point upstream, virtual8days, no network. Cache entries73→97→121→145→169→193→217→241; day8 retains144entries whose fetch timestamp is >24h old. Backup persists all241. Therefore storage bounds are missing regardless of whether this cache caused the observed final JSON parse crash.

Operating log restored97slots. Local repository backup is80slots,574,000points,4.70MiB gzip→35.63MiB JSON. Per-process `measure_files.cjs` gives retained heap~78.7MiB and peak RSS~288.1MiB for raw buffer→string→parse; operation sequencing changes reported RSS. This is independent of the new marine risk feature.

## Other proven allocation amplification

`risk_store.refresh` uses a combined signature of weather, raw risk datasets, status, quota and static files. A change in **one status/quota** clears caches and reparses all weather/risk files and static `risk_spots.json`; `probe_changed_status.cjs` showed RSS~88.9→114.2MiB after only a tiny accident_status change, with all large files reread. An unchanged signature correctly skips rereads. This is allocation churn, not proof of retained-object leak. Separate per-file signatures / status-only refresh is a next small optimization.

`risk_collector_io.read` eagerly gunzips full files and parses them. New congestion codec2 already limits expanded row objects to8frames, but the packed arrays and read/string/parse peaks remain. Old non-codec2 files are returned eager and retain repeated fields. `measure_congestion.cjs` with48x5666 synthetic rows:

- baseline3.66MiB heap;
- legacy62.49MiB (58.83MiB extra);
- legacy+packed97.50MiB;
- packed31.58MiB;
- lazy decode after48 accesses39.90MiB (only8 row frames retained).

No actual production marine gzip files are present in this checkout (only gale_status.json). Hence actual production row counts, codec versions, all cached-source sizes and Node native RSS remain unknown. The screenshot/API sample5666 is an assumption for the congestion fixture, not a measurement of today's Fly data.

## Separate server PR implementation

Applied source: `local_server/services/khoa_stream_cache.js`:

1. Final user-directed KST **forecast timestamp** window current-hour through current-hour+72h, not just last-fetch timestamp; max73slots. Prior-hour and yesterday slots are evicted. A1minute unref timer prunes even if there are no user requests or a collector is blocked; it makes no network requests or disk writes.
2. Evict past/expired success/failure entries on get/refresh/persist/hydrate and independently once per minute. Preserve1h freshness and24h stale fallback for the **same current/future forecast slot**.24h refers to generation/fetch age, not permission to retain past forecast hours.
3. Backup codec2 stores each slot as an independent gzip/base64 block. Root JSON contains small strings; hydrate decodes one slot at a time and skips outside-window blocks before parsing points. Runtime API `{ts,points,meta,stale,...}` stays unchanged.
4. Legacy backups supported with gzip output limit64MiB; per-block8MiB limit. Oversized/corrupt backup is logged, file preserved and normal upstream collection can populate. No fake zero-success source data is written. Legacy>64MiB loses **startup restore** until real collection; stage must document this tradeoff and consider progressive legacy-reader conversion if relevant to actual production size.
5. The old deployed binary does not understand the new codec2 backup. A rollback will refill from upstream rather than restore it; plan/document rollback or optionally retain a bounded legacy sidecar if required.

`test_khoa_stream_cache_memory.js`:40PASS in UTC and America/Los_Angeles, including8day73cap, current-hour progression, previous-hour/yesterday non-retention, legacy expired-slot exclusion, independent timer pruning, API fields, fresh hit, current/future stale fallback, concurrent dedup, invalid coordinates/dates, new/legacy restore and oversize file preservation. The original source fails on day2 under the final73cap. Existing HTTPS test6PASS in both timezones with stagedsource read substitution. Integrated gate results are recorded in handoff_server_memory.md.

`measure_hydrate.cjs` final rerun compares73current/future slots with actual local point counts, rewritten dates/timestamps into the current~72h testwindow:

| process | after-GC heap | sampled JSONparse peak RSS | disk |
|---|---:|---:|---:|
| legacy |72.35MiB|208.23MiB|4.290MiB|
| new codec2 |72.48MiB|136.71MiB|4.323MiB|

~71.5MiB lower sampled startup RSS peak, ~0.8% larger compressed backup. The earlier80slot prototype comparison(222.71→139.57MiB) preceded the user-directed removal of all past-hour retention. Resident data heap stays the same; this is a peak reduction, not a claim all memory was freed.

Measurements use local Node **v24.19.0** with `--max-old-space-size=480 --max-semi-space-size=4` where stated; Docker production uses Node20. RSS is allocator/process dependent and sampled at JSON.parse boundaries, not an OS-wide maximum monitor. No actual Fly whole-machine memory guarantee or exact crash-file attribution follows.

## Priority / separate PR proposal

First fix the proven cache bound and backup parsing peak as a separate server commit/PR after UI commit. Add narrowly targeted risk-store per-file refresh to avoid reparsing large sources on tiny status changes. Add concise bounded runtime memory/source-size diagnostics (heapUsed, RSS, external, arrayBuffers, heap_size_limit, per-file compressed/uncompressed size/count/version; never credential URL/source bodies) before/after startup hydrate and collectors so next incident identifies the allocating source. Consider serializing heavy bootstrap tasks; process promises running in parallel still allocate within one shared heap. Leave genuine source failure states intact.

Do not state the KHOA defect was conclusively the incident source, and do not claim a heap-limit change solves all memory issues. No operational fix has been deployed.


## Recent marine deployment differential and user hypothesis

#1371 merged 2026-10-13 **07:34 KST**. User's3day VM graph shows Oct11 afterrestart~540→640~740MiB, Oct12 anotherrestart~540→700, Oct13 06시~600 then07:34after~700~800 and13시after~850~940peaks. This temporal correspondence makes recently added realtime/fusion load a priority candidate. It does not prove source attribution; independent KHOA cache growth must not be substituted for investigation of the new feature.

`measure_pipeline.cjs`: actual marine codec/io-shape synthetic48x5666 rows, onepageJSON and intermediate steps retained. heap62.57MiB at normalized48frames→66.62inputstring→68.44parse→69.53normalizedpage→107.28pack(old+new)→116.02stringify; RSS97.8→163.0MiB. UTF8+gzip external1.80→9.54MiB, arrayBuffers0.13→7.87MiB. After releasing old/transient references GC leaves33.94MiB heap. This shows the user's pre-compression duplication hypothesis is mechanically plausible. It does not simulate several real upstream calls or prove their peaks coincide in Fly.

`measure_realtime.cjs`: **actual newly added realtime collector** with mocked3460feature geometry/7ship/10ton response and mockdescribe, no officialAPI route. First collection heap4.36→raw10.61→normalized/hash15.36→write16.40MiB; RSS26.5→53.2. Second collection usesdisjointIDs and preserves old locationtableunion6920cells; peakheap23.89/RSS65.86. Real describe tables, API basic row objects, escaped-string response sizes and live source data are absent, so this is a lower-level estimate only. Source retains cell union until30000; collector only keeps latest values, not history. New marine static ship-accident7.08MiB parse alone added~24.96MiB heap, parseRSS71.21process-total. Future filtered5yr runtime retains a subset of those rows.

`measure_request_pattern.cjs`: actual risk_store/marine_fusion methods with identical fixtures5666congestion48frames(codec2),1450accident24frames and real local static/weather. Old frontend's invisiblelegacy sea+accident requests followed by unified requests cost2709ms and retained81.95MiB heap afterGC. New frontend unifiedpaironly costs351ms and70.87MiB. Roughly11.1MiB fewer retained objects and87%lower isolated request computation time. Old RSS141.2 vsnew138.4 includes allocator variance. Parent UI work implementing this omission is itself a server-load improvement; it doesn't alone prove the repeated heap480 failure resolved.

### Collection ordering recommendation

1. Read concise heap/RSS/external/arrayBuffers before/after hydrate and eachcollector start/normalize/serialize stage so allocating feature can be identified.
2. Publish only verified complete datasets; no fabricated zeros. Keep normal old data if a collector fails.
3. Gate heavy bootstraps with a small serial/limited-concurrency queue (not blindly serializing all HTTP IO): oldcache hydration, congestion pack/write, accident geometry24frames, currentweb schema decode, raster/PDF collection are main phases to coordinate. Preserve due-time and retry schedules; startupsync changing toqueue requires collector promise/stop hooks, not merely callingasyncstartmethods onebyone.
4. Apply independent KHOA bounds/backuppeak fix and UI's obsolete-frame-request removal. Per-source risk_store refresh is included in this server PR.
5. Newly staged cache patch canonicalizesnumeric/paddedhour intoonekey, validatesfinitepointcoordinates/values at normalization/restore, skips corrupt codec blocks individually. Outsidewindow explicit requests still receive real fetched upstream result but it is not retained. Existing oceanTimeline and streamoverlay use **0..72h** and selectedhour; bottomsheetfetchusescurrentorselectedtimeline. Therefore production UI current/future time scope is kept. Arbitrary historical backend requests remain callable but lose long-termcache reuse.
6. Existing `test_khoa_https.js`6PASS, no otherdedicatedcachetest existed. New formal40tests includeconcurrentdedup/failureTTL/coordinates/malformeddates/newandlegacybackup andcap. Need registerinverify_all.sh and runfullgate when applied.
