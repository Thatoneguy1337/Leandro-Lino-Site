<?php
// api/cities.php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

// ======== Config ========
$ROOT = dirname(__DIR__);
$UPLOAD_DIR = $ROOT . '/uploads/cities';
$DB_JSON = $ROOT . '/uploads/cities/_index.json';
$CACHE_FILE = $ROOT . '/uploads/cities/_cache.json';
$MEMORY_CACHE_FILE = $ROOT . '/uploads/cities/_memory_cache.json'; // Cache super rápido
$CACHE_TTL = 3600; // 1 hora - cache mais longo
$BASE_URL = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
$SITE_ROOT = rtrim($BASE_URL, '/api');
$FILES_BASE_URL = $SITE_ROOT . '/uploads/cities';

// Configurações para máxima performance
ini_set('memory_limit', '256M');
ini_set('max_execution_time', 30);
ini_set('opcache.enable', '1');
ini_set('opcache.memory_consumption', '128');
ini_set('realpath_cache_size', '4096K');
ini_set('realpath_cache_ttl', '600');

// Garante estrutura
if (!is_dir($UPLOAD_DIR)) { @mkdir($UPLOAD_DIR, 0775, true); }
if (!file_exists($DB_JSON)) { @file_put_contents($DB_JSON, json_encode([])); }

// ======== Cache em Memória (Instantâneo) ========
function get_memory_cached_data(): ?array {
    global $MEMORY_CACHE_FILE;
    
    static $memory_cache = null;
    
    // Já carregado em memória nesta requisição
    if ($memory_cache !== null) {
        return $memory_cache;
    }
    
    // Tenta carregar do cache em memória (arquivo otimizado)
    if (file_exists($MEMORY_CACHE_FILE) && 
        (time() - filemtime($MEMORY_CACHE_FILE)) < 3600) {
        
        $content = @file_get_contents($MEMORY_CACHE_FILE);
        if ($content !== false) {
            $memory_cache = json_decode($content, true);
            if (is_array($memory_cache)) {
                return $memory_cache;
            }
        }
    }
    
    return null;
}

function save_memory_cache(array $data): void {
    global $MEMORY_CACHE_FILE;
    
    // Salva formato otimizado para leitura rápida
    file_put_contents($MEMORY_CACHE_FILE, json_encode($data, JSON_UNESCAPED_UNICODE));
    
    // Atualiza cache estático para esta requisição
    $GLOBALS['memory_cache_static'] = $data;
}

function invalidate_all_caches(): void {
    global $CACHE_FILE, $MEMORY_CACHE_FILE;
    
    if (file_exists($CACHE_FILE)) @unlink($CACHE_FILE);
    if (file_exists($MEMORY_CACHE_FILE)) @unlink($MEMORY_CACHE_FILE);
    
    // Limpa cache estático
    $GLOBALS['memory_cache_static'] = null;
}

// ======== Helpers Ultra Otimizados ========
function json_ok($data, int $code = 200){
  http_response_code($code);
  
  // Headers agressivos para cache
  if ($code === 200) {
    header('Cache-Control: public, max-age=3600, immutable');
    header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 3600) . ' GMT');
    header('Pragma: cache');
  } else {
    header('Cache-Control: no-cache, no-store');
  }
  
  // Compressão se disponível
  if (ob_get_level()) ob_end_clean();
  
  echo json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE);
  exit;
}

function json_err(string $msg, int $code = 400){
  http_response_code($code);
  header('Cache-Control: no-cache, no-store');
  echo json_encode(['ok'=>false,'error'=>$msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function load_index_optimized(): array {
    global $DB_JSON;
    
    // Tenta primeiro o cache em memória (mais rápido)
    $cached = get_memory_cached_data();
    if ($cached !== null) {
        return $cached;
    }
    
    // Fallback: carrega do arquivo principal
    $raw = @file_get_contents($DB_JSON);
    if ($raw === false) return [];
    
    $data = json_decode($raw, true);
    $data = is_array($data) ? $data : [];
    
    // Atualiza cache em memória para próximas requisições
    save_memory_cache($data);
    
    return $data;
}

function save_index_optimized(array $arr): void {
    global $DB_JSON;
    
    file_put_contents($DB_JSON, json_encode(array_values($arr), JSON_UNESCAPED_UNICODE));
    
    // Atualiza cache em memória também
    save_memory_cache($arr);
    
    // Invalida outros caches
    invalidate_all_caches();
}

function uid(): string { 
    return 'c_' . bin2hex(random_bytes(6)); 
}

function clean_prefix(string $p): string {
    return strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $p), 0, 8));
}

function city_to_prefix(string $name): string {
    $clean = preg_replace('/[^A-Za-z ]/', '', iconv('UTF-8', 'ASCII//TRANSLIT', $name));
    $clean = trim($clean ?: 'GEN');
    $parts = preg_split('/\s+/', $clean);
    $base = $parts[0] ?? 'GEN';
    
    if (preg_match('/^(SAO|SANTO|SANTA|SANTANA|VILA|BOM|NOVA)$/i', $base) && !empty($parts[1])) {
        $base = $parts[1];
    }
    
    return strtoupper(substr($base, 0, 3));
}

function is_kml(string $n): bool { 
    return stripos($n, '.kml') !== false; 
}

function is_kmz(string $n): bool { 
    return stripos($n, '.kmz') !== false; 
}

// Processamento de arquivos otimizado
function fast_file_upload(string $tmp_path, string $target_path): array {
    $start = microtime(true);
    
    // Usa copy() que é mais rápido para arquivos grandes
    if (!copy($tmp_path, $target_path)) {
        throw new Exception('Falha ao copiar arquivo');
    }
    @unlink($tmp_path);
    
    return [
        'size' => filesize($target_path),
        'processing_time' => round(microtime(true) - $start, 3)
    ];
}

// Response builder otimizado
function build_city_response_fast(array $city, string $files_base_url): array {
    $response = [
        'id' => $city['id'],
        'name' => $city['name'],
        'prefix' => $city['prefix'],
        'updatedAt' => $city['updatedAt'],
        'isDefault' => (bool)($city['isDefault'] ?? false),
        'defaultAt' => $city['defaultAt'] ?? null
    ];
    
    if (!empty($city['file']) && !empty($city['file']['name'])) {
        $response['file'] = [
            'name' => $city['file']['name'],
            'size' => $city['file']['size'] ?? 0,
            'url' => $files_base_url . '/' . $city['id'] . '/' . rawurlencode($city['file']['name'])
        ];
    }
    
    return $response;
}

// ======== Router Ultra Rápido ========
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// CORS otimizado
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400'); // Cache CORS por 24h
    exit;
}

header('Access-Control-Allow-Origin: *');

// ---------- LIST (INSTANTÂNEO) ----------
if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $index = load_index_optimized();
    
    // Pré-aloca array para melhor performance
    $out = array_fill(0, count($index), null);
    $i = 0;
    
    foreach ($index as $city) {
        $out[$i++] = build_city_response_fast($city, $FILES_BASE_URL);
    }
    
    json_ok($out);
}

// ---------- GET (INSTANTÂNEO) ----------
if ($method === 'GET' && $action === 'get') {
    $id = $_GET['id'] ?? '';
    
    if (empty($id)) {
        json_err('ID obrigatório');
    }
    
    $index = load_index_optimized();
    
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            json_ok(build_city_response_fast($city, $FILES_BASE_URL));
        }
    }
    
    json_err('Cidade não encontrada', 404);
}

// ---------- CREATE/UPDATE RÁPIDO ----------
if ($method === 'POST' && ($action === 'create' || $action === 'update')) {
    header('Cache-Control: no-cache, no-store');
    
    $name = trim($_POST['name'] ?? '');
    $prefix = trim($_POST['prefix'] ?? '');
    $id = $action === 'update' ? trim($_POST['id'] ?? '') : '';
    
    if (empty($name)) {
        json_err('Nome da cidade é obrigatório');
    }
    
    $index = load_index_optimized();
    $city_index = -1;
    
    if ($action === 'create') {
        $id = uid();
        $prefix = $prefix !== '' ? clean_prefix($prefix) : city_to_prefix($name);
        
        $new_city = [
            'id' => $id,
            'name' => $name,
            'prefix' => $prefix,
            'file' => null,
            'updatedAt' => time(),
            'isDefault' => false,
            'defaultAt' => null
        ];
        
        $index[] = $new_city;
        $city_index = count($index) - 1;
    } else {
        foreach ($index as $i => &$city) {
            if ($city['id'] === $id) {
                $city['name'] = $name;
                $city['prefix'] = $prefix !== '' ? clean_prefix($prefix) : ($city['prefix'] ?? city_to_prefix($name));
                $city['updatedAt'] = time();
                $city_index = $i;
                break;
            }
        }
        
        if ($city_index === -1) {
            json_err('Cidade não encontrada', 404);
        }
    }
    
    // Processamento rápido de arquivo
    if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $file = $_FILES['file'];
        $origName = $file['name'];
        
        if (!is_kml($origName) && !is_kmz($origName)) {
            json_err('Formato inválido. Envie .kml ou .kmz');
        }
        
        $cityDir = $UPLOAD_DIR . '/' . $id;
        if (!is_dir($cityDir)) @mkdir($cityDir, 0775, true);
        
        $safeName = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $origName);
        $target = $cityDir . '/' . $safeName;
        
        // Remove arquivo anterior rapidamente
        if (!empty($index[$city_index]['file']['path'])) {
            @unlink($index[$city_index]['file']['path']);
        }
        
        try {
            $file_info = fast_file_upload($file['tmp_name'], $target);
            
            $index[$city_index]['file'] = [
                'name' => $safeName,
                'size' => $file_info['size'],
                'path' => $target,
                'uploadedAt' => time()
            ];
            
            $index[$city_index]['updatedAt'] = time();
            
        } catch (Exception $e) {
            json_err('Erro no upload: ' . $e->getMessage(), 500);
        }
    }
    
    save_index_optimized($index);
    json_ok(build_city_response_fast($index[$city_index], $FILES_BASE_URL), $action === 'create' ? 201 : 200);
}

// ---------- UPLOAD DIRETO RÁPIDO ----------
if ($method === 'POST' && $action === 'upload_only') {
    header('Cache-Control: no-cache, no-store');
    
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_err('ID obrigatório');
    
    $index = load_index_optimized();
    $found = false;
    
    foreach ($index as $i => &$city) {
        if ($city['id'] === $id) {
            $found = true;
            
            if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
                $file = $_FILES['file'];
                $origName = $file['name'];
                
                if (!is_kml($origName) && !is_kmz($origName)) {
                    json_err('Formato inválido. Envie .kml ou .kmz');
                }
                
                $cityDir = $UPLOAD_DIR . '/' . $id;
                if (!is_dir($cityDir)) @mkdir($cityDir, 0775, true);
                
                $safeName = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $origName);
                $target = $cityDir . '/' . $safeName;
                
                // Remove anterior
                if (!empty($city['file']['path'])) {
                    @unlink($city['file']['path']);
                }
                
                try {
                    $file_info = fast_file_upload($file['tmp_name'], $target);
                    
                    $city['file'] = [
                        'name' => $safeName,
                        'size' => $file_info['size'],
                        'path' => $target,
                        'uploadedAt' => time()
                    ];
                    
                    $city['updatedAt'] = time();
                    
                } catch (Exception $e) {
                    json_err('Erro no upload: ' . $e->getMessage(), 500);
                }
            }
            break;
        }
    }
    
    if (!$found) json_err('Cidade não encontrada', 404);
    
    save_index_optimized($index);
    json_ok(build_city_response_fast($city, $FILES_BASE_URL));
}

// ---------- SET DEFAULT RÁPIDO ----------
if ($method === 'POST' && $action === 'set_default') {
    header('Cache-Control: no-cache, no-store');
    
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_err('ID obrigatório');
    
    $index = load_index_optimized();
    $found = false;
    
    foreach ($index as &$city) {
        if ($city['id'] === $id) {
            $city['isDefault'] = true;
            $city['defaultAt'] = time();
            $found = true;
        } else {
            $city['isDefault'] = false;
            $city['defaultAt'] = null;
        }
    }
    
    if (!$found) json_err('Cidade não encontrada', 404);
    
    save_index_optimized($index);
    
    // Resposta rápida sem reprocessar tudo
    json_ok(['success' => true, 'defaultCityId' => $id]);
}

// ---------- DELETE RÁPIDO ----------
if (($method === 'POST' || $method === 'DELETE') && $action === 'delete') {
    header('Cache-Control: no-cache, no-store');
    
    $id = $_POST['id'] ?? ($_GET['id'] ?? '');
    $index = load_index_optimized();
    $new_index = [];
    $deleted = false;
    
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            $deleted = true;
            // Remove arquivos em background
            $dir = $UPLOAD_DIR . '/' . $id;
            if (is_dir($dir)) {
                // Deleção assíncrona para não bloquear
                register_shutdown_function(function() use ($dir) {
                    system("rm -rf " . escapeshellarg($dir) . " > /dev/null 2>&1 &");
                });
            }
        } else {
            $new_index[] = $city;
        }
    }
    
    if (!$deleted) json_err('Cidade não encontrada', 404);
    
    save_index_optimized($new_index);
    json_ok(['deleted' => true, 'id' => $id]);
}

// ---------- HEALTH CHECK (para monitoramento) ----------
if ($method === 'GET' && $action === 'health') {
    $start = microtime(true);
    $index = load_index_optimized();
    $load_time = round((microtime(true) - $start) * 1000, 2);
    
    json_ok([
        'status' => 'ok',
        'cache_enabled' => true,
        'load_time_ms' => $load_time,
        'cities_count' => count($index),
        'memory_usage' => round(memory_get_usage(true) / 1024 / 1024, 2) . ' MB'
    ]);
}

// ---------- 404 RÁPIDO ----------
json_err('Rota não encontrada', 404);