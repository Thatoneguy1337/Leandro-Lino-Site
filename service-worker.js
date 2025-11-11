/* GeoViewer Pro — Service Worker (Cache Agressivo + Performance Máxima) */
const VERSION = 'v2.0.1'; // Increment version to trigger update
const CORE_CACHE = `geoviewer-core-${VERSION}`;
const RUNTIME_CACHE = `geoviewer-runtime-${VERSION}`;

// ✅ CACHE CRÍTICO - Recursos que bloqueiam a renderização
const IMMEDIATE_ASSETS = [
  './',
  'index.html',
  'assets/styles.css',
  'assets/script.js', // Added script.js to immediate assets
  'assets/img/image.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// ✅ CACHE SECUNDÁRIO - Recursos importantes mas não bloqueantes
const LAZY_ASSETS = [
  'admin.html',
  'offline.html',
  'manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', VERSION);
  
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => {
        // Cache apenas os recursos IMEDIATOS durante a instalação
        return cache.addAll(IMMEDIATE_ASSETS);
      })
      .then(() => {
        // ⚡ Pula a fase de waiting - ativa imediatamente
        return self.skipWaiting();
      })
      .catch((err) => {
        console.log('[SW] Install failed:', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', VERSION);
  
  event.waitUntil(
    Promise.all([
      // Limpa caches antigos
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter(key => key !== CORE_CACHE && key !== RUNTIME_CACHE)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        );
      }),
      
      // Pré-cache recursos lazy em background
      caches.open(CORE_CACHE).then(cache => {
        return cache.addAll(LAZY_ASSETS).catch(err => {
          console.log('[SW] Lazy cache failed (non-critical):', err);
        });
      }),
      
      // ⚡ Assume controle imediato de todas as tabs
      self.clients.claim()
    ])
  );
});

/* -------- ESTRATÉGIAS DE CACHE ULTRA-RÁPIDAS -------- */

// ✅ Cache-First para recursos estáticos (mais rápido)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    // Fallback genérico para CSS/JS
    if (request.destination === 'style' || request.destination === 'script') {
      return new Response('/* Fallback */', { 
        status: 200, 
        headers: { 'Content-Type': 'text/css' } 
      });
    }
    throw err;
  }
}

// ✅ Network-First apenas para HTML
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Fallback para navegação
    if (request.mode === 'navigate') {
      return caches.match('./offline.html');
    }
    
    throw err;
  }
}

// ✅ Stale-While-Revalidate otimizado (não bloqueia resposta)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  
  // ⚡ Retorna cached imediatamente, atualiza em background
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response).catch(() => {});
      }
      return response;
    })
    .catch(() => {}); // Silencia erros de atualização

  // Não espera pela network - retorna cached ou faz fetch
  return cached || fetchPromise || Response.error();
}

/* -------- ROTEAMENTO INTELIGENTE -------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 🔥 BYPASS COMPLETO para APIs e recursos dinâmicos
  const shouldBypass = 
    request.method !== 'GET' ||
    url.origin.includes('open-meteo.com') ||
    url.origin.includes('geocode.maps.co') ||
    url.origin.includes('maps.co') ||
    url.pathname.includes('/api/') ||
    url.search.includes('nocache=true');

  if (shouldBypass) {
    event.respondWith(fetch(request));
    return;
  }

  // 🎯 Estratégias específicas por tipo de recurso
  switch (true) {
    // HTML - Sempre fresco
    case request.mode === 'navigate':
      event.respondWith(networkFirst(request));
      break;

    // CSS/JS/Imagens - Cache agressivo
    case request.destination === 'style':
    case request.destination === 'script':
    case request.destination === 'image':
      event.respondWith(cacheFirst(request));
      break;

    // Fontes e outros - SWR
    default:
      event.respondWith(staleWhileRevalidate(request));
  }
});

/* -------- MENSAGENS PARA ATUALIZAÇÃO -------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});