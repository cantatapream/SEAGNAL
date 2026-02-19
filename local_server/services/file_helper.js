/**
 * ============================================================================
 * 파일명: services/file_helper.js
 * 역할: JSON 파일 읽기/쓰기 유틸리티 모듈
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버에서 자주 사용하는 JSON 파일 읽기/쓰기 작업을 공통 함수로 제공합니다.
 * - readJSON: JSON 파일을 읽어서 JavaScript 객체로 반환
 * - writeJSON: JavaScript 객체를 JSON 파일로 저장
 * - existsSync: 파일 존재 여부 확인 (fs.existsSync 래퍼)
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR 경로 사용
 * - routes/*.js → JSON 데이터 파일 읽기/쓰기에 사용
 *
 * [초보자를 위한 안내]
 * SEAGNAL 서버는 데이터베이스 대신 JSON 파일로 데이터를 저장합니다.
 * (MongoDB, PostgreSQL 같은 DB를 사용하지 않음)
 * 이 파일의 함수들은 그 JSON 파일을 안전하게 읽고 쓰는 역할을 합니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

/**
 * JSON 파일을 읽어서 파싱된 객체를 반환합니다.
 * 파일이 없거나 파싱 실패 시 기본값을 반환합니다.
 *
 * @param {string} filename - data/ 디렉토리 내의 파일명 (예: 'visitors.json')
 * @param {*} defaultValue - 파일이 없거나 오류 시 반환할 기본값
 * @returns {*} 파싱된 JSON 데이터 또는 기본값
 */
function readJSON(filename, defaultValue = null) {
    const filePath = filename.includes(path.sep) ? filename : path.join(DATA_DIR, filename);
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
    } catch (e) {
        console.error(`[FileHelper] ${filename} 읽기 실패:`, e.message);
    }
    return defaultValue;
}

/**
 * JavaScript 객체를 JSON 파일로 저장합니다.
 *
 * @param {string} filename - data/ 디렉토리 내의 파일명 (예: 'visitors.json')
 * @param {*} data - 저장할 데이터
 * @returns {boolean} 저장 성공 여부
 */
function writeJSON(filename, data) {
    const filePath = filename.includes(path.sep) ? filename : path.join(DATA_DIR, filename);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error(`[FileHelper] ${filename} 쓰기 실패:`, e.message);
        return false;
    }
}

/**
 * 파일 존재 여부를 확인합니다.
 *
 * @param {string} filename - 확인할 파일 경로 또는 data/ 내 파일명
 * @returns {boolean} 파일 존재 여부
 */
function fileExists(filename) {
    const filePath = filename.includes(path.sep) ? filename : path.join(DATA_DIR, filename);
    return fs.existsSync(filePath);
}

module.exports = {
    readJSON,
    writeJSON,
    fileExists,
    DATA_DIR
};
