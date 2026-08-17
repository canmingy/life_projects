/* ============================================================
   Service Worker —— 静态资源离线缓存
   * 只缓存应用静态资源（HTML/CSS/JS/图标），绝不缓存云端数据
   * 策略：网络优先，失败回退缓存；离线时页面与最近数据可查看
   * 数据同步逻辑完全由 app.js 控制（离线不覆盖云端，恢复网络提示）
   ============================================================ */
const CACHE_NAME = 'canming-workbench-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './mobile.css',
  './app.js',
  './share.html',
  './share.js',
  './share.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只处理同源请求；Supabase API 等跨域请求一律不拦截
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || caches.match('./index.html'))
      )
  );
});
