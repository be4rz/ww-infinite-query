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
 *
 * Cache keys are structured in two levels:
 *   - baseKey:      hashKey(queryKey) — the "family" identifier (e.g. "posts")
 *   - compositeKey: hashKey([queryKey, params]) — the specific variation
 *
 * The _keyRegistry maps each baseKey to the set of compositeKeys it contains,
 * enabling family-level invalidation (e.g. invalidate ALL "posts" regardless of params).
 */
class QueryCache {
    constructor() {
        /** @type {Map<string, QueryEntry>} */
        this._cache = new Map();

        /**
         * Maps a base query key (family) to all composite keys that belong to it.
         * @type {Map<string, Set<string>>}
         */
        this._keyRegistry = new Map();
    }

    /**
     * Register a composite key under its base key family.
     * @param {string} compositeKey
     * @param {string} baseKey
     */
    _registerKey(compositeKey, baseKey) {
        if (!this._keyRegistry.has(baseKey)) {
            this._keyRegistry.set(baseKey, new Set());
        }
        this._keyRegistry.get(baseKey).add(compositeKey);
    }

    /**
     * Unregister a composite key from its family (called on removal).
     * @param {string} compositeKey
     * @param {string} baseKey
     */
    _unregisterKey(compositeKey, baseKey) {
        const family = this._keyRegistry.get(baseKey);
        if (family) {
            family.delete(compositeKey);
            if (family.size === 0) {
                this._keyRegistry.delete(baseKey);
            }
        }
    }

    /**
     * Get or create a cache entry for the given composite key.
     * @param {string} compositeKey - Hashed composite key (queryKey + params)
     * @param {string} [baseKey]    - Hashed base key (queryKey only), for registry
     * @returns {QueryEntry}
     */
    get(compositeKey, baseKey) {
        if (!this._cache.has(compositeKey)) {
            this._cache.set(compositeKey, {
                data: undefined,
                error: null,
                status: QueryStatus.IDLE,
                fetchedAt: 0,
                promise: null,
                subscribers: new Set(),
                gcTimeout: null,
            });
        }
        // Register under family if baseKey is provided
        if (baseKey) {
            this._registerKey(compositeKey, baseKey);
        }
        return this._cache.get(compositeKey);
    }

    /**
     * Check if the cache has an entry for the key.
     * @param {string} compositeKey
     * @returns {boolean}
     */
    has(compositeKey) {
        return this._cache.has(compositeKey);
    }

    /**
     * Fetch data for a composite key, with request deduplication.
     * If an identical request is already in-flight, returns the existing promise.
     *
     * @param {string}   compositeKey - Hashed composite key
     * @param {Function} fetchFn     - Async function that returns data
     * @param {string}   [baseKey]   - Hashed base key for registry
     * @returns {Promise<*>}
     */
    async fetch(compositeKey, fetchFn, baseKey) {
        const entry = this.get(compositeKey, baseKey);

        // Request deduplication: return existing in-flight promise
        if (entry.promise) {
            return entry.promise;
        }

        // Mark as fetching
        const wasIdle = entry.status === QueryStatus.IDLE;
        if (wasIdle) {
            entry.status = QueryStatus.LOADING;
        }
        this._notify(compositeKey);

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
                this._notify(compositeKey);
            }
        })();

        return entry.promise;
    }

    /**
     * Invalidate a single composite cache entry.
     * Does NOT remove the data — subscribers can still display stale data.
     *
     * @param {string} compositeKey - Hashed composite key
     */
    invalidate(compositeKey) {
        if (this._cache.has(compositeKey)) {
            const entry = this._cache.get(compositeKey);
            entry.fetchedAt = 0; // Mark as stale
            this._notify(compositeKey);
        }
    }

    /**
     * Invalidate ALL cache entries that belong to a base key family.
     * e.g. invalidateByKey("posts") clears all param variations of "posts".
     *
     * @param {string} baseKey - Hashed base key (the family identifier)
     */
    invalidateByKey(baseKey) {
        const family = this._keyRegistry.get(baseKey);
        if (family) {
            for (const compositeKey of family) {
                this.invalidate(compositeKey);
            }
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
     * Remove a single composite cache entry entirely.
     * @param {string} compositeKey
     * @param {string} [baseKey] - If provided, also unregisters from family
     */
    remove(compositeKey, baseKey) {
        const entry = this._cache.get(compositeKey);
        if (entry) {
            if (entry.gcTimeout) clearTimeout(entry.gcTimeout);
            this._cache.delete(compositeKey);
        }
        if (baseKey) {
            this._unregisterKey(compositeKey, baseKey);
        }
    }

    /**
     * Remove ALL cache entries for a base key family.
     * @param {string} baseKey
     */
    removeByKey(baseKey) {
        const family = this._keyRegistry.get(baseKey);
        if (family) {
            for (const compositeKey of [...family]) {
                this.remove(compositeKey, baseKey);
            }
        }
    }

    /**
     * Subscribe to state changes for a composite cache key.
     * Cancels any pending GC timeout for this entry.
     *
     * @param {string}   compositeKey - Hashed composite key
     * @param {Function} cb           - Callback invoked with the entry on change
     * @param {string}   [baseKey]    - For registry tracking
     * @returns {Function} unsubscribe function
     */
    subscribe(compositeKey, cb, baseKey) {
        const entry = this.get(compositeKey, baseKey);

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
     * Schedule garbage collection for a composite cache key.
     * Called when the last subscriber unsubscribes.
     *
     * @param {string} compositeKey
     * @param {number} cacheTime - ms to wait before evicting
     * @param {string} [baseKey] - For unregistering from family on eviction
     */
    scheduleGC(compositeKey, cacheTime, baseKey) {
        const entry = this._cache.get(compositeKey);
        if (!entry) return;

        if (entry.subscribers.size > 0) return; // Still has subscribers

        if (entry.gcTimeout) clearTimeout(entry.gcTimeout);

        if (cacheTime === Infinity) return; // Never GC

        entry.gcTimeout = setTimeout(() => {
            // Only remove if still no subscribers
            if (entry.subscribers.size === 0) {
                this._cache.delete(compositeKey);
                if (baseKey) {
                    this._unregisterKey(compositeKey, baseKey);
                }
            }
        }, cacheTime);
    }

    /**
     * Notify all subscribers of a composite cache key that state has changed.
     * @param {string} compositeKey
     * @private
     */
    _notify(compositeKey) {
        const entry = this._cache.get(compositeKey);
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

    /**
     * Get registered families (for debugging).
     * @returns {Map<string, Set<string>>}
     */
    get registry() {
        return this._keyRegistry;
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
