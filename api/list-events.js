const { createListEndpoint } = require('./_lib/cachedList');

module.exports = createListEndpoint({
    collectionName: 'events',
    cacheKey: 'cache:list:events',
    ttlSeconds: 30,
});
