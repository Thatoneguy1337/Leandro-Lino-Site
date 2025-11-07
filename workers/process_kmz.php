<?php
// workers/process_kmz.php
declare(strict_types=1);

if (php_sapi_name() !== 'cli') exit("CLI only\n");

$in = $argv[1] ?? '';
$metaPath = $argv[2] ?? '';

if (!file_exists($in)) {
    if ($metaPath) file_put_contents($metaPath, json_encode(['error'=>'file_missing','processing'=>false]));
    exit(1);
}

$ext = strtolower(pathinfo($in, PATHINFO_EXTENSION));

$tempKml = sys_get_temp_dir() . '/kml_' . uniqid() . '.kml';
$foundKml = false;

if ($ext === 'kmz' || $ext === 'zip') {
    $zip = new ZipArchive();
    if ($zip->open($in) === true) {
        // tenta localizar o primeiro .kml (preferir doc.kml ou root .kml)
        for ($i=0; $i<$zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (preg_match('/\\.kml$/i', $name)) {
                // extrai para arquivo temp
                $stream = $zip->getStream($name);
                if ($stream) {
                    $out = fopen($tempKml, 'wb');
                    while (!feof($stream)) {
                        fwrite($out, fread($stream, 8192));
                    }
                    fclose($out);
                    fclose($stream);
                    $foundKml = true;
                    break;
                }
            }
        }
        $zip->close();
    }
} elseif ($ext === 'kml') {
    copy($in, $tempKml);
    $foundKml = true;
}

$meta = ['processing' => true, 'updatedAt' => time()];

if ($foundKml && file_exists($tempKml)) {
    // streaming parse: conta <Placemark> e extrai coords para bbox
    $reader = new XMLReader();
    if ($reader->open($tempKml)) {
        $placemarkCount = 0;
        $minLat = $minLon = INF;
        $maxLat = $maxLon = -INF;

        while ($reader->read()) {
            if ($reader->nodeType === XMLReader::ELEMENT && strtolower($reader->localName) === 'placemark') {
                $placemarkCount++;
            }

            // captura nós <coordinates> (conteúdo como texto)
            if ($reader->nodeType === XMLReader::ELEMENT && strtolower($reader->localName) === 'coordinates') {
                $coordsText = $reader->readInnerXML();
                if ($coordsText) {
                    // normaliza: múltiplas coordenadas separadas por espaço/linha
                    $coordsText = trim(preg_replace('/\\s+/', ' ', $coordsText));
                    $pairs = preg_split('/\\s+/', $coordsText);
                    foreach ($pairs as $pair) {
                        // formato: lon,lat[,alt]
                        $parts = explode(',', trim($pair));
                        if (count($parts) >= 2) {
                            $lon = floatval($parts[0]);
                            $lat = floatval($parts[1]);
                            if ($lat !== 0.0 || $lon !== 0.0) {
                                $minLat = min($minLat, $lat);
                                $maxLat = max($maxLat, $lat);
                                $minLon = min($minLon, $lon);
                                $maxLon = max($maxLon, $lon);
                            }
                        }
                    }
                }
            }
        }
        $reader->close();

        // se não houve coords válidas, set nulls
        if (!is_finite($minLat)) { $minLat = $minLon = $maxLat = $maxLon = null; }

        $meta['placemarks'] = $placemarkCount;
        $meta['bbox'] = $minLat === null ? null : ['minLat'=>$minLat,'minLon'=>$minLon,'maxLat'=>$maxLat,'maxLon'=>$maxLon];
        $meta['processing'] = false;
        $meta['processedAt'] = time();
    } else {
        $meta['error'] = 'cannot_open_kml';
        $meta['processing'] = false;
    }

    // remove temp KML
    @unlink($tempKml);
} else {
    $meta['error'] = 'kml_not_found_in_kmz';
    $meta['processing'] = false;
}

// grava metadados atômico
if ($metaPath) {
    $tmp = $metaPath . '.tmp';
    file_put_contents($tmp, json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    @rename($tmp, $metaPath);
}

exit(0);
