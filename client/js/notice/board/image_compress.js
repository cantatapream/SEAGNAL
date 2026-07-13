/**
 * ============================================================================
 * 파일명: js/image_compress.js
 * 역할: 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (브라우저 Canvas API 만 사용)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음 (Quill 에디터 이미지 입력 훅으로만 동작)
 *  - 나를 쓰는 곳  : promo.js (관리자 게시글 에디터 이미지 삽입 시 window.compressImageToJpeg/blobToDataURL 호출)
 * ============================================================================
 *
 * [배경]
 *  Quill 에디터에 이미지를 paste / drop / 파일선택 으로 삽입하면 Quill 의
 *  기본 동작상 이미지가 base64 문자열로 본문 HTML 에 인라인 삽입됨.
 *  1MB 이미지 하나가 base64 로 ~1.3MB 가 되어 JSON body 가 과도하게 커져
 *  서버 body limit(Express 기본 100kb) 초과로 저장 실패. limit 을 크게
 *  올리면 DoS / 저장소 비대화 리스크 발생.
 *
 * [해결]
 *  에디터에 삽입되기 전에 브라우저 Canvas API 로 자동 압축.
 *   - 가로 최대 1600px 로 리사이즈
 *   - JPEG 품질 0.85 부터 인코딩
 *   - 목표 용량(기본 500KB) 초과면 품질 0.1 씩 낮춰 재인코딩
 *   - 품질 하한(0.5) 에서도 초과면 가로 80% 축소 후 재시도
 *
 * [사용처]
 *  js/promo.js  — 관리자 게시글 에디터의 이미지 입력 훅
 *
 * [공개 API]
 *  window.compressImageToJpeg(fileOrBlob, options)  → Promise<Blob>
 *  window.blobToDataURL(blob)                        → Promise<string>
 * ============================================================================
 */

(function () {
    'use strict';

    /**
     * 이미지를 JPEG 로 압축하여 Blob 반환.
     *
     * @param {File|Blob} file  이미지 파일/블롭
     * @param {Object} [opts]
     * @param {number} [opts.maxWidth=1600]       리사이즈 후 최대 가로 px
     * @param {number} [opts.targetBytes=524288]  목표 용량 (바이트, 기본 500KB)
     * @param {number} [opts.minQuality=0.5]      JPEG 품질 하한
     * @param {number} [opts.initialQuality=0.85] JPEG 품질 시작값
     * @returns {Promise<Blob>}
     */
    window.compressImageToJpeg = function (file, opts) {
        opts = opts || {};
        var maxWidth       = opts.maxWidth       || 1600;
        var targetBytes    = opts.targetBytes    || (500 * 1024);
        var minQuality     = opts.minQuality     || 0.5;
        var initialQuality = opts.initialQuality || 0.85;

        return new Promise(function (resolve, reject) {
            if (!file || !file.type || file.type.indexOf('image/') !== 0) {
                reject(new Error('이미지 파일이 아닙니다.'));
                return;
            }

            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    // 1) 가로 최대폭 기준 리사이즈 비율 계산
                    var ratio = Math.min(1, maxWidth / img.width);
                    var w = Math.max(1, Math.round(img.width * ratio));
                    var h = Math.max(1, Math.round(img.height * ratio));

                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    if (!ctx) { reject(new Error('Canvas 컨텍스트 획득 실패')); return; }

                    function _redraw() {
                        canvas.width = w;
                        canvas.height = h;
                        // 투명 PNG → JPEG 변환 시 배경이 검게 찍히는 것을 방지
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                    }
                    _redraw();

                    // 2) 품질 낮춰가며 목표 용량 도달까지 재인코딩
                    var quality = initialQuality;
                    var MIN_WIDTH_FLOOR = 400;  // 가로 축소 하한 (가독성 보호)

                    function _tryEncode() {
                        canvas.toBlob(function (blob) {
                            if (!blob) {
                                reject(new Error('canvas.toBlob() 실패'));
                                return;
                            }
                            // 목표 도달 → 반환
                            if (blob.size <= targetBytes) {
                                resolve(blob);
                                return;
                            }
                            // 품질을 더 낮출 여지
                            if (quality - 0.1 >= minQuality) {
                                quality = Math.round((quality - 0.1) * 100) / 100;
                                _tryEncode();
                                return;
                            }
                            // 품질 하한 도달 → 가로 축소 후 재시도 (하한 MIN_WIDTH_FLOOR)
                            if (w > MIN_WIDTH_FLOOR) {
                                w = Math.max(MIN_WIDTH_FLOOR, Math.round(w * 0.8));
                                h = Math.max(1, Math.round(h * 0.8));
                                _redraw();
                                quality = initialQuality;   // 새로운 축소 스텝에서 품질 리셋
                                _tryEncode();
                                return;
                            }
                            // 더 이상 줄일 수 없음 → 현재 결과라도 반환 (원본보다 작으면 이익)
                            resolve(blob);
                        }, 'image/jpeg', quality);
                    }
                    _tryEncode();
                };
                img.onerror = function () { reject(new Error('이미지 디코딩 실패')); };
                img.src = reader.result;
            };
            reader.onerror = function () { reject(new Error('FileReader 오류')); };
            reader.readAsDataURL(file);
        });
    };

    /**
     * Blob → data: URL (base64) 변환.
     * Quill 의 insertEmbed('image', url) 에 넣을 수 있는 src 문자열.
     */
    window.blobToDataURL = function (blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(new Error('Blob 읽기 실패')); };
            fr.readAsDataURL(blob);
        });
    };
})();
