/**
 * ============================================================================
 * 파일명: js/ocean_condition4.js
 * 역할: 해황예보도 - 이미지 표출 및 전체화면 확대 모달
 * ============================================================================
 *
 * [설명]
 * 선택된 날짜+시간에 해당하는 해황예보도 이미지를 화면에 표출하고,
 * 이미지 탭(클릭) 시 전체화면 모달로 확대하는 기능을 담당합니다.
 *
 * [이미지 로드 흐름]
 * 1. OceanForecast.items에서 선택된 날짜+시간에 맞는 아이템 찾기
 * 2. 해당 아이템의 imgFileNm으로 이미지 URL 구성
 *    → /api/ocean-condition/image/{imgFileNm} (우리 서버 캐시에서 제공)
 * 3. <img> 태그의 src 설정 → 브라우저가 이미지 로드
 *
 * [전체화면 모달]
 * - 이미지 탭 → 모달 열림 (어두운 배경 + 확대 이미지)
 * - 핀치줌 (모바일) / 마우스 휠 (PC) 확대 지원
 * - 닫기: X 버튼 / 배경 탭 / 뒤로가기 버튼 (backbutton.js 연동)
 *
 * [연계 파일]
 * - ocean_condition1.js → OceanForecast 전역 상태 참조
 * - ocean_condition3.js → selectOceanTime() 후 showOceanImage() 호출
 * - js/backbutton.js → PopupStack에 모달 등록 (뒤로가기 닫기)
 * ============================================================================
 */

// ============================================================================
// 이미지 표출
// ============================================================================

/**
 * 현재 선택된 날짜+시간에 해당하는 해황예보도 이미지를 표출
 *
 * [동작]
 * 1. OceanForecast.items 배열에서 selectedDate + selectedTime 일치하는 아이템 검색
 * 2. 아이템의 imgFileNm으로 이미지 URL 구성
 * 3. <img> 요소의 src 변경 → 이미지 로드
 * 4. 발표 시점 라벨 표시 (이미지 왼쪽 하단)
 *
 * [호출 위치] ocean_condition3.js → selectOceanTime()
 */
window.showOceanImage = function () {
    var state = window.OceanForecast;
    var imageEl = document.getElementById('ocean-forecast-image');
    var publishEl = document.getElementById('ocean-forecast-publish-label');
    var emptyEl = document.getElementById('ocean-forecast-empty');
    var loadingEl = document.getElementById('ocean-forecast-loading');

    if (!imageEl) return;

    // 선택된 날짜+시간에 맞는 아이템 찾기
    var targetItem = null;
    for (var i = 0; i < state.items.length; i++) {
        var item = state.items[i];
        if (item.ofcFrcstYmd === state.selectedDate && item.ofcFrcstTm === state.selectedTime) {
            targetItem = item;
            break;
        }
    }

    if (!targetItem || !targetItem.imgFileNm) {
        // 해당 날짜+시간의 이미지가 없음
        imageEl.style.display = 'none';
        if (publishEl) publishEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.querySelector('p').textContent = '선택한 일시의 예보도가 없습니다.';
        }
        return;
    }

    // 이미지 URL 구성 (우리 서버 캐시에서 제공)
    var imageUrl = '/api/ocean-condition/image/' + targetItem.imgFileNm;

    // 로딩 표시
    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';

    // 이미지 로드
    imageEl.onload = function () {
        imageEl.style.display = 'block';
        if (loadingEl) loadingEl.style.display = 'none';
    };
    imageEl.onerror = function () {
        imageEl.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.querySelector('p').textContent = '이미지를 불러올 수 없습니다.';
        }
    };
    imageEl.src = imageUrl;

    // 발표 시점 라벨 표시
    // 형식: "발표 2026. 04. 04. 09시"
    if (publishEl && state.publishDate) {
        var pd = state.publishDate; // 예: '20260404'
        var py = pd.substring(0, 4);
        var pm = pd.substring(4, 6);
        var pday = pd.substring(6, 8);
        // 발표 시간: 첫 번째 아이템의 시간대 (보통 09시)
        var firstTimes = state.dateMap[state.publishDate] || [];
        var publishTime = firstTimes.length > 0 ? firstTimes[0] : '09';
        publishEl.textContent = '발표 ' + py + '. ' + pm + '. ' + pday + '. ' + publishTime + '시';
        publishEl.style.display = 'block';
    }
};

// ============================================================================
// 전체화면 확대 모달
// ============================================================================

/**
 * 해황예보도 이미지를 전체화면 모달로 확대 표시
 *
 * [동작]
 * 1. 어두운 배경(backdrop) + 확대 이미지 + 닫기 버튼 + 일시 라벨 생성
 * 2. 핀치줌 (터치) / 더블탭 확대 / 마우스 휠 확대 지원
 * 3. PopupStack에 등록 (뒤로가기 버튼으로 닫기 가능)
 *
 * [닫기 방법]
 * - 오른쪽 상단 X 버튼 탭
 * - 어두운 배경 영역 탭
 * - 휴대폰 뒤로가기 버튼 (PopupStack 연동)
 *
 * [호출 위치] index.html → <img onclick="window.openOceanForecastModal()">
 */
window.openOceanForecastModal = function () {
    var state = window.OceanForecast;
    var imageEl = document.getElementById('ocean-forecast-image');
    if (!imageEl || !imageEl.src) return;

    // 기존 모달이 열려있으면 무시
    if (document.getElementById('ocean-forecast-modal')) return;

    // ── 모달 배경(backdrop) 생성 ──
    var backdrop = document.createElement('div');
    backdrop.id = 'ocean-forecast-modal';
    backdrop.className = 'ocean-forecast-modal-backdrop';

    // ── 닫기 버튼 ──
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ocean-forecast-modal-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', function () {
        window.closeOceanForecastModal();
    });

    // ── 일시 라벨 (예: "4/7(월) 09:00 · 전국") ──
    var labelEl = document.createElement('div');
    labelEl.className = 'ocean-forecast-modal-label';
    if (state.selectedDate && state.selectedTime) {
        var sd = state.selectedDate;
        var sm = parseInt(sd.substring(4, 6));
        var sday = parseInt(sd.substring(6, 8));
        var sDateObj = new Date(parseInt(sd.substring(0, 4)), sm - 1, sday);
        var sDayName = OCEAN_DAY_NAMES[sDateObj.getDay()];
        var areaName = state.areas[state.currentArea] || '전국';
        labelEl.textContent = sm + '/' + sday + '(' + sDayName + ') ' +
            state.selectedTime + ':00 · ' + areaName;
    }

    // ── 이미지 컨테이너 (핀치줌 대상) ──
    var imgContainer = document.createElement('div');
    imgContainer.className = 'ocean-forecast-modal-img-container';

    var modalImg = document.createElement('img');
    modalImg.src = imageEl.src;
    modalImg.alt = '해황예보도 확대';
    modalImg.className = 'ocean-forecast-modal-img';

    imgContainer.appendChild(modalImg);

    // ── 모달 조립 ──
    backdrop.appendChild(closeBtn);
    backdrop.appendChild(labelEl);
    backdrop.appendChild(imgContainer);

    // 배경 클릭 시 닫기 (이미지 영역 클릭은 전파 중단)
    backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) {
            window.closeOceanForecastModal();
        }
    });
    imgContainer.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    document.body.appendChild(backdrop);

    // ── 핀치줌 / 더블탭 확대 설정 ──
    setupOceanModalZoom(modalImg, imgContainer);

    // ── PopupStack 등록 (뒤로가기 버튼 지원) ──
    if (window.PopupStack) {
        window.PopupStack.push('ocean-forecast-modal', function () {
            window.closeOceanForecastModal();
        });
    }

    // 애니메이션을 위해 약간의 딜레이 후 visible 클래스 추가
    requestAnimationFrame(function () {
        backdrop.classList.add('visible');
    });
};

/**
 * 해황예보도 전체화면 모달 닫기
 *
 * [호출 위치]
 * - 닫기 버튼 클릭
 * - 배경 클릭
 * - PopupStack (뒤로가기 버튼)
 */
window.closeOceanForecastModal = function () {
    var modal = document.getElementById('ocean-forecast-modal');
    if (!modal) return;

    // 페이드아웃 애니메이션 후 제거
    modal.classList.remove('visible');
    setTimeout(function () {
        if (modal.parentNode) modal.remove();
    }, 300);

    // PopupStack에서 제거
    if (window.PopupStack) {
        window.PopupStack.remove('ocean-forecast-modal');
    }
};

// ============================================================================
// 핀치줌 / 더블탭 확대 설정
// ============================================================================

/**
 * 모달 이미지에 핀치줌(터치) / 더블탭 / 마우스 휠 확대 기능 설정
 *
 * @param {HTMLImageElement} img - 확대 대상 이미지
 * @param {HTMLElement} container - 이미지를 감싸는 컨테이너
 */
function setupOceanModalZoom(img, container) {
    var scale = 1;       // 현재 확대 배율
    var minScale = 1;    // 최소 배율
    var maxScale = 4;    // 최대 배율
    var posX = 0;        // X축 이동량
    var posY = 0;        // Y축 이동량

    // 이미지에 transform 초기화
    function applyTransform() {
        img.style.transform = 'translate(' + posX + 'px, ' + posY + 'px) scale(' + scale + ')';
    }

    // ── 마우스 휠 확대 (PC) ──
    container.addEventListener('wheel', function (e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? 0.9 : 1.1; // 위로 = 확대, 아래로 = 축소
        var newScale = Math.max(minScale, Math.min(maxScale, scale * delta));
        if (newScale === minScale) { posX = 0; posY = 0; } // 축소 시 위치 리셋
        scale = newScale;
        applyTransform();
    }, { passive: false });

    // ── 더블탭 확대 (모바일/PC) ──
    var lastTap = 0;
    container.addEventListener('touchend', function (e) {
        var now = Date.now();
        if (now - lastTap < 300) {
            // 더블탭 감지
            e.preventDefault();
            if (scale > 1) {
                // 확대 상태 → 원래 크기로
                scale = 1; posX = 0; posY = 0;
            } else {
                // 원래 크기 → 2배 확대
                scale = 2;
            }
            applyTransform();
        }
        lastTap = now;
    });

    // ── 핀치줌 (모바일 터치) ──
    var startDist = 0;
    var startScale = 1;
    var isDragging = false;
    var dragStartX = 0, dragStartY = 0;
    var startPosX = 0, startPosY = 0;

    container.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
            // 두 손가락: 핀치줌 시작
            startDist = getTouchDistance(e.touches);
            startScale = scale;
            e.preventDefault();
        } else if (e.touches.length === 1 && scale > 1) {
            // 한 손가락 + 확대 상태: 드래그 시작
            isDragging = true;
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            startPosX = posX;
            startPosY = posY;
        }
    }, { passive: false });

    container.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2) {
            // 핀치줌 진행
            var dist = getTouchDistance(e.touches);
            var newScale = Math.max(minScale, Math.min(maxScale, startScale * (dist / startDist)));
            if (newScale === minScale) { posX = 0; posY = 0; }
            scale = newScale;
            applyTransform();
            e.preventDefault();
        } else if (isDragging && e.touches.length === 1) {
            // 확대 상태에서 드래그 (이미지 이동)
            posX = startPosX + (e.touches[0].clientX - dragStartX);
            posY = startPosY + (e.touches[0].clientY - dragStartY);
            applyTransform();
            e.preventDefault();
        }
    }, { passive: false });

    container.addEventListener('touchend', function () {
        isDragging = false;
        // 축소되었으면 위치 리셋
        if (scale <= 1) { posX = 0; posY = 0; applyTransform(); }
    });

    /**
     * 두 터치 포인트 사이의 거리 계산 (핀치줌용)
     * @param {TouchList} touches
     * @returns {number} 두 점 사이 거리 (픽셀)
     */
    function getTouchDistance(touches) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
