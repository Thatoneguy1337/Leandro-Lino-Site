<?php
// cities.optimized.php
// Versão otimizada: APCu + arquivo de cache público (_cache.json) + ETag + gravação atômica
declare(strict_types=1);

// ======== Config ========
$ROOT = dirname(__DIR__);
$UPLOAD_DIR = $ROOT . '/uploads/cities';
$DB_JSON = $ROOT . '/uploads/cities/_index.json';
$CACHE_FILE = $ROOT . '/uploads/cities/_cache.json';
$MEMORY_CACHE_FILE = $ROOT . '/uploads/cities/_memory_cache.json'; // fallback rápido
$CACHE_TTL = 3600; // 1 hora
$FILES_BASE_URL = rtrim(str_replace($_SERVER['DOCUMENT_ROOT'], '', $UPLOAD_DIR), '/');

// Performance / runtime
ini_set('memory_limit', '256M');
ini_set('max_execution_time', '30');
ini_set('opcache.enable', '1');
ini_set('opcache.memory_consumption', '128');
ini_set('realpath_cache_size', '4096K');
ini_set('realpath_cache_ttl', '600');

// Garante estrutura
if (!is_dir($UPLOAD_DIR)) { @mkdir($UPLOAD_DIR, 0775, true); }
if (!file_exists($DB_JSON)) { @file_put_contents($DB_JSON, json_encode([])); }

// ======== Helpers ========
function apcu_available(): bool {
    return function_exists('apcu_fetch') && ini_get('apc.enabled') != '0';
}

function atomic_write(string $path, string $content): bool {
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, $content, LOCK_EX) === false) return false;
    return rename($tmp, $path);
}

// ======== Cache layer (APCu -> memory file -> db file)
function save_memory_cache_fast(array $arr): void {
    global $MEMORY_CACHE_FILE;
    $json = json_encode($arr, JSON_UNESCAPED_UNICODE);
    atomic_write($MEMORY_CACHE_FILE, $json);
    if (apcu_available()) {
        @apcu_store('cities_index_v1', $arr, 3600);
    }
}

function load_index_fast(): array {
    global $DB_JSON, $MEMORY_CACHE_FILE, $CACHE_TTL;

    // 1) APCu
    if (apcu_available()) {
        $cached = @apcu_fetch('cities_index_v1', $ok);
        if ($ok && is_array($cached)) return $cached;
    }

    // 2) arquivo de "memory cache"
    if (file_exists($MEMORY_CACHE_FILE) && (time() - filemtime($MEMORY_CACHE_FILE)) < $CACHE_TTL) {
        $content = @file_get_contents($MEMORY_CACHE_FILE);
        if ($content !== false) {
            $arr = json_decode($content, true);
            if (is_array($arr)) {
                if (apcu_available()) @apcu_store('cities_index_v1', $arr, $CACHE_TTL);
                return $arr;
            }
        }
    }

    // 3) leitura principal
    $raw = @file_get_contents($DB_JSON);
    $arr = $raw === false ? [] : (json_decode($raw, true) ?: []);
    save_memory_cache_fast($arr);
    return $arr;
}

function save_index_fast(array $arr): void {
    global $DB_JSON, $CACHE_FILE;

    // salva DB principal atômico
    $json_db = json_encode(array_values($arr), JSON_UNESCAPED_UNICODE);
    atomic_write($DB_JSON, $json_db);

    // atualiza memória/cache intermediário
    save_memory_cache_fast($arr);

    // atualiza APCu
    if (apcu_available()) {
        @apcu_store('cities_index_v1', $arr, 3600);
    }

    // invalida cache público
    if (file_exists($CACHE_FILE)) @unlink($CACHE_FILE);
}

// ======== Public cache file (pré-renderizado) ========
function save_public_cache_file(array $data): void {
    global $CACHE_FILE;
    $final = json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE);
    atomic_write($CACHE_FILE, $final);
    @chmod($CACHE_FILE, 0644);
}

function serve_public_cache_if_fresh(): bool {
    global $CACHE_FILE, $CACHE_TTL;
    if (file_exists($CACHE_FILE) && (time() - filemtime($CACHE_FILE) < $CACHE_TTL)) {
        $etag = '"' . md5_file($CACHE_FILE) . '"';
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: public, max-age=' . $CACHE_TTL . ', must-revalidate');
        header('ETag: ' . $etag);

        $ifNone = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
        if ($ifNone === $etag) { http_response_code(304); exit; }

        // serve file direto (sem json_encode)
        readfile($CACHE_FILE);
        exit;
    }
    return false;
}

// ======== ETag helper para objetos gerados on-the-fly ========
function send_cached_json_with_etag(array $data, int $ttl = 3600): void {
    $json = json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE);
    $etag = '"' . md5($json) . '"';

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=' . $ttl . ', must-revalidate');
    header('ETag: ' . $etag);

    $ifNone = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if ($ifNone === $etag) { http_response_code(304); exit; }

    echo $json; exit;
}

function json_err(string $msg, int $code = 400){
    http_response_code($code);
    header('Cache-Control: no-cache, no-store');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok'=>false,'error'=>$msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ======== Small helpers from original code ========
function uid(): string { return 'c_' . bin2hex(random_bytes(6)); }
function clean_prefix(string $p): string { return strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $p), 0, 8)); }
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
function is_kml(string $n): bool { return stripos($n, '.kml') !== false; }
function is_kmz(string $n): bool { return stripos($n, '.kmz') !== false; }
function fast_file_upload(string $tmp_path, string $target_path): array {
    $start = microtime(true);
    if (!copy($tmp_path, $target_path)) { throw new Exception('Falha ao copiar arquivo'); }
    @unlink($tmp_path);
    return [ 'size' => filesize($target_path), 'processing_time' => round(microtime(true) - $start, 3) ];
}
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
            'url' => rtrim($files_base_url, '/') . '/' . rawurlencode($city['id']) . '/' . rawurlencode($city['file']['name'])
        ];
    }
    return $response;
}

// ======== Router ========
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// CORS / OPTIONS
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
    exit;
}
header('Access-Control-Allow-Origin: *');

// ---------- LIST (tenta cache público primeiro) ----------
if ($method === 'GET' && ($action === '' || $action === 'list')) {
    if (serve_public_cache_if_fresh()) exit; // serve cache público se existir

    $index = load_index_fast();
    $out = [];
    foreach ($index as $city) { $out[] = build_city_response_fast($city, $FILES_BASE_URL); }

    // salva cache público para próximas requisições e envia ETag
    save_public_cache_file($out);
    send_cached_json_with_etag($out, $CACHE_TTL);
}

// ---------- GET ----------
if ($method === 'GET' && $action === 'get') {
    $id = $_GET['id'] ?? '';
    if (empty($id)) json_err('ID obrigatório');

    $index = load_index_fast();
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            send_cached_json_with_etag(build_city_response_fast($city, $FILES_BASE_URL), $CACHE_TTL);
        }
    }
    json_err('Cidade não encontrada', 404);
}

// ---------- CREATE / UPDATE ----------
if ($method === 'POST' && ($action === 'create' || $action === 'update')) {
    header('Cache-Control: no-cache, no-store');

    $name = trim($_POST['name'] ?? '');
    $prefix = trim($_POST['prefix'] ?? '');
    $id = $action === 'update' ? trim($_POST['id'] ?? '') : '';

    if (empty($name)) json_err('Nome da cidade é obrigatório');

    $index = load_index_fast();
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
                $city_index = $i; break;
            }
        }
        if ($city_index === -1) json_err('Cidade não encontrada', 404);
    }

    // Upload de arquivo (rápido)
    if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $file = $_FILES['file'];
        $origName = $file['name'];
        if (!is_kml($origName) && !is_kmz($origName)) json_err('Formato inválido. Envie .kml ou .kmz');

        $cityDir = $UPLOAD_DIR . '/' . $id;
        if (!is_dir($cityDir)) @mkdir($cityDir, 0775, true);
        $safeName = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $origName);
        $target = $cityDir . '/' . $safeName;

        // remove anterior
        if (!empty($index[$city_index]['file']['path'])) @unlink($index[$city_index]['file']['path']);

        try {
            $file_info = fast_file_upload($file['tmp_name'], $target);
            $index[$city_index]['file'] = [ 'name'=>$safeName, 'size'=>$file_info['size'], 'path'=>$target, 'uploadedAt'=>time() ];
            $index[$city_index]['updatedAt'] = time();
        } catch (Exception $e) {
            json_err('Erro no upload: ' . $e->getMessage(), 500);
        }
    }

    save_index_fast($index);

    // constrói resposta
    $resp = build_city_response_fast($index[$city_index], $FILES_BASE_URL);
    http_response_code($action === 'create' ? 201 : 200);
    send_cached_json_with_etag($resp, 0); // responder sem cache TTL para objeto único (cliente decide)
}

// ---------- UPLOAD ONLY ----------
if ($method === 'POST' && $action === 'upload_only') {
    header('Cache-Control: no-cache, no-store');
    $id = trim($_POST['id'] ?? ''); if (empty($id)) json_err('ID obrigatório');

    $index = load_index_fast(); $found = false; $city = null;
    foreach ($index as $i => &$c) {
        if ($c['id'] === $id) { $found = true; $city = &$c; break; }
    }
    if (!$found) json_err('Cidade não encontrada', 404);

    if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $file = $_FILES['file']; $origName = $file['name'];
        if (!is_kml($origName) && !is_kmz($origName)) json_err('Formato inválido. Envie .kml ou .kmz');
        $cityDir = $UPLOAD_DIR . '/' . $id; if (!is_dir($cityDir)) @mkdir($cityDir, 0775, true);
        $safeName = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $origName);
        $target = $cityDir . '/' . $safeName;
        if (!empty($city['file']['path'])) @unlink($city['file']['path']);
        try {
            $file_info = fast_file_upload($file['tmp_name'], $target);
            $city['file'] = [ 'name'=>$safeName, 'size'=>$file_info['size'], 'path'=>$target, 'uploadedAt'=>time() ];
            $city['updatedAt'] = time();
        } catch (Exception $e) { json_err('Erro no upload: ' . $e->getMessage(), 500); }
    }

    save_index_fast($index);
    send_cached_json_with_etag(build_city_response_fast($city, $FILES_BASE_URL));
}

// ---------- SET DEFAULT ----------
if ($method === 'POST' && $action === 'set_default') {
    header('Cache-Control: no-cache, no-store');
    $id = trim($_POST['id'] ?? ''); if (empty($id)) json_err('ID obrigatório');

    $index = load_index_fast(); $found = false;
    foreach ($index as &$city) {
        if ($city['id'] === $id) { $city['isDefault'] = true; $city['defaultAt'] = time(); $found = true; }
        else { $city['isDefault'] = false; $city['defaultAt'] = null; }
    }
    if (!$found) json_err('Cidade não encontrada', 404);
    save_index_fast($index);
    send_cached_json_with_etag(['success'=>true,'defaultCityId'=>$id], 0);
}

// ---------- DELETE ----------
if (($method === 'POST' || $method === 'DELETE') && $action === 'delete') {
    header('Cache-Control: no-cache, no-store');
    $id = $_POST['id'] ?? ($_GET['id'] ?? ''); if (empty($id)) json_err('ID obrigatório');

    $index = load_index_fast(); $new_index = []; $deleted = false;
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            $deleted = true;
            $dir = $UPLOAD_DIR . '/' . $id;
            if (is_dir($dir)) {
                register_shutdown_function(function() use ($dir) {
                    // tentativa de remoção em background (quiet)
                    @system("rm -rf " . escapeshellarg($dir) . " > /dev/null 2>&1 &");
                });
            }
        } else { $new_index[] = $city; }
    }
    if (!$deleted) json_err('Cidade não encontrada', 404);
    save_index_fast($new_index);
    send_cached_json_with_etag(['deleted'=>true,'id'=>$id]);
}

// ---------- HEALTH CHECK ----------
if ($method === 'GET' && $action === 'health') {
    $start = microtime(true);
    $index = load_index_fast();
    $load_time = round((microtime(true) - $start) * 1000, 2);
    send_cached_json_with_etag([
        'status'=>'ok',
        'cache_enabled' => apcu_available(),
        'load_time_ms'=>$load_time,
        'cities_count'=>count($index),
        'memory_usage'=>round(memory_get_usage(true)/1024/1024,2) . ' MB'
    ], 0);
}

// ---------- 404 ----------
json_err('Rota não encontrada', 404);
