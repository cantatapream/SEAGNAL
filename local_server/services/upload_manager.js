/**
 * ============================================================================
 * 파일명: services/upload_manager.js
 * 역할: 파일 업로드 설정 관리 모듈 (Cloudinary 클라우드 또는 로컬 디스크)
 * ============================================================================
 *
 * [설명]
 * 이 파일은 이미지 및 문서 파일 업로드를 위한 multer 스토리지 설정을 관리합니다.
 * - Cloudinary 환경변수가 설정되어 있으면: 클라우드 스토리지 사용
 * - 설정이 없으면: 로컬 디스크(uploads/ 폴더)에 저장
 *
 * [Lazy Require 적용 — 시작 속도 최적화]
 *   `cloudinary` + `multer-storage-cloudinary` SDK 는 require 만 해도 약 6초가
 *   걸리는 무거운 모듈이다. 그러나 사용자 업로드는 서버 시작 직후 발생하지 않는
 *   드문 이벤트이므로, require 를 첫 업로드 시점까지 미루어 startup 을 단축한다.
 *   - 로컬 디스크 모드: cloudinary 가 필요 없으므로 즉시 multer 생성 (변화 없음)
 *   - Cloudinary 모드:  upload / uploadFile 을 lazy proxy 로 export.
 *                       proxy 의 .single() / .array() 등이 실제로 호출되어
 *                       middleware 가 동작할 때 cloudinary 모듈을 require 한다.
 *                       Node 의 require 캐싱으로 두 번째 호출부터는 즉시 반환됨.
 *
 * [연계 파일]
 * - config/server_config.js → UPLOAD_DIR 경로 사용
 * - routes/content.js       → upload(이미지), uploadFile(문서) 미들웨어 사용
 * - routes/admin.js         → getCloudinary() 로 사용량 조회
 * - server.js               → 정적 파일로 uploads/ 폴더 서빙
 *
 * [초보자를 위한 안내]
 * multer는 Node.js에서 파일 업로드를 처리하는 라이브러리입니다.
 * Cloudinary는 이미지/파일을 클라우드에 저장하는 서비스입니다.
 * 환경변수(CLOUDINARY_CLOUD_NAME 등)가 설정되어 있으면 Cloudinary를,
 * 아니면 서버의 uploads/ 폴더에 파일을 저장합니다.
 * ============================================================================
 */

const multer = require('multer');
const { UPLOAD_DIR } = require('../config/server_config');

let upload;                     // 이미지 업로드 핸들러 (혹은 lazy proxy)
let uploadFile;                 // 문서 파일 업로드 핸들러 (혹은 lazy proxy)
let cloudinaryInstance = null;  // Cloudinary SDK 인스턴스 (관리자 페이지 사용량 조회용)

// ============================================================================
// Cloudinary lazy 초기화 (모듈 외부 스코프에 위치 — getCloudinary 도 사용)
// ============================================================================
let _cloudInitDone = false;     // 첫 초기화 시도가 끝났는지 (성공·실패 모두 포함)
let _realUpload = null;         // 실제 cloudinary 기반 multer (이미지)
let _realUploadFile = null;     // 실제 cloudinary 기반 multer (문서)

/**
 * Cloudinary 모드에서 실제 SDK 와 multer 인스턴스를 처음 한 번 만든다.
 * 이미 시도했으면 즉시 반환. 실패해도 _cloudInitDone 을 true 로 두어
 * 매 요청마다 재시도하지 않는다 (오류 로그 폭주 방지).
 */
function _ensureCloudReady() {
    if (_cloudInitDone) return;
    _cloudInitDone = true;

    try {
        // [Lazy Require] 무거운 SDK 를 첫 호출 시점에만 로딩.
        const cloudinary = require('cloudinary').v2;
        const { CloudinaryStorage } = require('multer-storage-cloudinary');

        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
        cloudinaryInstance = cloudinary;

        // 이미지 업로드용 스토리지 (jpg, png, gif, webp 허용)
        _realUpload = multer({
            storage: new CloudinaryStorage({
                cloudinary,
                params: {
                    folder: 'seagnal-uploads',
                    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp']
                }
            })
        });

        // 문서 파일 업로드용 스토리지 (raw 타입: 엑셀, 한글, PDF 등)
        _realUploadFile = multer({
            storage: new CloudinaryStorage({
                cloudinary,
                params: {
                    folder: 'seagnal-files',
                    resource_type: 'raw'
                }
            })
        });

        console.log('☁️  Cloudinary Storage 모드로 동작합니다.');
    } catch (e) {
        console.error('⚠️ Cloudinary 초기화 실패 (업로드 비활성):', e && e.message);
    }
}

/**
 * multer 인스턴스의 메서드(.single/.array/.fields/.none/.any) 를 흉내내는 lazy proxy.
 * 각 메서드는 middleware 함수를 반환하며, middleware 가 실제로 실행될 때
 * _ensureCloudReady() 가 호출되어 cloudinary 가 그 시점에 require 된다.
 *
 * @param {() => any} getReal - 실제 multer 인스턴스(_realUpload 등)를 반환하는 getter
 */
function _makeLazyMulterProxy(getReal) {
    function wrap(method) {
        return function (...args) {
            return function (req, res, next) {
                _ensureCloudReady();
                const real = getReal();
                if (!real) {
                    return next(new Error('Cloudinary 초기화 실패 — 업로드 불가'));
                }
                return real[method](...args)(req, res, next);
            };
        };
    }
    return {
        single: wrap('single'),
        array:  wrap('array'),
        fields: wrap('fields'),
        none:   wrap('none'),
        any:    wrap('any')
    };
}

// ============================================================================
// Cloudinary vs 로컬 디스크 스토리지 선택
// ============================================================================
if (process.env.CLOUDINARY_CLOUD_NAME) {
    // Cloudinary 모드: 실제 SDK 로딩은 첫 업로드 요청까지 미룸 (lazy)
    upload     = _makeLazyMulterProxy(() => _realUpload);
    uploadFile = _makeLazyMulterProxy(() => _realUploadFile);
    // 시작 로그는 실제 init 시점("☁️ Cloudinary Storage 모드로 동작합니다.")에 출력됨
} else {
    // 로컬 디스크 스토리지 (cloudinary 미사용 — 가벼우므로 즉시 생성)
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
            // 한글 깨짐 방지: latin1 -> utf8 변환
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
            // 파일명 중복 방지: 타임스탬프 + 원본파일명
            cb(null, Date.now() + '_' + file.originalname);
        }
    });

    upload = multer({ storage: storage });
    uploadFile = multer({ storage: storage });

    console.log('📂 Local Disk Storage 모드로 동작합니다.');
}

// global.uploadFile 설정 (기존 코드 호환성 유지)
global.uploadFile = uploadFile;

module.exports = {
    upload,
    uploadFile,
    /**
     * Cloudinary SDK 인스턴스를 반환한다 (관리자 페이지의 사용량 조회 등에 사용).
     * Cloudinary 모드라면 첫 호출 시 lazy 초기화를 트리거하여 인스턴스를 만든 뒤 반환.
     * 로컬 디스크 모드(또는 초기화 실패) 라면 null.
     */
    getCloudinary: () => {
        if (process.env.CLOUDINARY_CLOUD_NAME) _ensureCloudReady();
        return cloudinaryInstance;
    }
};
