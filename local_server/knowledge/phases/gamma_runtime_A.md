# 옵션 γ — v5 측정 자동화 시점 A 사용법 (preflight + run)

> **위치:** `knowledge/phases/preflight_v5.sh`, `knowledge/phases/run_v5.sh`.
> **정본 SOP:** `v5_measurement_synthesis.md` §1~§3 / `v5_measurement_frame_A.md` §1~§3.
> **목적:** SOP 의 C1~C5 사전점검과 §2.1 BG 가동 + §3 폴링/재시작을 한 줄 실행으로 묶는다.
> **본 문서는 *사용·체크포인트·재시작 절차* 만 다룬다. 패치 결정·ROI 는 synthesis §6 참조.**

---

## 0. 한눈 흐름

```
[preflight_v5.sh]──PASS──▶[run_v5.sh]──(BG 가동·폴링)──▶[종합 블록]──▶ freevar_v5.log 보관
        │FAIL                    │ stall/서버사망
        └─조치 후 재실행          └─(--auto-restart)──▶ 서버 재가동 + 러너 재시작 (1회)
```

---

## 1. 표준 실행 (권장)

```bash
cd /home/user/SEAGNAL/local_server
bash knowledge/phases/run_v5.sh
```

- `run_v5.sh` 가 내부에서 `preflight_v5.sh` 를 먼저 호출 → PASS 시에만 BG 가동.
- 진행 라인은 stdout 으로 표시(`[YYYY-MM-DDTHH:MM:SSZ] 진행 130/440 elapsed_runner=650s eta=1400s wall=680s`).
- 측정 로그는 `/tmp/freevar.log`, 메타는 `/tmp/freevar_meta.txt`, PID 는 `/tmp/freevar.pid`.
- 완료시 마지막에 종합/지연 라인을 추출해 출력.

---

## 2. preflight_v5.sh — C1~C5 사전점검

| 체크 | 항목 | PASS 기준 | 실패 시 조치 |
|------|------|-----------|--------------|
| C1 | `GET /api/health` | code 200 + `ok:true` | 서버 재가동 |
| C2 | `data/marine_{buoys,vs,wh_buoys}.json` | 3 파일 ≥ 1KB, mtime ≤ 24h | marine.kma 적재 잡 가동 (synthesis §1.1 비고) |
| C3 | `knowledge/graph/{topic,tool}_embeddings.json` | 두 파일 존재 + topics≈169 / tools≈19~20 | 서버 기동시 자동 warmup. 캐시 비어있으면 GEMINI_API_KEY 확인 후 서버 재기동 |
| C4 | `knowledge/jikgun/_thresholds.json` | 8 직군 + `_default` = 9 키 모두 존재 | 임계표 파일 복구 (git restore) |
| C5 | `phase2b_eval_runner.py --n=3` | PASS 10/10 (rc=0) | 골든 회귀 — 즉시 차단, 자유변칙 측정 보류 |
| AUX | `phase2b_eval_freevar.jsonl` 440 라인 / 러너 SHA / 외부 키 | FAIL 아님(메타 기록) | 라인 수 ≠440 시 코드 회귀 신호 |

옵션:

```bash
bash knowledge/phases/preflight_v5.sh            # 전체
bash knowledge/phases/preflight_v5.sh --skip-c5  # 시간 절약 (자유변칙 판정 권한 약화)
bash knowledge/phases/preflight_v5.sh --quiet    # PASS 라인 숨김, FAIL/WARN 만
```

종료 코드: 0 = 전부 PASS / 1 = 어느 C 실패.

---

## 3. run_v5.sh — 가동·폴링·자동 복구

```bash
bash knowledge/phases/run_v5.sh                # 표준
bash knowledge/phases/run_v5.sh --no-preflight # preflight 스킵 (긴급)
bash knowledge/phases/run_v5.sh --auto-restart # stall/서버사망 1회 자동 재시작
bash knowledge/phases/run_v5.sh --dry-run      # 명령만 출력
```

### 3.1 환경 변수

| 변수 | 기본 | 의미 |
|------|------|------|
| `PORT` | 3001 | 로컬 서버 포트 |
| `POLL_INTERVAL_S` | 30 | 폴링 간격(초) |
| `STALL_LIMIT_S` | 300 | 진행 라인 무진행 허용(초) — 초과시 stall 처리 |
| `MAX_RUN_S` | 3900 | 65분. 초과시 강제 종료 (synthesis §0 60분 게이트 + 마진) |
| `SERVER_START_CMD` | `cd $LOCAL_SERVER && nohup node server.js > /tmp/local_server.log 2>&1 &` | `--auto-restart` 시 서버 재가동 명령. 다를 경우 export 후 실행 |

### 3.2 종료 코드 (run_v5.sh)

| 코드 | 의미 |
|------|------|
| 0 | 종합 블록 등장 — 정상 완료 |
| 1 | preflight FAIL |
| 2 | 30s 안 헤더 미출력 |
| 3 | MAX_RUN_S 초과 |
| 4 | 서버 자동 재가동 실패 |
| 5 | stall/서버사망 + 자동 재시작 비활성 또는 이미 사용 |
| 6 | 러너 PID 사망 + 종합 블록 없음 (비정상) |

---

## 4. 체크포인트 — 진행 단계별

| 단계 | 신호 (로그) | 정상 | 비정상 → 대응 |
|------|-------------|------|----------------|
| 가동 직후 | `[..Z] 러너 가동 PID=...` | PID 즉시 발급 | PID 미발급 → exit 6 |
| 30s 내 | `=== Phase 2b 자유 변칙 평가 …` | 헤더 출력 | exit 2 (서버/EVAL 경로) |
| 1~5분 | `진행 10/440 …` `진행 20/440 …` | 10건 단위 진행 | stall → exit 5 (또는 자동 재시작) |
| 5~30분 | 케이스당 ~5s 비례 (440×5≈37분) | 정상 | 케이스당 >8s → 기록만, p95 악화 신호 |
| 30분~ | `==== 종합 PASS ____ ====` | 종합 블록 + p50/p95 | 60분 초과 → exit 3 |
| 완료 | 마지막 30 라인 추출 | `종합 / 지연 / 직군` 라인 출력 | — |

---

## 5. 재시작 절차

### 5.1 자동 (--auto-restart)

`run_v5.sh --auto-restart` 가 다음 조건에서 **1회** 자동 복구를 시도:

1. **stall** (진행 라인 `STALL_LIMIT_S` 초 무진행) 또는
2. **서버 health 실패** (`/api/health` 비-200).

복구 시퀀스:

```
abort_runner (TERM → 5s → KILL)
  → 서버 health 확인
  → 사망시 SERVER_START_CMD 실행 + 최대 30s 대기
  → 헬스 OK 시 /tmp/freevar.log → /tmp/freevar_aborted_<ts>.log
  → start_runner + capture_meta + 폴링 타이머 리셋
```

> 1회 한정. 두 번째 stall/사망은 exit 4/5.

### 5.2 수동 재시작 (synthesis §3.5)

```bash
PID=$(cat /tmp/freevar.pid); kill -TERM $PID; sleep 5
kill -0 $PID 2>/dev/null && kill -KILL $PID
mv -f /tmp/freevar.log /tmp/freevar_aborted_$(date +%Y%m%d_%H%M%S).log
bash knowledge/phases/run_v5.sh    # preflight 부터 다시
```

> 러너는 **체크포인트 없음** — 부분 결과 신뢰 금지. 정본은 *마지막 완주 1회*.

### 5.3 강제 종료만

```bash
PID=$(cat /tmp/freevar.pid); kill -TERM $PID; sleep 5
kill -0 $PID 2>/dev/null && kill -KILL $PID
tail -n 50 /tmp/freevar.log | grep -E '^\s*\[' | tail -1
```

---

## 6. 완료 후 산출물 보관

`run_v5.sh` 종료시 안내되는 명령 (synthesis §8.2 산출물 폴더):

```bash
cp /tmp/freevar.log      knowledge/phases/freevar_v5.log
cp /tmp/freevar_meta.txt knowledge/phases/freevar_v5_meta.txt
# 이후 synthesis §4 표 채워 v5_result_summary.md 작성
# diff_v3_v5.py (synthesis §5.3) 실행 → v5_regression_diff.md
```

---

## 7. 트러블슈팅 빠른표

| 증상 | 의심 | 즉시 명령 |
|------|------|-----------|
| C1 FAIL | 서버 미가동 | `cd local_server && node server.js` 후 재실행 |
| C2 FAIL (size<1KB or age>24h) | marine.kma 적재 미실행 / 외부 장애 | 적재 잡 가동 후 재실행. 환경 결함 의심시 측정 보류 |
| C3 FAIL (파일 없음) | 임베딩 캐시 비어있음 | 서버 재기동시 warmup 자동. `GEMINI_API_KEY` 확인 |
| C3 WARN (개수 불일치) | 그래프 갱신됨 | 메타에 기록 후 계속 진행 가능 |
| C5 FAIL | 평가셋 회귀 (골든 깨짐) | **자유변칙 측정 보류**. 패치 회귀 디버그 우선 |
| preflight PASS 였는데 30s 헤더 없음 | EVAL 경로 / 모듈 임포트 실패 | `tail /tmp/freevar.log` → 파이썬 traceback 확인 |
| `HTTP 429` 다발 | Gemini quota | 중단, 키 교체 후 재시작 (synthesis §3.3) |
| 진행 5분간 정지 | 서버 hang / timeout 미작동 | `--auto-restart` 또는 §5.2 수동 |
| 케이스당 평균 > 8s | LLM 지연 / 다중 도구 폭주 | 종료 안 함, p95 악화 신호 기록 (synthesis §3.3) |

---

## 8. 제약·주의

- 본 스크립트는 **코드/jsonl 수정 없음** — 러너·임계표·평가셋은 그대로.
- 자동 재시작은 **1회** 만. 두 번째 실패는 외부 환경 결함으로 라벨링하고 인간 판단 필요.
- preflight 의 C2/C5 는 SOP 상 **하드 컷오프** — `--skip-c5` 는 비상시만, 결과 신뢰 약화.
- 측정 종합 결과 해석·다음 패치 결정은 본 문서 범위 외. synthesis §4~§10 사용.

---

(끝)
