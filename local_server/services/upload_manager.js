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
 * [연계 파일]
 * - config/server_config.js → UPLOAD_DIR 경로 사용
 * - routes/content.js → upload(이미지), uploadFile(문서) 미들웨어 사용
 * - server.js → 정적 파일로 uploads/ 폴더 서빙
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

let upload;         // 이미지 업로드 핸들러
let uploadFile;     // 문서 파일 업로드 핸들러

// ============================================================================
// Cloudinary vs 로컬 디스크 스토리지 선택
// ============================================================================
if (process.env.CLOUDINARY_CLOUD_NAME) {
    const cloudinary = require('cloudinary').v2;
    const { CloudinaryStorage } = require('multer-storage-cloudinary');

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    // 이미지 업로드용 스토리지 (jpg, png, gif, webp 허용)
    const cloudStorage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'seagnal-uploads',
            allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
        },
    });

    // 문서 파일 업로드용 스토리지 (raw 타입: 엑셀, 한글, PDF 등)
    const cloudStorageRaw = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'seagnal-files',
            resource_type: 'raw',
        },
    });

    upload = multer({ storage: cloudStorage });
    uploadFile = multer({ storage: cloudStorageRaw });

    console.log('☁️  Cloudinary Storage 모드로 동작합니다.');
} else {
    // 로컬 디스크 스토리지
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
    uploadFile
};
