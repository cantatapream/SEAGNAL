// ====================================================================
// cctv7.js — CCTV 위치 편집 도구
//
// [역할]
//   마커 좌표가 잘못된 경우 지도 상에서 직접 위치를 교정합니다.
//   편집 모드에서:
//     1. 마커를 탭 → 해당 CCTV 선택 (빨간 원으로 강조)
//     2. 지도 빈 곳 탭 → 선택된 마커를 그 위치로 이동
//     3. '내보내기' 버튼 → 변경된 좌표를 JSON으로 표시 + 클립보드 복사
//
// [연계]
//   - cctv2.js cctvMap              — 지도 인스턴스
//   - cctv3.js _cctvClusterSource   — 마커 소스 (위치 갱신)
//   - cctv4.js handleCctvMapClick   — 편집 모드일 때 클릭 분기
// ====================================================================

/** 편집 모드 활성 여부 */
let _editMode = false;

/** 현재 선택된 내부 Feature */
let _editSelectedFeature = null;

/** 변경 내역: { "providerKey:cctvId": { providerKey, cctvId, name, lat, lng } } */
const _editChanges = {};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모드 토글
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function toggleCctvEditMode() {
    _editMode = !_editMode;
    _clearEditSelection();

    const btn = document.getElementById('cctv-edit-mode-btn');
    if (btn) {
        if (_editMode) {
            btn.classList.add('cctv-edit-btn-active');
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 편집 종료';
        } else {
            btn.classList.remove('cctv-edit-btn-active');
            btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> 위치 편집';
        }
    }

    const panel = document.getElementById('cctv-edit-panel');
    if (panel) panel.style.display = _editMode ? 'flex' : 'none';

    if (cctvMap) {
        cctvMap.getTargetElement().style.cursor = _editMode ? 'crosshair' : '';
    }

    if (_editMode) {
        _updateEditPanel(null, null, null, null);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 편집 클릭 처리  (cctv4.js handleCctvMapClick에서 위임)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function handleCctvEditClick(event) {
    const feature = cctvMap.forEachFeatureAtPixel(event.pixel, function (f) { return f; });

    if (feature) {
        const clusterFeatures = feature.get('features');
        if (!clusterFeatures || clusterFeatures.length > 1) {
            // 클러스터: 줌인 안내
            _setEditMsg('클러스터입니다. 더 확대한 뒤 개별 마커를 선택하세요.');
            return;
        }
        // 단일 마커 선택
        _selectEditFeature(clusterFeatures[0]);
    } else {
        // 빈 지도 탭 → 선택 마커 이동
        if (_editSelectedFeature) {
            _moveSelectedFeature(event.coordinate);
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 마커 선택 / 이동
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _selectEditFeature(innerFeature) {
    _clearEditSelection();
    _editSelectedFeature = innerFeature;

    // 선택 하이라이트 스타일 (빨간 원 + 이름)
    innerFeature._origStyle = innerFeature.getStyle();
    innerFeature.setStyle(new ol.style.Style({
        image: new ol.style.Circle({
            radius: 12,
            fill:   new ol.style.Fill({ color: 'rgba(239,68,68,0.92)' }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 })
        }),
        text: new ol.style.Text({
            text: innerFeature.get('name'),
            offsetY: -22,
            fill:    new ol.style.Fill({ color: '#ef4444' }),
            stroke:  new ol.style.Stroke({ color: '#000000', width: 3 }),
            font:    'bold 12px "Noto Sans KR", sans-serif'
        })
    }));

    const coords = ol.proj.toLonLat(innerFeature.getGeometry().getCoordinates());
    _updateEditPanel(coords[1], coords[0],
        innerFeature.get('name'), innerFeature.get('subtitle'));
}

function _moveSelectedFeature(coordinate) {
    const lonLat = ol.proj.toLonLat(coordinate);
    const lat = lonLat[1];
    const lng = lonLat[0];

    // 마커 위치 갱신
    _editSelectedFeature.getGeometry().setCoordinates(coordinate);

    // 변경 이력 저장
    const cctvId   = _editSelectedFeature.get('cctvId');
    const provKey  = _editSelectedFeature.get('providerKey');
    const key      = provKey + ':' + cctvId;
    _editChanges[key] = {
        providerKey: provKey,
        cctvId:      cctvId,
        name:        _editSelectedFeature.get('name'),
        subtitle:    _editSelectedFeature.get('subtitle'),
        lat:         lat.toFixed(7),
        lng:         lng.toFixed(7)
    };

    // 클러스터 소스 변경 알림 (화면 갱신)
    if (_cctvClusterSource) _cctvClusterSource.getSource().changed();

    // 패널 좌표 업데이트
    _updateEditPanel(lat, lng,
        _editSelectedFeature.get('name'), _editSelectedFeature.get('subtitle'));
    _setEditMsg('위치 이동 완료. 계속 이동하거나 다른 마커를 선택하세요.');
}

function _clearEditSelection() {
    if (_editSelectedFeature) {
        if (_editSelectedFeature._origStyle !== undefined) {
            _editSelectedFeature.setStyle(_editSelectedFeature._origStyle);
            delete _editSelectedFeature._origStyle;
        }
        _editSelectedFeature = null;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 패널 UI 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _updateEditPanel(lat, lng, name, subtitle) {
    const nameEl  = document.getElementById('cctv-edit-name');
    const coordEl = document.getElementById('cctv-edit-coord');

    if (nameEl) {
        nameEl.textContent = name
            ? name + (subtitle ? '  ·  ' + subtitle : '')
            : '마커를 탭하여 선택하세요';
    }
    if (coordEl) {
        coordEl.textContent = (lat != null)
            ? 'lat ' + lat.toFixed(6) + '  /  lng ' + lng.toFixed(6)
            : '';
    }
    _setEditMsg(name ? '지도 빈 곳을 탭하면 이 위치로 이동합니다.' : '');
}

function _setEditMsg(msg) {
    const msgEl = document.getElementById('cctv-edit-msg');
    if (msgEl) msgEl.textContent = msg;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 내보내기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function exportCctvEditChanges() {
    const entries = Object.values(_editChanges);
    if (!entries.length) {
        alert('변경된 위치가 없습니다.');
        return;
    }

    // providerKey별로 그룹화
    const byProvider = {};
    entries.forEach(function (c) {
        if (!byProvider[c.providerKey]) byProvider[c.providerKey] = [];
        byProvider[c.providerKey].push(c);
    });

    const blocks = [];
    Object.entries(byProvider).forEach(function ([provKey, items]) {
        const lines = items.map(function (c) {
            return '  // ' + c.name + (c.subtitle ? ' (' + c.subtitle + ')' : '') + '\n'
                 + '  { cctvId: ' + c.cctvId
                 + ", lat: '" + c.lat + "'"
                 + ", lng: '" + c.lng + "' }";
        });
        blocks.push('// ── ' + provKey + ' ──\n' + lines.join(',\n'));
    });

    const text = blocks.join('\n\n');

    const modal    = document.getElementById('cctv-edit-export-modal');
    const textarea = document.getElementById('cctv-edit-export-text');
    if (modal && textarea) {
        textarea.value = text;
        modal.style.display = 'flex';
        setTimeout(function () { textarea.select(); }, 100);
    }
}

function closeCctvEditExport() {
    const modal = document.getElementById('cctv-edit-export-modal');
    if (modal) modal.style.display = 'none';
}

function copyCctvEditChanges() {
    const textarea = document.getElementById('cctv-edit-export-text');
    if (!textarea) return;
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        navigator.clipboard && navigator.clipboard.writeText(textarea.value);
    }
    const btn = document.getElementById('cctv-edit-copy-btn');
    if (btn) {
        const orig = btn.textContent;
        btn.textContent = '복사됨 ✓';
        setTimeout(function () { btn.textContent = orig; }, 2000);
    }
}
