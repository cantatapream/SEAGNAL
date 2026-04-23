/**
 * [Patch] 특보 알림 상세 팝업 로직 수정 (동절기/하절기 문구 적용)
 * 이 파일은 app.js의 기존 AlertDetailPopup을 덮어씁니다.
 */
window.AlertDetailPopup = {
    // 동절기 확인 (11월 ~ 3월)
    isWinterPeriod(dateStr) {
        if (!dateStr) return false;

        // 1. "01/05 오후..." 같은 문자열 포맷 -> 현재 날짜(now) 기준
        // (푸시 알림에서 온 데이터가 이런 형식이면 현재 시각 기준으로 판단)
        if (typeof dateStr === 'string' && (dateStr.includes('/') || dateStr.includes('오후') || dateStr.includes('오전'))) {
            const now = new Date();
            const month = now.getMonth() + 1;
            return month >= 11 || month <= 3;
        }

        // 2. "202601051200" 같은 숫자 포맷
        const nums = dateStr.replace(/[^0-9]/g, '');
        if (nums.length >= 6) {
            const month = parseInt(nums.substring(4, 6));
            return month >= 11 || month <= 3;
        }

        // 3. 포맷을 알 수 없는 경우 -> 현재 날짜 기준
        const now = new Date();
        const month = now.getMonth() + 1;
        return month >= 11 || month <= 3;
    },

    // 날짜 포맷 (숫자면 포맷팅, 아니면 그대로 유지)
    // 예비특보의 경우 마지막 4자리가 "시작시~종료시" 범위를 의미하므로
    // 범위 패턴에 해당하면 "M월 D일 시간대명(시작~종료시)" 형식으로 변환합니다.
    // 예: "202604031824" → "4월 3일 밤(18~24시)"
    // 정확한 시각인 경우 기존대로 "YYYY-MM-DD HH:MM" 형식으로 변환합니다.
    // 예: "202604021600" → "2026-04-02 16:00"
    formatDateTime(dateStr) {
        if (!dateStr) return '정보 없음';
        if (typeof dateStr !== 'string') return String(dateStr);

        // 숫자로만 구성된 12자리 형식 (YYYYMMDDHHMM 또는 YYYYMMDD시작시종료시)
        const nums = dateStr.replace(/[^0-9]/g, '');
        if (nums.length === 12) {
            const m = nums.substring(4, 6);
            const d = nums.substring(6, 8);
            const timePart = nums.substring(8, 12); // 마지막 4자리 (시:분 또는 시작시~종료시)

            // 기상청 예비특보 시간 범위 패턴 10가지
            // 마지막 4자리가 "시작시간+종료시간"으로 구성된 범위를 의미
            const TIME_RANGES = {
                '0006': '새벽(0~6시)',
                '0609': '아침(6~9시)',
                '0612': '오전(6~12시)',
                '0912': '오전(9~12시)',
                '1215': '낮(12~15시)',
                '1218': '오후(12~18시)',
                '1518': '늦은 오후(15~18시)',
                '1821': '저녁(18~21시)',
                '1824': '밤(18~24시)',
                '2124': '밤(21~24시)'
            };

            // 범위 패턴에 해당하면 "M월 D일 시간대명" 형식 반환
            if (TIME_RANGES[timePart]) {
                return `${parseInt(m)}월 ${parseInt(d)}일 ${TIME_RANGES[timePart]}`;
            }

            // 범위가 아닌 정확한 시각이면 기존 형식 유지
            const y = nums.substring(0, 4);
            const h = nums.substring(8, 10);
            const min = nums.substring(10, 12);
            return `${y}-${m}-${d} ${h}:${min}`;
        }
        return dateStr;
    },

    // 해역명을 링크로 변환
    createZoneLinks(zones, status) {
        if (!zones || zones.length === 0) return '해당 해역';
        return zones.map(zone =>
            `<a href="#" class="alert-zone-link" data-zone="${zone}" data-status="${status}" style="color: var(--accent-blue); text-decoration: underline; cursor: pointer;">${zone}</a>`
        ).join(', ');
    },

    // 메시지 생성 (사용자 요청 문구 반영)
    generateMessage(data) {
        let { alertType, status, tmFc, tmEf, tmYn, zones, prevAlertType } = data;
        const isWinter = this.isWinterPeriod(tmEf); // 발효시각 기준으로 동절기 판단
        const timeStrLong = this.formatDateTime(tmFc || tmEf); // 발표시각
        const effectTimeStr = this.formatDateTime(tmEf);       // 발효시각
        const zoneLinks = this.createZoneLinks(zones, status);

        // [New] 시간 정보가 유효할 때만 접미사를 붙임
        // 범위형(예: '4월 3일 밤(18~24시)')이면 '중', 정확한 시각이면 '부로'
        const timePrefix = (timeStrLong && timeStrLong !== '정보 없음' && timeStrLong !== '미정')
            ? (timeStrLong.includes('~') ? `${timeStrLong} 중 ` : `${timeStrLong}부로 `)
            : '';

        // 용어 명확화
        if (alertType.includes('풍랑') && !alertType.includes('경보')) alertType = '풍랑주의보';
        if (prevAlertType && prevAlertType.includes('풍랑') && !prevAlertType.includes('경보')) prevAlertType = '풍랑주의보';

        let message = '';

        // 1. 풍랑주의보 - 발표 (Publish)
        if (alertType.includes('풍랑') && status === 'publish') {
            if (isWinter) {
                // 동절기 (30톤)
                message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발표'되었습니다.
해역별 정확한 발효시각은 앱의 상세내용에서 확인해 주시고, 발효 시 30톤 미만 어선은 출항 및 조업이 제한되니 사전에 안전지대로 이동 및 대피바랍니다.
* 15톤 이상 출항 가능 조건은 가까운 해양경찰 파출소로 문의

② 어선안전조업법 제49조에 따라 행정처분 대상이 될 수 있습니다.

③ 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 특보 발효 전 조속히 입항하시기 바랍니다.

④ 가까운 해양경찰 파출소로 문의바랍니다.`;
            } else {
                // 경보나 태풍이 아닌 일반 풍랑주의보 (15톤)
                message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발표'되었습니다.
해역별 정확한 발효시각은 앱의 상세내용에서 확인해 주시고, 발효 시 15톤 미만 어선은 출항 및 조업이 제한되니 사전에 안전지대로 이동 및 대피바랍니다.

② 출항 및 조업 제한 위반 시 어선안전조업법 제49조에 따라 어업허가 정지 등 행정처분 대상이 될 수 있습니다.

③ 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 특보 발효 전 조속히 입항하시기 바랍니다.

④ 출항 제한 관련 문의는 가까운 해양경찰 파출소로 문의바랍니다.`;
            }
        }
        // [예외] 풍랑경보/태풍 발표 (Publish)
        else if (['경보', '태풍'].some(t => alertType.includes(t)) && status === 'publish') {
            message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발표'되었습니다.

② 해역별 정확한 발효시각은 앱의 상세내용에서 확인해 주시고, 발효 시 모든 어선은 출항 및 조업이 제한됩니다. 해당 해역 및 인근 해역을 항해하는 어선은 속히 안전지대로 대피해주시기 바랍니다.

③ 어선안전조업법 제49조에 따라 행정처분 대상이 될 수 있습니다.

④ 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 특보 발효 전 조속히 입항하시기 바랍니다.

⑤ 가까운 해경 파출소로 문의바랍니다.`;
        }
        // 2. 풍랑주의보 - 발효 (Active)
        else if (alertType.includes('풍랑') && status === 'active' && !alertType.includes('경보')) {
            if (isWinter) {
                // 동절기 (30톤)
                message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발효'되었습니다.
30톤 미만 어선은 출항 및 조업이 제한되니 조업 중인 어선은 안전지대로 이동 및 대피바랍니다.
* 15톤 이상 출항 가능 조건은 가까운 해양경찰 파출소로 문의

② 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 조속히 입항하시기 바랍니다.

③ 어선안전조업법 제49조에 따라 행정처분 대상이 될 수 있습니다.

④ 해역별 정확한 해제시각은 앱의 상세내용에서 확인해 주시고, 실제 풍랑주의보 해제 시각 이후부터 모든 어선은 즉시 출항이 가능하오니, 수시로 기상특보를 확인바랍니다.

⑤ 가까운 해경 파출소로 문의바랍니다.`;
            } else {
                // 비동절기 (15톤)
                message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발효'되었습니다.
15톤 미만 어선은 출항 및 조업이 제한되니 조업 중인 어선은 안전지대로 이동 및 대피바랍니다.

② 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 조속히 입항하시기 바랍니다.

③ 어선안전조업법 제49조에 따라 행정처분 대상이 될 수 있습니다.

④ 해역별 정확한 해제시각은 앱의 상세내용에서 확인해 주시고, 실제 풍랑주의보 해제 시각 이후부터 모든 어선은 즉시 출항이 가능하오니, 수시로 기상특보를 확인바랍니다.

⑤ 가까운 해경 파출소로 문의바랍니다.`;
            }
        }
        // 3. 풍랑경보/태풍 - 발효 (Active)
        else if (['경보', '태풍'].some(t => alertType.includes(t)) && status === 'active') {
            message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '발효'되었습니다.

② 모든 어선은 출항 및 조업이 제한됩니다. 해당 해역 및 인근 해역을 항해하는 어선은 속히 안전지대로 대피해주시기 바랍니다.

③ 어선안전조업법 제49조에 따라 행정처분 대상이 될 수 있습니다.

④ 주의보 이상의 특보가 발효된 경우 수상레저안전법 제22조에 따라 수상레저기구를 활용한 수상레저활동이 금지되며, 관련 법에 따라 처벌될 수 있으니 조속히 입항하시기 바랍니다.

⑤ 가까운 해경 파출소로 문의바랍니다.`;
        }
        // 4. 해제 (Release)
        else if (status === 'release') {
            message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 '해제'되었습니다. 어선의 출항 및 조업이 가능하나, 출항 전 출항지 및 조업지 해상상태를 확인하시어 안전한 출항과 조업이 되도록 당부드립니다.

② 출항 제한과 관련 문의는 가까운 해경 파출소로 문의바랍니다.`;
        }
        // 5. 격상/격하 (Upgrade/Downgrade)
        else if (status === 'upgrade' || status === 'downgrade') {
            const levelWord = status === 'upgrade' ? '격상' : '격하';
            const targetType = alertType; // 최종 특보

            if (targetType.includes('풍랑') && !targetType.includes('경보')) {
                // 최종 태세가 풍랑주의보
                if (isWinter) {
                    message = `
① ${timePrefix}${zoneLinks}에 ${prevAlertType || '전 단계 특보'}가 ${targetType}으로 ${levelWord}되었습니다.
30톤 미만 어선은 출항 및 조업이 제한되니 조업 중인 어선은 안전지대로 이동 및 대피바랍니다.
* 15톤 이상 출항 가능 조건은 가까운 해양경찰 파출소 문의

② 해제 예정 일시는 앱의 상세내용에서 확인해주시고, 실제 풍랑주의보 해제 시각 이후부터 모든 어선은 즉시 출항이 가능하오니, 수시로 기상특보를 확인바랍니다.

③ 출항 및 조업 제한 위반 시 어선안전조업법 제49조에 따라 어업허가 정지 등 행정처분 대상이 될 수 있습니다.

④ 출항 제한과 관련 문의는 가까운 해경 파출소로 문의바랍니다.`;
                } else {
                    message = `
① ${timePrefix}${zoneLinks}에 ${prevAlertType || '전 단계 특보'}가 ${targetType}으로 ${levelWord}되었습니다.
15톤 미만 어선은 출항 및 조업이 제한되니 조업 중인 어선은 안전지대로 이동 및 대피바랍니다.

② 해제 예정 일시는 앱의 상세내용에서 확인해주시고, 실제 풍랑주의보 해제 시각 이후부터 모든 어선은 즉시 출항이 가능하오니, 수시로 기상특보를 확인바랍니다.

③ 출항 및 조업 제한 위반 시 어선안전조업법 제49조에 따라 어업허가 정지 등 행정처분 대상이 될 수 있습니다.

④ 출항 제한과 관련 문의는 가까운 해경 파출소로 문의바랍니다.`;
                }
            } else {
                // 최종 태세가 경보/태풍
                message = `
① ${timePrefix}${zoneLinks}에 ${prevAlertType || '전 단계 특보'}가 ${targetType}으로 ${levelWord}되었습니다.

② 모든 어선은 출항 및 조업이 제한됩니다. 해당 해역 및 인근 해역을 항해하는 어선은 속히 안전지대로 대피해주시기 바랍니다.

③ 출항 및 조업 제한 위반 시 어선안전조업법 제49조에 따라 어업허가 정지 등 행정처분 대상이 될 수 있습니다.

④ 출항 제한과 관련 문의는 가까운 해경 파출소로 문의바랍니다.`;
            }
        }
        else {
            message = `
① ${timePrefix}${zoneLinks}에 ${alertType}가 발생했습니다.

② 자세한 내용은 앱의 기상특보 탭에서 확인해주세요.`;
        }

        return message.trim();
    },

    // 팝업 표시
    show(data) {
        // [New] 안전정보 팝업 끄기 설정 체크
        const suppressSafetyPopup = localStorage.getItem('suppressSafetyPopup') === 'true';
        if (suppressSafetyPopup) {
            console.log('[AlertDetailPopup] 안전정보 팝업이 설정에 의해 비활성화되었습니다.');
            return; // 팝업 표시하지 않음
        }

        const message = this.generateMessage(data);

        // 기존 팝업 제거
        const existing = document.getElementById('alert-detail-popup');
        if (existing) existing.remove();

        // 제목 및 아이콘 설정
        let title = '기상특보에 따른 안전권고';
        let iconColor = '#f59e0b'; // 주황색 (기본)

        if (data.status === 'release') {
            title = '기상특보 해제 알림';
            iconColor = '#10b981'; // 초록색 (해제)
        }

        // 팝업 생성
        const popup = document.createElement('div');
        popup.id = 'alert-detail-popup';
        popup.innerHTML = `
            <div class="alert-popup-overlay" onclick="AlertDetailPopup.close()"></div>
            <div class="alert-popup-content">
                <div class="alert-popup-header">
                    <h3><i class="fa-solid fa-triangle-exclamation" style="color: ${iconColor};"></i> ${title}</h3>
                    <button class="alert-popup-close" onclick="AlertDetailPopup.close()">✕</button>
                </div>
                <div class="alert-popup-body">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                <div class="alert-popup-footer">
                    <button onclick="AlertDetailPopup.close()" style="padding: 10px 24px; background: var(--accent-blue); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">확인</button>
                </div>
            </div>
        `;

        // 스타일이 없으면 추가
        if (!document.getElementById('alert-popup-style')) {
            const style = document.createElement('style');
            style.id = 'alert-popup-style';
            style.textContent = `
                #alert-detail-popup {
                    position: fixed;
                    inset: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .alert-popup-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.7);
                }
                .alert-popup-content {
                    position: relative;
                    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
                    border-radius: 16px;
                    border: 1px solid rgba(255,255,255,0.1);
                    max-width: 500px;
                    width: 100%;
                    max-height: 80vh;
                    overflow: hidden;
                    animation: alertPopupIn 0.3s ease-out;
                }
                @keyframes alertPopupIn {
                    from { opacity: 0; transform: scale(0.9) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .alert-popup-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .alert-popup-header h3 {
                    margin: 0;
                    font-size: 1.1rem;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .alert-popup-close {
                    background: none;
                    border: none;
                    color: #94a3b8;
                    font-size: 1.2rem;
                    cursor: pointer;
                }
                .alert-popup-body {
                    padding: 20px;
                    color: #e2e8f0;
                    font-size: 0.95rem;
                    line-height: 1.7;
                    max-height: 50vh;
                    overflow-y: auto;
                }
                .alert-popup-footer {
                    padding: 16px 20px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    justify-content: center;
                }
                .alert-zone-link:hover {
                    color: #60a5fa !important;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(popup);

        // 링크 이벤트
        popup.querySelectorAll('.alert-zone-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const zoneName = e.target.dataset.zone;
                this.close();
                // 지도 이동 실행
                if (window.AlertDetailPopup && window.AlertDetailPopup.scrollToZone) {
                    window.AlertDetailPopup.scrollToZone(zoneName, data.status);
                }
            });
        });
    },

    close() {
        const popup = document.getElementById('alert-detail-popup');
        if (popup) popup.remove();
    }
};

// [중요] 기존 app.js에서 scrollToZone을 사용하는 경우를 대비해
// scrollToZone 메서드도 복원해야 합니다. (백업 파일 9443라인)
window.AlertDetailPopup.scrollToZone = function (zoneName, status) {
    const tabId = 'weather-alert-section';
    let cardClass = '.alert-card';

    // 1. 탭 이동
    const tab = document.querySelector(`[data-target="${tabId}"]`);
    if (tab) tab.click();

    setTimeout(() => {
        // 2. 메인 아코디언 강제 열기
        if (status === 'release') {
            cardClass = '.weather-status-card';
            const marineBody = document.getElementById('marine-status-accordion-body');
            if (marineBody && marineBody.classList.contains('collapsed')) {
                if (typeof toggleMarineStatusAccordion === 'function') toggleMarineStatusAccordion();
                else { marineBody.classList.remove('collapsed'); marineBody.style.maxHeight = 'none'; }
            }
        } else {
            const mainBody = document.getElementById('main-accordion-body');
            if (mainBody && mainBody.classList.contains('collapsed')) {
                if (typeof toggleMainAccordion === 'function') toggleMainAccordion();
                else { mainBody.classList.remove('collapsed'); mainBody.style.maxHeight = 'none'; }
            }
        }

        // 3. 대상 카드 찾기
        const cards = document.querySelectorAll(cardClass);
        let targetCard = null;
        cards.forEach(card => {
            if (card.textContent.includes(zoneName)) targetCard = card;
        });

        if (targetCard) {
            // 상위 섹션 열기
            const seaSection = targetCard.closest('.sea-section');
            if (seaSection && !seaSection.classList.contains('open')) {
                const header = seaSection.querySelector('.sea-header');
                if (header) header.click();
            }
            const subRegionSection = targetCard.closest('.sub-region-section');
            if (subRegionSection) {
                const list = subRegionSection.querySelector('.sub-region-list');
                if (list && list.style.display === 'none') {
                    const header = subRegionSection.querySelector('.sub-region-header');
                    if (header) header.click();
                }
            }

            if (status !== 'release') {
                const details = targetCard.querySelector('.alert-details');
                if (details && details.classList.contains('hidden')) {
                    details.classList.remove('hidden');
                }
            }

            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.style.boxShadow = '0 0 20px 5px rgba(255, 215, 0, 0.8)';
            setTimeout(() => { targetCard.style.boxShadow = ''; }, 3000);
        }
    }, 500);
};

// 푸시 팝업 자동 체크 함수 (window에 등록하여 capacitor-plugins.js에서 호출 가능)
window.checkForPushPopup = async function () {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');

    // [New] 시각 변경 / 격상·격하 알림인 경우 팝업 표시 및 지도 이동 기능을 모두 생략함
    const SUPPRESSED_POPUP_STATUSES = [
        'time_ef_change',
        'time_yn_change',
        'level_upgrade_publish',
        'level_upgrade_active',
        'level_downgrade_publish',
        'level_downgrade_active'
    ];
    if (SUPPRESSED_POPUP_STATUSES.includes(status)) {
        console.log(`[AlertDetailPopup] ${status} 알림은 팝업 및 화면 이동을 생략합니다.`);
        // 앱 홈 화면으로 진입한 것처럼 보이도록 URL 파라미터 제거
        if (window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        return;
    }

    if (params.get('popup') === 'true') {
        const alertType = params.get('alertType') || '';
        // 관리자 직접 발송 알림은 alertType이 없으므로 팝업 표시하지 않음
        if (!alertType) return;
        if (alertType.includes('해일')) return;

        const zones = params.get('zones') ? params.get('zones').split(',') : [];

        // [New] 중복 특보 체크 (경보 발효 중 + 주의보 예비 동시 존재 시 팝업 비표시)
        try {
            const response = await fetch('/data/weather_alerts.json');
            if (response.ok) {
                const alertsData = await response.json();
                const currentData = alertsData.current || {};

                // 해역별로 current와 upcoming이 모두 존재하고 등급이 다른지 확인
                let hasDualLevelAlert = false;

                // 재귀적으로 해역 찾기 (4단계 중첩 구조 대응)
                const findZoneData = (obj, targetZone) => {
                    if (!obj || typeof obj !== 'object') return null;
                    for (const [key, value] of Object.entries(obj)) {
                        if (key === targetZone && value && (value.current !== undefined || value.upcoming !== undefined)) {
                            return value;
                        }
                        if (typeof value === 'object' && value !== null) {
                            const found = findZoneData(value, targetZone);
                            if (found) return found;
                        }
                    }
                    return null;
                };

                for (const zone of zones) {
                    const zoneData = findZoneData(currentData, zone);
                    if (zoneData && zoneData.current && zoneData.upcoming) {
                        // 둘 다 존재하고 등급이 다른 경우
                        const currentLevel = zoneData.current.wrnLvl;
                        const upcomingLevel = zoneData.upcoming.wrnLvl;
                        if (currentLevel !== upcomingLevel &&
                            currentLevel !== '예비' && upcomingLevel !== '예비') {
                            // 경보/주의보 조합인 경우
                            if ((currentLevel === '경보' && upcomingLevel === '주의보') ||
                                (currentLevel === '주의보' && upcomingLevel === '경보')) {
                                hasDualLevelAlert = true;
                                console.log(`[AlertDetailPopup] 중복 특보 감지: ${zone} (${currentLevel} + ${upcomingLevel}) - 팝업 비표시`);
                                break;
                            }
                        }
                    }
                }

                if (hasDualLevelAlert) {
                    console.log('[AlertDetailPopup] 등급이 다른 2개의 특보가 동시 존재하여 팝업을 표시하지 않습니다.');
                    return; // 팝업 표시하지 않음
                }
            }
        } catch (err) {
            console.warn('[AlertDetailPopup] 특보 데이터 확인 실패, 팝업 표시 진행:', err.message);
        }

        const data = {
            alertType: alertType,
            status: params.get('status'),
            tmFc: params.get('tmFc'),
            tmEf: params.get('tmEf'),
            tmYn: params.get('tmYn'),
            zones: zones,
            prevAlertType: params.get('prevAlertType')
        };

        setTimeout(() => {
            if (window.AlertDetailPopup) window.AlertDetailPopup.show(data);
        }, 500);
    }
};

// 페이지 로드 시 자동 실행
window.checkForPushPopup();

