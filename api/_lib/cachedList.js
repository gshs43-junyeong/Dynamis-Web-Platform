// 공개 목록 컬렉션을 캐싱해서 반환하는 공용 핸들러.
//
// [비용 모델] 캐시 미스 한 번이 Firestore 읽기 N건(문서 개수)을 발생시키고,
// 그 뒤 TTL 동안의 모든 요청은 Redis에서 응답한다. 즉 TTL 창 안에서는 방문자가
// 1명이든 10만 명이든 Firestore 비용이 동일하다 — 방문자당 비용을 줄이는 게
// 아니라 "총 origin 요청 수"에 상한을 만드는 것이라, 볼류메트릭 공격(계정/토큰
// 하나로 짧은 시간에 수천~수만 번 반복 요청)에 대해 실질적인 상한이 생긴다.
//
// [컬렉션을 파라미터로 받지 않는 이유] Admin SDK는 보안 규칙을 완전히 우회한다.
// 만약 이 함수가 요청의 쿼리 파라미터로 컬렉션 이름을 받는다면, 검증 로직에
// 버그 하나만 있어도 users/sanctions 같은 비공개 컬렉션을 인증 없이 통째로
// 덤프하는 엔드포인트가 될 수 있다. 그래서 호출하는 쪽(list-notices.js 등)이
// 컬렉션 이름을 코드에 리터럴로 박아 두고, 이 함수는 그 값을 그대로 전달받기만
// 한다 — 공격 표면에서 "파라미터로 컬렉션을 고른다"는 경우의 수 자체를 없앤다.

const { getAdminDb } = require('./admin');
const { cacheGet, cacheSet } = require('./cache');

/**
 * @param {object} opts
 * @param {string} opts.collectionName Firestore 컬렉션 이름 (호출부에 하드코딩된 값만)
 * @param {string} opts.cacheKey Redis 키
 * @param {number} opts.ttlSeconds 캐시 수명(초)
 */
async function handleCachedList({ collectionName, cacheKey, ttlSeconds }) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
        return { data: cached, hit: true };
    }

    const db = getAdminDb();
    const snapshot = await db.collection(collectionName).get();
    const docs = snapshot.docs.map((docSnap) => ({ ...docSnap.data(), docId: docSnap.id }));

    // Redis 클라이언트가 JSON을 알아서 (역)직렬화하므로 배열을 그대로 넘긴다.
    await cacheSet(cacheKey, docs, ttlSeconds);
    return { data: docs, hit: false };
}

/** Vercel Node 서버리스 함수 핸들러를 만든다. GET만 허용한다. */
function createListEndpoint({ collectionName, cacheKey, ttlSeconds }) {
    return async function handler(req, res) {
        if (req.method !== 'GET') {
            res.status(405).json({ error: 'GET만 지원합니다.' });
            return;
        }
        try {
            const { data, hit } = await handleCachedList({ collectionName, cacheKey, ttlSeconds });
            // 이 값들은 원래 firebase.rules에서 allow read: if true였던 컬렉션의
            // 전체 필드다 — 여기서 새로 노출되는 데이터는 없다.
            res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 3}`);
            res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
            res.status(200).json(data);
        } catch (err) {
            console.error(`[list:${collectionName}] 처리 실패:`, err?.message || err);
            res.status(503).json({ error: '목록을 불러오지 못했습니다.' });
        }
    };
}

module.exports = { createListEndpoint, handleCachedList };
