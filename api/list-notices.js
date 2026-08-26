const { createListEndpoint } = require('./_lib/cachedList');

// 30초 TTL: 새 공지가 화면에 반영되기까지 최대 30초 지연이 생길 수 있다는 뜻이다.
// 동아리 공지판 성격상 실시간성보다 DDoS 내성이 우선이라는 판단으로 고른 값이다.
module.exports = createListEndpoint({
    collectionName: 'notices',
    cacheKey: 'cache:list:notices',
    ttlSeconds: 30,
});
