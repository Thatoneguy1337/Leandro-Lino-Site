/* =========================================================
   GeoViewer Pro — Admin JS (otimizado)
   - Performance de zoom/carga melhorada
   - Simplificação de geometrias em METROS
   - Parser em lotes com requestIdleCallback
   - Labels de postos só quando o mapa para
   - Uploader de logo (server-side) incluído no final

   🔧 Atualizações (out/2025)
   - FIX: Ocultar linhas passa a ocultar apenas polylines (sem afetar postos/números)
   - FIX: Removidos halos/destaques ao ocultar linhas (não ficam "linhas fantasmas")
   - FIX: Duplicação de attachLineTooltip/addLayer em polylines
   - UX: Carregamento inicial mostra só as linhas; postos aparecem após o primeiro zoom do usuário
   - CACHE: Prefetch dos KML/KMZ com Cache Storage (cache-first com fallback de rede)
   - GEO: Localização por leitura única com animação (sem watch)
   ========================================================= */

/* ---------- Parâmetros de performance ---------- */
const Z_MARKERS_ON   = 15;
const Z_LABELS_ON    = 12;
const CHUNK_SIZE     = 2000;
const LINE_SMOOTH    = 2.0;
const LINE_BASE_W = 4;
const LINE_MAX_W  = 6;
const Z_POST_TEXT_ON   = 14;
const MAX_POST_LABELS  = 100;
const LABEL_GRID_PX    = 96;
const MAX_STATUS_LEN = 40;

/* ========================
   SISTEMA DE CACHE CLIENTE
   ======================== */
const UPLOAD_CACHE_KEY = 'gv_last_uploads_v3';
const MAP_STATE_KEY = 'gv_map_state_v3';
const LAST_SESSION_KEY = 'gv_last_session_v2';
const LAST_PROCESSED_MAP_DATA_KEY = 'gv_last_processed_map_data_v1';
const API_CITIES = 'api/cities.php';

window.currentCityId = null; // Declare global variable

/* ----------------- Utils ----------------- */
const $ = (s, r = document) => r.querySelector(s);
const statusEl = $("#statusText"),
      coordsEl = $("#coordinates");
const loadingEl = $("#loadingOverlay"),
      loadingTxt = $("#loadingText");

const setStatus = (m) => {
  if (!statusEl) return;
  const raw = String(m ?? '').trim();
  if (/não encontrei essa sua cidade/i.test(raw)) return;
  const short = raw.length > MAX_STATUS_LEN
    ? raw.slice(0, MAX_STATUS_LEN - 1).trimEnd() + '…'
    : raw;
  statusEl.textContent = short;
  statusEl.title = raw;
};

const showLoading = (on, msg = "Processando...") => {
  if (!loadingEl) return;
  loadingEl.classList.toggle("show", !!on);
  if (msg && loadingTxt) loadingTxt.textContent = msg;
};

const timeoutFetch = (url, opts = {}, ms = 15000) => {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(id));
};

const prettyCityFromFilename = (name = "") => {
  const base = String(name).split("/").pop().replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
};

// Global function for geolocation
function locateOnceAnimated() {
  console.log('📍 locateOnceAnimated called');
  if (!navigator.geolocation) {
    setStatus('❌ Geolocation não suportada pelo seu navegador.');
    console.error('Geolocation not supported.');
    return;
  }

  setStatus('🌍 Localizando...');
  showLoading(true, 'Obtendo sua localização...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const latlng = [latitude, longitude];
      console.log('✅ Geolocation success:', latlng);
      map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 1.5 });

      const tempMarker = L.circleMarker(latlng, {
        radius: 10,
        color: '#000',
        weight: 2,
        fillColor: '#3388ff',
        fillOpacity: 0.8
      }).addTo(map);

      tempMarker.bindPopup(`
        <b>Sua Localização</b><br>
        Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}
      `).openPopup();

      setTimeout(() => {
        map.removeLayer(tempMarker);
      }, 5000);

      setStatus('✅ Localização encontrada!');
      showLoading(false);
    },
    (error) => {
      console.error('❌ Geolocation error:', error);
      showLoading(false);
      let message = '❌ Erro ao obter localização.';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = '❌ Permissão de localização negada.';
          break;
        case error.POSITION_UNAVAILABLE:
          message = '❌ Localização indisponível.';
          break;
        case error.TIMEOUT:
          message = '❌ Tempo esgotado ao obter localização.';
          break;
        case error.UNKNOWN_ERROR:
          message = '❌ Erro desconhecido de localização.';
          break;
      }
      setStatus(message);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

/* ========================
   CACHE DE ÚLTIMOS UPLOADS
   ======================== */

// Salvar upload no cache
async function saveRecentUpload(uploadInfo) {
    try {
        const cache = JSON.parse(localStorage.getItem(UPLOAD_CACHE_KEY) || '[]');
        const filtered = cache.filter(item => item.file_path !== uploadInfo.file_path);
        filtered.unshift({
            ...uploadInfo,
            cached_at: Date.now(),
            client_cache: true
        });
        const limited = filtered.slice(0, 5);
        localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(limited));
        console.log('✅ Upload salvo no cache:', uploadInfo.file_name);
        renderRecentUploadsPanel();
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar upload:', error);
        return false;
    }
}

// Obter uploads do cache
function getRecentUploads() {
    try {
        const cache = JSON.parse(localStorage.getItem(UPLOAD_CACHE_KEY) || '[]');
        const now = Date.now();
        const fresh = cache.filter(item => now - (item.cached_at || 0) < 7 * 24 * 60 * 60 * 1000);
        if (fresh.length !== cache.length) {
            localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(fresh));
        }
        return fresh;
    } catch {
        return [];
    }
}

// Salvar estado da sessão
function saveSessionState() {
    if (!map) return;
    
    const state = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bounds: map.getBounds().toBBoxString(),
        timestamp: Date.now(),
        currentFile: currentFile?.textContent || '',
        visibleLayers: getVisibleLayers(),
        visiblePosts: getVisiblePosts(),
        mapView: {
            center: [map.getCenter().lat, map.getCenter().lng],
            zoom: map.getZoom()
        },
        cityId: window.currentCityId // Save the current city ID
    };
    
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(state));
}

function saveProcessedMapData() {
    console.log('DEBUG: saveProcessedMapData called.');
    if (!order.length && !postOrder.length) {
        console.log('DEBUG: No lines or markers to save. Returning early.');
        return;
    }

    const processedData = {
        lines: [],
        markers: [],
        order: order,
        postOrder: postOrder,
        timestamp: Date.now()
    };

    // Collect line data
    order.forEach(groupName => {
        if (groups[groupName]) {
            groups[groupName].eachLayer(layer => {
                if (layer instanceof L.Polyline && layer.__levels) {
                    processedData.lines.push({
                        group: groupName,
                        color: layer.options.color,
                        lods: layer.__levels
                    });
                }
            });
        }
    });

    // Collect marker data
    allPostMarkers.forEach(pm => {
        processedData.markers.push({
            coords: [pm.lat, pm.lng],
            group: pm.m.__groupName, // Use the group name set on the marker
            name: pm.text,
            extra: {
                Alim: pm.m.__groupName, // Assuming __groupName stores Alim
                Potência: pm.m.options.fillColor === POST_COLORS.KVA ? 'Sim' : undefined // Simplified, adjust as needed
            }
        });
    });

    console.log(`DEBUG: Collected ${processedData.lines.length} lines and ${processedData.markers.length} markers.`);

    try {
        const dataToSave = JSON.stringify(processedData);
        console.log(`DEBUG: Size of data to save: ${dataToSave.length} characters.`);
        localStorage.setItem(LAST_PROCESSED_MAP_DATA_KEY, dataToSave);
        console.log('✅ Dados do mapa processados salvos no cache.');
    } catch (e) {
        console.error('❌ Erro ao salvar dados do mapa processados:', e);
        if (e.name === 'QuotaExceededError') {
            console.error('LocalStorage quota exceeded. Data might be too large.');
        }
    }
}

// Restaurar última sessão
// Holds the state from the last session to be applied after data is loaded
window.restoredState = null;

// Restaurar última sessão
function restoreLastSession() {
    try {
        const saved = localStorage.getItem(LAST_SESSION_KEY);
        if (!saved) return null;
        
        const state = JSON.parse(saved);
        if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(LAST_SESSION_KEY);
            return null;
        }
        
        if (state.mapView && state.mapView.center) {
            map.setView(state.mapView.center, state.mapView.zoom, { animate: false });
        }
        
        if (state.currentFile && currentFile) {
            currentFile.textContent = state.currentFile;
        }
        
        window.restoredState = state;
        setStatus('🔄 Sessão anterior restaurada');
        return state; // Return the whole state object
        
    } catch (error) {
        console.error('❌ Erro ao restaurar sessão:', error);
        window.restoredState = null;
        return null;
    }
}

async function loadProcessedMapData() {
    try {
        const saved = localStorage.getItem(LAST_PROCESSED_MAP_DATA_KEY);
        if (!saved) return false;

        const data = JSON.parse(saved);
        // Check if data is too old (e.g., 7 days)
        if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(LAST_PROCESSED_MAP_DATA_KEY);
            console.log('Cache de dados do mapa processado expirado.');
            return false;
        }

        console.log('✅ Carregando dados do mapa processados do cache...');
        setStatus('🔄 Carregando mapa do cache...');
        showLoading(true, 'Carregando mapa do cache...');

        // Clear existing map layers before rendering from cache
        if (published) { try { map.removeLayer(published); } catch {} }
        resetGroups();

        // Re-populate global arrays
        order.length = 0;
        postOrder.length = 0;
        data.order.forEach(item => order.push(item));
        data.postOrder.forEach(item => postOrder.push(item));

        // Render the map from the cached data
        await renderFromProcessed(data);

        // Update UI panels
        renderLayersPanelLines();
        renderLayersPanelPosts();
        refreshCounters();

        setStatus('✅ Mapa carregado do cache!');
        showLoading(false);
        return true;

    } catch (error) {
        console.error('❌ Erro ao carregar dados do mapa processados do cache:', error);
        localStorage.removeItem(LAST_PROCESSED_MAP_DATA_KEY); // Clear corrupted cache
        showLoading(false);
        return false;
    }
}

// Obter layers visíveis
function getVisibleLayers() {
    const visible = [];
    if (window.order && window.groups) {
        window.order.forEach(name => {
            if (window.groups[name] && map.hasLayer(window.groups[name])) {
                visible.push(name);
            }
        });
    }
    return visible;
}

// Obter posts visíveis
function getVisiblePosts() {
    const visible = [];
    if (window.postOrder && window.postGroups) {
        window.postOrder.forEach(name => {
            if (window.postGroups[name] && map.hasLayer(window.postGroups[name])) {
                visible.push(name);
            }
        });
    }
    return visible;
}

/* ========================
   INTEGRAÇÃO COM API
   ======================== */

// Obter últimos uploads do servidor
async function getServerLastUploads(limit = 5) {
    try {
        const response = await timeoutFetch(`${API_CITIES}?action=last_uploads&limit=${limit}`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (data.ok && data.data) return data.data;
        throw new Error('Resposta inválida');
    } catch (error) {
        console.warn('❌ Não foi possível obter últimos uploads:', error);
        return [];
    }
}

// Obter último upload do servidor
async function getServerLastUpload() {
    try {
        const response = await timeoutFetch(`${API_CITIES}?action=last_upload`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (data.ok && data.data) return data.data;
        return null;
    } catch (error) {
        console.warn('❌ Não foi possível obter último upload:', error);
        return null;
    }
}

// Carregar último upload automaticamente
async function loadLastUploadAuto() {
    setStatus('🔄 Restaurando última sessão...');
    showLoading(true, 'Restaurando última sessão');
    
    try {
        const restoredState = restoreLastSession(); // Now returns the state object or null
        if (restoredState) {
            // If a session was restored, try to load the city associated with it
            if (restoredState.cityId) {
                await loadCityOnMap(restoredState.cityId);
                showLoading(false);
                return true;
            }
            showLoading(false);
            return true;
        }
        
        const serverUpload = await getServerLastUpload();
        if (serverUpload) {
            const success = await loadCachedUpload(
                serverUpload.file_path, 
                serverUpload.file_name, 
                serverUpload.city_name,
                true
            );
            if (success) {
                await saveRecentUpload(serverUpload);
                return true;
            }
        }
        
        const localUploads = getRecentUploads();
        if (localUploads.length > 0) {
            const success = await loadCachedUpload(
                localUploads[0].file_path,
                localUploads[0].file_name,
                localUploads[0].city_name,
                true
            );
            return success;
        }
        
        setStatus('💡 Faça upload de um arquivo para começar');
        return false;
        
    } catch (error) {
        console.error('❌ Erro ao carregar último upload:', error);
        setStatus('❌ Erro ao restaurar sessão');
        return false;
    } finally {
        showLoading(false);
    }
}

/* ========================
   SISTEMA DE UPLOAD COM CACHE
   ======================== */

// Upload com cache
async function handleFileUploadWithCache(file, cityId = null, cityName = null) {
    const isKmz = file.name.toLowerCase().endsWith('.kmz');
    const cityHint = cityName || prettyCityFromFilename(file.name);
    
    setStatus(`📤 Enviando ${file.name}...`);
    showLoading(true, `Enviando ${file.name}`);
    
    try {
        const formData = new FormData();
        
        if (cityId) {
            formData.append('action', 'upload');
            formData.append('id', cityId);
        } else {
            formData.append('action', 'create');
            formData.append('name', cityHint);
        }
        
        formData.append('file', file);
        
        const response = await timeoutFetch(API_CITIES, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Erro no upload');
        
        // Salva no cache
        const uploadInfo = {
            city_id: result.data.id,
            city_name: result.data.name,
            file_name: file.name,
            file_path: result.data.file?.url || `/uploads/cities/${result.data.id}/${file.name}`,
            file_size: file.size,
            file_type: file.name.split('.').pop().toLowerCase(),
            uploaded_at: Date.now(),
            placemarks_count: result.processing?.placemarks || 0,
            server_response: result,
            file_exists: true
        };
        
        await saveRecentUpload(uploadInfo);
        saveSessionState();
        
        setStatus(`✅ ${file.name} enviado e salvo no cache`);
        return result;
        
    } catch (error) {
        console.error('❌ Erro no upload:', error);
        let errorMessage = `Erro ao enviar: ${error.message}`;
        if (error.name === 'AbortError') errorMessage = 'Tempo esgotado';
        setStatus(`❌ ${errorMessage}`);
        throw error;
    } finally {
        showLoading(false);
    }
}

/* ========================
   CARREGAMENTO DE ARQUIVOS
   ======================== */

// Carregar upload do cache
async function loadCachedUpload(filePath, fileName, cityName, autoLoad = false) {
    try {
        setStatus(`🔄 Carregando ${fileName}...`);
        if (!autoLoad) showLoading(true, `Carregando ${fileName}`);
        
        const fullPath = filePath.startsWith('/') ? filePath : `/uploads/cities/${filePath}`;
        const response = await timeoutFetch(fullPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const isKmz = fileName.toLowerCase().endsWith('.kmz');
        
        if (isKmz) {
            const blob = await response.blob();
            const file = new File([blob], fileName, { 
                type: 'application/vnd.google-earth.kmz' 
            });
            
            if (typeof loadKMZ === 'function') {
                await loadKMZ(file);
            } else {
                throw new Error('loadKMZ não disponível');
            }
        } else {
            const text = await response.text();
            if (typeof parseKML === 'function') {
                await parseKML(text, cityName);
            } else {
                throw new Error('parseKML não disponível');
            }
        }
        
        if (currentFile) {
            currentFile.textContent = `${fileName} (${cityName})`;
        }
        
        // Atualiza cache
        const uploads = getRecentUploads();
        const currentUpload = uploads.find(u => u.file_name === fileName);
        if (currentUpload) {
            const filtered = uploads.filter(u => u.file_name !== fileName);
            filtered.unshift({ 
                ...currentUpload, 
                uploaded_at: Date.now(),
                last_loaded: Date.now()
            });
            localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(filtered));
        }
        
        saveSessionState();
        setStatus(`✅ ${fileName} carregado`);
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao carregar:', error);
        if (!autoLoad) setStatus(`❌ Erro ao carregar ${fileName}`);
        
        // Remove do cache se erro
        const uploads = getRecentUploads();
        const filtered = uploads.filter(u => u.file_name !== fileName);
        localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(filtered));
        renderRecentUploadsPanel();
        
        return false;
    } finally {
        if (!autoLoad) showLoading(false);
    }
}

/* ========================
   UI PARA UPLOADS RECENTES
   ======================== */

// Renderizar painel de uploads
function renderRecentUploadsPanel() {
    const uploads = getRecentUploads();
    if (uploads.length === 0) return;
    
    let panel = document.getElementById('recentUploadsPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'recentUploadsPanel';
        panel.className = 'panel-section';
        panel.innerHTML = `
            <h2>📁 Uploads Recentes</h2>
            <div class="cache-info">Últimos arquivos carregados</div>
            <div id="recentUploadsList" class="list-card"></div>
            <div class="row gap" style="margin-top: 8px;">
                <button onclick="clearUploadsCache()" class="btn link small">🗑️ Limpar</button>
                <button onclick="refreshUploadsCache()" class="btn link small">🔄 Atualizar</button>
            </div>
        `;
        
        const citiesSection = document.querySelector('.panel-section');
        if (citiesSection) {
            citiesSection.parentNode.insertBefore(panel, citiesSection.nextSibling);
        }
    }
    
    const list = document.getElementById('recentUploadsList');
    list.innerHTML = uploads.map((upload, index) => {
        const timeAgo = getTimeAgo(upload.uploaded_at);
        const isRecent = Date.now() - upload.uploaded_at < 24 * 60 * 60 * 1000;
        
        return `
            <div class="city-item ${isRecent ? 'recent-upload' : ''}">
                <div class="city-info">
                    <div class="city-name">
                        ${upload.file_name}
                        ${index === 0 ? '<span title="Último">🔄</span>' : ''}
                        ${upload.client_cache ? '<span title="Cache local">💾</span>' : ''}
                    </div>
                    <small class="muted">
                        ${upload.city_name} • 
                        ${upload.placemarks_count ? upload.placemarks_count + ' postos • ' : ''}
                        ${timeAgo}
                    </small>
                </div>
                <button class="btn primary small" 
                        onclick="loadCachedUpload('${upload.file_path}', '${upload.file_name}', '${upload.city_name}')"
                        title="Carregar">
                    Carregar
                </button>
            </div>
        `;
    }).join('');
}

// Limpar cache
function clearUploadsCache() {
    if (confirm('Limpar cache de uploads e dados do mapa?')) {
        localStorage.removeItem(UPLOAD_CACHE_KEY);
        localStorage.removeItem(LAST_SESSION_KEY);
        localStorage.removeItem(LAST_PROCESSED_MAP_DATA_KEY); // Clear the new cache key
        const panel = document.getElementById('recentUploadsPanel');
        if (panel) panel.remove();
        setStatus('🗑️ Cache limpo');
    }
}

// Atualizar cache
async function refreshUploadsCache() {
    setStatus('🔄 Atualizando cache...');
    try {
        const serverUploads = await getServerLastUploads(10);
        const localUploads = getRecentUploads();
        const mergedUploads = [...serverUploads, ...localUploads];
        
        const uniqueUploads = [];
        const seen = new Set();
        mergedUploads.forEach(upload => {
            const key = upload.file_path + upload.file_name;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueUploads.push(upload);
            }
        });
        
        uniqueUploads.sort((a, b) => (b.uploaded_at || 0) - (a.uploaded_at || 0));
        const limited = uniqueUploads.slice(0, 5);
        localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(limited));
        renderRecentUploadsPanel();
        setStatus(`✅ Cache atualizado (${limited.length} arquivos)`);
        
    } catch (error) {
        console.error('❌ Erro ao atualizar cache:', error);
        setStatus('❌ Erro ao atualizar cache');
    }
}

// Helper para tempo
function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `${minutes} min atrás`;
    if (hours < 24) return `${hours} h atrás`;
    if (days < 7) return `${days} dia${days > 1 ? 's' : ''} atrás`;
    return new Date(timestamp).toLocaleDateString('pt-BR');
}

/* ========================
   INICIALIZAÇÃO DO CACHE
   ======================== */

// Inicializar sistema
async function initializeCacheSystem() {
    console.log('🚀 Iniciando sistema de cache...');
    setupAutoSave();
    
    setTimeout(async () => {
        const loadedFromProcessedCache = await loadProcessedMapData();
        if (loadedFromProcessedCache) {
            console.log('✅ Mapa carregado do cache de dados processados.');
            return; // Exit if successfully loaded from processed cache
        }

        const loaded = await loadLastUploadAuto();
        if (!loaded) console.log('ℹ️ Nenhuma sessão anterior');
    }, 1000);
    
    setTimeout(() => {
        renderRecentUploadsPanel();
        refreshUploadsCache().catch(console.error);
    }, 2000);
    
    setInterval(() => {
        refreshUploadsCache().catch(console.error);
    }, 5 * 60 * 1000);
}

// Configurar salvamento automático
function setupAutoSave() {
    if (!map) return;
    
    let saveTimeout;
    function scheduleSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSessionState, 2000);
    }
    
    map.on('moveend', scheduleSave);
    map.on('zoomend', scheduleSave);
    map.on('layeradd', scheduleSave);
    map.on('layerremove', scheduleSave);
    
    window.addEventListener('beforeunload', saveSessionState);
}

/* ========================
   INTEGRAÇÃO COM SISTEMA EXISTENTE
   ======================== */

// Sistema de cidades
let _cities = [];

async function apiListCities() {
    try {
        const response = await timeoutFetch(`${API_CITIES}?action=list`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || 'Erro na API');
        _cities = data.data || [];
        return _cities;
    } catch (error) {
        console.error('❌ Erro ao listar cidades:', error);
        throw error;
    }
}

async function loadCityOnMap(id) {
    try {
        const city = _cities.find(c => c.id === id);
        if (!city) throw new Error('Cidade não encontrada');
        if (!city.file || !city.file.url) throw new Error('Cidade sem arquivo');
        
        setStatus(`📥 Carregando ${city.name}...`);
        showLoading(true, `Carregando ${city.name}`);

        window.currentCityId = id; // Set the current city ID

        // Always use the original KMZ/KML as processedUrl is not available
        console.log(`🐌 Carregando KMZ original para ${city.name}`);
        await loadOriginalKMZ(city);
        
        if (currentFile) {
            currentFile.textContent = `${city.file.name} (${city.name})`;
        }
        setStatus(`✅ ${city.name} carregada`);
        
    } catch (error) {
        console.error('❌ Erro ao carregar cidade:', error);
        setStatus(`❌ Erro: ${error.message}`);
        throw error;
    } finally {
        showLoading(false);
    }
}

// Helper for the original loading method (fallback)
async function loadOriginalKMZ(city) {
    const url = city.file.url;
    const isKmz = url.toLowerCase().endsWith('.kmz');
    const response = await timeoutFetch(url);
    if (!response.ok) throw new Error('Falha ao baixar arquivo original');

    if (isKmz) {
        const blob = await response.blob();
        const file = new File([blob], city.file.name, { type: 'application/vnd.google-earth.kmz' });
        await loadKMZ(file);
    } else {
        const text = await response.text();
        await parseKML(text, city.name);
    }
}

// New function to render the map from pre-processed JSON
async function renderFromProcessed(data, cityHint = "") {
  const groupBounds = {};
  const boundsLines = L.latLngBounds();
  const MIN_START_ZOOM = 12;

  showLoading(true, `Renderizando mapa otimizado de ${cityHint || "sua cidade"}…`);

  try {
    if (!data || !data.lines || !data.markers) {
        throw new Error("Formato de dados processados inválido");
    }

    if (published) { try { map.removeLayer(published); } catch {} }
    resetGroups();

    published = L.layerGroup().addTo(map);
    localIndex.points = [];
    localIndex.groups = [];
    stats = { markers: 0, lines: 0, polygons: 0 };

    if (hasCluster) {
      lod.keysContainer = L.markerClusterGroup({
        chunkedLoading: true,
        disableClusteringAtZoom: Z_MARKERS_ON + 2,
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false
      });
    } else {
      lod.keysRawGroup = L.layerGroup();
      lod.keysContainer = lod.keysRawGroup;
    }
    lod.keysContainer.addTo(map);
    lod.keysVisible = true;
    lod.blockMarkersUntilZoom = false;

    // Render Lines
    for (const line of data.lines) {
      const grp = line.group;
      if (!groups[grp]) {
        groups[grp] = L.layerGroup();
        published.addLayer(groups[grp]);
        order.push(grp);
      }
      const color = line.color; // Use the saved color
      const poly = makeLODPolylineFromData(line.lods, { color, weight: LINE_BASE_W, opacity: 0.95 }, grp);
      
      attachLineTooltip(poly, grp);
      groups[grp].addLayer(poly);

      const gb = (groupBounds[grp] ??= L.latLngBounds());
      if(line.lods.fine && line.lods.fine.length > 0) {
        line.lods.fine.forEach(([lt, lg]) => { gb.extend([lt, lg]); boundsLines.extend([lt, lg]); });
      }
      stats.lines++;
    }

    // Render Markers
    for (const markerData of data.markers) {
      const [lat, lng] = markerData.coords;
      const gName = markerData.group;
      const color = POST_COLORS[gName] || POST_COLORS.OUTROS;

      if (!postGroups[gName]) { 
        postGroups[gName] = L.layerGroup(); // Correct: Initialize as L.layerGroup()
        published.addLayer(postGroups[gName]); // Add the layer group to the map
        postOrder.push(gName); 
      }

      const label = `<b>${markerData.name}</b>`;
      const extra = `<br><small>Alim:</small> <b>${markerData.extra.Alim || "—"}</b>`
                  + (markerData.extra.Potência ? `<br><small>Potência:</small> <b>${markerData.extra.Potência}</b>` : ``);

      const marker = makePostMarker(lat, lng, color, label, extra);
      marker.setGroupName(markerData.extra.Alim);

      allPostMarkers.push({ m: marker, lat, lng, text: markerData.name });
      postGroups[gName].addLayer(marker); // Correct: Add marker to the layer group
      stats.markers++;
    }
    
    if (allPostMarkers.length > 0) {
        lod.keysContainer.addLayers(allPostMarkers.map(p => p.m));
    }

    Object.entries(groupBounds).forEach(([name, bbox]) => {
      localIndex.groups.push({ name, lat: bbox.getCenter().lat, lon: bbox.getCenter().lng, bbox });
    });

    renderLayersPanelLines();
    renderLayersPanelPosts();
    refreshCounters();

    if (boundsLines.isValid()) {
      map.fitBounds(boundsLines, { padding: [48, 48] });
      if (map.getZoom() < MIN_START_ZOOM) map.setZoom(MIN_START_ZOOM);
    }

    updateLOD();
    updatePostLabels();
    setStatus(`✅ Mapa otimizado carregado: ${stats.markers} postos, ${stats.lines} linhas`);

  } catch (e) {
    console.error(e);
    setStatus("❌ Erro ao renderizar mapa otimizado: " + e.message);
    throw e;
  } finally {
    showLoading(false);
  }
}

/* ========================
   CÓDIGO ORIGINAL (CONTINUAÇÃO)
   ======================== */

const LS_KEYCODES = 'gv_keycodes_v1';
const LS_PREFIXSEQ = 'gv_prefix_seq_v1';
const keycodes = JSON.parse(localStorage.getItem(LS_KEYCODES) || '{}');
const prefixSeq = JSON.parse(localStorage.getItem(LS_PREFIXSEQ) || '{}');

const localIndex = {
  points: [],
  groups: []
};

function saveCodes() {
  localStorage.setItem(LS_KEYCODES, JSON.stringify(keycodes));
  localStorage.setItem(LS_PREFIXSEQ, JSON.stringify(prefixSeq));
}

function stripAccents(s='') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cityToPrefix(city='') {
  const map = { 
    'Belo Horizonte':'BHZ',
    'São Paulo':'SAO',
    'Rio De Janeiro':'RIO',
    'Porto Alegre':'POA',
    'Belo Horizonte - Mg':'BHZ' 
  };
  const cTitle = (city||'').trim();
  if (map[cTitle]) return map[cTitle];
  const clean = stripAccents(cTitle).replace(/[^A-Za-z ]/g,'').trim();
  if (!clean) return 'GEN';
  const words = clean.split(/\s+/).filter(Boolean);
  let base = words[0] || clean;
  if (/^(Sao|Santo|Santa|Santana|Vila|Vila\/|Bom|Nova)$/i.test(base) && words[1]) base = words[1];
  return base.slice(0,3).toUpperCase();
}

const FEED_RE = /\b([A-Z]{2,6})\s*[-_:.\s]*0*([0-9]{1,4})\b/i;
function pad2(n){ return String(n).padStart(2,'0'); }
function extractFeedFromText(txt) {
  if (!txt) return null;
  const m = String(txt).toUpperCase().match(FEED_RE);
  return m ? `${m[1]}${pad2(+m[2])}` : null;
}

function detectPrefixFromTree(pm) {
  const n = pm.querySelector("name")?.textContent;
  let code = extractFeedFromText(n);
  if (code) return code.replace(/\d+$/, "");
  for (const d of pm.querySelectorAll("ExtendedData Data")) {
    const v = d.querySelector("value")?.textContent;
    code = extractFeedFromText(v);
    if (code) return code.replace(/\d+$/, "");
  }
  let node = pm.parentElement;
  while (node) {
    if (node.tagName === 'Folder' || node.tagName === 'Document') {
      const name = node.querySelector(":scope > name")?.textContent;
      const code = extractFeedFromText(name);
      if (code) return code.replace(/\d+$/, "");
    }
    node = node.parentElement;
  }
  return null;
}

function prefixFromFilename(filename = "") {
  const base = filename.split("/").pop().replace(/\.[^.]+$/, "");
  const clean = base.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z ]/g,'').trim();
  if (!clean) return "GEN";
  const first = clean.split(/\s+/)[0] || clean;
  return first.slice(0,3).toUpperCase();
}

function getAlim(pm) {
  for (const d of pm.querySelectorAll("ExtendedData Data")) {
    const key = (d.getAttribute("name") || "").toLowerCase();
    const val = d.querySelector("value")?.textContent?.trim();
    if (key.includes("alimentador") && val) {
      const code = extractFeedFromText(val);
      return code || val.toUpperCase();
    }
  }
  const folder = pm.closest("Folder");
  const fname = folder?.querySelector(":scope > name")?.textContent?.trim();
  if (fname) {
    const code = extractFeedFromText(fname);
    return code || fname.toUpperCase();
  }
  const s = pm.querySelector("styleUrl")?.textContent?.replace("#","").trim();
  if (s) {
    const code = extractFeedFromText(s);
    return code || s.toUpperCase();
  }
  return null;
}

function findFeedCodeInPlacemark(pm) {
  const byName = extractFeedFromText(pm.querySelector("name")?.textContent);
  if (byName) return byName;
  for (const d of pm.querySelectorAll("ExtendedData Data")) {
    const v = d.querySelector("value")?.textContent;
    const byExt = extractFeedFromText(v);
    if (byExt) return byExt;
  }
  let node = pm.parentElement;
  while (node) {
    if (node.tagName === 'Folder' || node.tagName === 'Document') {
      const name = node.querySelector(":scope > name")?.textContent;
      const byFolder = extractFeedFromText(name);
      if (byFolder) return byFolder;
    }
    node = node.parentElement;
  }
  return null;
}

function decideGroupForGeometry(pm, centroidLatLngOrNull, keyIndex) {
  const explicit = findFeedCodeInPlacemark(pm);
  if (explicit) return explicit;
  const alim = getAlim(pm);
  const asCode = extractFeedFromText(alim);
  if (asCode) return asCode;
  if (centroidLatLngOrNull && keyIndex?.length) {
    const near = nearestARA(keyIndex, centroidLatLngOrNull);
    if (near.code) return near.code;
  }
  return alim || "AUTO";
}

function getOrCreateKeyCodeAuto(pm, lat, lng, filenameHint = "") {
  const feed = findFeedCodeInPlacemark(pm) || extractFeedFromText(getAlim(pm));
  const prefix = feed ? feed.replace(/\d+$/, "") 
                      : (detectPrefixFromTree(pm) || prefixFromFilename(filenameHint) || "GEN");
  const key = `${prefix}:${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (keycodes[key]) return keycodes[key];
  const next = (prefixSeq[prefix] || 0) + 1;
  prefixSeq[prefix] = next;
  const code = `${prefix}${String(next).padStart(2,'0')}`;
  keycodes[key] = code;
  saveCodes();
  return code;
}

const DEFAULT_LOGO = "assets/img/image.png";
(() => {
  const src = localStorage.getItem("geoviewer-logo") || DEFAULT_LOGO;
  $("#brandLogo") && ($("#brandLogo").src = src);
  $("#brandLogoTop") && ($("#brandLogoTop").src = src);
  $("#loadingLogo") && ($("#loadingLogo").src = src);
  $("#favicon") && ($("#favicon").href = src);
})();

const themeBtn = $("#themeToggle");
(() => {
  const saved = localStorage.getItem("geoviewer-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  themeBtn?.setAttribute("aria-pressed", saved === "dark" ? "true" : "false");
})();
themeBtn?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("geoviewer-theme", next);
  themeBtn?.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
});

const dlg = $("#shortcutsDialog");
$("#openShortcuts")?.addEventListener("click", () => dlg?.showModal());
$("#closeShortcuts")?.addEventListener("click", () => dlg?.close());
$("#okShortcuts")?.addEventListener("click", () => dlg?.close());

const sidebar = $(".sidebar");
$("#openSidebar")?.addEventListener("click", () => {
  if (!sidebar) return;
  sidebar.classList.add("open");
  document.body.classList.add("sidebar-open");
});
$("#closeSidebar")?.addEventListener("click", () => {
  if (!sidebar) return;
  sidebar.classList.remove("open");
  document.body.classList.remove("sidebar-open");
});
document.addEventListener("click", (e) => {
  if (!sidebar) return;
  if (sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) &&
      !$("#openSidebar")?.contains(e.target) &&
      window.innerWidth <= 768) {
    sidebar.classList.remove("open");
    document.body.classList.remove("sidebar-open");
  }
});

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Tolerances for the LOD pipeline, in increasing order of aggression.
const LOD_TOLS = {
    fine:   IS_MOBILE ? 15.0 : 8.0,
    mid:    IS_MOBILE ? 30.0 : 15.0,
    coarse: IS_MOBILE ? 60.0 : 35.0
};

const MAX_POINTS_PER_GEOM = 800;
const MIN_SKIP_M     = 2.0;

function toMetersProj(lat0){
  const R = 6371000, toRad = d=>d*Math.PI/180, c0 = Math.cos(toRad(lat0));
  return (lat,lng)=>({ x: R*toRad(lng)*c0, y: R*toRad(lat) });
}
function rdpsSimplify(pointsXY, tol){
  const tol2 = tol*tol;
  const keep = new Uint8Array(pointsXY.length);
  const stack = [[0, pointsXY.length-1]];
  keep[0]=keep[keep.length-1]=1;
  function segDist2(p,a,b){
    const vx=b.x-a.x, vy=b.y-a.y;
    const wx=p.x-a.x, wy=p.y-a.y;
    const c1= vx*wx+vy*wy;
    if (c1<=0) return (wx*wx+wy*wy);
    const c2= vx*vx+vy*vy;
    if (c2<=c1){ const dx=p.x-b.x, dy=p.y-b.y; return dx*dx+dy*dy; }
    const t=c1/c2; const px=a.x+t*vx, py=a.y+t*vy;
    const dx=p.x-px, dy=p.y-py; return dx*dx+dy*dy;
  }
  while(stack.length){
    const [i,j] = stack.pop();
    let maxD2=-1, idx=-1;
    for(let k=i+1;k<j;k++){
      const d2 = segDist2(pointsXY[k], pointsXY[i], pointsXY[j]);
      if (d2>maxD2){ maxD2=d2; idx=k; }
    }
    if (maxD2>tol2 && idx>0){
      keep[idx]=1;
      stack.push([i,idx],[idx,j]);
    }
  }
  const outIdx=[];
  for(let k=0;k<keep.length;k++) if (keep[k]) outIdx.push(k);
  return outIdx;
}
function simplifyPathMeters(coords, tolM = LOD_TOLS.fine){
  if (!coords || coords.length <= 2) return coords || [];
  const out = [];
  let last = coords[0];
  out.push(last);
  const proj = toMetersProj(coords[0][0]);
  let lastXY = proj(last[0], last[1]);
  for (let i=1;i<coords.length;i++){
    const c = coords[i];
    const xy = proj(c[0], c[1]);
    const dx = xy.x - lastXY.x, dy = xy.y - lastXY.y;
    if (dx*dx + dy*dy >= MIN_SKIP_M*MIN_SKIP_M){
      out.push(c); last = c; lastXY = xy;
    }
  }
  if (out.length<=2) return out;
  const ptsXY = out.map(c => proj(c[0], c[1]));
  const keepIdx = rdpsSimplify(ptsXY, tolM);
  let simp = keepIdx.map(i => out[i]);
  if (simp.length > MAX_POINTS_PER_GEOM){
    const step = Math.ceil(simp.length / MAX_POINTS_PER_GEOM);
    const slim = [];
    for (let i=0;i<simp.length;i+=step) slim.push(simp[i]);
    if (slim[slim.length-1] !== simp[simp.length-1]) slim.push(simp[simp.length-1]);
    simp = slim;
  }
  return simp;
}

function buildSimpLevels(coords){
  const fine = simplifyPathMeters(coords, LOD_TOLS.fine);
  const mid  = simplifyPathMeters(fine,  LOD_TOLS.mid);
  const coarse = simplifyPathMeters(mid, LOD_TOLS.coarse);
  return { coarse, mid, fine };
}
function makeLODPolyline(coords, style, grpLabel){
  const levels = buildSimpLevels(coords);
  const poly = L.polyline(levels.coarse, {
    ...style,
    smoothFactor: 3,
    noClip: true,
    updateWhenZooming: false,
    renderer: fastRenderer
  });
  poly.__label = grpLabel || '';
  poly.__levels = levels;
  poly.__lodApplied = 'coarse';
  return poly;
}

// New function to create a polyline from pre-calculated LOD data
function makeLODPolylineFromData(lods, style, grpLabel){
  const poly = L.polyline(lods.coarse, { // Use lods.coarse directly
    ...style,
    smoothFactor: 3,
    noClip: true,
    updateWhenZooming: false,
    renderer: fastRenderer
  });
  poly.__label = grpLabel || '';
  poly.__levels = lods; // Use lods directly
  poly.__lodApplied = 'coarse';
  return poly;
}
function pickLevelForZoom(z){
  if (z < 13) return 'coarse';
  if (z < 15) return 'mid';
  return 'fine';
}
function nextIdle(){
  return new Promise(res => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => res(), { timeout: 32 });
    } else {
      requestAnimationFrame(() => res());
    }
  });
}

const fastRenderer = L.canvas({ padding: 0.1 });

const map = L.map("map", {
  center: [-21.7947, -48.1780],
  zoom: 12,
  zoomControl: false,
  worldCopyJump: true,
  preferCanvas: true,
  zoomAnimation: false,
  markerZoomAnimation: false,
  fadeAnimation: false
});

function makeBaseController(map){
  if(!map.getPane('labels')){
    map.createPane('labels');
    const p = map.getPane('labels');
    p.style.zIndex = 650;
    p.style.pointerEvents = 'none';
  }

  const bases = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19, updateWhenZooming: false, updateWhenIdle: true, keepBuffer: 0
    }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri, Maxar', maxZoom: 19, updateWhenZooming: false, updateWhenIdle: true, keepBuffer: 0
    }),
    terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap', maxZoom: 17, updateWhenZooming: false, updateWhenIdle: true, keepBuffer: 0
    })
  };

  const labels = {
    cartoLight: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
      pane: 'labels', maxZoom: 20, opacity: 1, attribution: '© CARTO'
    }),
    esriTrans: L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{x}/{y}', {
      pane: 'labels', maxZoom: 19, opacity: 1, attribution: '© Esri'
    }),
    esriPlaces: L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{x}/{y}', {
      pane: 'labels', maxZoom: 19, opacity: 1, attribution: '© Esri'
    })
  };

  let baseCur = 'osm';
  bases.osm.addTo(map);

  function enableSatLabels(on){
    const want = !!on;
    const hasL = map.hasLayer(labels.cartoLight);
    const hasT = map.hasLayer(labels.esriTrans);
    const hasP = map.hasLayer(labels.esriPlaces);
    if (want){
      if (!hasL) labels.cartoLight.addTo(map);
      if (!hasT) labels.esriTrans.addTo(map);
      if (!hasP) labels.esriPlaces.addTo(map);
    } else {
      if (hasL) map.removeLayer(labels.cartoLight);
      if (hasT) map.removeLayer(labels.esriTrans);
      if (hasP) map.removeLayer(labels.esriPlaces);
    }
  }

  function setBase(name){
    if (!bases[name] || name === baseCur) return;
    if (map.hasLayer(bases[baseCur])) map.removeLayer(bases[baseCur]);
    bases[name].addTo(map);
    enableSatLabels(name === 'sat');
    baseCur = name;
  }

  function wireButtons(){
    const bSat = document.getElementById('toggleSatellite');
    const bTer = document.getElementById('toggleTerrain');
    const bIn  = document.getElementById('zoomIn');
    const bOut = document.getElementById('zoomOut');
    const bLoc = document.getElementById('locateMe');

    bSat?.addEventListener('click', () => setBase(baseCur !== 'sat' ? 'sat' : 'osm'));
    bTer?.addEventListener('click', () => setBase(baseCur !== 'terrain' ? 'terrain' : 'osm'));
    bIn?.addEventListener('click',  () => map.zoomIn());
    bOut?.addEventListener('click', () => map.zoomOut());
    bLoc?.addEventListener('click', () => { window.locateOnceAnimated(); }); // Call global function
  }

  return { setBase, wireButtons, get current(){ return baseCur; }, bases, labels };
}

const baseCtl = makeBaseController(map);
baseCtl.wireButtons();

const searchForm  = $("#searchForm");
const searchInput = $("#searchInput");
const searchBtn   = $("#searchBtn");
if (searchBtn) searchBtn.type = "button";

let searchResults = document.getElementById("searchResults");
if (!searchResults) {
  searchResults = document.createElement("div");
  searchResults.id = "searchResults";
  document.body.appendChild(searchResults);
}
searchResults.className = "search-results";
searchResults.style.position = "fixed";
searchResults.style.maxHeight = "320px";
searchResults.style.overflowY = "auto";
searchResults.style.display = "none";
searchResults.style.zIndex = "9999";

const norm   = (q) => q.trim().replace(/\s+/g, " ");
const encode = (q) => encodeURIComponent(q);

function positionResults() {
  if (!searchInput || !searchResults) return;
  const r = searchInput.getBoundingClientRect();
  searchResults.style.left = `${r.left}px`;
  searchResults.style.top  = `${r.bottom + 4}px`;
  searchResults.style.width = `${r.width}px`;
}
window.addEventListener("resize", positionResults);
window.addEventListener("scroll", positionResults, true);

function showResults(on) {
  searchResults.style.display = on ? "block" : "none";
  if (on) positionResults();
}

const KEY_RE = /^([A-Z]{2,6})\s*[-_:.\s]*0*([0-9]{1,4})$/i;
function isKeyQuery(q) { return KEY_RE.test(q.trim()); }
function parseKey(q) {
  const m = q.trim().match(KEY_RE);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const num = String(+m[2]).padStart(2, "0");
  return `${prefix}${num}`;
}
function searchLocal(qRaw, limit = 20) {
  const q = qRaw.trim();
  const out = [];
  const seen = new Set();

  const isKey = KEY_RE.test(q);
  let keyNorm = null;
  if (isKey) {
    const m = q.match(KEY_RE);
    keyNorm = (m[1].toUpperCase() + String(+m[2]).padStart(2, "0"));
  }
  const qLower = q.toLowerCase();

  for (const p of (localIndex.points || [])) {
    const name = (p.name || "");
    const code = (p.code || "");
    const k = `${code}|${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`;
    if (seen.has(k)) continue;

    let ok = false, score = 0;

    if (isKey) {
      if (code === keyNorm) { ok = true; score += 100; }
      else if (code.startsWith(keyNorm)) { ok = true; score += 60; }
    } else {
      if (code.toLowerCase().startsWith(qLower)) { ok = true; score += 80; }
      else if (name.toLowerCase().includes(qLower)) { ok = true; score += 40; }
      else if (code.toLowerCase().includes(qLower)) { ok = true; score += 20; }
    }

    if (ok) {
      seen.add(k);
      out.push({ kind: "point", icon: "📍", name: code || name, desc: name && code ? name : "", lat: p.lat, lon: p.lon, _score: score });
      if (out.length >= limit) break;
    }
  }

  for (const g of (localIndex.groups || [])) {
    if (g.name && g.name.toLowerCase().includes(qLower)) {
      const k = `G|${g.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ kind: "group", icon: "🗂️", name: g.name, desc: "Grupo/Alimentador", lat: g.lat, lon: g.lon, bbox: g.bbox, _score: 10 });
    }
  }

  out.sort((a,b)=> (b._score||0) - (a._score||0));
  return out;
}

function flyToLocal(item) {
  if (item.kind === "group" && item.bbox) {
    map.fitBounds(item.bbox, { padding: [48, 48] });
    setStatus(`🗂️ Grupo: ${item.name}`);
    showResults(false);
    return;
  }
  const z = Math.max(map.getZoom(), 15);
  map.flyTo([item.lat, item.lon], z, { duration: 0.9 });
  const temp = L.circleMarker([item.lat, item.lon], {
    radius: 8, color: "#111", weight: 2, fillColor: "#4dabf7", fillOpacity: 1, renderer: fastRenderer
  }).addTo(map);
  temp.bindPopup(
    `<div style="min-width:220px"><b>${item.name}</b>${item.desc ? `<br><small>${item.desc}</small>` : ""}<br><small>Lat: ${item.lat.toFixed(6)}, Lon: ${item.lon.toFixed(6)}</small></div>`
  ).openPopup();
  setTimeout(() => map.removeLayer(temp), 15000);
  setStatus(`📍 ${item.name}`);
  showResults(false);
  searchResults.innerHTML = "";
  if (searchInput) searchInput.value = "";
}
function renderResults(items) {
  if (!searchResults) return;
  searchResults.innerHTML = "";
  if (!items.length) {
    searchResults.innerHTML = `<div class="search-item" style="opacity:.7;cursor:default">Nenhum resultado</div>`;
    showResults(true);
    return;
  }
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "search-item";
    div.style.cursor = "pointer";
    const icon = it.icon || (it.type?.includes("city") || it.type === "PPL" ? "🏙️" : "📍");
    const title = it.title || it.name;
    const subtitle = it.subtitle || it.desc || (it.name || "");
    div.innerHTML = `<b>${icon} ${title}</b>${subtitle ? `<br><small>${subtitle}</small>` : ""}`;
    div.addEventListener("click", () => {
      if (it.kind) flyToLocal(it); else flyToResult(it);
    });
    searchResults.appendChild(div);
  });
  showResults(true);
}

async function geocode(queryRaw) {
  const q = norm(queryRaw);
  if (!q) return [];
  const qEnc = encode(q);
  try {
    const r = await timeoutFetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${qEnc}&count=6&language=pt&format=json`,
      {}, 10000
    );
    if (r.ok) {
      const j = await r.json();
      const itemsOM = (j.results || []).map((it) => ({
        name: [it.name, it.admin1, it.country].filter(Boolean).join(", "),
        type: it.feature_code || "place",
        lat: it.latitude,
        lon: it.longitude,
        country_code: it.country_code || ""
      })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
      if (itemsOM.length) return itemsOM;
    }
  } catch {}
  try {
    const r2 = await timeoutFetch(
      `https://geocode.maps.co/search?q=${qEnc}&limit=6`, {}, 10000
    );
    if (r2.ok) {
      const j2 = await r2.json();
      const items = (j2 || []).map((it) => ({
        name: it.display_name || it.name || "Local",
        type: it.class || it.type || "place",
        lat: +it.lat,
        lon: +it.lon,
        country_code: (it.address && it.address.country_code) || ""
      })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
      if (items.length) return items;
    }
  } catch {}
  return [];
}
function rankResults(items) {
  if (!Array.isArray(items)) return [];
  const withScore = items.map((it, idx) => {
    let score = 0;
    const name = (it.name || "").toLowerCase();
    if ((it.country_code || "").toUpperCase() === "BR") score += 5;
    if (/brasil|brazil/.test(name)) score += 3;
    if (/^belo horizonte\b/i.test(it.name)) score += 2;
    return { it, score, idx };
  });
  withScore.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return withScore.map(x => x.it);
}
function flyToResult(it) {
  const z = it.type === "country" ? 6
          : it.type === "state"   ? 8
          : (it.type?.includes("city") || it.type === "PPL") ? 12 : 13;
  map.flyTo([it.lat, it.lon], z, { duration: 0.9 });
  const temp = L.marker([it.lat, it.lon], {
    icon: L.divIcon({ className: "", html: '<div style="font-size:28px">📍</div>', iconSize: [0, 0] })
  }).addTo(map);
  const main = String(it.name).split(",")[0];
  temp.bindPopup(
    `<div style="min-width:220px"><b>${main}</b><br><small>${it.name}</small><br><small>Lat: ${it.lat.toFixed(6)}, Lon: ${it.lon.toFixed(6)}</small></div>`
  ).openPopup();
  setTimeout(() => map.removeLayer(temp), 15000);
  setStatus(`📍 Local: ${main}`);
  showResults(false);
  searchResults.innerHTML = "";
  if (searchInput) searchInput.value = "";
}
async function handleSearch(e) {
  if (e) e.preventDefault();
  const q = (searchInput?.value || "").trim();
  if (!q || q.length < 2) { renderResults([]); return; }
  const local = searchLocal(q);
  if (local.length === 1) { flyToLocal(local[0]); return; }
  if (local.length > 1) { renderResults(local); setStatus(`Resultados no mapa para "${q}"`); return; }
  setStatus(`Buscando "${q}"…`);
  showLoading(true, "Buscando localização…");
  try {
    const remote = rankResults(await geocode(q));
    showLoading(false);
    if (remote.length === 1) { flyToResult(remote[0]); return; }
    renderResults(remote);
    setStatus(remote.length ? `Resultados para "${q}"` : `Nada encontrado para "${q}"`);
  } catch (err) {
    console.error("[search] erro:", err);
    showLoading(false);
    renderResults([]);
    setStatus("Erro ao buscar localização");
  }
}

searchForm?.addEventListener("submit", handleSearch);
searchBtn?.addEventListener("click", handleSearch);
searchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSearch(e); });

let _suggTimer = null;
searchInput?.addEventListener('input', () => {
  clearTimeout(_suggTimer);
  const q = (searchInput.value || '').trim();
  if (q.length < 2) { showResults(false); searchResults.innerHTML = ''; return; }
  _suggTimer = setTimeout(() => {
    const items = searchLocal(q, 12);
    renderResults(items);
  }, 120);
});

document.addEventListener("click", (e) => {
  const inside = searchResults.contains(e.target) ||
                 searchInput?.contains(e.target) ||
                 searchBtn?.contains(e.target);
  if (!inside) {
    showResults(false);
    searchResults.innerHTML = "";
  }
});

/* ----------------- Publicação KML/KMZ ----------------- */
const fileInput = $("#fileInput"),
      dropZone = $("#dropZone"),
      currentFile = $("#currentFile");

const layersListLines = $("#layersList") || null;
const layersListPosts = $("#postsLayersList") || null;
const hideAllBtn = $("#hideAllLayers"),
      showAllBtn = $("#showAllLayers"),
      hideAllPostsBtn = $("#hideAllPosts"),
      showAllPostsBtn = $("#showAllPosts");

const palette = [
  "#1976d2","#4dabf7","#51cf66","#f59f00","#845ef7",
  "#22b8cf","#e8590c","#a9e34b","#ff8787","#2f9e44",
  "#f783ac","#20c997","#ffa94d","#94d82d","#66d9e8",
  "#748ffc","#e599f7","#12b886","#e67700","#5c7cfa",
];
const POST_COLORS = { "FU": "#e03131", "FA": "#4f3b09", "RE": "#2f9e44", "KVA":"#845ef7", "OUTROS": "#868e96" };

const groups = {}, colors = {}, order = [];
const postGroups = {}, postOrder = [];
let pIdx = 0;
let published = null, stats = { markers: 0, lines: 0, polygons: 0 };
let routeLayer = null;

const lod = { keysContainer: null, keysRawGroup: null, keysVisible: false, blockMarkersUntilZoom: false }; // CORREÇÃO: blockMarkersUntilZoom começa como false
const hasCluster = typeof L.markerClusterGroup === "function";

const highlight = { line:null, oldStyle:null, halo:null, markers:[] };
let allPostMarkers = [];

const nextColor = (n) => colors[n] ?? (colors[n] = palette[pIdx++ % palette.length]);
function resetGroups() {
  for (const name of Object.keys(groups)) {
    try { map.removeLayer(groups[name]); } catch {}
    delete groups[name];
  }
  for (const gname of Object.keys(postGroups)) {
    try { map.removeLayer(postGroups[gname]); } catch {}
    delete postGroups[gname];
  }
  if (lod.keysContainer) { try { map.removeLayer(lod.keysContainer); } catch {} }
  if (lod.keysRawGroup)  { try { map.removeLayer(lod.keysRawGroup);  } catch {} }
  lod.keysContainer = null;
  lod.keysRawGroup  = null;
  lod.keysVisible   = false;
  lod.blockMarkersUntilZoom = false; // CORREÇÃO: Sempre false

  Object.keys(colors).forEach(k => delete colors[k]);
  order.length = 0;
  postOrder.length = 0;
  pIdx = 0;
  allPostMarkers = [];

  clearEmphasis();
  
  // Força re-render dos painéis
  setTimeout(() => {
    renderLayersPanelLines();
    renderLayersPanelPosts();
  }, 100);
}

function refreshCounters() {
  $("#markerCount") && ($("#markerCount").textContent = stats.markers);
  $("#lineCount") && ($("#lineCount").textContent = stats.lines);
  $("#polygonCount") && ($("#polygonCount").textContent = stats.polygons);
}

function renderLayersPanelLines() {
  if (!layersListLines) return;
  layersListLines.innerHTML = "";
  if (!order.length) {
    layersListLines.innerHTML = `<div class="empty"><div class="empty-ico">🗂️</div><p>Nenhuma camada carregada</p></div>`;
    return;
  }
  order.forEach((name) => {
    const color = colors[name];
    const row = document.createElement("label");
    row.className = "layer-item";
    
    // Verifica se a camada está atualmente no mapa
    const isCurrentlyVisible = groups[name] && map.hasLayer(groups[name]);
    
    row.innerHTML = `<input type="checkbox" ${isCurrentlyVisible ? 'checked' : ''} data-af="${name}"><span class="layer-color" style="background:${color}"></span><span class="layer-name">${name}</span>`;
    const cb = row.querySelector("input");
    cb.onchange = () => {
      if (cb.checked) {
        groups[name].addTo(map);
      } else {
        if (highlight.line && groups[name]?.hasLayer?.(highlight.line)) clearEmphasis();
        groups[name].eachLayer(l => l.unbindTooltip?.());
        map.removeLayer(groups[name]);
      }
    };
    layersListLines.appendChild(row);
  });
}

function renderLayersPanelPosts() {
  if (!layersListPosts) return;
  layersListPosts.innerHTML = "";
  if (!postOrder.length) {
    layersListPosts.innerHTML = `<div class="empty"><div class="empty-ico">📍</div><p>Nenhum posto</p></div>`;
    return;
  }
  
  postOrder.forEach((gname) => {
    const color = POST_COLORS[gname] || POST_COLORS.OUTROS;
    const row = document.createElement("label");
    row.className = "layer-item";
    
    // POR PADRÃO, TODOS OS GRUPOS DEVEM ESTAR SELECIONADOS
    // Garante que a camada está no mapa
    if (postGroups[gname] && !map.hasLayer(postGroups[gname])) {
      postGroups[gname].addTo(map);
    }
    
    row.innerHTML = `
      <input type="checkbox" checked data-pg="${gname}">
      <span class="layer-color" style="background:${color}"></span>
      <span class="layer-name">${gname}</span>
    `;
    
    const cb = row.querySelector("input");
    cb.onchange = () => {
      if (cb.checked) {
        // Adiciona ao mapa se não estiver já
        if (postGroups[gname] && !map.hasLayer(postGroups[gname])) {
          postGroups[gname].addTo(map);
        }
        // CORREÇÃO: Garante que o container de markers também seja mostrado
        if (lod.keysContainer && !map.hasLayer(lod.keysContainer)) {
          map.addLayer(lod.keysContainer);
          lod.keysVisible = true;
        }
      } else {
        // Remove do mapa se estiver presente
        if (postGroups[gname] && map.hasLayer(postGroups[gname])) {
          map.removeLayer(postGroups[gname]);
        }
      }
    };
    
    layersListPosts.appendChild(row);
  });
}

function parseCoordBlock(txt) {
  if (!txt) return [];
  return txt.trim().replace(/\s+/g, " ").split(" ").map((p) => {
    const [lngS, latS] = p.split(",");
    const lat = parseFloat(latS), lng = parseFloat(lngS);
    return isNaN(lat) || isNaN(lng) ? null : [lat, lng];
  }).filter(Boolean);
}
function getPotencia(pm) {
  for (const d of pm.querySelectorAll("ExtendedData Data")) {
    const k = (d.getAttribute("name") || "").toLowerCase();
    if (k.includes("kva") || k.includes("pot") || k.includes("potencia")) {
      const v = d.querySelector("value")?.textContent?.trim();
      if (v) return v.replace(/kva$/i, "kVA");
    }
  }
  return null;
}
function postoGroupByName(rawName, pm) {
  const n = (rawName || '').toUpperCase();
  if (/-FU\b/.test(n)) return 'FU';
  if (/-FA\b/.test(n)) return 'FA';
  if (/-RE\b/.test(n)) return 'RE';
  const pot = getPotencia(pm);
  if (pot) return 'KVA';
  return 'OUTROS';
}

function openGoogleMapsApp(lat, lng) {
  const dest = `${lat},${lng}`;
  const ios = `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
  const android = `google.navigation:q=${dest}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  setTimeout(() => { location.href = web; }, 250);
  if (isIOS) location.href = ios;
  else if (isAndroid) location.href = android;
  else location.href = web;
}

function haversine(a, b){
  const R = 6371000;
  const toRad = (x)=> x*Math.PI/180;
  const dLat = toRad(b.lat-a.lat);
  const dLng = toRad(b.lng-a.lng);
  const s1 = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s1));
}
function centroidLatLng(coords){
  let lat=0, lng=0, n=coords.length;
  coords.forEach(([lt,lg])=>{ lat+=lt; lng+=lg; });
  return { lat: lat/n, lng: lng/n };
}
function nearestARA(keysArr, pt){
  let best = null, bd = Infinity;
  for(const k of keysArr){
    const d = haversine(pt, {lat:k.lat, lng:k.lng});
    if (d < bd){ bd = d; best = k.code; }
  }
  return { code: best, dist: bd };
}

function distPointToSegmentMeters(P, A, B){
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const lat0 = toRad(P.lat);
  const x = (lng, lat) => R * toRad(lng) * Math.cos(lat0);
  const y = (lat)        => R * toRad(lat);
  const ax = x(A.lng, A.lat) - x(P.lng, P.lat);
  const ay = y(A.lat) - y(P.lat);
  const bx = x(B.lng, B.lat) - x(P.lng, P.lat);
  const by = y(B.lat) - y(P.lat);
  const vx = bx - ax, vy = by - ay;
  const c1 = -(ax*vx + ay*vy);
  if (c1 <= 0) return Math.hypot(ax, ay);
  const c2 = vx*vx + vy*vy;
  if (c2 <= c1) return Math.hypot(bx, by);
  const t = c1 / c2;
  const px = ax + t*vx, py = ay + t*vy;
  return Math.hypot(px, py);
}
function minDistToPolylineMeters(latlng, poly){
  const ll = poly.getLatLngs();
  const pts = Array.isArray(ll[0]) ? ll.flat() : ll;
  let min = Infinity;
  for (let i=0; i<pts.length-1; i++){
    const d = distPointToSegmentMeters(
      {lat: latlng.lat, lng: latlng.lng},
      {lat: pts[i].lat,   lng: pts[i].lng},
      {lat: pts[i+1].lat, lng: pts[i+1].lng}
    );
    if (d < min) min = d;
  }
  return min;
}
function bufferForZoomMeters(z){
  return Math.max(35, 250 * Math.pow(0.75, (z - 12)));
}

function normalizeGroupName(txt){
  if (!txt) return null;
  const code = extractFeedFromText(String(txt).toUpperCase());
  return code || String(txt).toUpperCase().trim();
}

function nearestPolylineInGroup(groupLayer, lat, lng){
  if (!groupLayer) return null;
  let best = null, bestD = Infinity;
  groupLayer.eachLayer(l => {
    if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
      const d = minDistToPolylineMeters({ lat, lng }, l);
      if (d < bestD) { bestD = d; best = l; }
    }
  });
  return best;
}

function nearestPolylineGlobal(lat, lng){
  let best = null, bestD = Infinity;
  for (const gName of Object.keys(groups)) {
    const l = nearestPolylineInGroup(groups[gName], lat, lng);
    if (l) {
      const d = minDistToPolylineMeters({ lat, lng }, l);
      if (d < bestD) { bestD = d; best = l; }
    }
  }
  return best;
}

function emphasizeNearestLineFor(groupName, lat, lng){
  const grp = groupName ? groups[normalizeGroupName(groupName)] : null;
  let target = null;
  if (grp) target = nearestPolylineInGroup(grp, lat, lng);
  if (!target) target = nearestPolylineGlobal(lat, lng);
  if (target) emphasizePolyline(target);
}

function guessGroupForPoint(pm, lat, lng, fallbackAlim){
  const explicit = findFeedCodeInPlacemark(pm);
  if (explicit) return explicit;
  const asCode = extractFeedFromText(fallbackAlim);
  if (asCode) return asCode;
  const near = nearestPolylineGlobal(lat, lng);
  if (near && near.__label) return near.__label;
  return fallbackAlim || "—";
}

function makePostMarker(lat, lng, color, labelHtml, extraHtml = "") {
  const baseRadius = matchMedia?.('(pointer:coarse)').matches ? 7 : 5;
  const cm = L.circleMarker([lat, lng], {
    radius: baseRadius,
    stroke: true,
    weight: 2,
    color: "#fff",
    fillColor: color,
    fillOpacity: 1,
    renderer: fastRenderer,
    updateWhenZooming: false
  });
  cm.__groupName = null;
  cm.setGroupName = (g) => { cm.__groupName = normalizeGroupName(g); };
  cm.on("click", () => {
    cm.bindPopup(`
      <div style="padding:8px;min-width:230px">
        ${labelHtml}${extraHtml}
        <div style="margin-top:8px">
          <button class="btn primary js-gmaps">Abrir no Google Maps (rota)</button>
        </div>
        <small style="color:#999;display:block;margin-top:6px">
          Lat: ${lat.toFixed(6)}, Lon: ${lng.toFixed(6)}
        </small>
      </div>
    `).openPopup();
    cm.getPopup()?.getElement()
      ?.querySelector(".js-gmaps")
      ?.addEventListener("click", () => openGoogleMapsApp(lat, lng));
    emphasizeNearestLineFor(cm.__groupName, lat, lng);
  });
  return cm;
}

function updatePostLabels() {
  const canShow = map.getZoom() >= Z_POST_TEXT_ON;
  if (!canShow) {
    for (const it of allPostMarkers) {
      if (it._labelOn) { it.m.unbindTooltip(); it._labelOn = false; }
    }
    return;
  }
  const bbox = map.getBounds().pad(0.12);
  const used = new Set();
  let shown = 0;
  const toCell = (lat, lng) => {
    const p = map.latLngToContainerPoint([lat, lng]);
    const cx = Math.floor(p.x / LABEL_GRID_PX);
    const cy = Math.floor(p.y / LABEL_GRID_PX);
    return cx + ':' + cy;
  };
  const center = map.getCenter();
  const dist2 = (a,b)=> {
    const pa = map.latLngToContainerPoint([a.lat, a.lng]);
    const pb = map.latLngToContainerPoint([b.lat, b.lng]);
    const dx = pa.x - pb.x, dy = pa.y - pb.y;
    return dx*dx + dy*dy;
  };
  const items = allPostMarkers
    .filter(it => bbox.contains([it.lat, it.lng]))
    .sort((a,b)=> dist2(a, center) - dist2(b, center));
  for (const it of items) {
    if (shown >= MAX_POST_LABELS) break;
    const cell = toCell(it.lat, it.lng);
    if (used.has(cell)) {
      if (it._labelOn) { it.m.unbindTooltip(); it._labelOn = false; }
      continue;
    }
    used.add(cell);
    if (!it._labelOn) {
      it.m.bindTooltip(it.text, {
        permanent: true,
        direction: "bottom",
        offset: [0, 10],
        className: "post-inline-label"
      });
      it._labelOn = true;
    }
    shown++;
  }
  for (const it of allPostMarkers) {
    if (!bbox.contains([it.lat, it.lng])) {
      if (it._labelOn) { it.m.unbindTooltip(); it._labelOn = false; }
      continue;
    }
    const cell = toCell(it.lat, it.lng);
    if (!used.has(cell) && it._labelOn) {
      it.m.unbindTooltip(); it._labelOn = false;
    }
  }
}

function attachLineTooltip(poly, grpLabel) {
  poly.__label = grpLabel;
  const openLabel = () => {
    poly.bindTooltip(grpLabel, {
      direction: "center",
      className: "line-label",
      sticky: true
    }).openTooltip();
  };
  const closeLabel = () => poly.unbindTooltip();
  poly.on("mouseover", () => { if (map.getZoom() >= Z_LABELS_ON) openLabel(); });
  poly.on("mouseout",  closeLabel);
  poly.on("click", () => { openLabel(); emphasizePolyline(poly); });
  poly.on("touchstart", () => openLabel());
}

function updateLOD() {
  const z = map.getZoom();
  const canShowMarkers = (z >= Z_MARKERS_ON) && !lod.blockMarkersUntilZoom;

  // CORREÇÃO: SEMPRE MOSTRAR SE NÃO HÁ BLOQUEIO
  if (!lod.blockMarkersUntilZoom && lod.keysContainer && !lod.keysVisible) {
    map.addLayer(lod.keysContainer);
    lod.keysVisible = true;
  }

  const IS_TOUCH = matchMedia?.('(pointer:coarse)').matches;
  const TOUCH_BONUS = IS_TOUCH ? 1.5 : 0;
  const w = Math.min(LINE_MAX_W, LINE_BASE_W + TOUCH_BONUS + Math.max(0, z - 12) * 0.9);
  const targetLevel = (z < 13) ? 'coarse' : (z < 15 ? 'mid' : 'fine');

  Object.values(groups).forEach((g) => {
    g.eachLayer((l) => {
      if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
        if (l.__levels && l.__lodApplied !== targetLevel) {
          l.setLatLngs(l.__levels[targetLevel]);
          l.__lodApplied = targetLevel;
        }
        l.setStyle({ weight: w, opacity: 0.95 });
      }
    });
  });
}

function lineSignature(grp, coords) {
  const round5 = (n) => Math.round(n * 1e5) / 1e5;
  const sample = (arr, step = Math.ceil(arr.length / 8)) =>
    arr.filter((_, i) => i === 0 || i === arr.length - 1 || i % step === 0)
       .map(([lt, lg]) => `${round5(lt)},${round5(lg)}`).join(';');
  const s1 = `${grp}|${sample(coords)}`;
  const s2 = `${grp}|${sample([...coords].reverse())}`;
  return s1 < s2 ? s1 : s2;
}

let _labelsScheduled = false, _labelsTimer = null;
function scheduleUpdatePostLabels(){
  if (_labelsScheduled) return;
  _labelsScheduled = true;
  clearTimeout(_labelsTimer);
  _labelsTimer = setTimeout(() => {
    _labelsScheduled = false;
    updatePostLabels();
  }, 60);
}
map.on("zoomend", () => { updateLOD(); scheduleUpdatePostLabels(); });
map.on("moveend", scheduleUpdatePostLabels);
map.on("zoomstart", () => {
  for (const it of allPostMarkers) { if (it._labelOn) { it.m.unbindTooltip(); it._labelOn = false; } }
});

function clearEmphasis(){
  if (highlight.line && highlight.oldStyle){
    try {
      highlight.line.unbindTooltip();
      highlight.line.setStyle(highlight.oldStyle).bringToBack();
    } catch {}
  }
  if (highlight.halo){ try { map.removeLayer(highlight.halo); } catch {} }
  highlight.markers.forEach(({m, old})=>{
    try { m.setStyle(old).setRadius(old.radius || 5).bringToBack(); } catch {}
  });
  highlight.line = highlight.oldStyle = highlight.halo = null;
  highlight.markers = [];
}
function emphasizePolyline(poly){
  clearEmphasis();
  const cur = poly.options || {};
  highlight.oldStyle = { color: cur.color, weight: cur.weight, opacity: cur.opacity, smoothFactor: cur.smoothFactor };
  highlight.line = poly;
  const coords = poly.getLatLngs();
  highlight.halo = L.polyline(coords, {
    color: '#ffffff', weight: (cur.weight||3) + 10, opacity: 0.45, interactive: false, renderer: fastRenderer, updateWhenZooming: false
  }).addTo(map);
  poly.setStyle({ color: '#ffd43b', weight: (cur.weight||3) + 4, opacity: 1 }).bringToFront();
  if (poly.__label) {
    poly.bindTooltip(poly.__label, { direction: "center", className: "line-label", sticky: true }).openTooltip();
  }
  const THRESH_M = bufferForZoomMeters(map.getZoom());
  for (const it of allPostMarkers){
    const d = minDistToPolylineMeters({lat: it.lat, lng: it.lng}, poly);
    if (d <= THRESH_M){
      const old = { ...it.m.options, radius: it.m.options.radius };
      highlight.markers.push({ m: it.m, old });
      it.m.setStyle({ color:'#000', weight:3, fillOpacity: 1 })
          .setRadius(Math.max(8, (old.radius||5) + 3))
          .bringToFront();
    }
  }
}
map.on('click', (e)=>{
  if (!(e.originalEvent?.target?.closest?.('.leaflet-interactive'))) clearEmphasis();
});

/* ----------------- Parse e publicação do KML (lotes) ----------------- */
async function parseKML(text, cityHint = "") {
  const groupBounds = {};
  const totalBounds = L.latLngBounds();
  const MIN_START_ZOOM = 14;
  const seenLines = new Set();

  showLoading(true, `Carregando mapa elétrico de ${cityHint || "sua cidade"}…`);

  try {
    const xml = new DOMParser().parseFromString(text, "text/xml");
    if (xml.querySelector("parsererror")) throw new Error("XML inválido");

    if (published) { try { map.removeLayer(published); } catch {} }
    resetGroups();

    published = L.layerGroup().addTo(map);

    localIndex.points = [];
    localIndex.groups = [];
    stats = { markers: 0, lines: 0, polygons: 0 };

    // CORREÇÃO: SEMPRE ADICIONAR O CONTAINER AO MAPA - SEM CONDIÇÕES
    if (hasCluster) {
      lod.keysContainer = L.markerClusterGroup({
        chunkedLoading: true,
        disableClusteringAtZoom: Z_MARKERS_ON + 2,
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false
      });
      lod.keysContainer.addTo(map);
      lod.keysVisible = true;
    } else {
      lod.keysRawGroup = L.layerGroup();
      lod.keysContainer = lod.keysRawGroup;
      lod.keysContainer.addTo(map);
      lod.keysVisible = true;
    }
    lod.blockMarkersUntilZoom = false; // CORREÇÃO: SEMPRE FALSE

    const placemarks = Array.from(xml.querySelectorAll("Placemark"));
    if (!placemarks.length) throw new Error("Sem Placemark");

    const keyIndex = [];
    let lastYieldTime = performance.now();

    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];
      const rawName = pm.querySelector("name")?.textContent?.trim() || `Ponto`;
      const alim = getAlim(pm);

      const point = pm.querySelector(":scope > Point > coordinates");
      if (point) {
        const coords = parseCoordBlock(point.textContent);
        if (coords.length) {
          const [lat, lng] = coords[0];
          totalBounds.extend(coords[0]);
          const autoCode = getOrCreateKeyCodeAuto(pm, lat, lng, cityHint);
          localIndex.points.push({ name: rawName, code: autoCode, lat, lon: lng });
          keyIndex.push({ lat, lng, code: autoCode });
          const gName = postoGroupByName(rawName, pm);
          const color = POST_COLORS[gName] || POST_COLORS.OUTROS;
          if (!postGroups[gName]) {
            postGroups[gName] = L.layerGroup();
            postOrder.push(gName);
            postGroups[gName].addTo(map);
          }
          const pot = getPotencia(pm);
          const label = `<b>${rawName}</b>`;
          const alimDisplay = guessGroupForPoint(pm, lat, lng, alim);
          const extra = `<br><small>Alim:</small> <b>${alimDisplay || "—"}</b>`
                      + (pot ? `<br><small>Potência:</small> <b>${pot}</b>` : ``)
                      + `<br><small>Cód.:</small> <b>${autoCode}</b>`;
          const marker = makePostMarker(lat, lng, color, label, extra);
          marker.setGroupName(alimDisplay);
          allPostMarkers.push({ m: marker, lat, lng, text: rawName });
          lod.keysContainer.addLayer(marker);
          postGroups[gName].addLayer(marker);
          stats.markers++;
        }
      }

      const lineNodes = pm.querySelectorAll(":scope > LineString > coordinates, MultiGeometry LineString coordinates");
      if (lineNodes.length) {
        lineNodes.forEach(ls => {
          const coordsRaw = parseCoordBlock(ls.textContent);
          const coords = simplifyPathMeters(coordsRaw);
          if (coords.length > 1) {
            const ctr = centroidLatLng(coords);
            const grp = decideGroupForGeometry(pm, ctr, keyIndex);
            const sig = lineSignature(grp, coords);
            if (seenLines.has(sig)) return;
            seenLines.add(sig);
            if (!groups[grp]) {
              groups[grp] = L.layerGroup();
              published.addLayer(groups[grp]);
              order.push(grp);
            }
            const color = nextColor(grp);
            const poly = makeLODPolyline(coords, { color, weight: LINE_BASE_W, opacity: 0.95 }, grp);
            attachLineTooltip(poly, grp);
            groups[grp].addLayer(poly);
            const gb = (groupBounds[grp] ??= L.latLngBounds());
            coords.forEach(([lt, lg]) => { gb.extend([lt, lg]); totalBounds.extend([lt, lg]); });
            stats.lines++;
          }
        });
      }

      const polyNodes = pm.querySelectorAll(":scope > Polygon outerBoundaryIs coordinates, MultiGeometry Polygon outerBoundaryIs coordinates");
      if (polyNodes.length) {
        polyNodes.forEach(pg => {
          const ringRaw = parseCoordBlock(pg.textContent);
          const coords = simplifyPathMeters(ringRaw);
          if (coords.length > 2) {
            const ctr = centroidLatLng(coords);
            const grp = decideGroupForGeometry(pm, ctr, keyIndex);
            if (!groups[grp]) {
              groups[grp] = L.layerGroup();
              published.addLayer(groups[grp]);
              order.push(grp);
            }
            const color = nextColor(grp);
            const p = L.polygon(coords, {
              color, weight: 2.5, fillColor: color, fillOpacity: 0.25,
              updateWhenZooming: false, renderer: fastRenderer
            });
            groups[grp].addLayer(p);
            stats.polygons++;
            coords.forEach(([lt, lg]) => totalBounds.extend([lt, lg]));
          }
        });
      }

      const now = performance.now();
      if (now - lastYieldTime > 16) {
        const pct = Math.round((i / placemarks.length) * 100);
        showLoading(true, `Processando (${pct}%)…`);
        await nextIdle();
        lastYieldTime = now;
      }
    }

    Object.entries(groupBounds).forEach(([name, bbox]) => {
      localIndex.groups.push({ name, lat: bbox.getCenter().lat, lon: bbox.getCenter().lng, bbox });
    });

    renderLayersPanelLines();
    renderLayersPanelPosts();
    refreshCounters();

    if (totalBounds.isValid()) {
      const ne = totalBounds.getNorthEast();
      const sw = totalBounds.getSouthWest();
      const distance = ne.distanceTo(sw); // distance in meters

      // If all points are very close, don't zoom in too far.
      // Set a fixed zoom instead of fitting bounds.
      if (distance < 50) { 
        map.flyTo(totalBounds.getCenter(), 16, { duration: 0.8 }); // Use flyTo for a smooth animation
      } else {
        map.fitBounds(totalBounds, { padding: [48, 48] });
      }

      if (map.getZoom() < MIN_START_ZOOM) {
        map.setZoom(MIN_START_ZOOM);
      }
    }

    // CORREÇÃO: ATUALIZA LOD IMEDIATAMENTE, SEM ESPERAR ZOOM
    updateLOD();
    updatePostLabels();
    setStatus(`✅ Publicado: ${stats.markers} postos, ${stats.lines} linhas, ${stats.polygons} polígonos`);
    saveProcessedMapData();

  } catch (e) {
    console.error(e);
    setStatus("❌ Erro ao processar KML: " + e.message);
  } finally {
    showLoading(false);
  }
}

/* ----------------- KMZ loader ----------------- */
async function loadKMZ(file) {
  const cityHint = prettyCityFromFilename(file?.name || "");
  showLoading(true, `Carregando mapa elétrico de ${cityHint || "sua cidade"}…`);
  try {
    const zip = await JSZip.loadAsync(file);
    const entry = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml") && !n.startsWith("__MACOSX"));
    if (!entry) throw new Error("KML não encontrado no KMZ");
    const text = await zip.files[entry].async("text");
    await parseKML(text, cityHint);
  } catch (e) {
    console.error(e);
    setStatus("❌ Erro ao processar KMZ: " + e.message);
  } finally {
    showLoading(false);
  }
}

async function uploadAndLoadFile(file) {
  if (!file) return;

  currentFile && (currentFile.textContent = file.name);

  try {
    // Primeiro, faz o upload e aguarda a confirmação do servidor
    await handleFileUploadWithCache(file);

    // Após o upload, carrega o arquivo imediatamente no mapa
    const isKmz = file.name.toLowerCase().endsWith('.kmz');
    if (isKmz) {
      await loadKMZ(file);
    } else {
      const text = await file.text();
      const cityHint = prettyCityFromFilename(file.name);
      await parseKML(text, cityHint);
    }
  } catch (error) {
    console.error('Erro no upload e carregamento do arquivo:', error);
    setStatus('❌ Falha ao carregar o arquivo.');
  }
}

/* ----------------- Upload / Drag&Drop ----------------- */
fileInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  await uploadAndLoadFile(f);
});

if (dropZone && fileInput) {
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); })
  );
  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, () => dropZone.classList.add("drag-over"))
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, () => dropZone.classList.remove("drag-over"))
  );
  dropZone.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      // Atualiza o input de arquivo para consistência
      const dt = new DataTransfer();
      dt.items.add(f);
      fileInput.files = dt.files;
      // Chama a função principal de upload e carregamento
      await uploadAndLoadFile(f);
    }
  });
}

/* ----------------- Limpar / Ocultar/Exibir ----------------- */
$("#clearLayers")?.addEventListener("click", () => {
  if (published) { map.removeLayer(published); published = null; }
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  clearEmphasis();
  resetGroups();
  localIndex.points = [];
  localIndex.groups = [];
  renderLayersPanelLines();
  renderLayersPanelPosts();
  stats = { markers: 0, lines: 0, polygons: 0 };
  refreshCounters();
  currentFile && (currentFile.textContent = "Nada publicado ainda");
  setStatus("🗑️ Publicação limpa");
});

hideAllBtn?.addEventListener("click", () => {
  clearEmphasis();
  order.forEach((n) => {
    groups[n].eachLayer(l => l.unbindTooltip?.());
    map.removeLayer(groups[n]);
    const cb = layersListLines?.querySelector(`input[data-af="${n}"]`);
    if (cb) cb.checked = false;
  });
});
showAllBtn?.addEventListener("click", () => {
  order.forEach((n) => {
    if (!map.hasLayer(groups[n])) groups[n].addTo(map);
    const cb = layersListLines?.querySelector(`input[data-af="${n}"]`);
    if (cb) cb.checked = true;
  });
  updateLOD();
});

hideAllPostsBtn?.addEventListener("click", () => {
  postOrder.forEach((gname) => {
    if (postGroups[gname] && map.hasLayer(postGroups[gname])) {
      map.removeLayer(postGroups[gname]);
    }
    // Atualiza os checkboxes imediatamente
    const cb = layersListPosts?.querySelector(`input[data-pg="${gname}"]`);
    if (cb) cb.checked = false;
  });
  
  // Também remove o container de markers
  if (lod.keysContainer && map.hasLayer(lod.keysContainer)) {
    map.removeLayer(lod.keysContainer);
    lod.keysVisible = false;
  }
});

showAllPostsBtn?.addEventListener("click", () => {
  postOrder.forEach((gname) => {
    if (postGroups[gname] && !map.hasLayer(postGroups[gname])) {
      postGroups[gname].addTo(map);
    }
    // Atualiza os checkboxes imediatamente
    const cb = layersListPosts?.querySelector(`input[data-pg="${gname}"]`);
    if (cb) cb.checked = true;
  });
  
  // Garante que o container de markers também seja mostrado
  if (!lod.keysVisible && lod.keysContainer) {
    map.addLayer(lod.keysContainer);
    lod.keysVisible = true;
  }
});

/* ========================
   INICIALIZAÇÃO FINAL
   ======================== */

// Inicialização quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
  console.log('🏁 Inicializando sistema completo com cache...');
  
  // Aguarda o mapa estar pronto
  const checkMapReady = setInterval(() => {
    if (typeof map !== 'undefined' && map) {
      clearInterval(checkMapReady);
      
      // Inicia o sistema de cache
      initializeCacheSystem();
      
      // Carrega cidades
      apiListCities().catch(console.error);
      
      console.log('✅ Sistema de cache inicializado');
    }
  }, 100);
  
  // Timeout de segurança
  setTimeout(() => {
    clearInterval(checkMapReady);
    initializeCacheSystem().catch(console.error);
  }, 5000);
});

/* ----------------- Inicial ----------------- */
setStatus("Sistema pronto");

// Exportar funções para uso global
window.saveRecentUpload = saveRecentUpload;
window.getRecentUploads = getRecentUploads;
window.loadCachedUpload = loadCachedUpload;
window.clearUploadsCache = clearUploadsCache;
window.refreshUploadsCache = refreshUploadsCache;
window.loadLastUploadAuto = loadLastUploadAuto;

console.log('🔧 Sistema completo carregado');