/**
 * Deterministic key hashing for query cache lookups.
 * Handles strings, arrays, and objects.
 *
 * @param {string|Array|Object} queryKey
 * @returns {string}
 */
export function hashKey(queryKey) {
    if (typeof queryKey === 'string') {
        return queryKey;
    }
    return JSON.stringify(queryKey, (_, val) => {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            // Sort object keys for deterministic serialization
            return Object.keys(val)
                .sort()
                .reduce((sorted, key) => {
                    sorted[key] = val[key];
                    return sorted;
                }, {});
        }
        return val;
    });
}

/**
 * Check if cached data is stale.
 *
 * @param {number} fetchedAt - Timestamp (ms) when the data was fetched
 * @param {number} staleTime - Duration (ms) data is considered fresh
 * @returns {boolean} true if data is stale
 */
export function isStale(fetchedAt, staleTime) {
    if (staleTime === Infinity) return false;
    if (!fetchedAt) return true;
    return Date.now() - fetchedAt > staleTime;
}

/**
 * Query status constants.
 */
export const QueryStatus = {
    IDLE: 'idle',
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
};
