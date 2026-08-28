// Upstash Redis 캐시 래퍼.
//
// [설계 원칙] 캐시가 없어도(또는 Upstash가 죽어도) 사이트는 죽지 않아야 한다.
// 다만 "죽지 않는다"를 예전처럼 "무조건 Firestore로 흘려보낸다"로 구현하면
// 안 된다 — 그건 fail-open이고, 공격자가 Upstash를 먼저 소진시키면 그 순간
// 방어가 통째로 꺼지면서 원래의 읽기 증폭 문제로 되돌아간다(방어가 필요한
// 바로 그 순간에 방어가 사라지는 구조). 실제 폴백 정책은 cachedList.js가
// 정하고, 이 모듈은 그 판단에 필요한 정보를 정확히 넘겨주는 것까지만 한다.
//
// [핵심] 그래서 "캐시에 값이 없음(miss)"과 "Redis가 실패함(error)"을 반드시
// 구분해서 돌려준다. 예전에는 둘 다 null이라 호출부가 구분할 수 없었고, 그게
// fail-open의 직접적인 원인이었다.
//
// [자격 증명] Upstash 콘솔에서 Redis 데이터베이스를 만들면 REST URL/토큰이
// 발급된다. Vercel 환경 변수로 등록:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// (Vercel 마켓플레이스의 "Upstash" 통합을 쓰면 이 두 값이 자동으로 채워진다.)

const { Redis } = require('@upstash/redis');

let client = null;
let clientInitAttempted = false;

function getClient() {
    if (clientInitAttempted) return client;
    clientInitAttempted = true;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        console.warn('[cache] UPSTASH_REDIS_REST_URL/TOKEN 미설정 — 메모리 캐시만으로 동작합니다.');
        return null;
    }
    client = new Redis({ url, token });
    return client;
}

/**
 * 캐시된 값을 읽는다.
 * @returns {Promise<{status: 'hit'|'miss'|'error'|'disabled', value?: any}>}
 *   hit      값이 있음
 *   miss     정상 조회했으나 값이 없음(만료 포함) → Firestore로 채우는 게 맞다
 *   error    Redis 자체가 실패(장애/한도 소진/타임아웃) → 함부로 Firestore로
 *            흘리면 안 된다. 호출부가 stale 서빙 등으로 감당해야 한다.
 *   disabled 환경 변수 미설정 → Redis를 아예 안 쓰는 구성
 */
async function cacheGet(key) {
    const redis = getClient();
    if (!redis) return { status: 'disabled' };
    try {
        const value = await redis.get(key);
        return value === null || value === undefined
            ? { status: 'miss' }
            : { status: 'hit', value };
    } catch (err) {
        console.warn(`[cache] get(${key}) 실패:`, err?.message || err);
        return { status: 'error' };
    }
}

/**
 * 값을 TTL(초)과 함께 저장한다.
 * @returns {Promise<boolean>} 저장에 성공했는지 (실패해도 예외는 던지지 않는다)
 */
async function cacheSet(key, value, ttlSeconds) {
    const redis = getClient();
    if (!redis) return false;
    try {
        await redis.set(key, value, { ex: ttlSeconds });
        return true;
    } catch (err) {
        console.warn(`[cache] set(${key}) 실패(무시하고 계속):`, err?.message || err);
        return false;
    }
}

module.exports = { cacheGet, cacheSet };
