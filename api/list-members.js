const { createListEndpoint } = require('./_lib/cachedList');

// memberProfiles는 이름/기수/등급/소개만 담는 투영 컬렉션이라(원본은 users) 노출
// 범위가 원래도 공개였다. 자주 안 바뀌는 데이터라 TTL을 조금 더 길게 잡았다.
module.exports = createListEndpoint({
    collectionName: 'memberProfiles',
    cacheKey: 'cache:list:memberProfiles',
    ttlSeconds: 60,
});
