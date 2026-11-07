const CACHE_NAME = 'lootura-v14';
const CORE_ASSETS = [
	'./',
	'./manifest.webmanifest',
	'./favicon.svg',
	'./icon-192.png',
	'./icon-512.png',
	'./offline/',
	'./500.html',
];

const isCacheableRequest = (request) => {
	if (request.method !== 'GET') return false;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return false;
	const scopePath = new URL('./', self.location.href).pathname;
	if (!url.pathname.startsWith(scopePath)) return false;
	const relativePath = url.pathname.slice(scopePath.length);
	if (/^(?:admin|dev)(?:\/|$)/.test(relativePath)) return false;
	if (relativePath.startsWith('data/processes/')) return false;
	if (url.pathname.endsWith('/app-build.json')) return false;
	if (/\/news(?:\.[a-z]{2})?\.json$/.test(url.pathname)) return false;
	if (url.pathname.endsWith('/activity.json')) return false;
	if (url.pathname.endsWith('/signal.json')) return false;
	if (url.pathname.includes('/signal-enrichment')) return false;

	return true;
};

const updateCache = async (request, response) => {
	if (!response || response.status !== 200 || response.type === 'opaque') return response;

	try {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(request, response.clone());
	} catch {
		// Cache quota or storage restrictions must not discard a valid network response.
	}
	return response;
};

const cachedResponse = async (request) => {
	try { return await caches.match(request); }
	catch { return undefined; }
};

// The fallback is a complete HTML document, with no network-dependent CSS or JS.
const recoveryPage = async (page) => {
	const saved = await cachedResponse(new URL(page, self.location.href).href);
	if (!saved) return undefined;
	return new Response(saved.body, {
		status: 503,
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
	});
};

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key.startsWith('lootura-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (event) => {
	if (!isCacheableRequest(event.request)) return;

	const request = event.request;
	const immutableAsset = new URL(request.url).pathname.includes('/_astro/');
	event.respondWith((async () => {
		if (immutableAsset) {
			try {
				const cachedAsset = await caches.match(request);
				if (cachedAsset) return cachedAsset;
			} catch { /* A restricted cache must still allow network loading. */ }
		}
		return fetch(request)
			.then(async (response) => {
				if (request.mode === 'navigate' && response.status >= 500) {
					return await cachedResponse(request) || await recoveryPage('./500.html') || response;
				}
				return updateCache(request, response);
			})
			.catch(async () => {
				const saved = await cachedResponse(request);
				if (saved) return saved;
				if (request.mode === 'navigate') {
					const fallback = await recoveryPage('./offline/');
					if (fallback) return fallback;
				}

				throw new Error('Network unavailable and no cached response found.');
			});
	})());
});
