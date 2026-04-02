/**
 * ============================================================================
 * 파일명: js/render.js
 * 역할: 메인 UI 렌더링 (renderApp, createAlertElement)
 * ============================================================================
 *
 * [설명]
 * - renderApp(): 특보 데이터를 해역별로 그룹화하여 메인 화면에 표시
 * - createAlertElement(): 개별 특보 카드 DOM 요소 생성 (아코디언 포함)
 *
 * [로딩 순서] 5번째 (data.js 이후)
 * ============================================================================
 */

function renderApp() {
    const seaSections = {
        '동해': document.getElementById('east-sea-list'),
        '서해': document.getElementById('west-sea-list'),
        '남해': document.getElementById('south-sea-list'),
        '제주': document.getElementById('jeju-sea-list')
    };

    const seaCounts = {
        '동해': document.getElementById('east-count'),
        '서해': document.getElementById('west-count'),
        '남해': document.getElementById('south-count'),
        '제주': document.getElementById('jeju-count')
    };

    // Clear content
    Object.values(seaSections).forEach(el => {
        if (el) el.innerHTML = '';
    });

    let counts = { '동해': 0, '서해': 0, '남해': 0, '제주': 0 };

    // Group by Sea (대분류) and SubRegion (중분류)
    const groups = {};        // 대분류별 그룹: { '동해': [[alert1, alert2], [alert3]], ... }
    const subGroups = {};     // 중분류별 그룹: { '동해남부해상': [[alert1, alert2]], ... }

    // [New] 동일 구역의 특보를 하나로 묶기
    const zoneAlertsMap = {};

    // 1. 메인 특보 데이터 기반으로 맵 구성
    appState.alerts.forEach(item => {
        if (item.isCoastal) return;
        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(item.zoneName)) return;

        if (!zoneAlertsMap[item.zoneName]) {
            zoneAlertsMap[item.zoneName] = [];
        }
        zoneAlertsMap[item.zoneName].push(item);
    });

    // 2. [수정] 연안바다/평수구역 특보가 있는 경우, 해당 상위 구역(Parent)도 맵에 추가
    // (메인 특보가 없더라도 연안 특보를 보여주기 위해 카드를 생성해야 함)
    if (appState.coastalAlerts) {
        for (const [coastalName, alerts] of Object.entries(appState.coastalAlerts)) {
            if (alerts && alerts.length > 0) {
                // 이 연안구역이 속한 모든 상위 구역(Parent) 찾기
                for (const [parentName, subZones] of Object.entries(COASTAL_MAPPING)) {
                    // 공백 제거 및 부분 일치 비교 (KMA 데이터는 '평수구역'을 '평수구'로 줄여 보내는 경우가 많음)
                    const isMatch = subZones.some(sz => {
                        let szNorm = (sz.fullName || '').replace(/\s+/g, '');
                        let cNorm = coastalName.replace(/\s+/g, '');

                        // '평수구'로 끝나는 경우 '역'을 붙여서 비교 시도
                        if (cNorm.endsWith('평수구')) cNorm += '역';
                        if (szNorm.endsWith('평수구')) szNorm += '역';

                        return szNorm === cNorm || (szNorm.length > 5 && cNorm.length > 5 && (szNorm.startsWith(cNorm) || cNorm.startsWith(szNorm)));
                    });

                    if (isMatch) {
                        // 사용자가 설정에서 숨긴 구역은 건너뜀
                        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(parentName)) continue;

                        if (!zoneAlertsMap[parentName]) {
                            // 메인 특보가 없는 경우 더미 객체 하나 추가 (구역명 보존 및 에러 방지용)
                            // dummy: true 속성을 통해 메인 특보가 없음을 createAlertElement에서 알 수 있음
                            zoneAlertsMap[parentName] = [{
                                zoneName: parentName,
                                isDummy: true,
                                // 기본값 설정
                                warnType: '',
                                level: '',
                                tmFc: '',
                                tmEf: '',
                                tmEd: ''
                            }];
                        }
                    }
                }
            }
        }
    }

    Object.keys(zoneAlertsMap).forEach(zoneName => {
        const items = zoneAlertsMap[zoneName];
        const subRegion = getSubRegion(zoneName) || '기타';
        const mainRegion = getMainRegion(subRegion);

        // 대분류 그룹에 배열(items) 추가
        if (!groups[mainRegion]) groups[mainRegion] = [];
        groups[mainRegion].push(items);

        // 중분류 그룹에 배열(items) 추가
        if (!subGroups[subRegion]) subGroups[subRegion] = [];
        subGroups[subRegion].push(items);
    });

    // console.log('Grouped items:', zoneAlertsMap);

    // Render with 2-level structure
    for (const [mainRegion, mainItems] of Object.entries(groups)) {
        if (!seaSections[mainRegion]) continue;

        const container = seaSections[mainRegion];

        // 해당 대분류의 중분류 목록
        const subRegionList = SEA_REGIONS[mainRegion]?.subRegions || [];

        // 제주는 중분류가 하나뿐이므로 서브헤더 없이 바로 렌더링
        if (mainRegion === '제주' || subRegionList.length <= 1) {
            // 정렬하여 렌더링
            const sortedItems = sortAlertItems(mainItems);
            sortedItems.forEach(item => {
                counts[mainRegion]++;
                container.appendChild(createAlertElement(item));
            });
        } else {
            // 중분류별로 서브 섹션 생성
            subRegionList.forEach(subRegion => {
                const subItems = subGroups[subRegion];
                if (!subItems || subItems.length === 0) return;

                // 서브 섹션 컨테이너
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // 서브 헤더 (중분류명) - 해역보다 작고, 특보구역보다 크게
                const subHeader = document.createElement('div');
                subHeader.className = 'sub-region-header';
                subHeader.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    background: linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6));
                    border-radius: 10px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    border-left: 4px solid #4fc3f7;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                `;
                subHeader.innerHTML = `
                    <span style="font-size: 1.0rem; font-weight: 700; color: #fff;">${subRegion}</span>
                    <span style="background: linear-gradient(135deg, #FFA726, #E65100); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #fff; margin-left: auto;">${subItems.length}개 해역</span>
                `;

                // 호버 효과 (그라디언트만 변경, 이동 없음)
                subHeader.onmouseenter = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(40, 80, 140, 0.9), rgba(52, 102, 180, 0.7))';
                };
                subHeader.onmouseleave = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6))';
                };

                // 목록 컨테이너 (기본: 숨김)
                const listContainer = document.createElement('div');
                listContainer.className = 'sub-region-list';
                listContainer.style.display = 'none';
                listContainer.style.paddingLeft = '12px';

                // 토글 기능 (배타적 모드: 하나만 열림, 슬라이드 애니메이션)
                subHeader.onclick = () => {
                    const isCurrentlyHidden = listContainer.style.display === 'none';

                    // 같은 대분류 내 모든 중분류 아코디언 닫기 (애니메이션)
                    const parentSection = subSection.closest('.sea-section') || container;
                    parentSection.querySelectorAll('.sub-region-list').forEach(list => {
                        if (list !== listContainer && list.style.display !== 'none') {
                            slideUp(list);
                        }
                        const header = list.previousElementSibling;
                        if (header && list !== listContainer) {
                            header.style.marginLeft = '0';
                        }
                    });

                    // 클릭한 것이 닫혀있었다면 열기 (애니메이션)
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);
                        subHeader.style.marginLeft = '4px';
                    } else {
                        slideUp(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(0deg)';
                        subHeader.style.marginLeft = '0';
                    }
                };

                // 아이템 추가 (정렬 적용)
                const sortedSubItems = sortAlertItems(subItems);
                sortedSubItems.forEach(item => {
                    counts[mainRegion]++;
                    listContainer.appendChild(createAlertElement(item));
                });

                subSection.appendChild(subHeader);
                subSection.appendChild(listContainer);
                container.appendChild(subSection);
            });
        }
    }

    const totalAlerts = appState.alerts.length;

    // --- Disable/Enable Sea Sections & Sort Order ---
    const alertContent = document.getElementById('alert-content');
    const errorMsg = document.getElementById('alert-error-message');
    const sections = []; // To store section elements with their counts logic

    // API 에러 처리
    if (appState.hasApiError) {
        if (errorMsg) errorMsg.classList.remove('hidden');

        // 모든 해역 섹션 숨기기 (count-badge 등은 무시됨)
        for (const [sea, section] of Object.entries(seaSections)) {
            if (section && section.parentElement) {
                section.parentElement.style.display = 'none';
            }
        }
        return; // 에러 상태에서는 여기서 렌더링 종료
    } else {
        // 정상 상태: 에러 메시지 숨기고 섹션 표시 복구
        if (errorMsg) errorMsg.classList.add('hidden');

        for (const [sea, section] of Object.entries(seaSections)) {
            if (section && section.parentElement) {
                section.parentElement.style.display = '';
            }
        }
    }

    for (const [sea, count] of Object.entries(counts)) {
        if (seaSections[sea]) {
            const sectionContainer = seaSections[sea].parentElement; // .sea-section

            if (sectionContainer) {
                // Store for sorting
                sections.push({ el: sectionContainer, count: count, id: sectionContainer.id });

                // Remove previous disabled state
                sectionContainer.classList.remove('disabled');
                const header = sectionContainer.querySelector('.sea-header');
                if (header) header.style.cursor = 'pointer';

                // Update count badge
                if (seaCounts[sea]) {
                    seaCounts[sea].textContent = `${count}개 해역`;

                    if (count === 0) {
                        // 특보가 없으면 아코디언 자체를 숨김
                        sectionContainer.style.display = 'none';
                    } else {
                        // 특보가 있으면 표시
                        sectionContainer.style.display = '';
                        seaCounts[sea].classList.remove('zero');
                        // Start collapsed (as requested)
                        sectionContainer.classList.remove('open');
                    }
                }
            }
        }
    }

    // Sort sections: Alerts (count > 0) first, No Alerts last
    // Keep original order relative to each group (e.g., East, West, South, Jeju)
    const originalOrder = ['east-sea-section', 'west-sea-section', 'south-sea-section', 'jeju-sea-section'];

    sections.sort((a, b) => {
        const hasAlertA = a.count > 0;
        const hasAlertB = b.count > 0;

        if (hasAlertA && !hasAlertB) return -1; // A comes first
        if (!hasAlertA && hasAlertB) return 1;  // B comes first

        // If same status, keep original relative order
        return originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id);
    });

    // Re-append in new order
    if (alertContent) {
        sections.forEach(item => {
            alertContent.appendChild(item.el);
        });
    }

    // --- Global Badge & Accordion State Logic ---
    const globalStatusContainer = document.querySelector('#main-accordion-header .header-status'); // 해역별 특보현황 헤더의 상태 배지 영역
    const mainHeader = document.getElementById('main-accordion-header');
    const mainBody = document.getElementById('main-accordion-body');

    // [New] 필터링된 알림 목록 재구성 (여기서 다시 계산해야 정확함)
    const filteredAlerts = appState.alerts.filter(a => {
        if (typeof UserSettings !== 'undefined') {
            return UserSettings.isVisible(a.zoneName);
        }
        return true;
    });

    // Count Active vs Preliminary (필터링된 목록 기준)
    const activeSet = new Set();
    const prelimSet = new Set();

    filteredAlerts.forEach(a => {
        if (a.isDummy) return;

        // 특보 구역명 기준으로 중복 제거 (동일 구역에 여러 특보가 있을 수 있으나 구역 수 기준인지 확인 필요)
        // 사용자는 "발효 ##건"이라고 했으므로 단순 특보 건수를 세는 것이 맞을 수 있으나 
        // 기존에는 해역(Zone) 수를 셌음. 여기서는 해역별 카드 수와 일치시키는 것이 안전함.
        // 하지만 flattenAlertsData에서 current/upcoming을 분리했으므로, 
        // 한 해역에 current, upcoming이 둘 다 있으면 각각 별도의 아이템이 됨.

        if (a.isPreliminary) {
            prelimSet.add(a.zoneName);
        } else {
            // 발효 중 (주의보/경보)
            activeSet.add(a.zoneName);
        }
    });

    const activeCount = activeSet.size;
    const prelimCount = prelimSet.size;
    const totalCount = activeCount + prelimCount;

    // [New] 헤더 텍스트 변경 로직
    // 필터링 여부 확인: UserSettings.settings에 false가 하나라도 있으면 필터링된 것으로 간주
    let isFiltered = false;
    if (typeof UserSettings !== 'undefined') {
        const settingsValues = Object.values(UserSettings.settings);
        // 설정값이 하나라도 있고, 그 중 false인 것이 있으면 필터링 상태
        // (기본값은 undefined일 수 있으나 settings 객체에 저장된 값은 true/false임)
        if (settingsValues.length > 0 && settingsValues.includes(false)) {
            isFiltered = true;
        }
    }

    // 1. 특보 현황 헤더
    const sectionTitle = document.querySelector('#main-accordion-header .section-title');
    if (sectionTitle) {
        if (isFiltered) {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 관심해역별 특보현황';
        } else {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 해역별 특보현황';
        }
    }

    // 2. 기상 현황 헤더
    const statusTitle = document.querySelector('#marine-status-accordion-header .section-title');
    if (statusTitle) {
        if (isFiltered) {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> 관심해역별 기상현황';
        } else {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> 해역별 기상현황';
        }
    }

    if (globalStatusContainer) {
        // Clear existing badges (except icon)
        // We need to keep the icon
        const icon = document.getElementById('main-accordion-icon');
        globalStatusContainer.innerHTML = ''; // Clear all
        globalStatusContainer.style.gap = '5px'; // Override CSS gap (12px)

        if (totalCount > 0) {
            // Add Active Badge (Red) - "발효"
            if (activeCount > 0) {
                const activeBadge = document.createElement('span');
                activeBadge.className = 'status-badge warning';
                activeBadge.textContent = `발효 ${activeCount}건`;
                globalStatusContainer.appendChild(activeBadge);
            }

            // Add Preliminary Badge (Orange) - "발표"
            if (prelimCount > 0) {
                const prelimBadge = document.createElement('span');
                prelimBadge.className = 'status-badge orange'; // Custom orange class
                prelimBadge.textContent = `발표 ${prelimCount}건`;
                globalStatusContainer.appendChild(prelimBadge);
            }

            // Start Expanded (필터링된 상태에서도 알림이 있으면 펼쳐짐)
            if (mainBody && mainBody.classList.contains('collapsed')) {
                mainBody.classList.remove('collapsed');
                if (mainHeader) mainHeader.classList.remove('collapsed-state');
            }

            // 특보 있음: 빨간색 그라데이션 (CSS 클래스로 제어)
            if (mainHeader) {
                mainHeader.classList.remove('gradient-safe');
                mainHeader.classList.add('gradient-alert');
            }
        } else {
            // No Alerts (Green)
            const safeBadge = document.createElement('span');
            safeBadge.className = 'status-badge safe';

            // 텍스트 조건부 변경
            if (isFiltered) {
                safeBadge.textContent = '관심해역 특보 없음';
            } else {
                safeBadge.textContent = '전 해역 특보없음';
            }

            safeBadge.style.marginRight = '6px';
            globalStatusContainer.appendChild(safeBadge);

            // Start Collapsed
            if (mainBody && !mainBody.classList.contains('collapsed')) {
                mainBody.classList.add('collapsed');
                if (mainHeader) mainHeader.classList.add('collapsed-state');
            }

            // 특보 없음: 초록색 그라데이션으로 변경 (CSS 클래스로 제어)
            if (mainHeader) {
                mainHeader.classList.remove('gradient-alert');
                mainHeader.classList.add('gradient-safe');
            }
        }

        // Re-append icon logic removed

    }

    // [New] 기상현황 아코디언 자동 제어 로직
    // 특보(filtered)가 없으면 기상현황을 열어주고, 있으면 기상현황을 닫음 (Focus 집중)
    const statusBody = document.getElementById('marine-status-accordion-body');
    const statusHeader = document.getElementById('marine-status-accordion-header');

    if (statusBody) {
        if (totalCount > 0) {
            // 특보 있음 -> 기상현황 닫기 (특보에 집중)
            if (!statusBody.classList.contains('collapsed')) {
                statusBody.classList.add('collapsed');
                // 헤더 상태 변경이 필요하다면 추가 (보통 collapsed-state 등)
            }
        } else {
            // 특보 없음 -> 기상현황 열기 (볼 게 없으므로 기상정보 제공)
            if (statusBody.classList.contains('collapsed')) {
                statusBody.classList.remove('collapsed');
            }
        }
    }

    // 전체 현황 업데이트 로그
    // console.log('Total alerts displayed:', totalAlerts);
}

function createAlertElement(items) {
    if (!Array.isArray(items)) items = [items];

    let zoneNameStr = '';
    let sortedAlerts = [];

    if (items.length > 0) {
        sortedAlerts = sortAlertItems(items);
        zoneNameStr = sortedAlerts[0].zoneName;
    }

    const data = sortedAlerts[0] || {};
    zoneNameStr = data.zoneName || '알 수 없는 구역';

    const template = document.getElementById('alert-item-template');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.alert-card');

    card.style.cssText = `
        padding: 10px 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    // [Fix] 모바일 화면에서 해역명과 뱃지가 겹칠 경우 자연스럽게 줄바꿈 허용 (문제 2 해결)
    const header = clone.querySelector('.alert-header');
    if (header) {
        header.style.flexWrap = 'wrap';
        header.style.rowGap = '6px';
        header.style.alignItems = 'center';
    }

    const zoneName = clone.querySelector('.zone-name');
    zoneName.innerHTML = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = zoneNameStr;
    zoneName.appendChild(nameSpan);

    // 원본 이름에 추가 정보(해제예고 등)가 있다면 함께 표시
    if (data.originalZoneName && data.originalZoneName !== data.zoneName) {
        let extraText = data.originalZoneName.replace(data.zoneName, '').trim();
        if (extraText) {
            const extraSpan = document.createElement('span');
            extraSpan.style.fontSize = '0.75rem';
            extraSpan.style.color = '#aaa';
            extraSpan.style.marginLeft = '6px';
            extraSpan.style.fontWeight = '400';
            extraSpan.textContent = extraText;
            zoneName.appendChild(extraSpan);
        }
    }

    zoneName.style.cssText = `
        font-size: 0.9rem;
        font-weight: 600;
        color: #e0e0e0;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
    `;

    // [New] 히스토리 아이콘 버튼: 해역명과 뱃지 사이에 삽입
    // 해당 해역의 특보 통보문 히스토리를 팝업으로 조회할 수 있는 버튼
    // history 데이터는 모든 alert에서 공유하므로 첫 번째 항목에서 가져옴
    const zoneHistory = data.history || [];
    if (zoneHistory.length > 0) {
        const historyBtn = document.createElement('button');
        historyBtn.className = 'alert-history-btn';
        historyBtn.title = '특보 히스토리 보기';
        historyBtn.textContent = '📋';
        historyBtn.style.cssText = `
            background: rgba(129, 212, 250, 0.15);
            border: 1px solid rgba(129, 212, 250, 0.3);
            width: 28px;
            height: 28px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.82rem;
            transition: all 0.2s;
            flex-shrink: 0;
            margin-left: 4px;
        `;
        historyBtn.addEventListener('mouseenter', function () {
            historyBtn.style.background = 'rgba(129, 212, 250, 0.3)';
            historyBtn.style.borderColor = 'rgba(129, 212, 250, 0.5)';
        });
        historyBtn.addEventListener('mouseleave', function () {
            historyBtn.style.background = 'rgba(129, 212, 250, 0.15)';
            historyBtn.style.borderColor = 'rgba(129, 212, 250, 0.3)';
        });
        historyBtn.addEventListener('click', function (e) {
            e.stopPropagation(); // 카드 아코디언 토글 방지
            if (typeof showAlertHistoryPopup === 'function') {
                showAlertHistoryPopup(zoneNameStr, zoneHistory);
            }
        });
        // 해역명(.zone-name) 뒤, 뱃지 컨테이너(.alert-badges) 앞에 삽입
        if (header) {
            const badgeEl = header.querySelector('.alert-badges');
            if (badgeEl) {
                header.insertBefore(historyBtn, badgeEl);
            } else {
                header.appendChild(historyBtn);
            }
        }
    }

    const badgeContainer = clone.querySelector('.alert-badges');
    badgeContainer.style.display = 'flex';
    badgeContainer.style.gap = '4px';
    badgeContainer.style.flexWrap = 'wrap';

    const now = getKfTime();
    const targetZoneName = data.zoneName || '';

    const getAlertScore = (type, lvl) => {
        const TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, '해일': 10, '호우': 10, '대설': 10, '기타': 0 };
        const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 1, '기타': 0, '해제': 0, '': 0 };
        const tScore = TYPE_RANK[type] || (type && type.includes('태풍') ? 100 : 10);
        const lScore = LVL_RANK[lvl] || 0;
        return tScore + lScore;
    };

    let ledgerEntry = null;
    const targetRegId = data.regId; // API 데이터의 regId

    // 1단계: regId로 정밀 매칭 시도
    if (appState.alertStateHistory && targetRegId && appState.alertStateHistory[targetRegId]) {
        ledgerEntry = appState.alertStateHistory[targetRegId];
    }

    // 2단계: 실패 시 명칭 기반 매칭 (Fallback)
    if (!ledgerEntry && appState.alertStateHistory) {
        const normalizeName = (s) => (s || '').replace(/[\s·.()]/g, '').trim();
        const normTarget = normalizeName(targetZoneName);

        for (const [regId, zoneData] of Object.entries(appState.alertStateHistory)) {
            const normKo = normalizeName(zoneData.korName || zoneData.regKo || '');
            if (normKo === normTarget) {
                ledgerEntry = zoneData;
                break;
            }
        }
    }

    let currentInView = null;
    let transitionBadge = null;
    let publishEntry = null; // 예정된 변경사항

    // [A안 적용] 장부에서 activeAlert와 upcomingAlert를 분리하여 참조
    // 마이그레이션 호환: current 필드가 있으면 구형 포맷으로 처리
    if (ledgerEntry) {
        // 신형 포맷 (activeAlert + upcomingAlert)
        if (ledgerEntry.activeAlert) {
            const curr = ledgerEntry.activeAlert;
            const currLevel = (curr.wrnLvl === '경보' || (curr.wrnLvl && curr.wrnLvl.includes('경보'))) ? '경보' :
                (curr.wrnLvl === '주의보' || (curr.wrnLvl && curr.wrnLvl.includes('주의'))) ? '주의보' :
                    (curr.wrnLvl === '예비' || (curr.wrnLvl && curr.wrnLvl.includes('예비'))) ? '예비' : '기타';

            currentInView = {
                warnType: curr.wrnTp || curr.warnType || '풍랑',
                level: currLevel,
                tmFc: curr.tmFc,
                tmEf: curr.tmEf,
                tmCc: curr.tmCc,
                tmYn: curr.tmYn,
                rawTmEf: curr.rawTmEf || '',
                isFromHistory: true
            };
        }

        if (ledgerEntry.upcomingAlert) {
            const upcoming = ledgerEntry.upcomingAlert;
            const upLevel = (upcoming.wrnLvl === '경보' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('경보'))) ? '경보' :
                (upcoming.wrnLvl === '주의보' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('주의'))) ? '주의보' :
                    (upcoming.wrnLvl === '예비' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('예비'))) ? '예비' : '기타';

            publishEntry = {
                warnType: upcoming.wrnTp || upcoming.warnType || '풍랑',
                level: upLevel,
                tmFc: upcoming.tmFc,
                tmEf: upcoming.tmEf,
                tmCc: upcoming.tmCc,
                tmYn: upcoming.tmYn,
                rawTmEf: upcoming.rawTmEf || '',
                isFromHistory: true
            };
        }

        // 구형 포맷 호환 (current 필드가 있는 경우)
        if (!currentInView && !publishEntry && ledgerEntry.current) {
            const curr = ledgerEntry.current;
            const currLevel = (curr.wrnLvl === '경보' || (curr.wrnLvl && curr.wrnLvl.includes('경보'))) ? '경보' :
                (curr.wrnLvl === '주의보' || (curr.wrnLvl && curr.wrnLvl.includes('주의'))) ? '주의보' :
                    (curr.wrnLvl === '예비' || (curr.wrnLvl && curr.wrnLvl.includes('예비'))) ? '예비' : '기타';

            const currData = {
                warnType: curr.wrnTp || curr.warnType || '풍랑',
                level: currLevel,
                tmFc: curr.tmFc,
                tmEf: curr.tmEf,
                tmCc: curr.tmCc,
                tmYn: curr.tmYn,
                rawTmEf: curr.rawTmEf || '',
                isFromHistory: true
            };

            if (curr.status === 'active') {
                currentInView = currData;
            } else if (curr.status === 'publish') {
                publishEntry = currData;
            }
        }
    }

    // [Fallback] 장부에 데이터가 없을 때만 API 데이터를 현재 상태로 간주
    // 장부에 데이터가 있으면 장부 기준으로 처리하므로 Fallback 불필요
    if (!ledgerEntry && !currentInView && data && !data.isDummy && data.warnType && data.level) {
        if (!data.isPreliminary) {
            currentInView = {
                ...data,
                level: (data.level === '경보' || (data.level && data.level.includes('경보'))) ? '경보' : '주의보'
            };
        }
    }

    // [단순화] 격상/격하 배지 계산 로직 제거됨

    let upcomingFromApi = [];
    const seenTmFc = new Set();

    // 1. 장부의 publishEntry가 있으면 가장 먼저 등록 (우선순위)
    if (publishEntry && publishEntry.tmFc) {
        seenTmFc.add(publishEntry.tmFc);
    }
    // currentInView도 기등록 처리
    if (currentInView && currentInView.tmFc) {
        seenTmFc.add(currentInView.tmFc);
    }

    sortedAlerts.forEach(alert => {
        if (!alert.warnType || !alert.level) return;
        const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
        const isFuture = cleanEf && cleanEf.length >= 12 && now < cleanEf;

        if (isFuture || alert.isPreliminary) {
            // 이미 장부 데이터(publishEntry/currentInView)로 처리된 동일 시각 데이터는 제외
            if (alert.tmFc && seenTmFc.has(alert.tmFc)) return;

            upcomingFromApi.push(alert);
            if (alert.tmFc) seenTmFc.add(alert.tmFc);
        }
    });



    if (currentInView) {
        const badge = document.createElement('span');
        badge.className = 'status-badge warning';
        badge.textContent = `${currentInView.warnType} ${currentInView.level}`;
        badgeContainer.appendChild(badge);


    }

    // [보정] API 파싱 오류나 장부 오류로 인해 예비특보와 주의보가 동시에 잡히는 경우
    // 장부(History) 여부와 상관없이, 예비특보가 존재하는데 주의보가 떠있다면(경보 제외)
    // 그리고 두 특보의 발표시각(tmFc)이 같다면, 이는 100% 동일 데이터를 잘못 해석한 것이다.
    if (publishEntry && currentInView) {
        // level 비교를 느슨하게 하여 '주의보' 뿐만 아니라 '주의' 등도 포함
        const curLvl = currentInView.level || '';
        const pubLvl = publishEntry.level || '';

        if (pubLvl.includes('예비') && !curLvl.includes('경보')) {
            // 발표 시각이 같으면 동일 알림의 중복 해석이므로 제거
            if (publishEntry.tmFc === currentInView.tmFc) {
                currentInView = null;
                activeFromApi = [];
            }
        }
    }


    // [수정] publishEntry(예정된 변경)가 있으면 배지 생성
    // [추가 수정] currentInView가 있으면 배지는 생성하지 않음 (current 우선)
    if (publishEntry) {
        let direction = '';
        if (currentInView) {
            const curScore = getAlertScore(currentInView.warnType, currentInView.level);
            const pubScore = getAlertScore(publishEntry.warnType, publishEntry.level);
            direction = curScore > pubScore ? '격하' : curScore < pubScore ? '격상' : '';
        }

        // [수정] currentInView가 없을 때만 예비 배지 생성
        if (!currentInView) {
            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            const cleanType = (publishEntry.warnType || '').replace('주의보', '').replace('경보', '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        }

        // 상세 영역 표시를 위해 리스트에 추가 (중복 방지는 위에서 처리됨)
        upcomingFromApi.unshift({
            ...publishEntry,
            _isUpcoming: true,
            _direction: direction
        });
    }

    // [중복 뱃지 생성 로직 제거됨] - 사용자 요청으로 Revert

    // 추가적인 upcoming 정보들 배지 생성
    // [수정] currentInView가 있으면 upcoming 배지는 생성하지 않음
    if (!currentInView) {
        upcomingFromApi.forEach(upcoming => {
            if (upcoming._isUpcoming) return; // 이미 publishEntry로 처리된 것 스킵

            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            const cleanType = (upcoming.warnType || '').replace('주의보', '').replace('경보', '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        });
    }

    if (badgeContainer.children.length === 0) {
        const safeBadge = document.createElement('span');
        safeBadge.className = 'status-badge safe';
        safeBadge.textContent = '관심해역 특보 없음';
        safeBadge.style.opacity = '0.6';
        badgeContainer.appendChild(safeBadge);
    }

    // 상세 정보 영역 표시용 데이터 리스트 구성
    const detailedAlertList = [];
    const seenDetailTmFc = new Set();

    // 1. 현재 발효 중인 특보 등록
    if (currentInView) {
        detailedAlertList.push({ ...currentInView, _isCurrent: true });
        if (currentInView.tmFc) seenDetailTmFc.add(currentInView.tmFc);
    }

    // 2. 다가오는(예비) 특보 등록
    upcomingFromApi.forEach(up => {
        // 이미 등록된 정보와 발표시각(tmFc)이 같으면 완벽한 중복이므로 제외
        if (up.tmFc && seenDetailTmFc.has(up.tmFc)) return;

        detailedAlertList.push({ ...up, _isUpcoming: true });
        if (up.tmFc) seenDetailTmFc.add(up.tmFc);
    });

    const details = clone.querySelector('.alert-details');
    details.innerHTML = '';

    const formatAlertTime = (timeStr) => {
        // [수정] 연도/월 표기 제거 (예: "2026년 2월 10일" -> "10일", "2월 15일 오전(06시~12시)" -> "15일 오전(06시~12시)")
        const formatted = formatWarningTime(timeStr);
        return formatted ? formatted.replace(/\d{4}년\s*/g, '').replace(/^\d+월\s*/, '').replace(/\s\d+월\s*/, ' ') : formatted;
    };

    const createRow = (label, value, color) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;';
        row.innerHTML = `<span style="color: #8b949e;">${label}</span><span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value || '정보 없음'}</span>`;
        return row;
    };

    detailedAlertList.forEach((alert, idx) => {
        if (alert.isDummy) return;

        // [수정] 다가오는 특보인 경우: 현재 특보가 이미 위에 있을 때만(idx > 0) [다가오는 특보] 타이틀과 구분선 표시
        if (alert._isUpcoming) {
            if (idx > 0) {
                const divider = document.createElement('div');
                divider.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 12px 0 8px 0; border-top: 1px dashed rgba(255,255,255,0.05);';
                details.appendChild(divider);

                const upcomingHead = document.createElement('div');
                upcomingHead.style.cssText = 'color: #ffb74d; font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;';

                // [수정] '예비' 레벨은 '주의보'로 치환하여 표시 ("예비 예정" -> "주의보 예정")
                let displayLevel = alert.level;
                if (displayLevel === '예비') displayLevel = '주의보';

                upcomingHead.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> [다가오는 특보] ${alert.warnType} ${displayLevel} 예정`;
                details.appendChild(upcomingHead);
            }
        }
        // [수정] '현재 발효 중' 타이틀은 사용자 요청으로 인해 표시하지 않음 (공간 절약 및 디자인 깔끔화)

        details.appendChild(createRow('발표시각', formatAlertTime(alert.tmFc)));
        details.appendChild(createRow('발효시각', formatAlertTime(alert.tmEf)));
        // [Fix] 예비특보(isPreliminary)는 기본적으로 해제예정시각을 표시하지 않되,
        // AI가 통보문에서 직접 추출한 tmCc(tmCcExplicit=true)가 있는 경우에만 조건부 표시
        let releaseTime = '정보 없음';
        if (!alert.isPreliminary || alert.tmCcExplicit) {
            const rawRelease = alert.tmCc || alert.tmYn || alert.tmEd || '';
            if (rawRelease.trim() !== '' && rawRelease.trim() !== '일') {
                releaseTime = formatAlertTime(rawRelease);
            }
        }
        details.appendChild(createRow('해제예정', releaseTime, '#69f0ae'));
    });

    const findCoastalZones = (zName) => {
        if (!zName) return null;
        const norm = zName.replace(/[\s·.]/g, '');
        for (const [key, val] of Object.entries(COASTAL_MAPPING)) {
            if (key.replace(/[\s·.]/g, '') === norm) return val;
        }
        return null;
    };

    const coastalZones = findCoastalZones(data.zoneName);
    if (coastalZones && coastalZones.length > 0) {
        const coastalContainer = document.createElement('div');
        coastalContainer.className = 'coastal-zones';
        coastalContainer.style.marginTop = '12px';
        coastalContainer.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        coastalContainer.style.paddingTop = '12px';

        const coastalTitle = document.createElement('div');
        coastalTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 8px;';
        coastalTitle.textContent = '연안바다/평수구역';
        coastalContainer.appendChild(coastalTitle);

        const findCoastalAlert = (fullName) => {
            const normalizedTarget = (fullName || '').replace(/\s+/g, '');
            for (const [key, alerts] of Object.entries(appState.coastalAlerts || {})) {
                const normalizedKey = key.replace(/\s+/g, '');
                if (normalizedKey === normalizedTarget) return alerts;
                // 부분 일치 허용 (구역/수구 등 truncation 대응)
                if (normalizedKey.length > 10 && normalizedTarget.length > 10) {
                    if (normalizedKey.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedKey)) return alerts;
                }
            }
            return null;
        };

        const sortedCoastal = [...coastalZones].sort((a, b) => {
            const alertA = findCoastalAlert(a.fullName);
            const alertB = findCoastalAlert(b.fullName);
            if (alertA && !alertB) return -1;
            if (!alertA && alertB) return 1;
            return 0;
        });
        sortedCoastal.forEach(coastal => {
            const coastalAlert = findCoastalAlert(coastal.fullName);
            const coastalItem = createCoastalElement(coastal, coastalAlert, data.zoneName);
            coastalContainer.appendChild(coastalItem);
        });
        details.appendChild(coastalContainer);
    }

    const buoys = BUOY_MAPPING[data.zoneName];
    if (buoys && buoys.length > 0) {
        const buoyContainer = document.createElement('div');
        buoyContainer.className = 'buoy-section';
        buoyContainer.style.cssText = 'margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;';

        const buoyTitle = document.createElement('div');
        buoyTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 10px;';
        buoyTitle.innerHTML = BUOY_SVG_ICON + ' 관측부이 <span style="color:#69f0ae;font-size:0.75rem">(' + buoys.length + ')</span>';
        buoyContainer.appendChild(buoyTitle);

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;';

        const infoArea = document.createElement('div');
        infoArea.className = 'buoy-info-area';
        infoArea.style.cssText = 'display: none; background: rgba(68, 138, 255, 0.1); border-radius: 8px; padding: 12px; border: 1px solid rgba(68, 138, 255, 0.2);';

        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.className = 'buoy-btn buoy-status-btn';
            btn.textContent = buoy.name;
            btn.dataset.buoyId = buoy.id;

            // renderApp() 시점에는 appState.buoyData가 이미 로드됨 → 즉시 판단
            const hasData = appState.buoyData && appState.buoyData[buoy.id];
            const defaultColor = hasData ? '#ccc' : '#ff6b6b';
            const defaultBorder = hasData ? 'rgba(255,255,255,0.3)' : 'rgba(255,107,107,0.5)';

            btn.style.cssText = `padding: 6px 14px; border-radius: 16px; border: 1px solid ${defaultBorder}; background: rgba(255,255,255,0.08); color: ${defaultColor}; font-size: 0.85rem; cursor: pointer; transition: background-color 0.2s, color 0.2s, border-color 0.2s;`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    if (typeof _applyBuoyDefaultStyle === 'function') _applyBuoyDefaultStyle(btn);
                    infoArea.style.display = 'none';
                    return;
                }
                btnContainer.querySelectorAll('.buoy-btn').forEach(b => {
                    b.classList.remove('active');
                    if (typeof _applyBuoyDefaultStyle === 'function') _applyBuoyDefaultStyle(b);
                });
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';
                infoArea.style.display = 'block';
                displayBuoyInfo(buoy, infoArea);
            });
            btnContainer.appendChild(btn);
        });

        buoyContainer.appendChild(btnContainer);
        buoyContainer.appendChild(infoArea);
        details.appendChild(buoyContainer);
    }

    // 펼치기/접기
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
        if (e.target.closest('.coastal-item') || e.target.closest('.buoy-btn') || e.target.closest('.buoy-info-area') || e.target.closest('.alert-history-btn')) return;
        e.stopPropagation();

        const isCurrentlyHidden = details.classList.contains('hidden');

        // 1. 다른 모든 알림 카드를 닫음 (전체 문서 범위에서)
        document.querySelectorAll('.alert-details').forEach(otherDetails => {
            otherDetails.classList.add('hidden');
        });
        // Arrow rotation logic removed


        // 2. 현재 카드만 토글 (이전에 닫혀있었다면 열기)
        if (isCurrentlyHidden) {
            details.classList.remove('hidden');
            // arrow rotation removed

        }
    });

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'card-action-btns';
    actionsContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 15px;';

    // 기상예보 버튼 (앞바다: 단기예보, 먼바다: 해구기상 기반)
    if (typeof showSeaForecastTable === 'function') {
        const forecastBtn = document.createElement('button');
        forecastBtn.innerHTML = '기상예보';
        forecastBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #ffd54f, #ff9800, #f57c00); color: #1a1e2e; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s; box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);';
        forecastBtn.addEventListener('click', (e) => { e.stopPropagation(); showSeaForecastTable(data.zoneName); });
        actionsContainer.appendChild(forecastBtn);
    }

    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.innerHTML = '해구기상';
    zoneViewBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #e94560, #0f3460); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s;';
    zoneViewBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof showZoneOverlay === 'function') showZoneOverlay(data.zoneName); });
    actionsContainer.appendChild(zoneViewBtn);


    if (WINDY_URL_MAPPING[data.zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '윈디';
        windyBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #00c6ff, #0072ff); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s;';
        windyBtn.addEventListener('click', (e) => { e.stopPropagation(); showWindyPopup(data.zoneName); });
        actionsContainer.appendChild(windyBtn);
    }

    details.appendChild(actionsContainer);
    return card;
}

