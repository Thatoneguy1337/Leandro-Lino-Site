<?php
// cities.php - Versão completa com cache avançado
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

// ======== Configuração ========
$ROOT = dirname(__DIR__);
$UPLOAD_DIR = $ROOT . '/uploads/cities';
$DB_JSON = $ROOT . '/uploads/cities/_index.json';
$CACHE_TTL = 7200; // 2 horas
$RECENT_FILES_CACHE = $ROOT . '/uploads/cities/_recent_files.json';
$LAST_UPLOADS_CACHE = $ROOT . '/uploads/cities/_last_uploads.json';
$MAX_RECENT_FILES = 10;

// Garantir diretórios
if (!is_dir($UPLOAD_DIR)) { 
    @mkdir($UPLOAD_DIR, 0775, true); 
}
if (!file_exists($DB_JSON)) { 
    @file_put_contents($DB_JSON, json_encode([])); 
}

// ======== Cache de Últimos Uploads ========
class LastUploadsCache {
    private static $instance = null;
    private $cache_file;
    private $max_items;
    
    public static function getInstance(): self {
        if (self::$instance === null) {
            global $LAST_UPLOADS_CACHE;
            self::$instance = new self($LAST_UPLOADS_CACHE, 5);
        }
        return self::$instance;
    }
    
    public function __construct(string $cache_file, int $max_items = 5) {
        $this->cache_file = $cache_file;
        $this->max_items = $max_items;
    }
    
    public function addUpload(array $upload_info): bool {
        $uploads = $this->getLastUploads();
        
        // Remove se já existe (para atualizar)
        $uploads = array_filter($uploads, function($item) use ($upload_info) {
            return $item['file_path'] !== $upload_info['file_path'];
        });
        
        // Adiciona no início
        array_unshift($uploads, $upload_info);
        
        // Mantém apenas os últimos itens
        if (count($uploads) > $this->max_items) {
            $uploads = array_slice($uploads, 0, $this->max_items);
        }
        
        return $this->saveUploads($uploads);
    }
    
    public function getLastUploads(): array {
        if (!file_exists($this->cache_file)) {
            return [];
        }
        
        $content = @file_get_contents($this->cache_file);
        if ($content === false) {
            return [];
        }
        
        $data = json_decode($content, true);
        return is_array($data) ? $data : [];
    }
    
    public function getLastUpload(): ?array {
        $uploads = $this->getLastUploads();
        return $uploads[0] ?? null;
    }
    
    public function clear(): bool {
        if (file_exists($this->cache_file)) {
            return unlink($this->cache_file);
        }
        return true;
    }
    
    private function saveUploads(array $uploads): bool {
        $json = json_encode($uploads, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        return file_put_contents($this->cache_file, $json, LOCK_EX) !== false;
    }
}

// ======== Cache de Arquivos Recentes ========
class RecentFilesCache {
    private static $instance = null;
    private $cache_file;
    private $max_files;
    private $memory_cache = null;
    
    public static function getInstance(): self {
        if (self::$instance === null) {
            global $RECENT_FILES_CACHE, $MAX_RECENT_FILES;
            self::$instance = new self($RECENT_FILES_CACHE, $MAX_RECENT_FILES);
        }
        return self::$instance;
    }
    
    public function __construct(string $cache_file, int $max_files = 10) {
        $this->cache_file = $cache_file;
        $this->max_files = $max_files;
    }
    
    public function addFile(array $file_info): bool {
        $recent_files = $this->getRecentFiles();
        
        // Remove se já existe (para atualizar)
        $recent_files = array_filter($recent_files, function($file) use ($file_info) {
            return $file['file_path'] !== $file_info['file_path'];
        });
        
        // Adicionar no início
        array_unshift($recent_files, $file_info);
        
        // Manter apenas os últimos MAX_RECENT_FILES
        if (count($recent_files) > $this->max_files) {
            $recent_files = array_slice($recent_files, 0, $this->max_files);
        }
        
        return $this->saveRecentFiles($recent_files);
    }
    
    public function getRecentFiles(): array {
        // Cache em memória
        if ($this->memory_cache !== null) {
            return $this->memory_cache;
        }
        
        if (!file_exists($this->cache_file)) {
            return [];
        }
        
        $content = @file_get_contents($this->cache_file);
        if ($content === false) {
            return [];
        }
        
        $data = json_decode($content, true);
        $this->memory_cache = is_array($data) ? $data : [];
        
        return $this->memory_cache;
    }
    
    public function getLastFile(): ?array {
        $files = $this->getRecentFiles();
        return $files[0] ?? null;
    }
    
    public function clear(): bool {
        $this->memory_cache = [];
        if (file_exists($this->cache_file)) {
            return unlink($this->cache_file);
        }
        return true;
    }
    
    public function getStats(): array {
        $files = $this->getRecentFiles();
        $total_size = 0;
        $cities = [];
        
        foreach ($files as $file) {
            $total_size += $file['file_size'] ?? 0;
            $city_id = $file['city_id'] ?? '';
            if ($city_id && !in_array($city_id, $cities)) {
                $cities[] = $city_id;
            }
        }
        
        return [
            'total_files' => count($files),
            'total_size_mb' => round($total_size / 1024 / 1024, 2),
            'cities_count' => count($cities),
            'max_files' => $this->max_files
        ];
    }
    
    private function saveRecentFiles(array $files): bool {
        $this->memory_cache = $files;
        $json = json_encode($files, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        return file_put_contents($this->cache_file, $json, LOCK_EX) !== false;
    }
}

// ======== Cache de Processamento KMZ ========
class KMZProcessorCache {
    private static $instance = null;
    private $cache_dir;
    
    public static function getInstance(): self {
        if (self::$instance === null) {
            global $UPLOAD_DIR;
            self::$instance = new self($UPLOAD_DIR . '/_kmz_cache');
        }
        return self::$instance;
    }
    
    public function __construct(string $cache_dir) {
        $this->cache_dir = $cache_dir;
        if (!is_dir($this->cache_dir)) {
            @mkdir($this->cache_dir, 0775, true);
        }
    }
    
    public function getCacheKey(string $file_path): string {
        if (!file_exists($file_path)) {
            return 'invalid_' . md5($file_path);
        }
        $filemtime = filemtime($file_path);
        $filesize = filesize($file_path);
        return 'kmz_' . md5($file_path . '_' . $filemtime . '_' . $filesize);
    }
    
    public function getCachedData(string $file_path): ?array {
        $cache_key = $this->getCacheKey($file_path);
        $cache_file = $this->cache_dir . '/' . $cache_key . '.json';
        
        if (file_exists($cache_file) && (time() - filemtime($cache_file) < 86400)) {
            $content = file_get_contents($cache_file);
            if ($content !== false) {
                $data = json_decode($content, true);
                if (is_array($data)) {
                    $data['from_cache'] = true;
                    $data['cache_key'] = $cache_key;
                    return $data;
                }
            }
        }
        
        return null;
    }
    
    public function saveCache(string $file_path, array $data): bool {
        $cache_key = $this->getCacheKey($file_path);
        $cache_file = $this->cache_dir . '/' . $cache_key . '.json';
        
        $data['cached_at'] = time();
        $data['cache_key'] = $cache_key;
        
        $json = json_encode($data, JSON_UNESCAPED_UNICODE);
        return file_put_contents($cache_file, $json, LOCK_EX) !== false;
    }
    
    public function processKMZ(string $file_path): array {
        // Tentar obter do cache primeiro
        $cached_data = $this->getCachedData($file_path);
        if ($cached_data !== null) {
            return $cached_data;
        }
        
        $start_time = microtime(true);
        $meta = [
            'placemarks' => 0,
            'bbox' => null,
            'processedAt' => time(),
            'from_cache' => false,
            'processing_time' => 0
        ];
        
        $ext = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));
        $temp_kml = '';
        
        try {
            if ($ext === 'kmz') {
                $zip = new ZipArchive();
                if ($zip->open($file_path) === true) {
                    for ($i = 0; $i < $zip->numFiles; $i++) {
                        $name = $zip->getNameIndex($i);
                        if (preg_match('/\.kml$/i', $name)) {
                            $temp_kml = sys_get_temp_dir() . '/kml_' . uniqid() . '.kml';
                            $stream = $zip->getStream($name);
                            if ($stream) {
                                file_put_contents($temp_kml, $stream);
                                fclose($stream);
                            }
                            break;
                        }
                    }
                    $zip->close();
                }
            } elseif ($ext === 'kml') {
                $temp_kml = $file_path;
            }
            
            // Processamento básico do KML
            if ($temp_kml && file_exists($temp_kml)) {
                $reader = new XMLReader();
                if ($reader->open($temp_kml)) {
                    $count = 0;
                    $min_lat = INF; $min_lon = INF; $max_lat = -INF; $max_lon = -INF;
                    
                    while ($reader->read()) {
                        // Contar Placemarks
                        if ($reader->nodeType === XMLReader::ELEMENT && 
                            strcasecmp($reader->localName, 'placemark') === 0) {
                            $count++;
                            if ($count > 5000) break;
                        }
                        
                        // Processar coordenadas para bounding box
                        if ($reader->nodeType === XMLReader::ELEMENT && 
                            strcasecmp($reader->localName, 'coordinates') === 0) {
                            
                            $reader->read();
                            if ($reader->nodeType === XMLReader::TEXT) {
                                $coords = $reader->value;
                                preg_match_all('/(-?\d+\.?\d*),(-?\d+\.?\d*)/', $coords, $matches, PREG_SET_ORDER);
                                
                                foreach ($matches as $match) {
                                    $lon = (float)$match[1];
                                    $lat = (float)$match[2];
                                    
                                    if (is_finite($lat) && is_finite($lon)) {
                                        $min_lat = min($min_lat, $lat);
                                        $max_lat = max($max_lat, $lat);
                                        $min_lon = min($min_lon, $lon);
                                        $max_lon = max($max_lon, $lon);
                                    }
                                }
                            }
                        }
                    }
                    $reader->close();
                    $meta['placemarks'] = $count;
                    
                    if (is_finite($min_lat)) {
                        $meta['bbox'] = [
                            'minLat' => $min_lat,
                            'minLon' => $min_lon,
                            'maxLat' => $max_lat,
                            'maxLon' => $max_lon
                        ];
                    }
                }
                
                if ($temp_kml !== $file_path) {
                    @unlink($temp_kml);
                }
            }
            
            $meta['processing_time'] = round(microtime(true) - $start_time, 3);
            
            // Salvar no cache
            $this->saveCache($file_path, $meta);
            
        } catch (Exception $e) {
            error_log("KMZ processing error: " . $e->getMessage());
            // Salvar resultado básico no cache para evitar reprocessamento
            $this->saveCache($file_path, $meta);
        }
        
        return $meta;
    }
    
    public function clearExpired(int $max_age = 86400): void {
        $files = glob($this->cache_dir . '/*.json');
        $now = time();
        
        foreach ($files as $file) {
            if (($now - filemtime($file)) > $max_age) {
                @unlink($file);
            }
        }
    }
}

// ======== Funções Básicas ========
function atomic_write(string $path, string $content): bool {
    $tmp = $path . '.tmp.' . uniqid();
    if (file_put_contents($tmp, $content, LOCK_EX) === false) return false;
    return rename($tmp, $path);
}

function load_index(): array {
    global $DB_JSON;
    if (!file_exists($DB_JSON)) return [];
    
    $content = @file_get_contents($DB_JSON);
    if ($content === false) return [];
    
    return json_decode($content, true) ?: [];
}

function save_index(array $arr): void {
    global $DB_JSON;
    $json = json_encode(array_values($arr), JSON_UNESCAPED_UNICODE);
    atomic_write($DB_JSON, $json);
}

function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $status = 400): void {
    json_response(['ok' => false, 'error' => $message], $status);
}

function build_city_response(array $city): array {
    global $UPLOAD_DIR;
    
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
            'url' => '/uploads/cities/' . $city['id'] . '/' . $city['file']['name'],
            'uploadedAt' => $city['file']['uploadedAt'] ?? time()
        ];
        
        // Adicionar metadados processados se disponíveis
        $meta_file = $UPLOAD_DIR . '/' . $city['id'] . '/file_meta.json';
        if (file_exists($meta_file)) {
            $meta_content = file_get_contents($meta_file);
            if ($meta_content !== false) {
                $meta = json_decode($meta_content, true);
                if (is_array($meta)) {
                    $response['file']['meta'] = $meta;
                }
            }
        }
    }
    
    return $response;
}

function load_file_meta(string $cityDir): ?array {
    $p = rtrim($cityDir, '/') . '/file_meta.json';
    if (!file_exists($p)) return null;
    
    $content = file_get_contents($p);
    if ($content === false) return null;
    
    return json_decode($content, true) ?: null;
}

// ======== Router Principal ========
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// CORS
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    exit;
}
header('Access-Control-Allow-Origin: *');

// ---------- LISTAR CIDADES ----------
if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $index = load_index();
    $cities = [];
    
    foreach ($index as $city) {
        $cities[] = build_city_response($city);
    }
    
    json_response(['ok' => true, 'data' => $cities]);
}

// ---------- OBTER CIDADE ESPECÍFICA ----------
if ($method === 'GET' && $action === 'get') {
    $id = $_GET['id'] ?? '';
    if (empty($id)) json_error('ID obrigatório');
    
    $index = load_index();
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            json_response(['ok' => true, 'data' => build_city_response($city)]);
        }
    }
    
    json_error('Cidade não encontrada', 404);
}

// ---------- CRIAR CIDADE ----------
if ($method === 'POST' && $action === 'create') {
    $name = trim($_POST['name'] ?? '');
    $prefix = trim($_POST['prefix'] ?? '');
    
    if (empty($name)) json_error('Nome da cidade é obrigatório');
    
    $index = load_index();
    $id = 'c_' . bin2hex(random_bytes(8));
    
    if (empty($prefix)) {
        $prefix = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name), 0, 3));
        if (empty($prefix)) $prefix = 'CTY';
    }
    
    $new_city = [
        'id' => $id,
        'name' => $name,
        'prefix' => $prefix,
        'file' => null,
        'updatedAt' => time(),
        'isDefault' => false
    ];
    
    $index[] = $new_city;
    save_index($index);
    
    json_response(['ok' => true, 'data' => build_city_response($new_city)], 201);
}

// ---------- ATUALIZAR CIDADE ----------
if ($method === 'POST' && $action === 'update') {
    $id = trim($_POST['id'] ?? '');
    $name = trim($_POST['name'] ?? '');
    $prefix = trim($_POST['prefix'] ?? '');
    
    if (empty($id)) json_error('ID obrigatório');
    if (empty($name)) json_error('Nome da cidade é obrigatório');
    
    $index = load_index();
    $found = false;
    
    foreach ($index as &$city) {
        if ($city['id'] === $id) {
            $city['name'] = $name;
            if (!empty($prefix)) {
                $city['prefix'] = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $prefix), 0, 6));
            }
            $city['updatedAt'] = time();
            $found = true;
            break;
        }
    }
    
    if (!$found) json_error('Cidade não encontrada', 404);
    
    save_index($index);
    json_response(['ok' => true, 'data' => build_city_response($city)]);
}

// ---------- UPLOAD DE ARQUIVO (COM CACHE COMPLETO) ----------
if ($method === 'POST' && $action === 'upload') {
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_error('ID da cidade é obrigatório');
    
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        json_error('Nenhum arquivo enviado');
    }
    
    $file = $_FILES['file'];
    $filename = $file['name'];
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    
    if (!in_array($extension, ['kml', 'kmz'])) {
        json_error('Apenas arquivos KML e KMZ são permitidos');
    }
    
    $index = load_index();
    $city_index = -1;
    $city = null;
    
    foreach ($index as $i => $c) {
        if ($c['id'] === $id) {
            $city_index = $i;
            $city = $c;
            break;
        }
    }
    
    if ($city_index === -1) json_error('Cidade não encontrada', 404);
    
    $city_dir = $UPLOAD_DIR . '/' . $id;
    if (!is_dir($city_dir)) {
        @mkdir($city_dir, 0775, true);
    }
    
    $safe_filename = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $filename);
    $target_path = $city_dir . '/' . $safe_filename;
    
    // Limpar arquivo anterior se existir
    if (!empty($index[$city_index]['file']['path'])) {
        @unlink($index[$city_index]['file']['path']);
    }
    
    if (!move_uploaded_file($file['tmp_name'], $target_path)) {
        json_error('Erro ao salvar arquivo');
    }
    
    // Processar KMZ para obter metadados
    $kmz_cache = KMZProcessorCache::getInstance();
    $file_meta = $kmz_cache->processKMZ($target_path);
    
    // Salvar metadados do arquivo
    atomic_write($city_dir . '/file_meta.json', json_encode($file_meta, JSON_UNESCAPED_UNICODE));
    
    // Atualizar cidade
    $file_info = [
        'name' => $safe_filename,
        'size' => filesize($target_path),
        'path' => $target_path,
        'uploadedAt' => time()
    ];
    
    $index[$city_index]['file'] = $file_info;
    $index[$city_index]['updatedAt'] = time();
    
    save_index($index);
    
    // ADICIONAR A TODOS OS CACHES
    $recent_cache = RecentFilesCache::getInstance();
    $last_uploads_cache = LastUploadsCache::getInstance();
    
    $recent_file_info = [
        'city_id' => $id,
        'city_name' => $city['name'],
        'file_name' => $safe_filename,
        'file_path' => $target_path,
        'file_size' => filesize($target_path),
        'file_type' => $extension,
        'uploaded_at' => time(),
        'placemarks_count' => $file_meta['placemarks'] ?? 0,
        'processing_time' => $file_meta['processing_time'] ?? 0,
        'from_cache' => $file_meta['from_cache'] ?? false
    ];
    
    $recent_cache->addFile($recent_file_info);
    $last_uploads_cache->addUpload($recent_file_info);
    
    json_response([
        'ok' => true, 
        'data' => build_city_response($index[$city_index]),
        'processing' => $file_meta,
        'cache_info' => [
            'added_to_recent' => true,
            'added_to_last_uploads' => true
        ]
    ]);
}

// ---------- ARQUIVOS RECENTES ----------
if ($method === 'GET' && $action === 'recent_files') {
    $recent_cache = RecentFilesCache::getInstance();
    $limit = intval($_GET['limit'] ?? 5);
    
    $files = $recent_cache->getRecentFiles();
    if ($limit > 0) {
        $files = array_slice($files, 0, $limit);
    }
    
    json_response([
        'ok' => true,
        'data' => $files,
        'stats' => $recent_cache->getStats()
    ]);
}

// ---------- ÚLTIMOS UPLOADS ----------
if ($method === 'GET' && $action === 'last_uploads') {
    $last_uploads_cache = LastUploadsCache::getInstance();
    $limit = intval($_GET['limit'] ?? 5);
    
    $uploads = $last_uploads_cache->getLastUploads();
    if ($limit > 0) {
        $uploads = array_slice($uploads, 0, $limit);
    }
    
    json_response([
        'ok' => true,
        'data' => $uploads,
        'count' => count($uploads)
    ]);
}

// ---------- ÚLTIMO ARQUIVO ----------
if ($method === 'GET' && $action === 'last_file') {
    $recent_cache = RecentFilesCache::getInstance();
    $last_file = $recent_cache->getLastFile();
    
    if ($last_file) {
        json_response(['ok' => true, 'data' => $last_file]);
    } else {
        json_response(['ok' => true, 'data' => null, 'message' => 'Nenhum arquivo recente']);
    }
}

// ---------- ÚLTIMO UPLOAD ----------
if ($method === 'GET' && $action === 'last_upload') {
    $last_uploads_cache = LastUploadsCache::getInstance();
    $last_upload = $last_uploads_cache->getLastUpload();
    
    if ($last_upload) {
        json_response(['ok' => true, 'data' => $last_upload]);
    } else {
        json_response(['ok' => true, 'data' => null, 'message' => 'Nenhum upload recente']);
    }
}

// ---------- DEFINIR PADRÃO ----------
if ($method === 'POST' && $action === 'set_default') {
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_error('ID obrigatório');
    
    $index = load_index();
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
    
    if (!$found) json_error('Cidade não encontrada', 404);
    
    save_index($index);
    json_response(['ok' => true, 'message' => 'Cidade definida como padrão']);
}

// ---------- DELETAR CIDADE ----------
if ($method === 'POST' && $action === 'delete') {
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_error('ID obrigatório');
    
    $index = load_index();
    $new_index = [];
    $deleted = false;
    
    foreach ($index as $city) {
        if ($city['id'] === $id) {
            // Marcar para deletar arquivos (em background)
            $city_dir = $UPLOAD_DIR . '/' . $id;
            if (is_dir($city_dir)) {
                // Deletar em background para não travar a resposta
                register_shutdown_function(function() use ($city_dir) {
                    system("rm -rf " . escapeshellarg($city_dir) . " > /dev/null 2>&1 &");
                });
            }
            $deleted = true;
        } else {
            $new_index[] = $city;
        }
    }
    
    if (!$deleted) json_error('Cidade não encontrada', 404);
    
    save_index($new_index);
    
    // Remover dos caches
    $recent_cache = RecentFilesCache::getInstance();
    $last_uploads_cache = LastUploadsCache::getInstance();
    
    // Limpar arquivos desta cidade dos caches
    $recent_files = $recent_cache->getRecentFiles();
    $filtered_recent = array_filter($recent_files, fn($file) => $file['city_id'] !== $id);
    $recent_cache->saveRecentFiles($filtered_recent);
    
    $last_uploads = $last_uploads_cache->getLastUploads();
    $filtered_uploads = array_filter($last_uploads, fn($upload) => $upload['city_id'] !== $id);
    $last_uploads_cache->saveUploads($filtered_uploads);
    
    json_response(['ok' => true, 'message' => 'Cidade deletada']);
}

// ---------- HEALTH CHECK ----------
if ($method === 'GET' && $action === 'health') {
    $index = load_index();
    $recent_cache = RecentFilesCache::getInstance();
    $last_uploads_cache = LastUploadsCache::getInstance();
    $kmz_cache = KMZProcessorCache::getInstance();
    
    // Limpar caches expirados
    $kmz_cache->clearExpired(86400);
    
    // Verificar uploads
    $upload_dir_exists = is_dir($UPLOAD_DIR);
    $upload_dir_writable = is_writable($UPLOAD_DIR);
    
    // Contar arquivos
    $file_count = 0;
    $total_size = 0;
    
    if ($upload_dir_exists) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($UPLOAD_DIR));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getFilename() !== '_index.json' && 
                !str_contains($file->getPath(), '_kmz_cache') &&
                !str_contains($file->getPath(), '_recent_files.json') &&
                !str_contains($file->getPath(), '_last_uploads.json')) {
                $file_count++;
                $total_size += $file->getSize();
            }
        }
    }
    
    json_response([
        'ok' => true,
        'status' => 'operational',
        'cities_count' => count($index),
        'upload_dir' => [
            'exists' => $upload_dir_exists,
            'writable' => $upload_dir_writable,
            'file_count' => $file_count,
            'total_size_mb' => round($total_size / 1024 / 1024, 2)
        ],
        'cache_info' => [
            'recent_files' => $recent_cache->getStats(),
            'last_uploads' => [
                'count' => count($last_uploads_cache->getLastUploads()),
                'max_items' => 5
            ],
            'kmz_processor' => [
                'cache_dir' => $UPLOAD_DIR . '/_kmz_cache',
                'enabled' => true
            ]
        ],
        'timestamp' => time()
    ]);
}

// ---------- VERIFICAR ARQUIVOS ----------
if ($method === 'GET' && $action === 'check_files') {
    $index = load_index();
    $results = [];
    
    foreach ($index as $city) {
        $file_info = [
            'city_id' => $city['id'],
            'city_name' => $city['name'],
            'has_file_reference' => !empty($city['file']),
            'file_exists' => false,
            'file_path' => null
        ];
        
        if (!empty($city['file']['path'])) {
            $file_info['file_path'] = $city['file']['path'];
            $file_info['file_exists'] = file_exists($city['file']['path']);
            if ($file_info['file_exists']) {
                $file_info['file_size'] = filesize($city['file']['path']);
            }
        }
        
        $results[] = $file_info;
    }
    
    json_response([
        'ok' => true,
        'total_cities' => count($index),
        'cities_with_files' => count(array_filter($results, fn($r) => $r['has_file_reference'])),
        'files_missing' => count(array_filter($results, fn($r) => $r['has_file_reference'] && !$r['file_exists'])),
        'details' => $results
    ]);
}

// ---------- LIMPAR CACHE ----------
if ($method === 'POST' && $action === 'clear_cache') {
    $recent_cache = RecentFilesCache::getInstance();
    $last_uploads_cache = LastUploadsCache::getInstance();
    $kmz_cache = KMZProcessorCache::getInstance();
    
    $recent_stats = $recent_cache->getStats();
    $last_uploads_count = count($last_uploads_cache->getLastUploads());
    
    $recent_cache->clear();
    $last_uploads_cache->clear();
    $kmz_cache->clearExpired(0); // Limpar tudo
    
    json_response([
        'ok' => true,
        'message' => 'Cache limpo com sucesso',
        'cleared_items' => [
            'recent_files' => $recent_stats['total_files'],
            'last_uploads' => $last_uploads_count,
            'kmz_cache' => 'todos expirados'
        ],
        'timestamp' => time()
    ]);
}

// ---------- PROCESSAR ARQUIVO EXISTENTE ----------
if ($method === 'POST' && $action === 'process_file') {
    $id = trim($_POST['id'] ?? '');
    if (empty($id)) json_error('ID da cidade é obrigatório');
    
    $index = load_index();
    $city = null;
    
    foreach ($index as $c) {
        if ($c['id'] === $id) {
            $city = $c;
            break;
        }
    }
    
    if (!$city || empty($city['file']['path'])) {
        json_error('Cidade ou arquivo não encontrado', 404);
    }
    
    $file_path = $city['file']['path'];
    if (!file_exists($file_path)) {
        json_error('Arquivo físico não encontrado', 404);
    }
    
    // Processar arquivo
    $kmz_cache = KMZProcessorCache::getInstance();
    $file_meta = $kmz_cache->processKMZ($file_path);
    
    // Atualizar metadados
    $city_dir = $UPLOAD_DIR . '/' . $id;
    atomic_write($city_dir . '/file_meta.json', json_encode($file_meta, JSON_UNESCAPED_UNICODE));
    
    // Atualizar todos os caches
    $recent_cache = RecentFilesCache::getInstance();
    $last_uploads_cache = LastUploadsCache::getInstance();
    
    $file_info = [
        'city_id' => $id,
        'city_name' => $city['name'],
        'file_name' => $city['file']['name'],
        'file_path' => $file_path,
        'file_size' => filesize($file_path),
        'file_type' => pathinfo($file_path, PATHINFO_EXTENSION),
        'uploaded_at' => time(),
        'placemarks_count' => $file_meta['placemarks'] ?? 0,
        'processing_time' => $file_meta['processing_time'] ?? 0,
        'from_cache' => $file_meta['from_cache'] ?? false,
        'reprocessed' => true
    ];
    
    $recent_cache->addFile($file_info);
    $last_uploads_cache->addUpload($file_info);
    
    json_response([
        'ok' => true,
        'message' => 'Arquivo processado e caches atualizados',
        'data' => $file_meta
    ]);
}

// ---------- OBTER ARQUIVO PARA DOWNLOAD ----------
if ($method === 'GET' && $action === 'download') {
    $id = $_GET['id'] ?? '';
    $filename = $_GET['file'] ?? '';
    
    if (empty($id) || empty($filename)) {
        json_error('ID e nome do arquivo são obrigatórios');
    }
    
    $file_path = $UPLOAD_DIR . '/' . $id . '/' . $filename;
    
    if (!file_exists($file_path)) {
        json_error('Arquivo não encontrado', 404);
    }
    
    // Verificar se é um arquivo válido
    if (!is_file($file_path)) {
        json_error('Acesso negado', 403);
    }
    
    // Determinar content-type
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $content_types = [
        'kml' => 'application/vnd.google-earth.kml+xml',
        'kmz' => 'application/vnd.google-earth.kmz'
    ];
    
    $content_type = $content_types[$extension] ?? 'application/octet-stream';
    
    // Headers para download
    header('Content-Type: ' . $content_type);
    header('Content-Disposition: inline; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($file_path));
    header('Cache-Control: public, max-age=3600');
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', filemtime($file_path)) . ' GMT');
    
    // Servir o arquivo
    readfile($file_path);
    exit;
}

// ---------- ROTA NÃO ENCONTRADA ----------
json_error('Rota não encontrada. Ações disponíveis: list, get, create, update, upload, recent_files, last_file, last_uploads, last_upload, process_file, clear_cache, health, check_files, set_default, delete, download', 404);