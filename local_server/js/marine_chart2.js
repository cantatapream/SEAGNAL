/**
 * ============================================================================
 * 파일명: js/marine_chart2.js
 * 역할: 해상일기도 — 데이터 fetch / 이미지 render / 시간 점프 / 재생 컨트롤
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
     */
    async function fetchList() {
        const { state, el, showToast } = MC;
        if (state.listLoading) return;
        state.listLoading = true;
        showLoading(true);
        showError(false);

        try {
            const params = new URLSearchParams({
                type: state.type,
                data: state.data,
            });
            // 연안 자료는 청 코드도 함께 (백엔드가 [AREA] 자리표시자 치환)
            if (state.type === 'C' && state.area) {
                params.set('area', state.area);
            }
            const res = await fetch(`/api/marine-chart/list?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const list = await res.json();
            if (!Array.isArray(list) || list.length === 0) {
                throw new Error('자료가 없습니다');
            }
            state.list = list;
            // 첫 진입 — "현재시각"(stm=s000) 또는 list[0] 를 기본 표시
            const firstIdx = findCurrentIndex();
            updateSliderRange();
            render(firstIdx);
            highlightJumpButton(0);
        } catch (err) {
            console.error('[marine_chart] fetchList 실패:', err);
            state.list = [];
            showError(true, err.message || '자료를 불러올 수 없습니다.');
        } finally {
            state.listLoading = false;
            showLoading(false);
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

        // 시각 라벨
        const tmLabel = formatTm(item.tm);
        const stmLabel = formatStm(item.stm);
        if (el.timeValue) el.timeValue.textContent = `${tmLabel}${stmLabel ? ' (' + stmLabel + ')' : ''}`;
        if (el.fsTime)    el.fsTime.textContent = tmLabel;
        if (el.fsStep)    el.fsStep.textContent = stmLabel;
        if (el.stepLabel) el.stepLabel.textContent = stmLabel;
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

    function goPrev() {
        const { state } = MC;
        if (state.list.length === 0) return;
        const idx = state.currentIndex > 0
            ? state.currentIndex - 1
            : state.list.length - 1;  // 처음 ← 끝으로 wrap
        render(idx);
    }

    function goNext() {
        const { state } = MC;
        if (state.list.length === 0) return;
        const idx = state.currentIndex < state.list.length - 1
            ? state.currentIndex + 1
            : 0;  // 끝 → 처음으로 wrap
        render(idx);
    }

    /**
     * 자동재생 시작 — setInterval 로 0.6초마다 goNext().
     */
    function play() {
        const { state, el } = MC;
        if (state.playing || state.list.length <= 1) return;
        state.playing = true;
        state.playTimer = setInterval(goNext, state.playIntervalMs);
        updatePlayButtonIcons();
    }

    /**
     * 자동재생 중지.
     */
    function pause() {
        const { state } = MC;
        if (state.playTimer) clearInterval(state.playTimer);
        state.playTimer = null;
        state.playing = false;
        updatePlayButtonIcons();
    }

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
