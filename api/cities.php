<?php
// cities.php - Versão para ler arquivos das pastas
declare(strict_types=1);

// HEADERS PRIMEIRO
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// ======== Configuração ========
$ROOT = dirname(__DIR__);
$UPLOAD_DIR = $ROOT . '/uploads/cities';
$DB_JSON = $ROOT . '/uploads/cities/_index.json';

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
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $status = 400): void {
    json_response(['ok' => false, 'error' => $message], $status);
}

// ======== Função para escanear arquivos KMZ nas pastas ========
function scan_kmz_files(): array {
    global $UPLOAD_DIR;
    
    $cities = [];
    
    if (!is_dir($UPLOAD_DIR)) {
        return $cities;
    }
    
    // Scan das pastas dentro de /uploads/cities/
    $folders = scandir($UPLOAD_DIR);
    
    foreach ($folders as $folder) {
        if ($folder === '.' || $folder === '..') continue;
        
        $city_path = $UPLOAD_DIR . '/' . $folder;
        
        // Verifica se é uma pasta
        if (is_dir($city_path)) {
            // Procura por arquivos KMZ/KML dentro da pasta
            $files = scandir($city_path);
            $kmz_files = array_filter($files, function($file) {
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                return in_array($ext, ['kml', 'kmz']) && $file !== '.' && $file !== '..';
            });
            
            if (!empty($kmz_files)) {
                $kmz_file = reset($kmz_files); // Pega o primeiro arquivo
                $file_path = $city_path . '/' . $kmz_file;
                
                $city_data = [
                    'id' => $folder,
                    'name' => ucfirst(str_replace(['_', '-'], ' ', $folder)), // Nome amigável
                    'prefix' => strtoupper(substr($folder, 0, 3)),
                    'updatedAt' => filemtime($file_path),
                    'isDefault' => false,
                    'file' => [
                        'name' => $kmz_file,
                        'size' => filesize($file_path),
                        'url' => '/uploads/cities/' . $folder . '/' . $kmz_file,
                        'uploadedAt' => filemtime($file_path)
                    ]
                ];
                
                $cities[] = $city_data;
            }
        }
    }
    
    return $cities;
}

// ======== Função para combinar dados do índice com arquivos físicos ========
function get_cities_combined(): array {
    $index_cities = load_index();
    $physical_cities = scan_kmz_files();
    
    // Se não há cidades físicas, retorna as do índice
    if (empty($physical_cities)) {
        return $index_cities;
    }
    
    // Combina os dados: prioriza arquivos físicos, mas mantém metadados do índice
    $combined = [];
    
    foreach ($physical_cities as $physical_city) {
        $city_id = $physical_city['id'];
        $index_city = null;
        
        // Procura se esta cidade existe no índice
        foreach ($index_cities as $ic) {
            if ($ic['id'] === $city_id) {
                $index_city = $ic;
                break;
            }
        }
        
        if ($index_city) {
            // Usa metadados do índice, mas atualiza com arquivo físico
            $combined[] = [
                'id' => $index_city['id'],
                'name' => $index_city['name'],
                'prefix' => $index_city['prefix'],
                'updatedAt' => $physical_city['updatedAt'], // Usa timestamp do arquivo
                'isDefault' => $index_city['isDefault'] ?? false,
                'defaultAt' => $index_city['defaultAt'] ?? null,
                'file' => $physical_city['file'] // Usa arquivo físico
            ];
        } else {
            // Cidade só existe fisicamente
            $combined[] = $physical_city;
        }
    }
    
    return $combined;
}

// ======== CORS ========
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

// ======== Router Principal ========
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

try {
    // Garantir diretórios
    if (!is_dir($UPLOAD_DIR)) { 
        @mkdir($UPLOAD_DIR, 0775, true); 
    }
    if (!file_exists($DB_JSON)) { 
        @file_put_contents($DB_JSON, json_encode([])); 
    }

    // ---------- LISTAR CIDADES ----------
    if ($method === 'GET' && ($action === '' || $action === 'list')) {
        $cities = get_cities_combined();
        
        json_response(['ok' => true, 'data' => $cities]);
    }

    // ---------- OBTER CIDADE ESPECÍFICA ----------
    if ($method === 'GET' && $action === 'get') {
        $id = $_GET['id'] ?? '';
        if (empty($id)) json_error('ID obrigatório');
        
        $cities = get_cities_combined();
        foreach ($cities as $city) {
            if ($city['id'] === $id) {
                json_response(['ok' => true, 'data' => $city]);
            }
        }
        
        json_error('Cidade não encontrada', 404);
    }

    // ---------- SCAN DE ARQUIVOS FÍSICOS ----------
    if ($method === 'GET' && $action === 'scan') {
        $physical_cities = scan_kmz_files();
        $index_cities = load_index();
        
        json_response([
            'ok' => true,
            'data' => [
                'physical_cities' => $physical_cities,
                'index_cities' => $index_cities,
                'total_physical' => count($physical_cities),
                'total_index' => count($index_cities)
            ]
        ]);
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
        
        // Criar diretório da cidade
        $city_dir = $UPLOAD_DIR . '/' . $id;
        if (!is_dir($city_dir)) {
            @mkdir($city_dir, 0775, true);
        }
        
        json_response(['ok' => true, 'data' => $new_city], 201);
    }

    // ---------- UPLOAD DE ARQUIVO ----------
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
        
        // Limpar arquivos anteriores KMZ/KML
        $files = scandir($city_dir);
        foreach ($files as $existing_file) {
            $ext = strtolower(pathinfo($existing_file, PATHINFO_EXTENSION));
            if (in_array($ext, ['kml', 'kmz']) && $existing_file !== '.' && $existing_file !== '..') {
                @unlink($city_dir . '/' . $existing_file);
            }
        }
        
        if (!move_uploaded_file($file['tmp_name'], $target_path)) {
            json_error('Erro ao salvar arquivo');
        }
        
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
        
        json_response([
            'ok' => true, 
            'data' => [
                'id' => $city['id'],
                'name' => $city['name'],
                'prefix' => $city['prefix'],
                'updatedAt' => $index[$city_index]['updatedAt'],
                'isDefault' => (bool)($city['isDefault'] ?? false),
                'file' => [
                    'name' => $safe_filename,
                    'size' => filesize($target_path),
                    'url' => '/uploads/cities/' . $id . '/' . $safe_filename,
                    'uploadedAt' => time()
                ]
            ]
        ]);
    }

    // ---------- HEALTH CHECK ----------
    if ($method === 'GET' && $action === 'health') {
        $physical_cities = scan_kmz_files();
        $index_cities = load_index();
        
        json_response([
            'ok' => true,
            'status' => 'operational',
            'physical_cities_count' => count($physical_cities),
            'index_cities_count' => count($index_cities),
            'upload_dir_exists' => is_dir($UPLOAD_DIR),
            'timestamp' => time()
        ]);
    }

    // ---------- ROTA NÃO ENCONTRADA ----------
    json_error('Rota não encontrada. Ações disponíveis: list, get, scan, create, upload, health', 404);

} catch (Exception $e) {
    error_log("Cities API Error: " . $e->getMessage());
    
    json_response([
        'ok' => false,
        'error' => 'Erro interno do servidor',
        'debug' => $e->getMessage() // Remover em produção
    ], 500);
}