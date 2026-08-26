// Upstash Redis 캐시 래퍼.
//
// [설계 원칙] 캐시가 없어도(또는 Upstash가 죽어도) 사이트는 죽지 않아야 한다.
// 캐시는 비용을 줄이는 최적화이지, 가용성이 거기 의존해서는 안 된다. 그래서 이
// 모듈의 모든 함수는 실패 시 예외를 던지는 대신 "캐시 없음"으로 취급하고, 호출한
// 쪽(list-*.js)이 Firestore 직접 조회로 자연스럽게 폴백하도록 만든다.
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
        console.warn('[cache] UPSTASH_REDIS_REST_URL/TOKEN 미설정 — 캐시 없이 매번 Firestore를 직접 조회합니다.');
        return null;
    }
    client = new Redis({ url, token });
    return client;
}

/** 캐시된 값을 읽는다. 없거나 실패하면 null. */
async function cacheGet(key) {
    const redis = getClient();
    if (!redis) return null;
    try {
        return await redis.get(key);
    } catch (err) {
        console.warn(`[cache] get(${key}) 실패, Firestore로 폴백:`, err?.message || err);
        return null;
    }
}

/** 값을 TTL(초)과 함께 저장한다. 실패해도 조용히 넘어간다 — 다음 요청이 다시 채운다. */
async function cacheSet(key, value, ttlSeconds) {
    const redis = getClient();
    if (!redis) return;
    try {
        await redis.set(key, value, { ex: ttlSeconds });
    } catch (err) {
        console.warn(`[cache] set(${key}) 실패(무시하고 계속):`, err?.message || err);
    }
}

module.exports = { cacheGet, cacheSet };
