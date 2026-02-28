export default {
    editor: {
        label: {
            en: 'Infinite Query',
            fr: 'Requête Infinie',
        },
        icon: 'data',
        bubble: {
            icon: 'data',
        },
        customSettingsPropertiesOrder: [
            'queryKey',
            'endpoint',
            'params',
            ['method', 'contentType'],
            'headers',
            'body',
            ['pageParamKey', 'initialPageParam'],
            ['nextPagePath', 'previousPagePath'],
            'maxPages',
            ['staleTime', 'cacheTime'],
            ['refetchInterval', 'refetchOnWindowFocus'],
            'enabled',
        ],
    },
    triggerEvents: [
        {
            name: 'onSuccess',
            label: { en: 'On success' },
            event: { data: null, pages: [] },
        },
        {
            name: 'onError',
            label: { en: 'On error' },
            event: { error: null },
        },
        {
            name: 'onSettled',
            label: { en: 'On settled' },
            event: { data: null, error: null },
        },
        {
            name: 'onFetchNextPage',
            label: { en: 'On fetch next page' },
            event: { pageParam: null, data: null },
        },
        {
            name: 'onFetchPreviousPage',
            label: { en: 'On fetch previous page' },
            event: { pageParam: null, data: null },
        },
    ],
    actions: [
        {
            label: 'Fetch next page',
            action: 'fetchNextPage',
        },
        {
            label: 'Fetch previous page',
            action: 'fetchPreviousPage',
        },
        {
            label: 'Refetch all pages',
            action: 'refetchAll',
        },
        {
            label: 'Reset pages',
            action: 'resetPages',
        },
        {
            label: 'Invalidate',
            action: 'invalidate',
        },
    ],
    properties: {
        queryKey: {
            label: { en: 'Query key' },
            type: 'Text',
            section: 'settings',
            bindable: true,
            defaultValue: '',
            /* wwEditor:start */
            bindingValidation: {
                type: 'string',
                tooltip:
                    'The cache family name for this infinite query (e.g. "posts"). All param variations share this key. Invalidating this key clears all cached variations and pages.',
            },
            /* wwEditor:end */
        },
        endpoint: {
            label: { en: 'Endpoint URL' },
            type: 'Text',
            section: 'settings',
            bindable: true,
            defaultValue: '',
            /* wwEditor:start */
            bindingValidation: {
                type: 'string',
                tooltip:
                    'The base URL to fetch. Params + page param will be appended as query string for GET. Example: "https://api.example.com/posts"',
            },
            /* wwEditor:end */
        },
        params: {
            label: { en: 'Query params' },
            type: 'Object',
            section: 'settings',
            bindable: true,
            defaultValue: {},
            /* wwEditor:start */
            bindingValidation: {
                type: 'object',
                tooltip:
                    'Additional query parameters (filters, etc.). For GET: appended as query string alongside page param. For POST: merged into body. Different params create separate cache entries under the same query key family.',
            },
            /* wwEditor:end */
        },
        method: {
            label: { en: 'HTTP Method' },
            type: 'TextSelect',
            section: 'settings',
            options: {
                options: [
                    { value: 'GET', label: { en: 'GET' } },
                    { value: 'POST', label: { en: 'POST' } },
                ],
            },
            defaultValue: 'GET',
        },
        contentType: {
            label: { en: 'Content type' },
            type: 'TextSelect',
            section: 'settings',
            options: {
                options: [
                    { value: 'application/json', label: { en: 'JSON' } },
                    { value: 'application/x-www-form-urlencoded', label: { en: 'Form URL Encoded' } },
                ],
            },
            defaultValue: 'application/json',
            hidden: content => content.method === 'GET',
        },
        headers: {
            label: { en: 'Headers' },
            type: 'Object',
            section: 'settings',
            bindable: true,
            defaultValue: {},
            /* wwEditor:start */
            bindingValidation: {
                type: 'object',
                tooltip:
                    'HTTP headers. Example: { "Authorization": "Bearer token123" }',
            },
            /* wwEditor:end */
        },
        body: {
            label: { en: 'Request body' },
            type: 'Object',
            section: 'settings',
            bindable: true,
            defaultValue: null,
            hidden: content => content.method === 'GET',
            /* wwEditor:start */
            bindingValidation: {
                type: 'object',
                tooltip: 'Base request body. Page param will be merged in.',
            },
            /* wwEditor:end */
        },
        pageParamKey: {
            label: { en: 'Page param key' },
            type: 'Text',
            section: 'settings',
            bindable: true,
            defaultValue: 'page',
            /* wwEditor:start */
            bindingValidation: {
                type: 'string',
                tooltip:
                    'The query parameter name used for pagination. For GET: appended as ?page=N. For POST: merged into body. Default: "page"',
            },
            /* wwEditor:end */
        },
        initialPageParam: {
            label: { en: 'Initial page param' },
            type: 'Number',
            section: 'settings',
            bindable: true,
            defaultValue: 1,
            /* wwEditor:start */
            bindingValidation: {
                type: 'number',
                tooltip: 'The starting page parameter value. Default: 1',
            },
            /* wwEditor:end */
        },
        nextPagePath: {
            label: { en: 'Next page path' },
            type: 'Text',
            section: 'settings',
            bindable: true,
            defaultValue: '',
            /* wwEditor:start */
            bindingValidation: {
                type: 'string',
                tooltip:
                    'Dot-notation path to extract the next page param from the API response. Example: "meta.nextPage" or "pagination.next". If empty, uses currentPage + 1. If the value at this path is null/undefined, hasNextPage becomes false.',
            },
            /* wwEditor:end */
        },
        previousPagePath: {
            label: { en: 'Previous page path' },
            type: 'Text',
            section: 'settings',
            bindable: true,
            defaultValue: '',
            /* wwEditor:start */
            bindingValidation: {
                type: 'string',
                tooltip:
                    'Dot-notation path to extract the previous page param from the API response. Example: "meta.prevPage". If empty, uses currentPage - 1 (stops at initial page param).',
            },
            /* wwEditor:end */
        },
        maxPages: {
            label: { en: 'Max pages' },
            type: 'Number',
            section: 'settings',
            bindable: true,
            defaultValue: 0,
            options: {
                min: 0,
                step: 1,
            },
            /* wwEditor:start */
            bindingValidation: {
                type: 'number',
                tooltip: 'Maximum number of pages to keep in memory. 0 = unlimited. Default: 0',
            },
            /* wwEditor:end */
        },
        staleTime: {
            label: { en: 'Stale time (ms)' },
            type: 'Number',
            section: 'settings',
            bindable: true,
            defaultValue: 0,
            options: { min: 0, step: 1000 },
            /* wwEditor:start */
            bindingValidation: {
                type: 'number',
                tooltip: 'Time in ms that data is considered fresh. 0 = always stale. Default: 0',
            },
            /* wwEditor:end */
        },
        cacheTime: {
            label: { en: 'Cache time (ms)' },
            type: 'Number',
            section: 'settings',
            bindable: true,
            defaultValue: 300000,
            options: { min: 0, step: 1000 },
            /* wwEditor:start */
            bindingValidation: {
                type: 'number',
                tooltip: 'Time in ms unused cache entries are kept. Default: 300000 (5 min)',
            },
            /* wwEditor:end */
        },
        refetchInterval: {
            label: { en: 'Refetch interval (ms)' },
            type: 'Number',
            section: 'settings',
            bindable: true,
            defaultValue: 0,
            options: { min: 0, step: 1000 },
            /* wwEditor:start */
            bindingValidation: {
                type: 'number',
                tooltip: 'Auto-refetch all pages every N ms. 0 = disabled.',
            },
            /* wwEditor:end */
        },
        refetchOnWindowFocus: {
            label: { en: 'Refetch on window focus' },
            type: 'OnOff',
            section: 'settings',
            bindable: true,
            defaultValue: false,
            /* wwEditor:start */
            bindingValidation: {
                type: 'boolean',
                tooltip: 'Refetch all pages when the browser tab becomes visible again.',
            },
            /* wwEditor:end */
        },
        enabled: {
            label: { en: 'Enabled' },
            type: 'OnOff',
            section: 'settings',
            bindable: true,
            defaultValue: true,
            /* wwEditor:start */
            bindingValidation: {
                type: 'boolean',
                tooltip: 'If disabled, the query will not automatically fetch.',
            },
            /* wwEditor:end */
        },
    },
};
