/**
 * ============================================================================
 * 파일명: js/marine_chart2.js
 * 역할: 해상일기도 — 데이터 fetch / 이미지 render / 시간 점프 / 재생 컨트롤
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : marine_chart1.js (window.MarineChart 의 state·el 사용)
 *  - 서버 API      : GET /api/marine-chart/list (가용 시각 목록 프록시)
 *  - 마크업        : marine_chart1.js 가 바인딩한 인라인/풀스크린 <img> · 슬라이더 · 재생 버튼
 *  - 나를 쓰는 곳  : marine_chart1.js(드롭다운 변경 → fetchList) · marine_chart3~5.js(render/재생 연동)
 * ============================================================================
 *
 * [개요]
 * marine_chart1.js 가 정의한 state·el 을 사용해서:
 *   1) 백엔드(/api/marine-chart/list) 에서 가용 시각 목록을 받아 state.list 채움
 *   2) 인덱스 기반으로 인라인+풀스크린 두 <img> 를 동시 갱신 (자동재생 끊김 방지)
 *   3) 시간 점프 버튼(-48H ~ +48H) 을 가장 가까운 frame 으로 매핑
 *   4) 슬라이더 양방향 바인딩 (인라인↔풀스크린 동기)
 *   5) 자동재생 (이전/재생/다음, 0.6초 간격, 끝나면 처음으로 루프)
 *
 * [전역 노출] window.MarineChart 에 다음 추가:
 *   fetchList(), render(idx), jumpHours(h), play(), pause(), togglePlay(),
 *   setIndex(idx), goPrev(), goNext()
 *
 * [초보자 안내]
 *   "프레임" = state.list[i] 의 GIF 1장. 자동재생은 i 를 0,1,2... 차례로 늘리며
 *   render(i) 를 호출하는 것. 슬라이더는 i 를 시각적으로 보여주고 사용자가
 *   드래그하면 그 i 로 이동.
 * ============================================================================
 */

(function () {
    'use strict';

    const MC = window.MarineChart;
    if (!MC) {
        console.error('[marine_chart2] marine_chart1.js 가 먼저 로드되어야 합니다.');
        return;
    }

    /**
     * 백엔드 프록시(/api/marine-chart/list)에서 가용 시각 목록을 받아 state.list 갱신.
     * 성공 시 첫 진입 인덱스(현재시각 = +0H에 가장 가까운 항목) 로 자동 render.
     *
     * [Race condition 방지 — AbortController 패턴]
     * 사용자가 빠르게 영역/변수/청 드롭다운을 연속 변경하면 fetchList 가 여러 번
     * 호출됨. 이전엔 state.listLoading 으로 lock 을 걸어 후속 호출을 무시했지만,
     * 그 결과 첫 호출(이전 선택)의 응답이 화면에 적용되어 드롭다운/화면 불일치 발생.
     *
     * 해결: 새 fetch 시작 시 이전 fetch 를 abort. 그러면 이전 응답은 도착하지
     * 않거나(취소됨) AbortError 로 떨어져 catch 에서 무시됨. 항상 마지막 호출의
     * 결과만 화면에 반영.
     */
    async function fetchList() {
        const { state } = MC;
        // 이전 진행 중 fetch 가 있으면 취소
        if (state.fetchAbort) {
            try { state.fetchAbort.abort(); } catch (e) { /* 이미 없어졌거나 정리된 뒤일 수 있다 — 정리는 실패해도 그대로 둔다 */ }
        }
        const ac = new AbortController();
        state.fetchAbort = ac;

        showLoading(true);
        showError(false);

        try {
            const params = new URLSearchParams({
                cat:  state.category,    // 카테고리 (wave/surge/current/sst)
                type: state.type,
                data: state.data,
            });
            if (state.category === 'wave') {
                // 연안일 때만 청 코드 (KMA 가 [AREA] server-side 치환)
                if (state.type === 'C' && state.area) {
                    params.set('area', state.area);
                }
                // BUOY 스펙트럼 변수: [STN] 자리표시자 + stn 전송
                if (state.type === 'C' && state.data && state.data.includes('[STN]') && state.stn) {
                    params.set('stn', state.stn);
                }
            } else if (state.category === 'surge') {
                // 폭풍해일 시계열-지방청 (data='kim_rtsm_jibang') 일 때만 stn 전송
                if (state.data === 'kim_rtsm_jibang' && state.stn) {
                    params.set('stn', state.stn);
                }
            } else if (state.category === 'current') {
                // 해양순환은 항상 area=수심 전송
                if (state.area) {
                    params.set('area', state.area);
                }
            }
            // sst 는 type/data 만으로 충분 (영역=type, 평균기간=data)
            const res = await fetch(`/api/marine-chart/list?${params}`, {
                signal: ac.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const list = await res.json();
            // 이 시점에 더 최신 fetch 가 시작됐으면 결과 무시
            if (state.fetchAbort !== ac) return;
            if (!Array.isArray(list) || list.length === 0) {
                throw new Error('자료가 없습니다');
            }
            state.list = list;
            // 첫 진입 — "현재시각"(stm=s000) 또는 list[0] 를 기본 표시
            const firstIdx = findCurrentIndex();
            updateSliderRange();
            render(firstIdx);
            highlightJumpButton(0);
            // [사용량] 해상일기도 첫 프레임 표출 완료 → chart.load (세션당 1회만)
            if (!MC._usageLoadCounted) {
                MC._usageLoadCounted = true;
                if (window.trackUsage) window.trackUsage('chart.load');
            }
        } catch (err) {
            // 취소 에러는 정상 흐름이므로 무시 (새 fetch 가 진행 중이라는 의미)
            if (err.name === 'AbortError') return;
            console.error('[marine_chart] fetchList 실패:', err);
            state.list = [];
            showError(true, err.message || '자료를 불러올 수 없습니다.');
        } finally {
            // 자기 자신이 최신 ac 인 경우에만 로딩 인디케이터/abort 슬롯 정리
            // (더 최신 fetch 가 진행 중이면 그쪽이 알아서 정리)
            if (state.fetchAbort === ac) {
                state.fetchAbort = null;
                showLoading(false);
            }
        }
    }

    /**
     * state.list 에서 "현재시각(가장 가까운 +0H)" 인덱스 찾기.
     * KMA 응답에서 stm='s000' 인 항목이 있으면 그것, 없으면 0.
     */
    function findCurrentIndex() {
        const list = MC.state.list;
        const idx = list.findIndex(item => item.stm === 's000');
        return idx >= 0 ? idx : 0;
    }

    /**
     * 슬라이더 범위(min/max)를 list 길이에 맞게 갱신.
     * 인라인·풀스크린 슬라이더 둘 다 동시 갱신.
     */
    function updateSliderRange() {
        const { state, el } = MC;
        const max = Math.max(0, state.list.length - 1);
        if (el.slider)   { el.slider.max = max; el.slider.value = 0; }
        if (el.fsSlider) { el.fsSlider.max = max; el.fsSlider.value = 0; }
    }

    /**
     * 인덱스에 해당하는 GIF 를 인라인 + 풀스크린 두 <img> 에 동시 적용.
     * 시각 라벨(기준시각/예측시각) 도 같이 갱신.
     */
    function render(index) {
        const { state, el } = MC;
        if (index < 0 || index >= state.list.length) return;
        state.currentIndex = index;
        const item = state.list[index];

        // 두 이미지 동시 갱신 (브라우저 캐시로 1회만 실제 다운로드)
        if (el.image && item.url) {
            el.image.src = item.url;
            showError(false);
        }
        if (el.fsImage && item.url) {
            el.fsImage.src = item.url;
        }

        // 슬라이더 위치 동기
        if (el.slider)   el.slider.value = index;
        if (el.fsSlider) el.fsSlider.value = index;

        // 시각 라벨 — ftm(발효시각, 표출 자료의 절대 시각) 만 사용.
        // "+nH" 같은 offset 표기 제거 — 사용자가 "직관적이지 않다" 보고.
        // 형식: "YYYY년 MM월 DD일 HH시"
        const ftmLabel = formatFtm(item.ftm || item.tm);
        if (el.timeValue) el.timeValue.textContent = ftmLabel;
        if (el.fsTime)    el.fsTime.textContent = ftmLabel;
        // stepLabel/fsStep 은 보조 정보 — 사용자 요구상 +H 제거. 빈값으로.
        if (el.stepLabel) el.stepLabel.textContent = '';
        if (el.fsStep)    el.fsStep.textContent = '';
    }

    /**
     * 시간 점프 버튼 처리 (-48H ~ +48H).
     * stm='s000' 항목을 기준으로 hours 만큼 떨어진 가장 가까운 항목으로 이동.
     * 자료에 해당 시각이 없으면 가장 가까운 항목으로 fallback.
     */
    function jumpHours(hours) {
        const { state } = MC;
        if (state.list.length === 0) return;
        // 기준: stm='s000' 가 있으면 그 항목, 없으면 list[0]
        const baseIdx = findCurrentIndex();
        // 각 항목의 +nH offset 을 ftm 차이로 계산
        const baseTm = parseKmaTm(state.list[baseIdx].ftm);
        if (!baseTm) {
            highlightJumpButton(hours);
            return;
        }
        const targetMs = baseTm.getTime() + hours * 3600 * 1000;
        // list 에서 ftm 이 가장 가까운 항목 찾기
        let bestIdx = baseIdx;
        let bestDiff = Infinity;
        state.list.forEach((item, idx) => {
            const t = parseKmaTm(item.ftm);
            if (!t) return;
            const diff = Math.abs(t.getTime() - targetMs);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIdx = idx;
            }
        });
        render(bestIdx);
        highlightJumpButton(hours);
    }

    /**
     * 시간 점프 버튼들 중 활성 표시 갱신.
     */
    function highlightJumpButton(hours) {
        const { el } = MC;
        if (!el.timeJump) return;
        el.timeJump.querySelectorAll('button[data-jump]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.jump, 10) === hours);
        });
    }

    /**
     * 슬라이더 입력 → 해당 인덱스로 이동.
     * (인라인/풀스크린 슬라이더에서 호출)
     */
    function setIndex(index) {
        const idx = Math.max(0, Math.min(MC.state.list.length - 1, parseInt(index, 10) || 0));
        render(idx);
        highlightJumpButton(NaN); // 슬라이더 직접 이동은 어떤 시간 점프와도 매칭 안 됨
    }

    /** 차트 슬라이드 이전(idx - 1) 으로 이동. 첫 항목이면 마지막으로 wrap-around. */
    function goPrev() {
        const { state } = MC;
        if (state.list.length === 0) return;
        const idx = state.currentIndex > 0
            ? state.currentIndex - 1
            : state.list.length - 1;  // 처음 ← 끝으로 wrap
        render(idx);
    }

    /** 차트 슬라이드 다음(idx + 1) 으로 이동. 마지막 항목이면 첫 항목으로 wrap-around. */
    function goNext() {
        const { state } = MC;
        if (state.list.length === 0) return;
        const idx = state.currentIndex < state.list.length - 1
            ? state.currentIndex + 1
            : 0;  // 끝 → 처음으로 wrap
        render(idx);
    }

    /**
     * 자동재생 시작 — 로드 체인 패턴 (setInterval 대신).
     *
     * 이전엔 setInterval 로 0.6초마다 goNext() 호출 → render() 가 img.src 를
     * 변경 → 슬라이더는 즉시 갱신되지만 GIF 다운로드는 비동기. 큰 파일이거나
     * 느린 네트워크에선 슬라이더가 이미지보다 앞서 나가는 문제.
     *
     * 새 패턴:
     *   1) 다음 인덱스의 GIF 를 먼저 preload (별도 Image 객체)
     *   2) onload 발화 시 render() 호출 — 브라우저 캐시에 이미 있어 즉시 표시
     *   3) state.playIntervalMs 만큼 대기 후 다음 frame
     *
     * → 슬라이더와 화면 이미지가 항상 동기. 사용자가 속도 칩을 변경하면
     *   다음 대기 시간부터 즉시 적용.
     */
    function play() {
        const { state } = MC;
        if (state.playing || state.list.length <= 1) return;
        state.playing = true;
        // [사용량] 재생이 실제 시작된 성공 분기에서만 카운트 (누를 때마다 +1)
        if (window.trackUsage) window.trackUsage('chart.play');
        updatePlayButtonIcons();
        _scheduleNextFrame();
    }

    /**
     * 다음 프레임을 미리 받고, 받은 즉시 render + 일정 시간 대기 → 재귀.
     * pause() 가 호출되면 state.playing=false 가 되어 체인이 자연스럽게 종료됨.
     */
    function _scheduleNextFrame() {
        const { state } = MC;
        if (!state.playing || state.list.length <= 1) return;

        // 다음 인덱스 (마지막이면 처음으로 wrap)
        const nextIdx = state.currentIndex < state.list.length - 1
            ? state.currentIndex + 1 : 0;
        const item = state.list[nextIdx];
        if (!item || !item.url) return;

        // preload Image 로 다운로드 → onload 시 화면 갱신
        const preload = new Image();
        const proceed = () => {
            if (!state.playing) return;
            render(nextIdx);
            // 화면에 표시한 뒤 사용자가 바꾼 최신 속도로 대기
            state.playTimer = setTimeout(_scheduleNextFrame, state.playIntervalMs);
        };
        preload.onload = proceed;
        preload.onerror = proceed;   // 로드 실패해도 진행 (스킵 효과)
        preload.src = item.url;
    }

    /**
     * 자동재생 중지. 체인은 state.playing=false 만으로 끊기지만 안전을 위해
     * pending setTimeout 도 정리.
     */
    function pause() {
        const { state } = MC;
        if (state.playTimer) clearTimeout(state.playTimer);
        state.playTimer = null;
        state.playing = false;
        updatePlayButtonIcons();
    }

    /** 자동재생 ON/OFF 토글 — 현재 playing 상태에 따라 pause/play 분기. */
    function togglePlay() {
        if (MC.state.playing) pause();
        else play();
    }

    /**
     * 재생/정지 버튼 아이콘 갱신 (인라인 + 풀스크린).
     */
    function updatePlayButtonIcons() {
        const { state, el } = MC;
        const iconClass = state.playing ? 'fa-pause' : 'fa-play';
        const setIcon = (btn) => {
            if (!btn) return;
            const i = btn.querySelector('i');
            if (i) {
                i.classList.remove('fa-play', 'fa-pause');
                i.classList.add(iconClass);
            }
        };
        setIcon(el.playToggle);
        setIcon(el.fsToggle);
    }

    // ── 인라인 컨트롤 이벤트 바인딩 (init 후 1회) ──
    function bindControls() {
        const { el } = MC;
        if (el.slider) {
            el.slider.addEventListener('input', () => setIndex(el.slider.value));
        }
        if (el.fsSlider) {
            el.fsSlider.addEventListener('input', () => setIndex(el.fsSlider.value));
        }
        if (el.playPrev)   el.playPrev.addEventListener('click', goPrev);
        if (el.playNext)   el.playNext.addEventListener('click', goNext);
        if (el.playToggle) el.playToggle.addEventListener('click', togglePlay);
        if (el.fsPrev)     el.fsPrev.addEventListener('click', goPrev);
        if (el.fsNext)     el.fsNext.addEventListener('click', goNext);
        if (el.fsToggle)   el.fsToggle.addEventListener('click', togglePlay);

        // 속도 칩 — 인라인 + 풀스크린 동일 핸들러로 묶음 (둘 다 state 공유)
        bindSpeedChips(el.speedChips);
        bindSpeedChips(el.fsSpeedChips);
    }

    /**
     * 속도 칩 그룹에 클릭 핸들러 바인딩.
     * 클릭 시 state.playIntervalMs 변경 + 양쪽 칩 그룹의 active 시각 동기.
     * 자동재생 중이면 다음 _scheduleNextFrame 의 setTimeout 부터 즉시 적용.
     */
    function bindSpeedChips(group) {
        if (!group) return;
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('.mc-speed-chip');
            if (!btn) return;
            const ms = parseInt(btn.dataset.speed, 10);
            if (!isFinite(ms) || ms <= 0) return;
            MC.state.playIntervalMs = ms;
            // 인라인·풀스크린 양쪽 칩 그룹 모두 active 동기
            syncSpeedChipsActive(ms);
        });
    }

    /** 재생 속도 칩(0.5x/1x/2x...) 활성 표시를 ms 값에 맞춰 동기화. 일반/풀스크린 두 그룹 모두 갱신. */
    function syncSpeedChipsActive(ms) {
        const { el } = MC;
        [el.speedChips, el.fsSpeedChips].forEach(group => {
            if (!group) return;
            group.querySelectorAll('.mc-speed-chip').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.speed, 10) === ms);
            });
        });
    }

    // ── 시각 포맷터 ──
    /**
     * KMA tm/ftm 포맷("yyyymmddhh") → "YYYY.MM.DD HH KST" 로 표시.
     * KMA 응답의 tm 은 KST 기준이므로 KST 라벨로 표기.
     */
    function formatTm(tm) {
        if (!tm || tm.length < 10) return '--';
        return `${tm.slice(0, 4)}.${tm.slice(4, 6)}.${tm.slice(6, 8)} ${tm.slice(8, 10)} KST`;
    }

    /**
     * KMA ftm(발효시각, "yyyymmddhh") → "'YY. M. D.(요일) HH시 기준" 형식.
     * 사용자가 직관적으로 읽을 수 있는 표시 — render() 의 시각 라벨에 사용.
     * 예: "2026043003" → "'26. 4. 30.(목) 03시 기준"
     *
     * 요일 계산: Date.UTC + getUTCDay() — 사용자 로컬 타임존과 무관하게
     * 일정 (KST 시각의 날짜 부분만 사용, 요일은 그 날짜 기준).
     */
    function formatFtm(ftm) {
        if (!ftm || ftm.length < 10) return '--';
        var yyyy = parseInt(ftm.slice(0, 4), 10);
        var yy   = ftm.slice(2, 4);                       // '26'
        var mm   = parseInt(ftm.slice(4, 6), 10);         // 4 (앞 0 제거)
        var dd   = parseInt(ftm.slice(6, 8), 10);         // 30
        var hh   = ftm.slice(8, 10);                      // '03' (2자리 유지)
        var dateObj = new Date(Date.UTC(yyyy, mm - 1, dd));
        var dayKor = ['일','월','화','수','목','금','토'][dateObj.getUTCDay()];
        return "'" + yy + ". " + mm + ". " + dd + ".(" + dayKor + ") " + hh + "시 기준";
    }

    /**
     * stm("s003" 등) → "+3H" 라벨.
     */
    function formatStm(stm) {
        if (!stm) return '';
        const m = stm.match(/^s(\d+)$/);
        if (!m) return stm;
        const h = parseInt(m[1], 10);
        return h === 0 ? '실황' : `+${h}H`;
    }

    /**
     * KMA tm/ftm 문자열을 Date 객체로 (KST 기준).
     * "2026042621" → 2026-04-26 21:00 KST → JS Date(UTC -9h)
     */
    function parseKmaTm(tm) {
        if (!tm || tm.length < 10) return null;
        const y = parseInt(tm.slice(0, 4), 10);
        const mo = parseInt(tm.slice(4, 6), 10) - 1;
        const d = parseInt(tm.slice(6, 8), 10);
        const h = parseInt(tm.slice(8, 10), 10);
        // KST = UTC+9. JS Date 는 로컬 타임존 기반이지만 비교 목적이라 일관되면 OK
        return new Date(Date.UTC(y, mo, d, h - 9));
    }

    // ── 로딩/에러 표시 헬퍼 ──
    function showLoading(on) {
        const { el } = MC;
        if (el.imageLoading) el.imageLoading.hidden = !on;
    }
    /**
     * 차트 이미지 로딩 실패 시 에러 메시지 표출/숨김.
     * @param {boolean} on - true 면 표시, false 면 숨김
     * @param {string=} msg - 표시할 메시지 (생략 시 기본 메시지)
     */
    function showError(on, msg) {
        const { el } = MC;
        if (el.imageError) {
            el.imageError.hidden = !on;
            if (on && msg) el.imageError.textContent = msg;
        }
    }

    // ── DOMContentLoaded 후 1회 컨트롤 바인딩 ──
    // (init() 이 호출되어 el.* 이 채워진 다음에 작동하므로 첫 fetchList 직전에 묶음)
    const _origInit = MC.init;
    MC.init = function () {
        _origInit();
        // bindControls 는 한 번만
        if (!MC._controlsBound) {
            bindControls();
            MC._controlsBound = true;
        }
    };

    // ── 전역 노출 ──
    Object.assign(MC, {
        fetchList,
        render,
        jumpHours,
        setIndex,
        goPrev,
        goNext,
        play,
        pause,
        togglePlay,
    });
})();
