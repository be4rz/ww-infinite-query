<template>
    <!-- Invisible wrapper — renders children via slot -->
    <div class="ww-infinite-query" style="display: contents">
        <slot />
    </div>
</template>

<script>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { getQueryCache } from './core/QueryCache.js';
import { hashKey, isStale as checkIsStale, QueryStatus } from './core/utils.js';

/**
 * Safely access a nested property by dot-notation path.
 * e.g. getByPath({ meta: { nextPage: 3 } }, 'meta.nextPage') => 3
 */
function getByPath(obj, path) {
    if (!path || !obj) return undefined;
    return path.split('.').reduce((current, key) => {
        if (current === null || current === undefined) return undefined;
        return current[key];
    }, obj);
}

export default {
    props: {
        content: { type: Object, required: true },
        uid: { type: String, required: true },
        /* wwEditor:start */
        wwEditorState: { type: Object, required: true },
        /* wwEditor:end */
    },
    emits: ['trigger-event', 'update:content:effect'],
    setup(props, { emit, expose }) {
        // --- Reactive state ---
        const pages = ref([]);
        const pageParams = ref([]);
        const error = ref(null);
        const isLoading = ref(false);
        const isFetching = ref(false);
        const isFetchingNextPage = ref(false);
        const isFetchingPreviousPage = ref(false);
        const isStale = ref(true);
        const isSuccess = ref(false);
        const isError = ref(false);
        const hasNextPage = ref(true);
        const hasPreviousPage = ref(false);
        const status = ref('idle');
        const fetchedAt = ref(0);

        const cache = getQueryCache();
        let visibilityHandler = null;
        let refetchIntervalId = null;

        // --- Key helpers ---
        function getBaseKey() {
            return hashKey(props.content.queryKey);
        }

        function getCompositePageKey(pageParam) {
            const params = props.content.params || {};
            const hasParams = Object.keys(params).length > 0;
            if (hasParams) {
                return hashKey([props.content.queryKey, params, 'page', pageParam]);
            }
            return hashKey([props.content.queryKey, 'page', pageParam]);
        }

        // --- Computed: flattened data from all pages ---
        const data = computed(() => {
            if (pages.value.length === 0) return [];
            if (Array.isArray(pages.value[0])) {
                return pages.value.flat();
            }
            const firstPage = pages.value[0];
            if (firstPage && typeof firstPage === 'object' && Array.isArray(firstPage.data)) {
                return pages.value.flatMap(p => p.data || []);
            }
            return pages.value;
        });

        // --- Emit state to WeWeb ---
        function emitState() {
            const statePayload = {
                data: data.value,
                pages: pages.value,
                pageParams: pageParams.value,
                error: error.value
                    ? { message: error.value.message || String(error.value) }
                    : null,
                isLoading: isLoading.value,
                isFetching: isFetching.value,
                isFetchingNextPage: isFetchingNextPage.value,
                isFetchingPreviousPage: isFetchingPreviousPage.value,
                isStale: isStale.value,
                isSuccess: isSuccess.value,
                isError: isError.value,
                hasNextPage: hasNextPage.value,
                hasPreviousPage: hasPreviousPage.value,
                status: status.value,
                fetchedAt: fetchedAt.value,
                currentPage: pageParams.value.length > 0
                    ? pageParams.value[pageParams.value.length - 1]
                    : props.content.initialPageParam ?? 1,
                totalPages: pages.value.length,
            };

            emit('update:content:effect', statePayload);
        }

        // --- Build fetch function for a specific page param ---
        function buildPageFetchFn(pageParam) {
            return async () => {
                const endpoint = props.content.endpoint;
                if (!endpoint) {
                    throw new Error('[ww-infinite-query] No endpoint URL configured');
                }

                const method = props.content.method || 'GET';
                const pageParamKey = props.content.pageParamKey || 'page';
                const params = props.content.params || {};
                const headers = { ...(props.content.headers || {}) };
                const fetchOptions = { method, headers };

                if (method === 'GET') {
                    // Append params + page param as query parameters
                    const url = new URL(endpoint, window.location.origin);
                    // Add user params first
                    for (const [key, value] of Object.entries(params)) {
                        if (value !== undefined && value !== null && value !== '') {
                            url.searchParams.set(key, String(value));
                        }
                    }
                    // Add page param
                    url.searchParams.set(pageParamKey, String(pageParam));
                    fetchOptions.url = url.toString();
                } else {
                    // For POST: merge params + page param into body
                    const contentType = props.content.contentType || 'application/json';
                    headers['Content-Type'] = contentType;
                    const bodyData = {
                        ...(props.content.body || {}),
                        ...params,
                        [pageParamKey]: pageParam,
                    };
                    fetchOptions.body = JSON.stringify(bodyData);
                    fetchOptions.url = endpoint;
                }

                const response = await fetch(fetchOptions.url || endpoint, {
                    method: fetchOptions.method,
                    headers: fetchOptions.headers,
                    body: fetchOptions.body,
                });

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => '');
                    throw new Error(
                        `[ww-infinite-query] HTTP ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ''}`
                    );
                }

                const contentTypeHeader = response.headers.get('content-type') || '';
                if (contentTypeHeader.includes('application/json')) {
                    return response.json();
                }
                return response.text();
            };
        }

        // --- Determine next/previous page params from a response ---
        function getNextPageParam(lastPage, allPages) {
            const path = props.content.nextPagePath;
            if (path) {
                const nextParam = getByPath(lastPage, path);
                return nextParam !== undefined && nextParam !== null ? nextParam : undefined;
            }
            const currentParam = pageParams.value[pageParams.value.length - 1]
                ?? (props.content.initialPageParam ?? 1);
            return currentParam + 1;
        }

        function getPreviousPageParam(firstPage, allPages) {
            const path = props.content.previousPagePath;
            if (path) {
                const prevParam = getByPath(firstPage, path);
                return prevParam !== undefined && prevParam !== null ? prevParam : undefined;
            }
            const initial = props.content.initialPageParam ?? 1;
            const currentParam = pageParams.value[0] ?? initial;
            return currentParam > initial ? currentParam - 1 : undefined;
        }

        // --- Core fetch page logic ---
        async function fetchPage(pageParam, direction = 'next') {
            const compositeKey = getCompositePageKey(pageParam);
            const baseKey = getBaseKey();

            try {
                const pageData = await cache.fetch(compositeKey, buildPageFetchFn(pageParam), baseKey);

                if (direction === 'next') {
                    pages.value = [...pages.value, pageData];
                    pageParams.value = [...pageParams.value, pageParam];

                    const maxPages = props.content.maxPages || 0;
                    if (maxPages > 0 && pages.value.length > maxPages) {
                        pages.value = pages.value.slice(-maxPages);
                        pageParams.value = pageParams.value.slice(-maxPages);
                    }
                } else {
                    pages.value = [pageData, ...pages.value];
                    pageParams.value = [pageParam, ...pageParams.value];

                    const maxPages = props.content.maxPages || 0;
                    if (maxPages > 0 && pages.value.length > maxPages) {
                        pages.value = pages.value.slice(0, maxPages);
                        pageParams.value = pageParams.value.slice(0, maxPages);
                    }
                }

                // Update has next/previous
                const nextParam = getNextPageParam(pageData, pages.value);
                hasNextPage.value = nextParam !== undefined;

                const prevParam = getPreviousPageParam(pages.value[0], pages.value);
                hasPreviousPage.value = prevParam !== undefined;

                error.value = null;
                isSuccess.value = true;
                isError.value = false;
                status.value = QueryStatus.SUCCESS;
                fetchedAt.value = Date.now();

                return pageData;
            } catch (err) {
                error.value = err;
                if (pages.value.length === 0) {
                    isError.value = true;
                    status.value = QueryStatus.ERROR;
                }
                throw err;
            }
        }

        // --- Initial fetch (first page) ---
        async function initialFetch() {
            if (!(props.content.enabled ?? true)) return;
            if (!props.content.queryKey || !props.content.endpoint) return;

            const initialParam = props.content.initialPageParam ?? 1;
            const compositeKey = getCompositePageKey(initialParam);
            const baseKey = getBaseKey();
            const entry = cache.get(compositeKey, baseKey);
            const staleTime = props.content.staleTime ?? 0;

            if (
                entry.status === QueryStatus.SUCCESS &&
                !checkIsStale(entry.fetchedAt, staleTime) &&
                pages.value.length > 0
            ) {
                emitState();
                return;
            }

            isLoading.value = pages.value.length === 0;
            isFetching.value = true;
            status.value = pages.value.length === 0 ? QueryStatus.LOADING : status.value;
            emitState();

            try {
                pages.value = [];
                pageParams.value = [];

                const pageData = await fetchPage(initialParam, 'next');

                emit('trigger-event', {
                    name: 'onSuccess',
                    event: { data: data.value, pages: pages.value },
                });
                emit('trigger-event', {
                    name: 'onSettled',
                    event: { data: data.value, error: null },
                });
            } catch (err) {
                emit('trigger-event', {
                    name: 'onError',
                    event: { error: { message: err.message || String(err) } },
                });
                emit('trigger-event', {
                    name: 'onSettled',
                    event: { data: null, error: { message: err.message || String(err) } },
                });
            } finally {
                isLoading.value = false;
                isFetching.value = false;
                emitState();
            }
        }

        // --- Component actions ---
        async function fetchNextPage() {
            if (!hasNextPage.value || isFetchingNextPage.value) return;

            const lastPage = pages.value[pages.value.length - 1];
            const nextParam = getNextPageParam(lastPage, pages.value);
            if (nextParam === undefined) {
                hasNextPage.value = false;
                emitState();
                return;
            }

            isFetchingNextPage.value = true;
            isFetching.value = true;
            emitState();

            try {
                const pageData = await fetchPage(nextParam, 'next');
                emit('trigger-event', {
                    name: 'onFetchNextPage',
                    event: { pageParam: nextParam, data: pageData },
                });
                emit('trigger-event', {
                    name: 'onSuccess',
                    event: { data: data.value, pages: pages.value },
                });
            } catch (err) {
                emit('trigger-event', {
                    name: 'onError',
                    event: { error: { message: err.message || String(err) } },
                });
            } finally {
                isFetchingNextPage.value = false;
                isFetching.value = false;
                emitState();
            }
        }

        async function fetchPreviousPage() {
            if (!hasPreviousPage.value || isFetchingPreviousPage.value) return;

            const firstPage = pages.value[0];
            const prevParam = getPreviousPageParam(firstPage, pages.value);
            if (prevParam === undefined) {
                hasPreviousPage.value = false;
                emitState();
                return;
            }

            isFetchingPreviousPage.value = true;
            isFetching.value = true;
            emitState();

            try {
                const pageData = await fetchPage(prevParam, 'previous');
                emit('trigger-event', {
                    name: 'onFetchPreviousPage',
                    event: { pageParam: prevParam, data: pageData },
                });
                emit('trigger-event', {
                    name: 'onSuccess',
                    event: { data: data.value, pages: pages.value },
                });
            } catch (err) {
                emit('trigger-event', {
                    name: 'onError',
                    event: { error: { message: err.message || String(err) } },
                });
            } finally {
                isFetchingPreviousPage.value = false;
                isFetching.value = false;
                emitState();
            }
        }

        async function refetchAll() {
            if (isFetching.value) return;

            const currentPageParams = [...pageParams.value];
            pages.value = [];
            pageParams.value = [];

            isFetching.value = true;
            isLoading.value = true;
            emitState();

            try {
                for (const param of currentPageParams) {
                    const compositeKey = getCompositePageKey(param);
                    cache.invalidate(compositeKey);
                    await fetchPage(param, 'next');
                }

                emit('trigger-event', {
                    name: 'onSuccess',
                    event: { data: data.value, pages: pages.value },
                });
            } catch (err) {
                emit('trigger-event', {
                    name: 'onError',
                    event: { error: { message: err.message || String(err) } },
                });
            } finally {
                isLoading.value = false;
                isFetching.value = false;
                emitState();
            }
        }

        function resetPages() {
            // Invalidate all page cache entries for this family
            for (const param of pageParams.value) {
                const compositeKey = getCompositePageKey(param);
                cache.invalidate(compositeKey);
            }
            pages.value = [];
            pageParams.value = [];
            hasNextPage.value = true;
            hasPreviousPage.value = false;
            isSuccess.value = false;
            status.value = QueryStatus.IDLE;
            emitState();

            initialFetch();
        }

        function invalidate() {
            // Invalidate the ENTIRE query key family (all params × all pages)
            cache.invalidateByKey(getBaseKey());
            refetchAll();
        }

        // Expose actions for WeWeb's "Execute component action"
        expose({ fetchNextPage, fetchPreviousPage, refetchAll, resetPages, invalidate });

        // --- Lifecycle ---
        onMounted(() => {
            initialFetch();

            if (props.content.refetchOnWindowFocus && typeof document !== 'undefined') {
                visibilityHandler = () => {
                    if (document.visibilityState === 'visible' && (props.content.enabled ?? true)) {
                        const staleTime = props.content.staleTime ?? 0;
                        if (checkIsStale(fetchedAt.value, staleTime)) {
                            refetchAll();
                        }
                    }
                };
                document.addEventListener('visibilitychange', visibilityHandler);
            }

            const interval = props.content.refetchInterval ?? 0;
            if (interval > 0) {
                refetchIntervalId = setInterval(() => {
                    if (props.content.enabled ?? true) {
                        refetchAll();
                    }
                }, interval);
            }
        });

        onBeforeUnmount(() => {
            if (visibilityHandler && typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', visibilityHandler);
            }

            if (refetchIntervalId) {
                clearInterval(refetchIntervalId);
            }

            // Schedule GC for all page cache entries
            const cacheTime = props.content.cacheTime ?? 300000;
            const baseKey = getBaseKey();
            for (const param of pageParams.value) {
                const compositeKey = getCompositePageKey(param);
                cache.scheduleGC(compositeKey, cacheTime, baseKey);
            }
        });

        // --- Watchers ---
        watch(
            () => [props.content.queryKey, props.content.endpoint, props.content.params],
            () => {
                resetPages();
            }
        );

        watch(
            () => props.content.enabled,
            (newEnabled) => {
                if (newEnabled && pages.value.length === 0) {
                    initialFetch();
                }
            }
        );

        return {
            data,
            pages,
            pageParams,
            error,
            isLoading,
            isFetching,
            isFetchingNextPage,
            isFetchingPreviousPage,
            isStale,
            isSuccess,
            isError,
            hasNextPage,
            hasPreviousPage,
            status,
            fetchedAt,
            fetchNextPage,
            fetchPreviousPage,
            refetchAll,
            resetPages,
            invalidate,
        };
    },
};
</script>
