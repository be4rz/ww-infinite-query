import { hashKey, isStale, QueryStatus } from './utils.js';

/**
 * @typedef {Object} QueryEntry
 * @property {*}        data        - Cached response data
 * @property {*}        error       - Last error, or null
 * @property {string}   status      - One of QueryStatus values
 * @property {number}   fetchedAt   - Timestamp of last successful fetch
 * @property {Promise}  promise     - In-flight fetch promise (for dedup), or null
 * @property {Set}      subscribers - Set of callback functions
 * @property {number}   gcTimeout   - setTimeout id for garbage collection
 */

/**
 * Global query cache singleton.
 * All ww-query and ww-infinite-query instances share this cache
 * via window.__wwQueryCache.
 */
class QueryCache {
    constructor() {
        /** @type {Map<string, QueryEntry>} */
        this._cache = new Map();
    }

    /**
     * Get or create a cache entry for the given key.
     * @param {string} key - Hashed query key
     * @returns {QueryEntry}
     */
    get(key) {
        if (!this._cache.has(key)) {
            this._cache.set(key, {
                data: undefined,
                error: null,
                status: QueryStatus.IDLE,
                fetchedAt: 0,
                promise: null,
                subscribers: new Set(),
                gcTimeout: null,
            });
        }
        return this._cache.get(key);
    }

    /**
     * Check if the cache has an entry for the key.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this._cache.has(key);
    }

    /**
     * Fetch data for a query key, with request deduplication.
     * If an identical request is already in-flight, returns the existing promise.
     *
     * @param {string}   key      - Hashed query key
     * @param {Function} fetchFn  - Async function that returns data
     * @returns {Promise<*>}
     */
    async fetch(key, fetchFn) {
        const entry = this.get(key);

        // Request deduplication: return existing in-flight promise
        if (entry.promise) {
            return entry.promise;
        }

        // Mark as fetching
        const wasIdle = entry.status === QueryStatus.IDLE;
        if (wasIdle) {
            entry.status = QueryStatus.LOADING;
        }
        this._notify(key);

        // Create and track the promise
        entry.promise = (async () => {
            try {
                const data = await fetchFn();
                entry.data = data;
                entry.error = null;
                entry.status = QueryStatus.SUCCESS;
                entry.fetchedAt = Date.now();
                return data;
            } catch (err) {
                entry.error = err;
                // Only set ERROR status if we don't already have data
                if (entry.data === undefined) {
                    entry.status = QueryStatus.ERROR;
                }
                throw err;
            } finally {
                entry.promise = null;
                this._notify(key);
            }
        })();

        return entry.promise;
    }

    /**
     * Invalidate a cache entry, forcing the next access to refetch.
     * Does NOT remove the data immediately — subscribers can still display stale data.
     *
     * @param {string} key - Hashed query key
     */
    invalidate(key) {
        if (this._cache.has(key)) {
            const entry = this._cache.get(key);
            entry.fetchedAt = 0; // Mark as stale
            this._notify(key);
        }
    }

    /**
     * Invalidate all cache entries.
     */
    invalidateAll() {
        for (const key of this._cache.keys()) {
            this.invalidate(key);
        }
    }

    /**
     * Remove a cache entry entirely.
     * @param {string} key
     */
    remove(key) {
        const entry = this._cache.get(key);
        if (entry) {
            if (entry.gcTimeout) clearTimeout(entry.gcTimeout);
            this._cache.delete(key);
        }
    }

    /**
     * Subscribe to state changes for a cache key.
     * Cancels any pending GC timeout for this entry.
     *
     * @param {string}   key - Hashed query key
     * @param {Function} cb  - Callback invoked with the entry on change
     * @returns {Function} unsubscribe function
     */
    subscribe(key, cb) {
        const entry = this.get(key);

        // Cancel GC if a new subscriber appears
        if (entry.gcTimeout) {
            clearTimeout(entry.gcTimeout);
            entry.gcTimeout = null;
        }

        entry.subscribers.add(cb);

        return () => {
            entry.subscribers.delete(cb);
        };
    }

    /**
     * Schedule garbage collection for a cache key.
     * Called when the last subscriber unsubscribes.
     *
     * @param {string} key
     * @param {number} cacheTime - ms to wait before evicting
     */
    scheduleGC(key, cacheTime) {
        const entry = this._cache.get(key);
        if (!entry) return;

        if (entry.subscribers.size > 0) return; // Still has subscribers

        if (entry.gcTimeout) clearTimeout(entry.gcTimeout);

        if (cacheTime === Infinity) return; // Never GC

        entry.gcTimeout = setTimeout(() => {
            // Only remove if still no subscribers
            if (entry.subscribers.size === 0) {
                this._cache.delete(key);
            }
        }, cacheTime);
    }

    /**
     * Notify all subscribers of a cache key that state has changed.
     * @param {string} key
     * @private
     */
    _notify(key) {
        const entry = this._cache.get(key);
        if (!entry) return;
        for (const cb of entry.subscribers) {
            try {
                cb(entry);
            } catch (e) {
                console.error('[ww-query-cache] Subscriber error:', e);
            }
        }
    }

    /**
     * Get the number of cached entries (for debugging).
     * @returns {number}
     */
    get size() {
        return this._cache.size;
    }
}

/**
 * Get or create the global QueryCache singleton.
 * Attached to window so all WeWeb component instances share it.
 *
 * @returns {QueryCache}
 */
export function getQueryCache() {
    if (typeof window !== 'undefined') {
        if (!window.__wwQueryCache) {
            window.__wwQueryCache = new QueryCache();
        }
        return window.__wwQueryCache;
    }
    // Fallback for non-browser environments (shouldn't happen in WeWeb)
    return new QueryCache();
}

export { QueryCache };
