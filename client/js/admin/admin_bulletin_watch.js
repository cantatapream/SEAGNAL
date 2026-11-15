/**
 * ============================================================================
 * 파일명: client/js/admin/admin_bulletin_watch.js
 * 역할  : 관리자 → 특보 관리 → 「통보문 관찰」 탭. 방재기상플랫폼 통보문 관련 기능을 한곳에 모은다.
 *         ① 통보문 관찰기 기록 내려받기(매분 관찰 — 빈 통보문이 채워지는 모습 등)
 *         ② MMIS ↔ 통보문 특보 비교 보고서 내려받기(services/bulletin_compare)
 *         ③ 참고사항 AI 시험 — 3차(2025년)·2차(2026년)·1차(ChatGPT·200건) 칸마다 [시험 시작] [멈춤] [결과 내려받기]
 *         (사용자 확정 2026-11-15: 「카톡 중계 탭에 넣지말고 통보문 관찰이라는 탭을 하나 더 두고」 「보내는 시각은 ㄱ(누르면 바로)」)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js (window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부 · 탭 등록 switchAlertTopTab)
 *  - 서버 API      : GET /api/admin/bulletin-watch/report.md · GET /api/admin/bulletin-ai-trial?trial=1|2|3|4(4 = 「AI 특보 분석」 설정 순서) ·
 *                    POST /api/admin/bulletin-ai-trial/start · POST /api/admin/bulletin-ai-trial/stop · GET /api/admin/bulletin-ai-trial/report.md ·
 *                    GET /api/admin/bulletin-compare/report.md
 *                    (routes/bulletin_watch.js)
 *  - 마크업        : 없음(admin.js 의 #alert-top-content 안에 그린다)
 *  - 나를 쓰는 곳  : admin/admin.js renderUnifiedAlertContent → 「통보문 관찰」 탭 · 검사 test_bulletin_ai_trial(UI 부분)
 * [로드 순서] index2.html 에서 admin/admin.js 뒤, admin_kakao_relay.js 다음.
 * ============================================================================
 */
(function () {
    'use strict';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function btn(label, onclick, tone) {
        return '<button type="button" onclick="' + onclick + '" style="padding:5px 10px;margin:6px 6px 0 0;border-radius:8px;border:1px solid rgba(' + tone + ',0.5);'
            + 'background:rgba(' + tone + ',0.12);color:rgb(' + tone + ');font-size:0.78rem;cursor:pointer">' + esc(label) + '</button>';
    }
    function box(title, inner) {
        return '<div style="background:#161b22;border:1px solid #2a3340;border-radius:10px;padding:10px 12px;margin:10px 0">'
            + '<div style="font-weight:700;color:#cdd6e0;font-size:0.9rem;margin-bottom:4px">' + title + '</div>' + inner + '</div>';
    }
    var STATUS_WORD = { idle: '대기 중', running: '진행 중', stopped: '멈춤', done: '다 끝남' };
    var KST = function (iso) { if (!iso) return '—'; var d = new Date(new Date(iso).getTime() + 9 * 3600e3); return d.toISOString().slice(5, 16).replace('T', ' ') + ' KST'; };

    /**
     * 시험 상태 글을 만든다.
     * 예: trialText({status:'running', done:37, total:200, failed:1, lastAt:'…'}) → '상태: 진행 중 · 37/200 끝남 · 실패 1 …'
     * @param {object} s GET /api/admin/bulletin-ai-trial 응답
     * @returns {string} HTML
     * [연계] ← refreshTrial(이 파일)
     */
    function trialText(s) {
        return '<div style="font-size:0.82rem;color:#cdd6e0">상태: <b>' + esc(STATUS_WORD[s.status] || s.status) + '</b> · ' + esc(s.done) + '/' + esc(s.total) + ' 끝남 · 실패 ' + esc(s.failed) + '</div>'
            + '<div style="font-size:0.76rem;color:#9aa7b4;margin-top:2px">마지막 응답: ' + esc(KST(s.lastAt)) + (s.stopReason ? ' · ' + esc(s.stopReason) : '') + (s.lastError ? ' · 마지막 오류: ' + esc(s.lastError) : '') + '</div>';
    }

    /** 시험 상태를 다시 받아 그린다. 진행 중이면 10초 뒤 또(탭을 떠나 칸이 없어지면 멈춘다). @param {'1'|'2'} id [연계] → GET /api/admin/bulletin-ai-trial?trial= */
    async function refreshTrial(id) {
        var el = document.getElementById('bw-trial-status-' + id);
        if (!el) return;
        try {
            var r = await fetch('/api/admin/bulletin-ai-trial?trial=' + id, { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var s = await r.json();
            el.innerHTML = trialText(s);
            if (s.status === 'running') setTimeout(function () { refreshTrial(id); }, 10000);
        } catch (e) {
            console.warn('[통보문 관찰] AI 시험 상태 불러오기 실패:', e && e.message);
            el.innerHTML = '<span style="color:#f87171">상태를 불러오지 못했습니다 — ' + esc(e.message) + '</span>';
        }
    }

    /** 관리자 토큰이 붙도록 fetch 로 받아 파일로 저장한다. [연계] ← 내려받기 버튼들 */
    async function download(url, name) {
        try {
            var r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var a = document.createElement('a');
            a.href = URL.createObjectURL(await r.blob());
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) {
            console.warn('[통보문 관찰] 내려받기 실패:', e && e.message);
            window.alert('내려받지 못했습니다 — ' + e.message);
        }
    }

    var START_ASK = {
        '1': '1차 참고사항 AI 시험(ChatGPT, 200건)을 지금 시작할까요?\n\nChatGPT 줄을 나리야·브리핑 AI 와 함께 써서, 진행 중엔 나리야 답이 늦어질 수 있습니다.\n끝난 건은 건너뛰고 이어서 합니다.',
        '3': '3차 참고사항 AI 시험(클로드 키2, 2025년 224건)을 지금 시작할까요?\n\n관리자 센터 「클로드 키2」 크레딧을 씁니다(나리야 답변 순서의 같은 키). 크레딧이 다 떨어지면 바로 멈춥니다.\n끝난 건은 건너뛰고 이어서 합니다.',
        '2': '2차 참고사항 AI 시험(클로드 키2, 161건)을 지금 시작할까요?\n\n관리자 센터 「클로드 키2」 크레딧을 씁니다(나리야 답변 순서 1번 칸과 같은 키). 크레딧이 다 떨어지면 바로 멈춥니다.\n끝난 건은 건너뛰고 이어서 합니다.'
    };
    /** [시험 시작]·[멈춤] — 시작은 한 번 더 묻는다. @param {'start'|'stop'} kind @param {'1'|'2'} id [연계] → POST /api/admin/bulletin-ai-trial/start|stop?trial= */
    async function trialAction(kind, id) {
        if (kind === 'start' && !window.confirm(START_ASK[id])) return;
        try {
            var r = await fetch('/api/admin/bulletin-ai-trial/' + kind + '?trial=' + id, { method: 'POST', cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
        } catch (e) {
            console.warn('[통보문 관찰] AI 시험 ' + kind + ' 실패:', e && e.message);
            window.alert((kind === 'start' ? '시작' : '멈춤') + '하지 못했습니다 — ' + e.message);
        }
        refreshTrial(id);
    }

    /**
     * 시험 한 칸(상태·버튼).
     * @param {'1'|'2'} id  @param {string} title  @param {string} desc  @param {string} warn
     * @returns {string} HTML
     * [연계] ← renderBulletinWatchAdminTab(이 파일)
     */
    function trialBox(id, title, desc, warn) {
        return box(title,
            '<div style="font-size:0.8rem;color:#9aa7b4;margin-bottom:6px">' + desc + '</div>'
            + '<div id="bw-trial-status-' + id + '" style="font-size:0.8rem;color:#9aa7b4">불러오는 중…</div>'
            + '<div>' + btn('시험 시작', "window.__bwTrial('start','" + id + "')", '96,165,250') + btn('멈춤', "window.__bwTrial('stop','" + id + "')", '248,113,113')
            + btn('결과 내려받기', "window.__bwDownload('/api/admin/bulletin-ai-trial/report.md?trial=" + id + "','bulletin_ai_trial_" + id + ".md')", '167,139,250') + '</div>'
            + '<div style="font-size:0.74rem;color:#f0b35a;margin-top:6px">' + warn + '</div>');
    }

    /**
     * 「통보문 관찰」 탭을 그린다.
     * @param {HTMLElement} container #alert-top-content
     * [연계] ← admin.js switchAlertTopTab('bulletin-watch')
     */
    function renderBulletinWatchAdminTab(container) {
        container.innerHTML = '<div style="padding:4px 2px">'
            + box('📡 통보문 관찰기록',
                '<div style="font-size:0.8rem;color:#9aa7b4">방재기상플랫폼 특보·예비특보 통보문을 1분마다 보며 처음 보인 모습과 바뀐 모습(빈 통보문이 채워짐·내용 바뀜·번호 바뀜)을 남긴 기록입니다. 관찰만 하고 앱 특보현황·푸시는 바꾸지 않습니다.</div>'
                + btn('기록 내려받기', "window.__bwDownload('/api/admin/bulletin-watch/report.md?day=all','bulletin_watch_all.md')", '52,211,153'))
            + box('📊 MMIS ↔ 통보문 특보 비교',
                '<div style="font-size:0.8rem;color:#9aa7b4">MMIS 기준(실제 앱)과 통보문 기준(관찰·계산만)의 해역별 특보 상태와 푸시를 매분 맞대어 남긴 기록입니다. MMIS 실제 푸시가 몇 분 몇 초에 무엇으로 나갔는지, 통보문 기준이었다면 언제 무엇으로 나갔을지(보내지 않은 가상 푸시)를 나란히 봅니다. 메인 화면 「기상정보」 옆 [통보문] 버튼으로 통보문 기준 목록도 볼 수 있습니다.</div>'
                + btn('비교 보고서 내려받기', "window.__bwDownload('/api/admin/bulletin-compare/report.md?day=all','bulletin_compare_all.md')", '251,191,36'))
            + trialBox('4', '🤖 참고사항 AI 시험 — 설정한 순서 · 표본 200건',
                '관리자 센터 AI 탭 「AI 특보 분석」의 「② 참고사항 해석」 순서대로(1순위가 실패하면 다음 순위) 1차와 같은 표본 200건을 한 건씩 읽혀 규칙 결과와 맞춰 봅니다. 결과에 몇 순위 AI 가 답했는지 남습니다. 실제 특보현황·푸시에는 반영하지 않습니다.',
                '※ 순서에 든 AI 의 크레딧·정액제 한도를 씁니다. 순서를 바꾸면 그다음 건부터 새 순서로 갑니다. 멈추면 지금 건만 마치고 서고, 다시 시작하면 이어서 합니다.')
            + trialBox('3', '🤖 참고사항 AI 시험 3차 — 클로드 키2 · 2025년 새 표현 224건',
                '2025년 통보문 중 1·2차 표본에 없던 문장 모양(경보→주의보 변경 발표·예비특보 추가 발표·「길게 이어지지 않아」·머리줄만 있는 글 등)이 든 224건을 「클로드 키2」에 한 건씩 읽혀 규칙 결과와 맞춰 봅니다. 실제 특보현황·푸시에는 반영하지 않습니다.',
                '※ 「클로드 키2」 크레딧을 씁니다. 크레딧이 다 떨어지면 바로 멈춥니다. 멈추면 지금 건만 마치고 서고, 다시 시작하면 이어서 합니다.')
            + trialBox('2', '🤖 참고사항 AI 시험 2차 — 클로드 키2 · 2026년 새 표현 161건',
                '1차 표본에 없던 2026년 문장 모양(해제예고 앞당김·정확한 해제 시각·바다와 육상이 섞인 문장 등)과 규칙이 못 읽던 해역 표현이 든 통보문 161건을, 관리자 센터 「클로드 키2」(claude-sonnet-5-5 · medium)에 한 건씩 읽혀 규칙 결과와 맞춰 봅니다. 실제 특보현황·푸시에는 반영하지 않습니다.',
                '※ 「클로드 키2」 크레딧을 씁니다(나리야 답변 순서의 같은 키). 크레딧이 다 떨어지면 바로 멈춥니다. 멈추면 지금 건만 마치고 서고, 다시 시작하면 이어서 합니다.')
            + trialBox('1', '🤖 참고사항 AI 시험 1차 — ChatGPT · 표본 200건',
                '지난 통보문 참고사항 200건을 서버의 ChatGPT 에 읽혀 정해진 칸으로 옮기게 하고, 규칙 결과와 나란히 맞춰 봅니다. 한 건씩 차례로 보내며, 실제 특보현황·푸시에는 반영하지 않습니다.',
                '※ ChatGPT 줄을 나리야·브리핑 AI 와 함께 씁니다. 진행 중엔 나리야 답이 늦어질 수 있습니다. 멈추면 지금 건만 마치고 서고, 다시 시작하면 이어서 합니다.')
            + '</div>';
        refreshTrial('4');
        refreshTrial('3');
        refreshTrial('2');
        refreshTrial('1');
    }

    window.renderBulletinWatchAdminTab = renderBulletinWatchAdminTab;
    window.__bwTrial = trialAction;
    window.__bwDownload = download;
    window.__bwTrialText = trialText;   // 검사용
})();
