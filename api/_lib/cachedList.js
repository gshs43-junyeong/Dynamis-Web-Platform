// 공개 목록 컬렉션을 캐싱해서 반환하는 공용 핸들러.
//
// [비용 모델] 캐시 미스 한 번이 Firestore 읽기 N건(문서 개수)을 발생시키고,
// 그 뒤 TTL 동안의 모든 요청은 캐시에서 응답한다. 즉 TTL 창 안에서는 방문자가
// 1명이든 10만 명이든 Firestore 비용이 동일하다 — 방문자당 비용을 줄이는 게
// 아니라 "총 origin 요청 수"에 상한을 만드는 것이라, 볼류메트릭 공격(계정/토큰
// 하나로 짧은 시간에 수천~수만 번 반복 요청)에 대해 실질적인 상한이 생긴다.
//
// [3단 계층] L1 메모리 → L2 Redis → L3 Firestore
//
//   L1은 이 서버리스 인스턴스의 메모리다. Redis보다 앞에 두는 이유는 두 가지다.
//   (a) 정상 상황에서도 Redis 호출 자체를 줄인다 — 우리가 지키려는 자원이
//       Firestore만이 아니라 Upstash 요청 한도이기도 하기 때문이다.
//   (b) Redis가 죽거나 한도가 소진됐을 때 기댈 언덕이 된다(아래 참고).
//
// [왜 fail-open을 버렸나 — 이번 수정의 핵심]
//   예전에는 Redis 조회가 실패하면 그냥 "캐시 미스"로 취급해 Firestore로
//   흘려보냈다. 가용성만 보면 안전해 보이지만, 공격 관점에서는 정반대다:
//   공격자가 Upstash 한도를 먼저 태우면 그 순간부터 캐시가 통째로 무력화되고
//   모든 요청이 Firestore로 직행한다 — 방어가 가장 필요한 순간에 방어가 꺼지는
//   구조였다.
//
//   이제 Redis 실패는 "미스"가 아니라 별도의 상태로 다룬다(cache.js 참고).
//   실패했을 때는 Firestore로 가는 대신 L1에 남아 있는 직전 데이터를 그대로
//   내보낸다(최대 STALE_MAX_MS까지). 목록이 몇 분 낡는 것과 데이터베이스가
//   하루치 할당량을 소진해 사이트 전체가 멈추는 것 중에서는 전자가 낫다.
//   L1에 아무것도 없을 때만(=인스턴스가 막 뜬 콜드 스타트) Firestore를 한 번
//   조회해 부트스트랩한다. 이 경우도 인스턴스 수만큼으로 자연히 상한이 잡힌다.
//
// [컬렉션을 파라미터로 받지 않는 이유] Admin SDK는 보안 규칙을 완전히 우회한다.
// 만약 이 함수가 요청의 쿼리 파라미터로 컬렉션 이름을 받는다면, 검증 로직에
// 버그 하나만 있어도 users/sanctions 같은 비공개 컬렉션을 인증 없이 통째로
// 덤프하는 엔드포인트가 될 수 있다. 그래서 호출하는 쪽(list-notices.js 등)이
// 컬렉션 이름을 코드에 리터럴로 박아 두고, 이 함수는 그 값을 그대로 전달받기만
// 한다 — 공격 표면에서 "파라미터로 컬렉션을 고른다"는 경우의 수 자체를 없앤다.

const { getAdminDb } = require('./admin');
const { cacheGet, cacheSet } = require('./cache');

// Redis가 실패하는 동안 L1의 낡은 데이터를 얼마나 오래 내보낼지.
// 이 값이 길수록 Firestore는 더 안전해지고 목록은 더 낡는다. 10분이면
// Upstash 장애가 지나가기를 기다리기에 충분하고, 공지판이 10분 낡는 것은
// 사이트가 멈추는 것에 비하면 감수할 만하다.
const STALE_MAX_MS = 10 * 60 * 1000;

// cacheKey -> { data, freshUntil, storedAt }
// 컬렉션이 4개뿐이라 항목이 무한정 늘어나지 않는다(별도 만료/축출 로직 불필요).
const memoryCache = new Map();

// cacheKey -> Promise. 같은 인스턴스에서 동시에 들어온 요청이 Firestore를
// 중복 조회하지 않도록 한 번만 실제로 다녀오게 묶는다(single-flight).
// 캐시가 만료되는 순간 요청이 몰리면 그 수만큼 Firestore를 때리는
// thundering herd가 생기는데, 이게 정확히 공격자가 노릴 만한 타이밍이다.
const inFlight = new Map();

async function fetchFromFirestore(collectionName) {
    const db = getAdminDb();
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map((docSnap) => ({ ...docSnap.data(), docId: docSnap.id }));
}

function fetchOnce(collectionName, cacheKey) {
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;

    const promise = fetchFromFirestore(collectionName)
        .finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, promise);
    return promise;
}

/**
 * @param {object} opts
 * @param {string} opts.collectionName Firestore 컬렉션 이름 (호출부에 하드코딩된 값만)
 * @param {string} opts.cacheKey 캐시 키
 * @param {number} opts.ttlSeconds 캐시 수명(초)
 * @returns {Promise<{data: any[], source: 'MEMORY'|'HIT'|'STALE'|'MISS'}>}
 */
async function handleCachedList({ collectionName, cacheKey, ttlSeconds }) {
    const now = Date.now();
    const mem = memoryCache.get(cacheKey);

    // L1 — 아직 신선하면 Redis도 Firestore도 건드리지 않는다.
    if (mem && now < mem.freshUntil) {
        return { data: mem.data, source: 'MEMORY' };
    }

    // L2 — Redis.
    const cached = await cacheGet(cacheKey);
    if (cached.status === 'hit') {
        memoryCache.set(cacheKey, {
            data: cached.value,
            freshUntil: now + ttlSeconds * 1000,
            storedAt: now,
        });
        return { data: cached.value, source: 'HIT' };
    }

    // Redis가 실패한 경우 — Firestore로 흘려보내지 않고 낡은 데이터로 버틴다.
    if (cached.status === 'error' && mem && now - mem.storedAt < STALE_MAX_MS) {
        return { data: mem.data, source: 'STALE' };
    }

    // L3 — Firestore. 여기 도달하는 경우는 셋 중 하나다.
    //   (1) 정상적인 캐시 만료(miss)
    //   (2) Redis 미설정 구성(disabled)
    //   (3) Redis 실패인데 내보낼 낡은 데이터조차 없음(콜드 스타트)
    const docs = await fetchOnce(collectionName, cacheKey);
    memoryCache.set(cacheKey, {
        data: docs,
        freshUntil: now + ttlSeconds * 1000,
        storedAt: now,
    });
    // Redis가 방금 실패했다면 쓰기도 실패할 가능성이 높다 — 이미 힘들어하는
    // 쪽에 요청을 하나 더 얹지 않는다. 다음 요청에서 get이 성공하면 그때 채운다.
    if (cached.status !== 'error') {
        await cacheSet(cacheKey, docs, ttlSeconds);
    }
    return { data: docs, source: 'MISS' };
}

/** Vercel Node 서버리스 함수 핸들러를 만든다. GET만 허용한다. */
function createListEndpoint({ collectionName, cacheKey, ttlSeconds }) {
    return async function handler(req, res) {
        if (req.method !== 'GET') {
            res.status(405).json({ error: 'GET만 지원합니다.' });
            return;
        }
        try {
            const { data, source } = await handleCachedList({ collectionName, cacheKey, ttlSeconds });
            // 이 값들은 원래 firebase.rules에서 allow read: if true였던 컬렉션의
            // 전체 필드다 — 여기서 새로 노출되는 데이터는 없다.
            res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 3}`);
            res.setHeader('X-Cache', source);
            res.status(200).json(data);
        } catch (err) {
            console.error(`[list:${collectionName}] 처리 실패:`, err?.message || err);
            res.status(503).json({ error: '목록을 불러오지 못했습니다.' });
        }
    };
}

module.exports = { createListEndpoint, handleCachedList };
