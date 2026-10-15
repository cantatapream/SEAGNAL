/**
 * 파일명: local_server/services/risk_history_sources.js
 * 역할: 오류 감시에서 예보 본문을 보관하지 않고 실제 상태·수집 시각만 읽는다.
 * [연계] risk_error_history.start → risk_store.sources의 동일 신선도 규칙.
 * [로드 순서] 운영 감시 시작 시 생성. 화면용 저장소와 별도의 작은 메타데이터만 보관한다.
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    zlib = require('zlib'),
    Parser = require('stream-json/Parser');
const io = require('./risk_collector_io'),
    { createStore } = require('./risk_store');
const FIELDS = new Set([
    'updatedAt',
    'savedAt',
    'collectedAt',
    'date',
    'month',
    'createdAt',
    'sourceAt',
    'status',
    'lastSuccess',
    'lastError',
    'checkedAt',
    'lastRun',
]);
/** JSON을 끝까지 검사하되 각 본문 값을 즉시 버린다. 예: frames 48개도 객체로 남기지 않는다.
 * @param {string} file - JSON 또는 gzip 파일 @returns {Promise<object|null>} 실제 메타데이터, 손상은 null
 * [연계] createReader → risk_store.refresh / 원천 날짜를 파일 mtime으로 대체하지 않는다.
 */
async function readMetadata(file) {
    let source, decoded;
    try {
        if (fs.statSync(file).size > 64 * 1024 * 1024) return null;
        source = fs.createReadStream(file, { highWaterMark: 16384 });
        decoded = file.endsWith('.gz')
            ? source.pipe(zlib.createGunzip({ chunkSize: 16384 }))
            : source;
        if (decoded !== source)
            source.on('error', (error) => decoded.destroy(error));
        let inString = false,
            escaped = false,
            total = 0;
        const parser = new Parser({ packValues: false }),
            out = {},
            stack = [];
        let roots = 0,
            rootObject = false,
            keyText = '',
            scalar = null,
            places = null,
            invalid = false;
        // 값·키의 작은 조각만 받고 본문 배열/객체를 만들지 않는다.
        const current = () => stack[stack.length - 1];
        const value = (v) => {
            const c = current();
            if (stack.length === 1 && FIELDS.has(c.key)) out[c.key] = v;
            if (stack.length === 1 && c.key === 'places') places = null;
            if (
                stack.length === 2 &&
                c.root === 'places' &&
                c.type === 'Object' &&
                places
            ) {
                if (!places.has(c.key) && places.size >= 4096) {
                    invalid = true;
                    return;
                }
                places.set(c.key, false);
            }
            if (
                stack.length === 3 &&
                c.root === 'places' &&
                c.place !== undefined &&
                c.key === 'hasData' &&
                places
            )
                places.set(c.place, !!v);
        };
        parser.on('data', (token) => {
            if (invalid) return;
            const n = token.name,
                c = current();
            if (n === 'startKey') {
                keyText = '';
                return;
            }
            if (n === 'stringChunk' && !scalar) {
                if (keyText.length + token.value.length > 256) invalid = true;
                else keyText += token.value;
                return;
            }
            if (n === 'endKey') {
                if (c) c.key = keyText;
                return;
            }
            if (n === 'startObject' || n === 'startArray') {
                value(null);
                if (!stack.length) {
                    roots++;
                    rootObject = n === 'startObject';
                }
                const root = stack.length === 1 ? c.key : c?.root;
                if (stack.length === 1 && c.key === 'places')
                    places = n === 'startObject' ? new Map() : null;
                if (
                    stack.length === 3 &&
                    c.root === 'places' &&
                    c.key === 'hasData' &&
                    places
                )
                    places.set(c.place, true);
                if (stack.length >= 128) invalid = true;
                stack.push({
                    type: n.slice(5),
                    root,
                    place:
                        stack.length === 2 && root === 'places'
                            ? c.key
                            : undefined,
                });
                return;
            }
            if (n === 'endObject' || n === 'endArray') {
                stack.pop();
                return;
            }
            if (n === 'startString' || n === 'startNumber') {
                scalar = { type: n.slice(5), text: '', long: false };
                return;
            }
            if (n === 'stringChunk' || n === 'numberChunk') {
                if (scalar) {
                    if (scalar.text.length + token.value.length > 256)
                        scalar.long = true;
                    else scalar.text += token.value;
                }
                return;
            }
            if (n === 'endString' || n === 'endNumber') {
                const s = scalar;
                scalar = null;
                value(
                    s.long
                        ? s.type === 'String' &&
                          stack.length === 3 &&
                          current()?.key === 'hasData'
                            ? true
                            : null
                        : s.type === 'Number'
                        ? Number(s.text)
                        : s.text
                );
                return;
            }
            if (n === 'nullValue' || n === 'trueValue' || n === 'falseValue')
                value(token.value);
        });
        parser.on('error', () => {}); // 즉시 errored를 확인하고 지연 error 이벤트도 처리한다.
        for await (const chunk of decoded) {
            total += chunk.length;
            if (total > 64 * 1024 * 1024) return null;
            // 문자열 밖에는 JSON 표준 ASCII 공백만 허용한다.
            for (const b of chunk) {
                if (inString) {
                    if (escaped) escaped = false;
                    else if (b === 92) escaped = true;
                    else if (b === 34) inString = false;
                } else if (b === 34) inString = true;
                else if (b > 127 || (b < 32 && b !== 9 && b !== 10 && b !== 13))
                    return null;
            }
            parser.write(chunk);
            if (invalid || parser.errored) return null;
        }
        parser.end();
        if (
            parser.errored ||
            invalid ||
            roots !== 1 ||
            !rootObject ||
            stack.length ||
            scalar
        )
            return null;
        out._ripTotal = places?.size || 0;
        out._ripWithData = places
            ? [...places.values()].filter(Boolean).length
            : 0;
        return out;
    } catch (error) {
        if (error.code !== 'ENOENT')
            console.warn('[risk_history] 원천 메타데이터 읽기 실패');
        return null;
    } finally {
        if (decoded) decoded.destroy();
        if (source) source.destroy();
    }
}
/** 관리자 감시 전용 읽기 함수를 만든다. 예: 삭제·날짜 만료는 같은 sources 규칙으로 재평가한다.
 * @param {object} options - 검사에서 임시 폴더·시계 주입 @returns {function} 작은 원천 상태
 * [연계] risk_error_history.start / 화면의 격자·통계는 공개 저장소가 계속 담당한다.
 */
function createReader(options = {}) {
    const dir = options.dir || io.DEFAULT_DIR,
        clock = options.clock || Date.now,
        cache = new Map();
    const store = createStore({
        ...options,
        dir,
        clock,
        readData: (file) => cache.get(file)?.data || null,
        metadataOnly: true,
    });
    return async function readSources() {
        const day = io.day(clock()),
            liveFile = path.join(dir, 'sea_realtime.json.gz'),
            attemptFile = path.join(dir, 'realtime_status.json');
        const files = new Set([...store.sourceFiles(), liveFile, attemptFile]);
        for (const file of cache.keys())
            if (!files.has(file)) cache.delete(file);
        for (const file of files) {
            let signature = null;
            try {
                const st = fs.statSync(file);
                signature = [st.mtimeMs, st.size, st.ino].join(':');
            } catch (e) {
                if (e.code !== 'ENOENT') throw e;
            }
            if (cache.get(file)?.signature === signature) continue;
            cache.set(file, {
                signature,
                data: signature ? await readMetadata(file) : null,
            });
        }
        if (io.day(clock()) !== day) throw Error('source window changed');
        const live = cache.get(liveFile)?.data,
            attempt = cache.get(attemptFile)?.data,
            at = Date.parse(live?.sourceAt || live?.collectedAt),
            now = clock();
        const status =
            attempt?.status === 'error'
                ? 'error'
                : !live
                ? cache.get(liveFile)?.signature
                    ? 'error'
                    : 'missing'
                : !Number.isFinite(at) ||
                  now - at > 15 * 60000 ||
                  at > now + 5 * 60000
                ? 'stale'
                : 'ok';
        return {
            ...store.sources(true),
            realtime: {
                status,
                updatedAt: live?.sourceAt || live?.collectedAt || null,
                lastSuccess: attempt?.lastSuccess || live?.collectedAt || null,
                checkedAt: attempt?.lastRun || null,
                lastError: attempt?.lastError || null,
            },
        };
    };
}
module.exports = { createReader, readMetadata };
