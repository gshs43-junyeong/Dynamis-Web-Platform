const { createListEndpoint } = require('./_lib/cachedList');

module.exports = createListEndpoint({
    collectionName: 'faqs',
    cacheKey: 'cache:list:faqs',
    ttlSeconds: 30,
});
