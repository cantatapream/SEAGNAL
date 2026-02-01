const fs = require('fs');
const path = require('path');
const http = require('https');

const BASE_URL = 'https://seagnal-server.fly.dev';
const ARCHIVE_LIST_URL = `${BASE_URL}/api/archive/list`;
const DOWNLOAD_BASE_URL = `${BASE_URL}/api/archive/download/`;

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        http.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function runAnalysis() {
    console.log('--- 전체 해역 서버 데이터 통합 분석 시작 ---');

    try {
        const fileList = await fetchJson(ARCHIVE_LIST_URL);
        console.log(`분석 대상 해역 수: ${fileList.length}개`);

        const summary = {
            totalMissing: 0,
            totalGhost: 0,
            totalMismatch: 0,
            details: []
        };

        const tempDir = path.join(__dirname, 'temp_archives');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        for (const fileInfo of fileList) {
            const fileName = fileInfo.filename;
            const zoneName = fileInfo.name;
            const localPath = path.join(tempDir, fileName);

            process.stdout.write(`📥 ${zoneName} 다운로드 및 분석 중... `);

            await downloadFile(`${DOWNLOAD_BASE_URL}${fileName}`, localPath);
            const content = JSON.parse(fs.readFileSync(localPath, 'utf8'));

            let zoneMissing = 0;
            let zoneGhost = 0;
            let zoneMismatch = 0;

            if (content.history) {
                content.history.forEach(entry => {
                    const kst = entry.kst;
                    // 1월 27일 이후 데이터만 분석
                    if (!kst.includes('2026. 1. 27.') && !kst.includes('2026. 1. 28.')) return;

                    const hub = entry.hub || [];
                    const afso = entry.afso || [];

                    // 1. MISSING 감지
                    const activeHub = hub.filter(h => h.cmd !== '해제');
                    if (activeHub.length > 0 && afso.length === 0) {
                        zoneMissing++;
                        summary.details.push(`🔴 [MISSING] ${kst} | ${zoneName} | HUB: ${activeHub.map(h => h.wrnTp + ' ' + h.wrnLvl).join(', ')}`);
                    }

                    // 2. GHOST / LEVEL MISMATCH 감지
                    afso.forEach(a => {
                        if (a.levelMatch && a.levelMatch !== 'MATCH') {
                            if (a.levelMatch === 'GHOST') {
                                zoneGhost++;
                                summary.details.push(`👻 [GHOST] ${kst} | ${zoneName} | AFSO: ${a.wrnTp} ${a.wrnLvl}`);
                            } else {
                                zoneMismatch++;
                                summary.details.push(`⚠️ [${a.levelMatch}] ${kst} | ${zoneName} | AFSO: ${a.wrnTp} ${a.wrnLvl} vs HUB: ${a.hubWrnLvl}`);
                            }
                        }
                    });
                });
            }

            console.log(`완료 (M:${zoneMissing}, G:${zoneGhost}, L:${zoneMismatch})`);
            summary.totalMissing += zoneMissing;
            summary.totalGhost += zoneGhost;
            summary.totalMismatch += zoneMismatch;

            // 메모리 해제 및 파일 삭제 (선택)
            fs.unlinkSync(localPath);
        }

        console.log('\n=================================================');
        console.log('📊 서버 데이터 통합 분석 결과 (2026.01.27 ~ 현재)');
        console.log('=================================================');
        console.log(`🚩 총 누락(MISSING): ${summary.totalMissing}건`);
        console.log(`🚩 총 유령(GHOST): ${summary.totalGhost}건`);
        console.log(`🚩 총 등급 불일치: ${summary.totalMismatch}건`);
        console.log('-------------------------------------------------');

        if (summary.details.length > 0) {
            console.log('상세 로그 (최근 50건):');
            summary.details.slice(-50).forEach(log => console.log(log));
        } else {
            console.log('특이 사항 없음 (정상)');
        }

    } catch (e) {
        console.error('분석 중 오류 발생:', e.message);
    }
}

runAnalysis();
