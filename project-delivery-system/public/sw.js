/* ============================================================
   忆古轩项目管理系统 · Service Worker（PWA）
   ------------------------------------------------------------
   职责：
     · 缓存「界面壳」（HTML / CSS / JS / 图标），断网时仍能打开界面
     · 保证发版后能自动更新到新版本
   原则：
     · 所有 /api/ 请求一律走网络（含登录态、业务数据），绝不缓存
     · 导航请求用「网络优先」，保证拿到最新页面
   ============================================================ */

const VERSION = 'ygx-pms-v22-20261001-design-reminders';
const SHELL_CACHE = VERSION + '-shell';

/* 界面壳资源：与 index.html 中声明的加载顺序保持一致 */
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/workflow.css',
  '/manifest.webmanifest',
  '/js/00-icons.js',
  '/js/01-core.js',
  '/js/02-components.js',
  '/js/03-views.js',
  '/js/04-project.js',
  '/js/05-modules.js',
  '/js/06-boot.js',
  '/js/07-staff.js',
  '/js/08-datepicker.js',
  '/js/09-fields.js',
  '/js/10-nodeform.js',
];

/* 安装：预缓存界面壳 */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      /* 逐个添加：个别资源缺失（如图标未生成）不应导致整体安装失败 */
      return Promise.all(
        SHELL_FILES.map((f) => cache.add(f).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

/* 激活：清理旧版本缓存 */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.indexOf(VERSION) !== 0).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  /* 只处理同源 GET */
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  /* 接口请求：始终走网络，永不缓存（避免读到过期业务数据） */
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/healthz') return;

  /* 页面导航：网络优先，失败时回退到缓存的首页 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  /* 静态资源：缓存优先，后台顺便更新（stale-while-revalidate） */
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
