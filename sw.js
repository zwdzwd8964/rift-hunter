// 离线缓存：安装时把整个游戏存进缓存，之后优先用缓存（没网也能玩）。
// VERSION 是构建时按文件内容算出的哈希：游戏一更新，手机下次联网打开就会换成新版本。
const VERSION = '2ebb84b33734';
const FILES = ["./", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "index.html", "js/audio.js", "js/bosses.js", "js/core.js", "js/data_chars.js", "js/data_enemies.js", "js/data_items.js", "js/enemies.js", "js/fx.js", "js/gfx.js", "js/hud.js", "js/items.js", "js/main.js", "js/meta.js", "js/render.js", "js/sim.js", "js/sprites.js", "js/touch.js", "js/ui.js", "js/world.js", "manifest.webmanifest"];
const CACHE = 'rift-hunter-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rift-hunter-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() =>
      e.request.mode === 'navigate' ? caches.match('./') : Response.error()))
  );
});
