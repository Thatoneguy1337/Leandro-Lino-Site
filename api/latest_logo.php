<?php
// api/latest_logo.php
header('Content-Type: application/json; charset=utf-8');

$uploadsDir = __DIR__ . '/../uploads/';
$defaultLogo = 'assets/img/image.png';

// Encontra todos os logos customizados
$customLogos = glob($uploadsDir . 'logo-*.png');

if (empty($customLogos)) {
  // Se não houver logos customizados, retorna o padrão
  echo json_encode(['ok' => true, 'logoUrl' => $defaultLogo, 'isDefault' => true]);
  exit;
}

// Ordena os arquivos pela data de modificação (mais recente primeiro)
array_multisort(
  array_map('filemtime', $customLogos),
  SORT_DESC,
  $customLogos
);

// Pega o caminho do mais recente
$latestLogo = $customLogos[0];

// Constrói a URL relativa a partir da raiz do projeto
$relativePath = 'uploads/' . basename($latestLogo);

echo json_encode(['ok' => true, 'logoUrl' => $relativePath, 'isDefault' => false]);
