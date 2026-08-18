/**
 * 小步计划 Service Worker（手写，不依赖 Workbox）。
 *
 * 目标只有一个：断网/弱网时应用外壳能秒开。任务数据本来就在 IndexedDB（Dexie）里，
 * 不归 SW 管，所以这里只处理静态资源，绝不碰任何接口请求。
 *
 * 三条铁律：
 * 1. 跨域请求（Supabase 接口、认证）一律不拦截——缓存接口响应会让 LWW 合并读到过期数据，
 *    比不缓存危险得多；认证令牌更不能进缓存。
 * 2. 只处理 GET；POST/PATCH/DELETE 直接放行。
 * 3. index.html 走 network-first——保证推新版本后用户能拿到新代码，不会卡在旧版本。
 *    /assets/ 下是 Vite 带内容哈希的文件名（改动必然换名），可以放心 cache-first。
 */
const VERSION = "v1";
const SHELL_CACHE = `xiaobu-shell-${VERSION}`;
const ASSET_CACHE = `xiaobu-assets-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE];

self.addEventListener("install", (event) => {
  // 预热外壳：装好后即便首次离线也能开
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/index.html"])).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("xiaobu-") && !KEEP.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 铁律 1：跨域（Supabase）完全不插手

  // 页面导航：network-first，断网才回落到缓存的外壳
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // 带哈希的构建产物：cache-first（文件名变了就是新文件，不存在过期问题）
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })),
    );
    return;
  }

  // 图标/manifest 等固定名字的静态文件：先给缓存，后台顺带更新
  if (/\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        }).catch(() => cached ?? Response.error());
        return cached ?? network;
      }),
    );
  }
});
