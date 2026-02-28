import { getQueryCache } from './QueryCache.js';
import { hashKey, isStale, QueryStatus } from './utils.js';

/**
 * QueryObserver — per-component-instance logic.
 *
 * Manages the lifecycle of a single query subscription:
 * - Subscribes/unsubscribes from the global QueryCache
 * - Handles staleTime / refetchInterval / refetchOnWindowFocus
 * - Reports state changes via an onChange callback
 */
export class QueryObserver {
    /**
     * @param {Object}   options
     * @param {*}        options.queryKey            - Unique key (string, array, or object)
     * @param {Function} options.fetchFn             - Async function returning data
     * @param {number}   [options.staleTime=0]       - ms data is considered fresh
     * @param {number}   [options.cacheTime=300000]  - ms to keep unused cache entries (5 min)
     * @param {number}   [options.refetchInterval=0] - ms between auto-refetches (0 = disabled)
     * @param {boolean}  [options.refetchOnWindowFocus=true]
     * @param {boolean}  [options.enabled=true]      - Whether the query should run
     * @param {Function} options.onChange             - Called with state object on every change
     * @param {Function} [options.onSuccess]          - Called with data on success
     * @param {Function} [options.onError]            - Called with error on failure
     * @param {Function} [options.onSettled]           - Called with {data, error} after fetch
     */
    constructor(options) {
        this._options = {
            staleTime: 0,
            cacheTime: 300000,
            refetchInterval: 0,
            refetchOnWindowFocus: true,
            enabled: true,
            ...options,
        };

        this._cache = getQueryCache();
        this._hashedKey = hashKey(this._options.queryKey);
        this._unsubscribe = null;
        this._refetchIntervalId = null;
        this._mounted = false;

        // Bind handlers
        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
        this._handleCacheUpdate = this._handleCacheUpdate.bind(this);
    }

    /**
     * Mount the observer: subscribe to cache, start timers, perform initial fetch if needed.
     */
    mount() {
        if (this._mounted) return;
        this._mounted = true;

        // Subscribe to cache updates
        this._unsubscribe = this._cache.subscribe(this._hashedKey, this._handleCacheUpdate);

        // Set up refetchOnWindowFocus
        if (this._options.refetchOnWindowFocus && typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._handleVisibilityChange);
        }

        // Set up refetchInterval
        if (this._options.refetchInterval > 0) {
            this._refetchIntervalId = setInterval(() => {
                if (this._options.enabled) {
                    this._executeFetch();
                }
            }, this._options.refetchInterval);
        }

        // Initial fetch
        if (this._options.enabled) {
            const entry = this._cache.get(this._hashedKey);
            if (entry.status === QueryStatus.IDLE || isStale(entry.fetchedAt, this._options.staleTime)) {
                this._executeFetch();
            } else {
                // Emit current cached state immediately
                this._emitState(entry);
            }
        } else {
            // Emit idle state
            this._emitState(this._cache.get(this._hashedKey));
        }
    }

    /**
     * Unmount the observer: unsubscribe, clear timers, schedule GC.
     */
    unmount() {
        if (!this._mounted) return;
        this._mounted = false;

        // Unsubscribe from cache
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }

        // Remove visibility listener
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        }

        // Clear refetch interval
        if (this._refetchIntervalId) {
            clearInterval(this._refetchIntervalId);
            this._refetchIntervalId = null;
        }

        // Schedule garbage collection
        this._cache.scheduleGC(this._hashedKey, this._options.cacheTime);
    }

    /**
     * Force a refetch, bypassing staleTime.
     * @returns {Promise<*>}
     */
    async refetch() {
        return this._executeFetch();
    }

    /**
     * Invalidate cached data, forcing next access to refetch.
     * Also triggers an immediate refetch if mounted and enabled.
     */
    invalidate() {
        this._cache.invalidate(this._hashedKey);
        if (this._mounted && this._options.enabled) {
            this._executeFetch();
        }
    }

    /**
     * Update options at runtime (e.g. when props change).
     * @param {Object} newOptions
     */
    updateOptions(newOptions) {
        const oldKey = this._hashedKey;
        const oldOptions = { ...this._options };

        Object.assign(this._options, newOptions);
        this._hashedKey = hashKey(this._options.queryKey);

        // If the query key changed, re-subscribe
        if (this._hashedKey !== oldKey && this._mounted) {
            // Unsubscribe from old
            if (this._unsubscribe) {
                this._unsubscribe();
            }
            this._cache.scheduleGC(oldKey, this._options.cacheTime);

            // Subscribe to new
            this._unsubscribe = this._cache.subscribe(this._hashedKey, this._handleCacheUpdate);

            // Fetch new key if enabled
            if (this._options.enabled) {
                const entry = this._cache.get(this._hashedKey);
                if (
                    entry.status === QueryStatus.IDLE ||
                    isStale(entry.fetchedAt, this._options.staleTime)
                ) {
                    this._executeFetch();
                } else {
                    this._emitState(entry);
                }
            }
        }

        // Handle refetchInterval change
        if (oldOptions.refetchInterval !== this._options.refetchInterval) {
            if (this._refetchIntervalId) {
                clearInterval(this._refetchIntervalId);
                this._refetchIntervalId = null;
            }
            if (this._options.refetchInterval > 0 && this._mounted) {
                this._refetchIntervalId = setInterval(() => {
                    if (this._options.enabled) {
                        this._executeFetch();
                    }
                }, this._options.refetchInterval);
            }
        }

        // Handle enabled change
        if (!oldOptions.enabled && this._options.enabled && this._mounted) {
            const entry = this._cache.get(this._hashedKey);
            if (
                entry.status === QueryStatus.IDLE ||
                isStale(entry.fetchedAt, this._options.staleTime)
            ) {
                this._executeFetch();
            }
        }

        // Handle refetchOnWindowFocus change
        if (oldOptions.refetchOnWindowFocus !== this._options.refetchOnWindowFocus) {
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', this._handleVisibilityChange);
                if (this._options.refetchOnWindowFocus && this._mounted) {
                    document.addEventListener('visibilitychange', this._handleVisibilityChange);
                }
            }
        }
    }

    /**
     * Get current state snapshot.
     * @returns {Object}
     */
    getState() {
        const entry = this._cache.get(this._hashedKey);
        return this._buildState(entry);
    }

    // --- Private ---

    async _executeFetch() {
        try {
            const data = await this._cache.fetch(this._hashedKey, this._options.fetchFn);
            if (this._options.onSuccess) {
                this._options.onSuccess(data);
            }
            if (this._options.onSettled) {
                this._options.onSettled({ data, error: null });
            }
            return data;
        } catch (err) {
            if (this._options.onError) {
                this._options.onError(err);
            }
            if (this._options.onSettled) {
                this._options.onSettled({ data: null, error: err });
            }
            throw err;
        }
    }

    _handleVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            if (this._options.enabled) {
                const entry = this._cache.get(this._hashedKey);
                if (isStale(entry.fetchedAt, this._options.staleTime)) {
                    this._executeFetch().catch(() => { }); // Errors handled in _executeFetch
                }
            }
        }
    }

    _handleCacheUpdate(entry) {
        this._emitState(entry);
    }

    _emitState(entry) {
        if (this._options.onChange) {
            this._options.onChange(this._buildState(entry));
        }
    }

    _buildState(entry) {
        return {
            data: entry.data,
            error: entry.error,
            status: entry.status,
            isLoading: entry.status === QueryStatus.LOADING,
            isFetching: entry.promise !== null,
            isStale: isStale(entry.fetchedAt, this._options.staleTime),
            isSuccess: entry.status === QueryStatus.SUCCESS,
            isError: entry.status === QueryStatus.ERROR,
            isIdle: entry.status === QueryStatus.IDLE,
            fetchedAt: entry.fetchedAt,
        };
    }
}
