/**
 * ============================================================================
 * 파일명: js/ocean_warn_active5.js  (5/5 — 클릭 정보박스 + 초기화)
 * 역할 : 부모 zone 클릭 시 어두운 남색 정보 박스 표출, 외부 클릭 자동 close,
 *        모듈 부트스트랩(이벤트 listener 등록 + 버튼 바인딩 polling).
 * ============================================================================
 *
 * [클릭 흐름]
 *   ocean_map.js handleMapClick()
 *     → window.OceanWarnActive.tryHandleClick(map, evt)
 *         ├─ active 모드 아님   → false 반환 (바텀시트로 fallback)
 *         ├─ feature hit X     → false 반환 (바텀시트로 fallback)
 *         ├─ hit 한 zone 이 activeMap 에 없음 → false 반환 (해제된 zone)
 *         └─ activeMap 에 있음 → 박스 표출 + true 반환 (바텀시트 스킵)
 *
 * [박스 닫기]
 *   - X 버튼 click
 *   - document 외부 영역 pointerdown (capture 단계로 등록 → 박스 외 어디든)
 *   - 지도 'movestart' 이벤트 (사용자가 지도 이동/줌 시작)
 * ============================================================================
 */

(function () {
    'use strict';

    var ns = window.OceanWarnActive;
    if (!ns) return;
    var state = ns._state;

    // ────────────────────────────────────────────────────────────────────
    // 시간 문자열 정규화
    // ────────────────────────────────────────────────────────────────────

    /**
     * KMA 가 주는 시각 문자열을 깔끔하게 표시. 우리 데이터는 이미 한국어 포맷
     * (예: "2026년 04월 29일 오후 06시") 이라 거의 그대로 둠. 단 긴 공백·중복 공백 정리.
     */
    function _fmtTime(raw) {
        if (!raw) return '';
        // [표시 포맷] 공통 포맷터 위임 — "M월 D일(라벨) H시 / Hs시~He시"
        if (typeof formatWarningTime === 'function') {
            var r = formatWarningTime(raw);
            if (r && r !== '정보 없음') return r;
        }
        return ('' + raw).replace(/\s+/g, ' ').trim();
    }

    // ────────────────────────────────────────────────────────────────────
    // 클릭 hit 검사
    // ────────────────────────────────────────────────────────────────────

    /**
     * 주어진 픽셀 위치에서 부모 특보구역명 결정.
     *
     * [정책]
     *   - 자식(sub) feature 가 hit 되면 그 자식의 fullName 으로 부모 zone 환원
     *   - 메인(main) feature 가 hit 되면 그 zone 이름 그대로
     *   - 자식이 부모보다 위에 그려지므로 자식이 우선 hit 됨 (자연스러움)
     *
     * @param {ol.Map} map
     * @param {Array<number>} pixel - [x, y]
     * @returns {string|null} - 부모 zoneName
     */
    function _findHitParentZone(map, pixel) {
        var mainLayer = window.OceanWarnZone && window.OceanWarnZone.getMainLayer();
        var subLayer  = window.OceanWarnZone && window.OceanWarnZone.getSubLayer();
        if (!mainLayer && !subLayer) return null;

        var found = null;
        map.forEachFeatureAtPixel(pixel, function (feature, layer) {
            if (found) return; // 첫 hit 사용
            if (layer === subLayer) {
                var fullName = window.OceanWarnZone.getSubFullName(feature);
                var parent = ns._resolveParentByFullName(fullName);
                if (parent) found = parent;
            } else if (layer === mainLayer) {
                var name = window.OceanWarnZone.getMainZoneName(feature);
                if (name) found = name;
            }
        }, {
            layerFilter: function (l) { return l === mainLayer || l === subLayer; },
            hitTolerance: 2
        });

        return found;
    }

    /**
     * [S9-E] 클릭 위치의 hit 정보 (kind 포함) 반환.
     *   _findHitParentZone 의 확장 버전 — 자식이 hit 되었는지 부모가 hit 되었는지
     *   구분해서 알려준다. 자식 active 여부에 따라 자식 박스 / 부모 박스 분기에 사용.
     *
     * @returns {{kind:'main'|'sub', fullName?:string, parent:string} | null}
     */
    function _findHit(map, pixel) {
        var mainLayer = window.OceanWarnZone && window.OceanWarnZone.getMainLayer();
        var subLayer  = window.OceanWarnZone && window.OceanWarnZone.getSubLayer();
        if (!mainLayer && !subLayer) return null;

        var hit = null;
        map.forEachFeatureAtPixel(pixel, function (feature, layer) {
            if (hit) return;
            if (layer === subLayer) {
                var fullName = window.OceanWarnZone.getSubFullName(feature);
                if (fullName) {
                    var parent = ns._resolveParentByFullName(fullName);
                    hit = { kind: 'sub', fullName: fullName, parent: parent || '' };
                }
            } else if (layer === mainLayer) {
                var name = window.OceanWarnZone.getMainZoneName(feature);
                if (name) hit = { kind: 'main', parent: name };
            }
        }, {
            layerFilter: function (l) { return l === mainLayer || l === subLayer; },
            hitTolerance: 2
        });

        return hit;
    }

    // ────────────────────────────────────────────────────────────────────
    // 박스 DOM 빌드
    // ────────────────────────────────────────────────────────────────────

    /**
     * 알림 종류·등급 라벨을 우리 표기 규칙으로 정규화.
     *
     * [입력 예시]    [출력]
     *   warnType="풍랑",     level="주의보", isUpcoming=false → "풍랑주의보 발효"
     *   warnType="풍랑",     level="경보",   isUpcoming=false → "풍랑경보 발효"
     *   warnType="풍랑",     level="주의보", isUpcoming=true  → "풍랑주의보 발표"
     *   warnType="풍랑예비", level="예비",   isUpcoming=true  → "풍랑주의보 발표"
     *   warnType="태풍",     level="경보",   isUpcoming=false → "태풍경보 발효"
     *
     * [정규화 규칙]
     *   - warnType 끝의 "예비" 제거 (KMA raw "풍랑예비" → "풍랑")
     *   - level === "예비" → "주의보" (예비 = 풍랑주의보가 곧 발효 예정 상태)
     *   - 상태 접미사: isUpcoming(=isPreliminary)=true → " 발표", false → " 발효"
     */
    function _buildTypeText(a, isUpcoming) {
        var type = (a.warnType || '').replace(/예비$/, '');     // "풍랑예비" → "풍랑"
        var lvl  = (a.level === '예비') ? '주의보' : (a.level || '');
        var state = isUpcoming ? '발표' : '발효';
        return type + lvl + ' ' + state;
    }

    /**
     * 한 알림(alertItem) 을 박스 한 블록으로 렌더링.
     *
     * [표시 라인 — 데이터 있을 때만]
     *   - 종류·등급·상태 (예: "풍랑경보 발효" / "태풍주의보 발표")
     *   - 발표 (tmFc)
     *   - 발효 / 발효 예정 (tmEf, isUpcoming 분기)
     *   - 해제 / 해제 예정 (tmCc, 있으면 "해제 예정" 으로 표기)
     *   - 격상/격하 (command='변경' + prevLevel)
     *
     * @param {Object} a          - alertItem (appState.alerts[])
     * @param {boolean} isUpcoming - true 면 "발표/발효 예정" 라벨 사용
     */
    function _renderAlertBlock(a, isUpcoming) {
        var lines = [];

        // 종류·등급·상태 라벨 (예: "풍랑주의보 발표")
        lines.push('<div class="warn-active-line warn-active-type">• '
            + _esc(_buildTypeText(a, isUpcoming)) + '</div>');

        if (a.tmFc) {
            lines.push('<div class="warn-active-line"><span class="warn-active-key">발표</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmFc)) + '</span></div>');
        }
        if (a.tmEf) {
            // isUpcoming=true 면 "발효 예정", false 면 "발효"
            var efLabel = isUpcoming ? '발효 예정' : '발효';
            lines.push('<div class="warn-active-line"><span class="warn-active-key">' + efLabel + '</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmEf)) + '</span></div>');
        }
        // 해제 시각이 잡혀 있으면 "해제 예정" 으로 표기.
        // [근거] appState.alerts 에는 아직 활성 또는 다가오는 알림만 들어감
        //        (이미 해제된 알림은 제외) → tmCc 가 있다면 향후 해제 예정 시각.
        if (a.tmCc) {
            lines.push('<div class="warn-active-line"><span class="warn-active-key">해제 예정</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmCc)) + '</span></div>');
        }
        // 격상/격하 — data.js 에서 command='변경' + prevLevel 채워줌
        if (a.command === '변경' && a.prevLevel) {
            // 이전 등급 → 현재 등급 (예: "주의보 → 경보")
            var curLvl = (a.level === '예비') ? '주의보' : (a.level || '');
            var arrow = a.prevLevel + ' → ' + curLvl;
            lines.push('<div class="warn-active-line"><span class="warn-active-key">격상/격하</span>'
                + '<span class="warn-active-val">' + _esc(arrow) + '</span></div>');
        }
        return lines.join('');
    }

    /**
     * HTML 안전 escape — zone 이름·시각 문자열에 < > & 가 들어와도 안전하게 표시.
     */
    function _esc(s) {
        return ('' + (s || ''))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 정보 박스를 만들어 화면에 띄움.
     *
     * [위치 선정]
     *   기본: 클릭한 픽셀의 약간 아래·우측에 박스 좌상단을 둠
     *   화면 우측/하단을 넘어가면 자동으로 반대쪽으로 뒤집기
     *
     * @param {string} parentZone
     * @param {Array<number>} pixel - [x, y]
     */
    ns._showBox = function (parentZone, pixel) {
        ns._hideBox(); // 기존 박스 있으면 먼저 닫기

        var info = state.activeMap[parentZone];
        if (!info) return;

        // 선택 강조 — 부모 zone 단위 강조. 자식 선택은 상호배타적으로 해제.
        // refresh 후 OL layer 가 즉시 재평가되어 색이 바뀜.
        state.selectedZone = parentZone;
        state.selectedSubName = null;
        if (window.OceanWarnZone && typeof window.OceanWarnZone.refresh === 'function') {
            window.OceanWarnZone.refresh();
        }

        // 박스 콘텐츠 빌드
        var html = ''
            + '<div class="warn-active-box-header">'
            +   '<span class="warn-active-box-title">' + _esc(parentZone) + '</span>'
            +   '<button type="button" class="warn-active-box-close" aria-label="닫기">&times;</button>'
            + '</div>'
            + '<div class="warn-active-box-body">';

        var hasCurrent = info.allCurrents.length > 0;
        var hasUpcoming = info.allUpcomings.length > 0;
        // "다가오는 특보" 섹션 헤더는 '둘 다 있을 때' 만 표출 (요구사항).
        // 단독으로 다가오는 특보만 있는 경우엔 "현재 발효 중" 등 헤더 없이
        // 그 알림 블록만 표출 → 사용자에게 혼동을 주지 않음.
        var showSectionHeaders = hasCurrent && hasUpcoming;

        if (hasCurrent) {
            html += '<div class="warn-active-section">';
            // 둘 다 있을 때만 명시적 헤더. 단독이면 zone 명 아래 바로 알림 블록.
            // (현재 발효 중 헤더는 다가오는 특보 헤더와의 시각적 균형을 위해 단독엔 생략)
            for (var i = 0; i < info.allCurrents.length; i++) {
                html += '<div class="warn-active-item">' + _renderAlertBlock(info.allCurrents[i], false) + '</div>';
            }
            html += '</div>';
        }
        if (hasUpcoming) {
            // 단독이면 일반 섹션, 둘 다면 "다가오는 특보" 헤더 + 가로 구분선 표시
            var sectionClass = showSectionHeaders
                ? 'warn-active-section warn-active-section-upcoming'
                : 'warn-active-section';
            html += '<div class="' + sectionClass + '">';
            if (showSectionHeaders) {
                html += '  <div class="warn-active-section-title">다가오는 특보</div>';
            }
            for (var j = 0; j < info.allUpcomings.length; j++) {
                html += '<div class="warn-active-item">' + _renderAlertBlock(info.allUpcomings[j], true) + '</div>';
            }
            html += '</div>';
        }
        html += '</div>'; // box-body

        // 박스 컨테이너
        var box = document.createElement('div');
        box.className = 'warn-active-box';
        box.innerHTML = html;
        document.body.appendChild(box);

        // 위치 조정 — 클릭 픽셀 아래·우측 (지도 컨테이너 기준 → 화면 절대 좌표 변환)
        var mapEl = document.getElementById('ocean-map');
        var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var px = (pixel && pixel[0] != null) ? pixel[0] : 0;
        var py = (pixel && pixel[1] != null) ? pixel[1] : 0;
        var pageX = rect.left + px;
        var pageY = rect.top + py;

        // 박스 크기 측정
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // 기본: 클릭 위치 우측 12px, 아래 12px
        var left = pageX + 12;
        var top  = pageY + 12;
        if (left + bw + 12 > vw) left = pageX - bw - 12; // 우측 침범 시 좌측으로
        if (top + bh + 12 > vh)  top  = pageY - bh - 12; // 하단 침범 시 위로
        if (left < 8) left = 8;
        if (top < 8)  top  = 8;

        box.style.left = left + 'px';
        box.style.top  = top + 'px';

        // 닫기 버튼
        var closeBtn = box.querySelector('.warn-active-box-close');
        if (closeBtn) closeBtn.addEventListener('click', ns._hideBox);

        state.box = box;
        _bindOutsideClose();
    };

    /**
     * 박스 닫기 — DOM 제거 + outside listener 해제.
     */
    ns._hideBox = function () {
        if (state.box && state.box.parentNode) {
            state.box.parentNode.removeChild(state.box);
        }
        state.box = null;
        _unbindOutsideClose();

        // 선택 강조 해제 (부모 + 자식 둘 다) — _styler 가 다음 렌더부터 일반 색상으로 복귀.
        // active 모드일 때만 layer 재평가 (OFF 상태면 styler 가 이미 null).
        if (state.selectedZone || state.selectedSubName) {
            state.selectedZone = null;
            state.selectedSubName = null;
            if (state.active && window.OceanWarnZone
                && typeof window.OceanWarnZone.refresh === 'function') {
                window.OceanWarnZone.refresh();
            }
        }
    };

    /**
     * document 의 capture-phase pointerdown 으로 박스 외부 클릭 감지.
     * 박스 내부 클릭은 contains 검사로 무시.
     *
     * [중요 — "닫기만, 연쇄 동작 X" 정책]
     *   외부 클릭으로 박스를 닫을 때 state.boxJustClosedAt 에 현재 시각을
     *   기록한다. 같은 click 으로 잠시 후 발생할 map singleclick → handleMapClick
     *   → tryHandleClick 이 그 timestamp 를 보고 일정 시간(현재 400ms) 안의
     *   호출은 "방금 박스 닫는 의도였음" 으로 간주, 새 박스/바텀시트 호출 없이
     *   true 만 반환한다. → 결과: 외부 클릭 1번 = 박스 닫힘만, 다음 클릭부터
     *   새 박스/동작 가능 (요구사항).
     */
    function _bindOutsideClose() {
        if (state.boxOutsideHandler) return; // 중복 방지
        state.boxOutsideHandler = function (e) {
            if (!state.box) return;
            if (state.box.contains(e.target)) return; // 박스 안 클릭은 유지
            ns._hideBox();
            state.boxJustClosedAt = Date.now();
        };
        document.addEventListener('pointerdown', state.boxOutsideHandler, true);
    }
    /**
     * _bindOutsideClose 의 역동작 — document 의 pointerdown 리스너 해제.
     *
     * [호출 시점]
     *   - _hideBox 시 (박스가 사라졌으므로 외부 클릭 listener 도 더 이상 불필요)
     *   - listener leak 방지: 박스가 떠 있는 동안만 등록 → 사라지면 해제
     *
     * [안전성]
     *   state.boxOutsideHandler 가 null 이면 (이미 해제됐거나 등록한 적 없으면)
     *   바로 return — 중복 해제 무해.
     */
    function _unbindOutsideClose() {
        if (!state.boxOutsideHandler) return;
        document.removeEventListener('pointerdown', state.boxOutsideHandler, true);
        state.boxOutsideHandler = null;
    }

    // ────────────────────────────────────────────────────────────────────
    // 외부 공개 API — 지도 클릭 가드 (ocean_map.js handleMapClick 호출)
    // ────────────────────────────────────────────────────────────────────

    /**
     * 활성 모드에서 호출되는 지도 클릭 가드.
     *
     * [반환값 정책]
     *   - state.active === false → false 반환 (바텀시트 흐름 그대로 진행)
     *   - state.active === true  → 항상 true 반환 (바텀시트 차단)
     *     · 요구사항: 활성 모드일 때는 비활성 zone 클릭에서도 바텀시트(드롭박스)가
     *       뜨지 않아야 함. 바텀시트는 OFF 상태 전용.
     *     · CCTV/부이/마커 등은 handleMapClick 에서 우리 가드 이전에 처리되므로
     *       그쪽 동작은 영향 없음 (정상 작동).
     *
     * [박스 외부 클릭 가드 (boxJustClosedAt)]
     *   외부 클릭으로 박스가 막 닫혔다면 같은 click 으로 발생한 이번 호출은
     *   "닫기 의도" 로 간주, 새 박스 표출 없이 즉시 true 반환.
     *   → 외부 클릭 1번 = 박스 닫힘 한 번만, 다음 클릭부터 새 박스 표출 가능.
     *
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true → 이 모듈이 처리함 (바텀시트 스킵).
     *                   false → 처리 안 함 (바텀시트 흐름 계속, OFF 상태에서만).
     */
    ns.tryHandleClick = function (map, evt) {
        // active 모드 아닐 때는 절대 처리 안 함 → 기존 바텀시트 흐름 유지
        if (!state.active) return false;
        if (!evt || !evt.pixel) return false;

        // [닫기 의도 가드] 외부 클릭으로 박스가 막 닫힌 click 이면 후속 동작 차단
        // 윈도우 400ms — pointerdown → singleclick 통상 100ms 이내라 충분히 여유
        if (state.boxJustClosedAt && (Date.now() - state.boxJustClosedAt) < 400) {
            state.boxJustClosedAt = 0;
            return true;  // 새 박스/바텀시트 모두 차단
        }

        // [S9-E] hit 정보를 kind 까지 확보. 자식 폴리곤이 active 한 경우 자식 박스,
        //   그 외엔 기존대로 부모 박스로 환원.
        var hit = _findHit(map, evt.pixel);

        if (hit && hit.kind === 'sub') {
            // 자식 hit — coastalAlerts 에서 active 한 dmdw 데이터가 있는지 확인
            var coastalMap = (window.appState && window.appState.coastalAlerts) || {};
            var childArr = coastalMap[hit.fullName] || [];
            var hasActiveChild = childArr.some(function (a) {
                // 색칠 가능한 종류이며 (paletteKey 있음) 발효 또는 다가오는 상태 둘 다
                return a && ns._resolvePaletteKey(a.warnType);
            });
            if (hasActiveChild) {
                ns._showChildBox(hit.fullName, hit.parent, evt.pixel);
                return true;
            }
            // 자식이 active 아닌 경우 — 기존대로 부모로 환원해서 부모 박스 표출
            var info = hit.parent ? state.activeMap[hit.parent] : null;
            if (info) ns._showBox(hit.parent, evt.pixel);
            return true;
        }

        if (hit && hit.kind === 'main') {
            var parentInfo = state.activeMap[hit.parent];
            if (parentInfo) ns._showBox(hit.parent, evt.pixel);
            return true;
        }

        // 활성 모드에서는 비활성 zone 클릭/빈 해역 클릭도 바텀시트 표출 차단
        return true;
    };

    /**
     * [S9-E] 자식 해역(연안바다·평수구역) 전용 박스 표출.
     *
     * @param {string} fullName    - 자식 fullName (예: "제주도서부앞바다중북서연안바다")
     * @param {string} parentZone  - 부모 zone (강조 표시용)
     * @param {Array<number>} pixel - [x, y]
     *
     * [표시 정책 — 사용자 요구]
     *   • 발표시각 (tmFc) + 발효시각 (tmEf) 표시
     *   • 해제 예정 시각은 dmdw 가 제공 안 함. 단:
     *       presentInLastFc === false 인 경우 (마지막 FC 사이클에서 사라짐)
     *       → "해제 예정" 텍스트 한 줄만 표시 (시각 없음, 라벨 없음)
     *       presentInLastFc === true / undefined → 해제 예정 행 자체 없음
     *   • 대표 alert 1건만 표시 (자식 색칠과 동일 우선순위 룰):
     *       발효 중 우선 → 같은 종류 내 경보 > 주의보 > 예비
     */
    ns._showChildBox = function (fullName, parentZone, pixel) {
        ns._hideBox();

        var coastalMap = (window.appState && window.appState.coastalAlerts) || {};
        var arr = coastalMap[fullName] || [];
        if (!arr.length) return;

        // 대표 alert 선택 — _buildChildInfoForStyle 과 동일한 우선순위.
        var currents = arr.filter(function (a) { return a && !a.isPreliminary; });
        var pick;
        if (currents.length) {
            currents.sort(function (x, y) {
                return (x.level === '경보' ? 0 : 1) - (y.level === '경보' ? 0 : 1);
            });
            pick = currents[0];
        } else {
            pick = arr[0];
        }
        if (!pick) return;

        var isUpcoming = !!pick.isPreliminary;

        // 선택 강조 — 자식 단위로 강조. 부모 선택은 상호배타적으로 해제.
        // _styler (3.js) 가 selectedSubName 과 일치하는 자식 feature 의 stroke 를
        // 노란색 강조로 렌더 → 사용자가 클릭한 자식만 정확히 부각.
        state.selectedSubName = fullName;
        state.selectedZone = null;
        if (window.OceanWarnZone && typeof window.OceanWarnZone.refresh === 'function') {
            window.OceanWarnZone.refresh();
        }

        // 박스 콘텐츠 구성
        var html = ''
            + '<div class="warn-active-box-header">'
            +   '<span class="warn-active-box-title">' + _esc(fullName) + '</span>'
            +   '<button type="button" class="warn-active-box-close" aria-label="닫기">&times;</button>'
            + '</div>'
            + '<div class="warn-active-box-body">'
            +   '<div class="warn-active-section">'
            +     '<div class="warn-active-item">';

        // 종류·등급·상태 (예: "풍랑주의보 발효")
        html += '<div class="warn-active-line warn-active-type">• '
              + _esc(_buildTypeText(pick, isUpcoming)) + '</div>';

        // 발표시각
        if (pick.tmFc) {
            html += '<div class="warn-active-line"><span class="warn-active-key">발표</span>'
                  + '<span class="warn-active-val">' + _esc(_fmtTime(pick.tmFc)) + '</span></div>';
        }
        // 발효시각 (or 발효 예정)
        if (pick.tmEf) {
            var efLabel = isUpcoming ? '발효 예정' : '발효';
            html += '<div class="warn-active-line"><span class="warn-active-key">' + efLabel + '</span>'
                  + '<span class="warn-active-val">' + _esc(_fmtTime(pick.tmEf)) + '</span></div>';
        }

        // [S9-E 핵심] "해제 예정" 조건부 표시
        //   • 발효 중(!isUpcoming) 일 때만 의미 있음
        //   • presentInLastFc === false 인 경우만 → "해제 예정" 한 줄
        //   • 시각·라벨 없이 텍스트만 (dmdw 가 정확한 해제 시각 제공 안 함)
        if (!isUpcoming && pick.presentInLastFc === false) {
            html += '<div class="warn-active-line warn-active-release-pending">'
                  + '<span class="warn-active-val">해제 예정</span></div>';
        }

        html += '</div></div></div>';

        // 박스 DOM 생성 + 위치 조정 (_showBox 와 동일 로직 — 단순성 위해 인라인 복제)
        var box = document.createElement('div');
        box.className = 'warn-active-box';
        box.innerHTML = html;
        document.body.appendChild(box);

        var mapEl = document.getElementById('ocean-map');
        var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var px = (pixel && pixel[0] != null) ? pixel[0] : 0;
        var py = (pixel && pixel[1] != null) ? pixel[1] : 0;
        var pageX = rect.left + px;
        var pageY = rect.top + py;
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var left = pageX + 12;
        var top  = pageY + 12;
        if (left + bw + 12 > vw) left = pageX - bw - 12;
        if (top + bh + 12 > vh)  top  = pageY - bh - 12;
        if (left < 8) left = 8;
        if (top < 8)  top  = 8;
        box.style.left = left + 'px';
        box.style.top  = top + 'px';

        var closeBtn = box.querySelector('.warn-active-box-close');
        if (closeBtn) closeBtn.addEventListener('click', ns._hideBox);

        state.box = box;
        _bindOutsideClose();
    };

    /**
     * 지도 외부에서 호출 가능한 강제 새로고침 — 향후 디버깅·관리자 모드용.
     */
    ns.refresh = function () {
        ns._buildActiveMap();
        ns._renderButton();
        if (state.active && window.OceanWarnZone) {
            window.OceanWarnZone.refresh();
        }
    };

    /** 현재 색칠 모드인지 외부에서 조회 */
    ns.isActive = function () { return !!state.active; };

    // ────────────────────────────────────────────────────────────────────
    // 부트스트랩 — 이벤트 listener 등록 + 버튼/지도 준비될 때까지 polling
    // ────────────────────────────────────────────────────────────────────

    /**
     * 'seagnal:alerts-changed' 핸들러 — 특보 데이터가 갱신되면:
     *   1) activeMap 다시 만들고
     *   2) 버튼 표시 갱신 (특보 없음 → ON 가능 / 다시 특보 없음 등 자동 전환)
     *   3) 활성 모드면 layer 다시 그리기
     *   4) 활성 모드 도중 특보가 모두 사라졌으면 자동 _deactivate
     */
    function _onAlertsChanged() {
        ns._buildActiveMap();
        // 활성 도중 색칠 가능 항목이 0 이 되면 자동 OFF
        if (state.active && !ns._hasAnyColorableActive()) {
            ns._deactivate();
            return;
        }
        ns._renderButton();
        if (state.active && window.OceanWarnZone) {
            window.OceanWarnZone.refresh();
        }
        // 활성 모드일 때 범례도 새 활성 맵 기준으로 다시 빌드
        // (예: 새로 태풍 특보가 추가되면 태풍 행이 자동으로 범례에 등장)
        if (state.active && typeof ns._renderLegend === 'function') {
            ns._renderLegend();
        }
        // 박스가 떠 있다면 닫음 — 이전 시점 데이터일 수 있어 안전하게 닫기
        if (state.box) ns._hideBox();
    }

    /**
     * 지도 'movestart' 발생 시 박스 자동 닫기 (사용자가 화면 이동/줌 시작).
     */
    function _bindMapClose(map) {
        if (!map) return;
        map.on('movestart', function () { if (state.box) ns._hideBox(); });
    }

    /**
     * 부트 — DOM/지도/특보구역 모듈 모두 준비될 때까지 폴링하다 한 번 초기화.
     *
     * [준비 조건]
     *   1) #ocean-warn-active-toggle-btn DOM 존재 (5.html 추가 후)
     *   2) window.OceanWarnZone 객체 (ocean_warn_zone.js 로드)
     *   3) window.getOceanMap() 가 OL Map 반환 (ocean_map.js 초기화 완료)
     */
    function _bootWhenReady() {
        var attempts = 0;
        var TIMER_MS = 250;

        function tick() {
            attempts++;
            var btnReady = !!document.getElementById('ocean-warn-active-toggle-btn');
            var zoneReady = !!window.OceanWarnZone;
            var map = (typeof window.getOceanMap === 'function') ? window.getOceanMap() : null;
            var mapReady = !!map;

            if (btnReady && zoneReady && mapReady) {
                _initialize(map);
                return;
            }
            // 무기한 polling — ocean_warn_zone.js 와 동일 패턴 (시간 제한 없음)
            setTimeout(tick, TIMER_MS);
        }
        tick();
    }

    /**
     * 모듈 1회 초기화 — _bootWhenReady 가 모든 의존성(버튼/지도/특보구역 모듈)이
     * 준비됐다고 판단하면 호출.
     *
     * [수행 작업]
     *   1) appState.alerts 기준 첫 활성 맵 빌드
     *   2) 토글 버튼 + 베이스맵 피커 + 특보구역 버튼 동기 listener 바인딩
     *   3) 토글 버튼 첫 표시 (대부분 특보구역 OFF 라 display:none 으로 시작)
     *   4) data.js 가 발화하는 'seagnal:alerts-changed' 이벤트 listen
     *   5) 지도 movestart 시 박스 자동 닫기 — 사용자가 화면 이동/줌 시작하면
     *      박스가 덜렁덜렁 따라다니지 않도록.
     *
     * [재호출 방지]
     *   _bootWhenReady 가 1회 성공 후 자체 종료. _bindButton 도 dataset 으로
     *   중복 등록 방지하므로 만약 우연히 재호출돼도 안전.
     */
    function _initialize(map) {
        // 1) 활성 맵 1차 빌드 (이미 데이터 있을 수 있음)
        ns._buildActiveMap();

        // 2) 버튼 바인딩 + 첫 표시
        if (typeof ns._bindButton === 'function') ns._bindButton();
        ns._renderButton();

        // 3) 'seagnal:alerts-changed' listener 등록
        window.addEventListener('seagnal:alerts-changed', _onAlertsChanged);

        // 4) 지도 movestart 시 박스 닫기
        _bindMapClose(map);

        ns._log('initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bootWhenReady);
    } else {
        _bootWhenReady();
    }
})();
