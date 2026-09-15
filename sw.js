const CACHE_NAME = 'lootura-v9';
const CORE_ASSETS = [
	'./',
	'./manifest.webmanifest',
	'./favicon.svg',
	'./news-fallback.svg',
	'./news-fallback-lines.svg',
	'./news-fallback-field.svg',
	'./news-fallback-press.svg',
	'./icon-192.png',
	'./icon-512.png',
];

const isCacheableRequest = (request) => {
	if (request.method !== 'GET') return false;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return false;
	if (url.pathname.endsWith('/app-build.json')) return false;
	if (url.pathname.endsWith('/news.json')) return false;
	if (url.pathname.includes('/signal-enrichment')) return false;

	return true;
};

const updateCache = async (request, response) => {
	if (!response || response.status !== 200 || response.type === 'opaque') return response;

	const cache = await caches.open(CACHE_NAME);
	await cache.put(request, response.clone());
	return response;
};

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	if (!isCacheableRequest(event.request)) return;

	event.respondWith(
		fetch(event.request)
			.then((response) => updateCache(event.request, response))
			.catch(async () => {
				const cachedResponse = await caches.match(event.request);
				if (cachedResponse) return cachedResponse;

				throw new Error('Network unavailable and no cached response found.');
			}),
	);
});
