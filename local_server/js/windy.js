/**
 * ============================================================================
 * 파일명: js/windy.js
 * 역할: Windy 팝업, 상태 카드 시스템
 * ============================================================================
 *
 * [설명]
 * - showWindyPopup(): Windy 임베드 iframe 모달
 * - createStatusCard(): 해역별 상태 카드 생성
 * - getSeaRegion(): 해역 분류
 * - renderBuoyButtonsForStatus(): 부이 버튼 렌더링
 * - closeWindyPopup(): Windy 팝업 닫기
 *
 * [로딩 순서] 10번째 (forecast.js 이후)
 * ============================================================================
 */

// ============================================================================
// 윈디 팝업 기능
// ============================================================================

/**
 * 윈디 팝업 표시
 * @param {string} zoneName - 특보구역명
 */
function showWindyPopup(zoneName) {
    const embedUrl = getWindyEmbedUrl(zoneName);
    const windyUrl = WINDY_URL_MAPPING[zoneName];

    if (!embedUrl) {
        // console.warn('윈디 URL을 찾을 수 없습니다:', zoneName);
        return;
    }

    // 기존 팝업 제거
    const existingModal = document.getElementById('windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'windy-modal';
    modal.innerHTML = `
        <div class="windy-modal-overlay" onclick="closeWindyPopup()"></div>
        <div class="windy-modal-content">
            <div class="windy-modal-header">
                <h3>🌀 ${zoneName} - Windy</h3>
                <button class="windy-close-btn" onclick="closeWindyPopup()">✕</button>
            </div>
            <div class="windy-iframe-container">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="windy-modal-footer">
                <a href="${windyUrl}" target="_blank" class="windy-external-link">
                    🔗 새 탭에서 열기
                </a>
            </div>
        </div>
    `;

    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // 스타일 추가
    const style = document.createElement('style');
    style.id = 'windy-modal-style';
    style.textContent = `
        .windy-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
        }
        .windy-modal-content {
            position: relative;
            width: 90%;
            max-width: 1200px;
            height: 85vh;
            background: #1a1e2e;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            animation: windyModalIn 0.3s ease-out;
            display: flex;
            flex-direction: column;
        }
        @keyframes windyModalIn {
            from {
                opacity: 0;
                transform: scale(0.9) translateY(20px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }
        .windy-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: linear-gradient(135deg, #00c6ff, #0072ff);
            color: white;
        }
        .windy-modal-header h3 {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
        }
        .windy-close-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 1.2rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .windy-close-btn:hover {
            background: rgba(255, 255, 255, 0.4);
            transform: scale(1.1);
        }
        .windy-iframe-container {
            flex: 1;
            background: #0a0a0a;
        }
        .windy-iframe-container iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
        .windy-modal-footer {
            padding: 12px 20px;
            background: rgba(0, 0, 0, 0.3);
            text-align: center;
        }
        .windy-external-link {
            color: #00c6ff;
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        .windy-external-link:hover {
            color: #64d8ff;
            text-decoration: underline;
        }
        @media (max-width: 768px) {
            .windy-modal-content {
                width: 95%;
                height: 90vh;
                border-radius: 12px;
            }
            .windy-modal-header {
                padding: 12px 16px;
            }
            .windy-modal-header h3 {
                font-size: 1rem;
            }
        }
    `;

    // 기존 스타일 제거 후 추가
    const existingStyle = document.getElementById('windy-modal-style');
    if (existingStyle) existingStyle.remove();
    document.head.appendChild(style);

    document.body.appendChild(modal);

    // ESC 키로 닫기
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeWindyPopup();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// ============================================================================
// 신규: 해역별 기상 현황 (특보 무관 전체 구역 표시)
// ============================================================================

function getSeaRegion(zoneName) {
    if (zoneName.includes('동해') || zoneName.includes('울산') || zoneName.includes('경북') || zoneName.includes('강원')) return 'east';
    if (zoneName.includes('서해') || zoneName.includes('인천') || zoneName.includes('경기') || zoneName.includes('충남') || zoneName.includes('전북')) return 'west';
    if (zoneName.includes('남해') || zoneName.includes('경남') || zoneName.includes('부산') || zoneName.includes('거제') || zoneName.includes('전남')) return 'south';
    if (zoneName.includes('제주')) return 'jeju';
    return 'other';
}

function renderBuoyButtonsForStatus(zoneName, container) {
    if (typeof BUOY_MAPPING === 'undefined' || !BUOY_MAPPING[zoneName]) return;

    const buoyContainer = document.createElement('div');
    buoyContainer.className = 'buoy-btn-container';
    buoyContainer.style.marginTop = '8px';
    buoyContainer.style.display = 'flex';
    buoyContainer.style.flexWrap = 'wrap';
    buoyContainer.style.gap = '6px';

    BUOY_MAPPING[zoneName].forEach(buoy => {
        const btn = document.createElement('button');
        btn.className = 'buoy-btn';

        let icon = 'fa-water';
        if (buoy.type === 'B') icon = 'fa-anchor';
        else if (buoy.type === 'C') icon = 'fa-wave-square';
        else if (buoy.type === 'L') icon = 'fa-lightbulb';

        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${buoy.name}`;
        btn.onclick = (e) => {
            e.stopPropagation();
            if (typeof fetchBuoyData === 'function') fetchBuoyData(buoy.id, buoy.name);
        };
        buoyContainer.appendChild(btn);
    });
    container.appendChild(buoyContainer);
}

function renderOtherButtonsForStatus(zoneName, container) {
    if (typeof ZONE_OVERLAY_CONFIG !== 'undefined' && ZONE_OVERLAY_CONFIG[zoneName]) {
        // 매핑된 구역인지 확인
        const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 15px;
            flex-wrap: nowrap;
        `;

        // 1. 기상예보 버튼 (앞바다: 단기예보, 먼바다: 해구기상 기반)
        {
            const forecastBtn = document.createElement('button');
            forecastBtn.className = 'forecast-btn';
            forecastBtn.innerHTML = '기상예보';
            forecastBtn.style.cssText = `
                flex: 1;
                padding: 12px 8px;
                background: linear-gradient(135deg, #ffd54f, #ff9800, #f57c00);
                color: #1a1e2e;
                border: none;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
                white-space: nowrap;
            `;
            forecastBtn.addEventListener('mouseenter', () => {
                forecastBtn.style.transform = 'translateY(-2px)';
                forecastBtn.style.boxShadow = '0 4px 15px rgba(255, 152, 0, 0.5)';
            });
            forecastBtn.addEventListener('mouseleave', () => {
                forecastBtn.style.transform = 'translateY(0)';
                forecastBtn.style.boxShadow = '0 2px 8px rgba(255, 152, 0, 0.3)';
            });
            forecastBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof showSeaForecastTable === 'function') showSeaForecastTable(zoneName);
            });
            btnContainer.appendChild(forecastBtn);
        }

        // 2. 해구별 기상전망 버튼
        const zoneViewBtn = document.createElement('button');
        zoneViewBtn.className = 'zone-view-btn';
        zoneViewBtn.innerHTML = '해구기상';
        zoneViewBtn.style.cssText = `
            flex: 1;
            padding: 12px 8px;
            background: linear-gradient(135deg, #e94560, #0f3460);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            white-space: nowrap;
        `;
        zoneViewBtn.addEventListener('mouseenter', () => {
            zoneViewBtn.style.transform = 'translateY(-2px)';
            zoneViewBtn.style.boxShadow = '0 4px 15px rgba(233, 69, 96, 0.4)';
        });
        zoneViewBtn.addEventListener('mouseleave', () => {
            zoneViewBtn.style.transform = 'translateY(0)';
            zoneViewBtn.style.boxShadow = 'none';
        });
        zoneViewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof showZoneOverlay === 'function') showZoneOverlay(zoneName);
        });
        btnContainer.appendChild(zoneViewBtn);

        // 3. 윈디 버튼
        if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
            const windyBtn = document.createElement('button');
            windyBtn.className = 'windy-btn';
            windyBtn.innerHTML = '윈디';
            windyBtn.style.cssText = `
                flex: 1;
                padding: 12px 8px;
                background: linear-gradient(135deg, #00c6ff, #0072ff);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                white-space: nowrap;
            `;
            windyBtn.addEventListener('mouseenter', () => {
                windyBtn.style.transform = 'translateY(-2px)';
                windyBtn.style.boxShadow = '0 4px 15px rgba(0, 114, 255, 0.4)';
            });
            windyBtn.addEventListener('mouseleave', () => {
                windyBtn.style.transform = 'translateY(0)';
                windyBtn.style.boxShadow = 'none';
            });
            windyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.showWindyPopup) window.showWindyPopup(zoneName);
            });
            btnContainer.appendChild(windyBtn);
        }

        container.appendChild(btnContainer);
    }
}

async function renderMarineWeatherStatus() {
    const containers = {
        '동해': document.getElementById('status-east-sea-list'),
        '서해': document.getElementById('status-west-sea-list'),
        '남해': document.getElementById('status-south-sea-list'),
        '제주': document.getElementById('status-jeju-sea-list')
    };

    const countBadges = {
        '동해': document.getElementById('status-east-count'),
        '서해': document.getElementById('status-west-count'),
        '남해': document.getElementById('status-south-count'),
        '제주': document.getElementById('status-jeju-count')
    };

    const counts = { '동해': 0, '서해': 0, '남해': 0, '제주': 0 };

    if (!containers['동해']) return;

    // 컨테이너 초기화
    Object.values(containers).forEach(el => { if (el) el.innerHTML = ''; });

    if (typeof SEA_REGIONS === 'undefined' || typeof SUB_REGION_ZONES === 'undefined') return;

    // 대분류별로 처리
    for (const [mainRegion, regionData] of Object.entries(SEA_REGIONS)) {
        const container = containers[mainRegion];
        if (!container) continue;

        const subRegionList = regionData.subRegions || [];

        // 제주는 중분류가 하나이므로 서브헤더 없이 바로 렌더링
        if (mainRegion === '제주' || subRegionList.length <= 1) {
            const zones = subRegionList.length > 0 ? (SUB_REGION_ZONES[subRegionList[0]] || []) : [];
            zones.forEach(zoneName => {
                if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                counts[mainRegion]++;
                container.appendChild(createStatusCard(zoneName));
            });
        } else {
            // 중분류별 서브 섹션 생성
            subRegionList.forEach(subRegion => {
                const zones = SUB_REGION_ZONES[subRegion] || [];
                if (zones.length === 0) return;

                // 서브 섹션 컨테이너
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // 서브 헤더 (중분류명) - 특보현황과 동일한 스타일
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
                    <span style="background: rgba(79, 195, 247, 0.3); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #4fc3f7; margin-left: auto;">${zones.length}개 해역</span>
                `;

                // 호버 효과
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

                        }
                    });

                    // 클릭한 것이 닫혀있었다면 열기 (애니메이션)
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);

                    } else {
                        slideUp(listContainer);

                    }
                };

                // 구역 카드들 추가
                let visibleZoneCount = 0;
                zones.forEach(zoneName => {
                    if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                    counts[mainRegion]++;
                    visibleZoneCount++;
                    listContainer.appendChild(createStatusCard(zoneName));
                });

                // [Fix] 표시할 구역이 하나도 없으면 섹션 자체를 렌더링하지 않음
                if (visibleZoneCount > 0) {
                    // 뱃지 업데이트 (필터링된 개수 반영)
                    const countSpan = subHeader.querySelector('span:last-child');
                    if (countSpan) countSpan.textContent = `${visibleZoneCount}개 해역`;

                    subSection.appendChild(subHeader);
                    subSection.appendChild(listContainer);
                    container.appendChild(subSection);
                }
            });
        }
    }

    // 대분류 뱃지 업데이트 및 섹션 숨김 처리
    for (const [region, count] of Object.entries(counts)) {
        if (countBadges[region]) {
            countBadges[region].textContent = `${count}개 해역`;
        }

        // [New] 해당 해역에 표시할 구역이 하나도 없으면 대분류 섹션 자체를 숨김
        // 컨테이너 ID 매핑: 동해 -> status-east-sea-section
        const sectionIdMap = {
            '동해': 'status-east-sea-section',
            '서해': 'status-west-sea-section',
            '남해': 'status-south-sea-section',
            '제주': 'status-jeju-sea-section'
        };

        const sectionId = sectionIdMap[region];
        if (sectionId) {
            const section = document.getElementById(sectionId);
            if (section) {
                if (count > 0) {
                    section.classList.remove('hidden');
                    section.style.display = ''; // 원래 display 속성 복원 (CSS 클래스가 우선순위 밀릴 경우 대비)
                } else {
                    section.classList.add('hidden');
                    section.style.display = 'none'; // 확실하게 숨김
                }
            }
        }
    }

    // 카드 생성 완료 후 부이 데이터가 이미 로드되어 있으면 색상 갱신
    updateBuoyButtonColors();
}

// 개별 구역 카드 생성 (기상 현황용) - 특보 현황과 100% 일치하도록 조정
function createStatusCard(zoneName) {
    const card = document.createElement('div');
    card.className = 'weather-status-card';
    card.style.cssText = `
        padding: 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    // === 헤더 영역: 구역명 + 버튼들 ===
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
    `;

    // 구역명
    const zoneNameEl = document.createElement('span');
    zoneNameEl.textContent = zoneName;
    zoneNameEl.style.cssText = `
        font-size: 0.9rem;
        font-weight: 600;
        color: #e0e0e0;
        flex-shrink: 0;
    `;
    header.appendChild(zoneNameEl);

    // 버튼 컨테이너 (오른쪽 정렬)
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
        display: flex;
        gap: 6px;
        margin-left: auto;
        flex-shrink: 0;
    `;

    const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

    // 기상예보 버튼 (앞바다: 단기예보, 먼바다: 해구기상 기반)
    {
        const forecastBtn = document.createElement('button');
        forecastBtn.textContent = '기상예보';
        forecastBtn.style.cssText = `
            padding: 5px 10px;
            background: linear-gradient(135deg, #ffd54f, #ff9800);
            color: #1a1e2e;
            border: none;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        `;
        forecastBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof showSeaForecastTable === 'function') showSeaForecastTable(zoneName);
        });
        btnContainer.appendChild(forecastBtn);
    }

    // 해구별 기상전망 버튼
    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.textContent = '해구기상';
    zoneViewBtn.style.cssText = `
        padding: 5px 10px;
        background: linear-gradient(135deg, #e94560, #0f3460);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
    `;
    zoneViewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof showZoneOverlay === 'function') showZoneOverlay(zoneName);
    });
    btnContainer.appendChild(zoneViewBtn);

    // 윈디 버튼
    if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '윈디';
        windyBtn.style.cssText = `
            padding: 5px 10px;
            background: linear-gradient(135deg, #00c6ff, #0072ff);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        `;
        windyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.showWindyPopup) window.showWindyPopup(zoneName);
        });
        btnContainer.appendChild(windyBtn);
    }

    header.appendChild(btnContainer);
    card.appendChild(header);

    // === 부이 정보 영역 (항상 표시) ===
    const buoys = typeof BUOY_MAPPING !== 'undefined' ? BUOY_MAPPING[zoneName] : null;
    if (buoys && buoys.length > 0) {
        const buoySection = document.createElement('div');
        buoySection.style.cssText = `
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.08);
        `;

        // 부이 라벨
        const buoyLabel = document.createElement('div');
        buoyLabel.innerHTML = `${BUOY_SVG_ICON} 관측부이<span style="color:#69f0ae;font-size:0.7rem;margin-left:4px">(${buoys.length})</span>`;
        buoyLabel.style.cssText = `
            font-size: 0.8rem;
            color: #8b949e;
            margin-bottom: 8px;
        `;
        buoySection.appendChild(buoyLabel);

        // 부이 버튼 컨테이너
        const buoyBtnWrap = document.createElement('div');
        buoyBtnWrap.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        `;

        // 부이 버튼들 (기본 회색, 데이터 로드 후 updateBuoyButtonColors로 색상 갱신)
        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.textContent = buoy.name;
            btn.dataset.buoyId = buoy.id;
            btn.className = 'buoy-status-btn';

            btn.style.cssText = `
                padding: 4px 10px;
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(255,255,255,0.05);
                color: #ccc;
                font-size: 0.75rem;
                cursor: pointer;
                transition: all 0.2s;
            `;

            btn.onclick = (e) => {
                e.stopPropagation();

                // 이미 활성화된 버튼 클릭 시 닫기
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    _applyBuoyDefaultStyle(btn);
                    const infoArea = buoySection.querySelector('.buoy-info-area');
                    if (infoArea) infoArea.style.display = 'none';
                    return;
                }

                // 다른 버튼 비활성화
                buoyBtnWrap.querySelectorAll('.buoy-status-btn').forEach(b => {
                    b.classList.remove('active');
                    _applyBuoyDefaultStyle(b);
                });

                // 현재 버튼 활성화
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';

                // 정보 표시 영역 찾기/생성
                let infoArea = buoySection.querySelector('.buoy-info-area');
                if (!infoArea) {
                    infoArea = document.createElement('div');
                    infoArea.className = 'buoy-info-area';
                    infoArea.style.cssText = `
                        margin-top: 10px;
                        background: rgba(68, 138, 255, 0.1);
                        border-radius: 8px;
                        padding: 12px;
                        border: 1px solid rgba(68, 138, 255, 0.2);
                    `;
                    buoySection.appendChild(infoArea);
                }

                if (typeof displayBuoyInfo === 'function') {
                    displayBuoyInfo(buoy, infoArea);
                    infoArea.style.display = 'block';
                }
            };
            buoyBtnWrap.appendChild(btn);
        });

        buoySection.appendChild(buoyBtnWrap);
        card.appendChild(buoySection);
    }

    return card;
}

/**
 * 부이 버튼의 기본 스타일 적용 (active 해제 시)
 * appState.buoyData 존재 여부에 따라 회색/빨간색 결정
 */
function _applyBuoyDefaultStyle(btn) {
    const buoyId = btn.dataset.buoyId;
    const hasData = typeof appState !== 'undefined' && appState.buoyData && appState.buoyData[buoyId];
    btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
    btn.style.color = hasData ? '#ccc' : '#ff6b6b';
    btn.style.borderColor = hasData ? 'rgba(255,255,255,0.15)' : 'rgba(255,107,107,0.4)';
}

/**
 * 부이 데이터 로드 완료 후 호출하여 모든 부이 버튼의 색상을 갱신
 */
function updateBuoyButtonColors() {
    document.querySelectorAll('.buoy-status-btn').forEach(btn => {
        if (btn.classList.contains('active')) return; // 활성화 상태는 유지
        _applyBuoyDefaultStyle(btn);
    });
}

window.toggleMarineStatusAccordion = function () {
    const body = document.getElementById('marine-status-accordion-body');
    const header = document.getElementById('marine-status-accordion-header');
    if (body) body.classList.toggle('collapsed');

    const icon = document.getElementById('marine-status-accordion-icon');
    if (icon) {
        if (body.classList.contains('collapsed')) {
            icon.style.transform = 'rotate(0deg)';
        } else {
            icon.style.transform = 'rotate(180deg)';
        }
    }
};

// 초기 실행
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderMarineWeatherStatus, 500); // 데이터 로드 시간 고려

    // 관리자 트리거 초기화 (15회 클릭)
    // 관리자 트리거 초기화 (15회 클릭) - LEGACY REMOVED
    // if (typeof initAdminTrigger === 'function') initAdminTrigger();

    // 공지사항 확인은 설문조사 완료/스킵 후 survey_user.js에서 호출됨
});


// 즉시 실행 시도


/**
 * 윈디 팝업 닫기
 */
function closeWindyPopup() {
    const modal = document.getElementById('windy-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.2s';
        setTimeout(() => modal.remove(), 200);
    }
}

// 전역 함수로 등록
window.showWindyPopup = showWindyPopup;
window.closeWindyPopup = closeWindyPopup;

