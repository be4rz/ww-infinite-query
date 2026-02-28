# ww-query-cache

**React Query-like caching for WeWeb** — two custom-coded components that bring `useQuery` and `useInfiniteQuery` patterns to WeWeb with a shared global cache.

## Features

| Feature | `ww-query` | `ww-infinite-query` |
|---------|:----------:|:-------------------:|
| Smart cache with query keys | ✅ | ✅ |
| Stale time | ✅ | ✅ |
| Cache time (GC) | ✅ | ✅ |
| Request deduplication | ✅ | ✅ |
| Refetch on window focus | ✅ | ✅ |
| Auto refetch interval | ✅ | ✅ |
| Enabled/disabled queries | ✅ | ✅ |
| Fetch next/previous page | — | ✅ |
| Auto-flatten pages | — | ✅ |
| Max pages limit | — | ✅ |

## Architecture

```
┌────────────────────────────────────────────┐
│            window.__wwQueryCache           │
│          (Global Cache Singleton)          │
│  Map<hashedKey, {data, error, status,...}> │
└────────────┬──────────────┬────────────────┘
             │              │
    ┌────────┴────┐  ┌──────┴──────────┐
    │  ww-query   │  │ ww-infinite-    │
    │  instances  │  │ query instances │
    │             │  │                 │
    │ QueryObserver  │ Per-page cache  │
    │ per instance│  │ management     │
    └─────────────┘  └────────────────┘
```

All component instances share a single in-memory cache via `window.__wwQueryCache`. This means:
- Same query key → same cached data (no duplicate requests)
- Data persists across page navigations (WeWeb is a SPA)
- When no component observes a key, it's garbage-collected after `cacheTime`

## Project Structure

```
packages/
├── core/src/               ← Shared cache engine (no WeWeb dependency)
│   ├── QueryCache.js       ← Global Map-based cache + request dedup
│   ├── QueryObserver.js    ← Per-instance lifecycle (timers, listeners)
│   └── utils.js            ← hashKey, isStale, QueryStatus
│
├── ww-query/               ← "useQuery" component
│   ├── package.json
│   ├── ww-config.js        ← Editor properties, actions, triggers
│   └── src/wwElement.vue   ← Invisible component logic
│
└── ww-infinite-query/      ← "useInfiniteQuery" component
    ├── package.json
    ├── ww-config.js
    └── src/wwElement.vue
```

## Setup

### Prerequisites
- Node.js 18+
- WeWeb account with dev editor access

### Install & Build

```bash
# ww-query
cd packages/ww-query
npm install
npx weweb build

# ww-infinite-query
cd packages/ww-infinite-query
npm install
npx weweb build
```

### Load in WeWeb Dev Editor

1. Start the dev server: `npx weweb serve` in the component directory
2. Open your WeWeb project editor
3. Go to the dev tabs to load your local component
4. The component appears in the editor's element palette

---

## Usage: `ww-query`

### 1. Add to Page

Drop a **Query** element onto your page. It's invisible — it renders its children via a slot.

### 2. Configure Properties (Editor Sidebar)

| Property | Description | Default |
|----------|-------------|---------|
| **Query key** | Unique cache key (e.g. `"posts"`, `"user-123"`) | — |
| **Endpoint URL** | The URL to fetch | — |
| **HTTP Method** | GET, POST, PUT, PATCH, DELETE | GET |
| **Headers** | Custom headers object | `{}` |
| **Request body** | Body for POST/PUT/PATCH | `null` |
| **Stale time (ms)** | How long data is "fresh" | `0` |
| **Cache time (ms)** | How long unused data stays in memory | `300000` |
| **Refetch interval (ms)** | Auto-refetch period (0 = off) | `0` |
| **Refetch on window focus** | Refetch when tab becomes visible | `true` |
| **Enabled** | Whether the query runs | `true` |

### 3. Bind to Exposed Variables

The component exposes these variables that you can bind to in formulas:

| Variable | Type | Description |
|----------|------|-------------|
| `data` | `any` | The fetched data |
| `error` | `object\|null` | Error object with `message` |
| `isLoading` | `boolean` | True on first fetch (no cached data) |
| `isFetching` | `boolean` | True during any fetch (including background) |
| `isStale` | `boolean` | True if data is past staleTime |
| `isSuccess` | `boolean` | True if last fetch succeeded |
| `isError` | `boolean` | True if last fetch failed |
| `status` | `string` | `"idle"`, `"loading"`, `"success"`, `"error"` |
| `fetchedAt` | `number` | Timestamp of last successful fetch |

### 4. Use Workflow Actions

Via **Execute component action** in workflows:

- **Refetch** — Force a new fetch, bypassing staleTime
- **Invalidate** — Mark cache as stale and refetch

### 5. React to Trigger Events

Add workflows triggered by:

- **On success** — Fires with `{ data }` after a successful fetch
- **On error** — Fires with `{ error }` on failure
- **On settled** — Fires with `{ data, error }` after any fetch completes

---

## Usage: `ww-infinite-query`

### Additional Properties

| Property | Description | Default |
|----------|-------------|---------|
| **Page param key** | Query param name for pagination | `"page"` |
| **Initial page param** | Starting page value | `1` |
| **Next page path** | Dot-path to extract next page from response (e.g. `meta.nextPage`) | — |
| **Previous page path** | Dot-path to extract previous page | — |
| **Max pages** | Max pages in memory (0 = unlimited) | `0` |

### Additional Exposed Variables

| Variable | Type | Description |
|----------|------|-------------|
| `pages` | `array` | Array of raw page responses |
| `data` | `array` | Auto-flattened data from all pages |
| `pageParams` | `array` | Array of page params that have been fetched |
| `hasNextPage` | `boolean` | Whether more pages are available |
| `hasPreviousPage` | `boolean` | Whether previous pages are available |
| `isFetchingNextPage` | `boolean` | True while fetching next page |
| `isFetchingPreviousPage` | `boolean` | True while fetching previous page |
| `currentPage` | `number` | Current (last fetched) page param |
| `totalPages` | `number` | Number of pages loaded |

### Additional Actions

- **Fetch next page** — Load the next page and append to pages array
- **Fetch previous page** — Load the previous page and prepend
- **Refetch all pages** — Invalidate and re-fetch all loaded pages
- **Reset pages** — Clear all pages and start from initial page
- **Invalidate** — Mark all page caches as stale and refetch

### Page Param Extraction

**Automatic (default):** If `nextPagePath` is empty, the component auto-increments: page 1 → 2 → 3...

**From API response:** Set `nextPagePath` to the dot-notation path where your API returns the next page value:

```json
// API response:
{
  "data": [...],
  "meta": { "nextPage": 3, "prevPage": 1 }
}
// Set nextPagePath = "meta.nextPage"
// Set previousPagePath = "meta.prevPage"
```

When the value at the path is `null` or `undefined`, `hasNextPage` becomes `false` and the component stops.

---

## How Caching Works

### Query Keys
Each unique `queryKey` maps to one cache entry. Use dynamic keys to cache different data:
- `"posts"` — all posts
- `"post-123"` — single post by ID (bind the key to a variable)

### Stale Time
Data is "fresh" for `staleTime` ms after fetching. While fresh:
- Component returns cached data instantly (no loading spinner)
- No background refetch occurs
- `isStale = false`

After `staleTime` expires:
- Data still shows (not removed)
- Next mount or focus triggers a background refetch
- `isStale = true`

### Cache Time (Garbage Collection)
When no component observes a query key anymore (e.g. user navigated away), the cache entry stays for `cacheTime` ms. If a component re-subscribes within that window, data loads instantly. After `cacheTime`, the entry is evicted.

### Request Deduplication
If multiple components use the same `queryKey`, only ONE network request fires. All components share the same cached result.

---

## License

MIT
