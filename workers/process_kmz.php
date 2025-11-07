<?php
// workers/process_kmz.php
declare(strict_types=1);

// RDP simplification and projection functions adapted from JS version
class GeoSimplifier {
    private const R = 6371000;
    private float $lat0_rad;

    private function toMetersProj(float $lat, float $lng): array {
        return ['x' => self::R * deg2rad($lng) * cos($this->lat0_rad), 'y' => self::R * deg2rad($lat)];
    }

    private function segDist2(array $p, array $a, array $b): float {
        $vx = $b['x'] - $a['x'];
        $vy = $b['y'] - $a['y'];
        $wx = $p['x'] - $a['x'];
        $wy = $p['y'] - $a['y'];
        $c1 = $vx * $wx + $vy * $wy;
        if ($c1 <= 0) return $wx * $wx + $wy * $wy;
        $c2 = $vx * $vx + $vy * $vy;
        if ($c2 <= $c1) {
            $dx = $p['x'] - $b['x'];
            $dy = $p['y'] - $b['y'];
            return $dx * $dx + $dy * $dy;
        }
        $t = $c1 / $c2;
        $px = $a['x'] + $t * $vx;
        $py = $a['y'] + $t * $vy;
        $dx = $p['x'] - $px;
        $dy = $p['y'] - $py;
        return $dx * $dx + $dy * $dy;
    }

    public function simplify(array $coords, float $toleranceMeters): array {
        if (count($coords) <= 2) return $coords;

        $this->lat0_rad = deg2rad($coords[0][0]);
        $pointsXY = array_map(fn($c) => $this->toMetersProj($c[0], $c[1]), $coords);
        
        $tol2 = $toleranceMeters * $toleranceMeters;
        $keep = array_fill(0, count($pointsXY), false);
        $stack = [[0, count($pointsXY) - 1]];
        $keep[0] = $keep[count($pointsXY) - 1] = true;

        while (count($stack) > 0) {
            [$i, $j] = array_pop($stack);
            $maxD2 = -1;
            $idx = -1;
            for ($k = $i + 1; $k < $j; $k++) {
                $d2 = $this->segDist2($pointsXY[$k], $pointsXY[$i], $pointsXY[$j]);
                if ($d2 > $maxD2) {
                    $maxD2 = $d2;
                    $idx = $k;
                }
            }
            if ($maxD2 > $tol2 && $idx > 0) {
                $keep[$idx] = true;
                array_push($stack, [$i, $idx], [$idx, $j]);
            }
        }

        $result = [];
        foreach ($keep as $i => $v) {
            if ($v) $result[] = $coords[$i];
        }
        return $result;
    }
}

function extract_feed_from_text(?string $txt): ?string {
    if (!$txt) return null;
    if (preg_match('/\b([A-Z]{2,6})\s*[-_:.\s]*0*([0-9]{1,4})\b/i', strtoupper($txt), $m)) {
        return $m[1] . str_pad($m[2], 2, '0', STR_PAD_LEFT);
    }
    return null;
}

function get_alim_from_placemark(DOMElement $pm): ?string {
    $xpath = new DOMXPath($pm->ownerDocument);
    foreach ($xpath->query('.//Data', $pm) as $data) {
        $key = strtolower($data->getAttribute('name') ?? '');
        if (strpos($key, 'alimentador') !== false) {
            $val = $xpath->query('.//value', $data)[0]->nodeValue ?? null;
            if ($val) return extract_feed_from_text($val) ?? strtoupper($val);
        }
    }
    $node = $pm->parentNode;
    while ($node) {
        if ($node instanceof DOMElement && in_array($node->tagName, ['Folder', 'Document'])) {
            $name = $xpath->query('name', $node)[0]->nodeValue ?? null;
            $code = extract_feed_from_text($name);
            if ($code) return $code;
        }
        $node = $node->parentNode;
    }
    return null;
}

function find_feed_code_in_placemark(DOMElement $pm, DOMXPath $xpath): ?string {
    $name = $xpath->query('name', $pm)[0]->nodeValue ?? '';
    $byName = extract_feed_from_text($name);
    if ($byName) return $byName;

    foreach ($xpath->query('.//Data', $pm) as $data) {
        $val = $xpath->query('.//value', $data)[0]->nodeValue ?? null;
        $byExt = extract_feed_from_text($val);
        if ($byExt) return $byExt;
    }
    
    $node = $pm->parentNode;
    while ($node) {
        if ($node instanceof DOMElement && in_array($node->tagName, ['Folder', 'Document'])) {
            $name = $xpath->query('name', $node)[0]->nodeValue ?? null;
            $byFolder = extract_feed_from_text($name);
            if ($byFolder) return $byFolder;
        }
        $node = $node->parentNode;
    }
    return null;
}

function get_potencia(DOMElement $pm, DOMXPath $xpath): ?string {
    foreach ($xpath->query('.//Data', $pm) as $data) {
        $key = strtolower($data->getAttribute('name') ?? '');
        if (strpos($key, 'kva') !== false || strpos($key, 'pot') !== false) {
            $val = $xpath->query('.//value', $data)[0]->nodeValue ?? null;
            if ($val) return str_ireplace('kva', 'kVA', $val);
        }
    }
    return null;
}

function posto_group_by_name(?string $rawName, DOMElement $pm, DOMXPath $xpath): string {
    $n = strtoupper($rawName ?? '');
    if (strpos($n, '-FU') !== false) return 'FU';
    if (strpos($n, '-FA') !== false) return 'FA';
    if (strpos($n, '-RE') !== false) return 'RE';
    if (get_potencia($pm, $xpath)) return 'KVA';
    return 'OUTROS';
}

function parse_coord_block(?string $txt): array {
    if (!$txt) return [];
    $coords = [];
    $pairs = preg_split('/\s+/', trim($txt));
    foreach ($pairs as $p) {
        $parts = explode(',', $p);
        if (count($parts) >= 2) {
            $lat = floatval($parts[1]);
            $lng = floatval($parts[0]);
            if ($lat !== 0.0 || $lng !== 0.0) {
                $coords[] = [$lat, $lng];
            }
        }
    }
    return $coords;
}

// --- Main Execution ---

if (php_sapi_name() !== 'cli') exit("CLI only\n");

$inputFile = $argv[1] ?? '';
$outputFile = $argv[2] ?? '';

if (empty($inputFile) || empty($outputFile)) {
    echo "Usage: php process_kmz.php <input_file> <output_json>\n";
    exit(1);
}
if (!file_exists($inputFile)) {
    file_put_contents($outputFile, json_encode(['error' => 'input_file_missing']));
    exit(1);
}

$ext = strtolower(pathinfo($inputFile, PATHINFO_EXTENSION));
$tempKml = sys_get_temp_dir() . '/kml_proc_' . uniqid() . '.kml';
$foundKml = false;

if ($ext === 'kmz' || $ext === 'zip') {
    $zip = new ZipArchive();
    if ($zip->open($inputFile) === true) {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (preg_match('/\.kml$/i', $name) && strpos($name, '__MACOSX') === false) {
                $zip->extractTo(sys_get_temp_dir(), $name);
                $tempKml = sys_get_temp_dir() . '/' . $name;
                $foundKml = true;
                break;
            }
        }
        $zip->close();
    }
} elseif ($ext === 'kml') {
    copy($inputFile, $tempKml);
    $foundKml = true;
}

if (!$foundKml || !file_exists($tempKml)) {
    file_put_contents($outputFile, json_encode(['error' => 'kml_not_found']));
    exit(1);
}

$doc = new DOMDocument();
// Use libxml options to prevent issues with large text nodes and entities
if (!$doc->load($tempKml, LIBXML_NOENT | LIBXML_NOCDATA | LIBXML_COMPACT)) {
     file_put_contents($outputFile, json_encode(['error' => 'xml_load_failed']));
     @unlink($tempKml);
     exit(1);
}

$xpath = new DOMXPath($doc);
$placemarks = $xpath->query('//Placemark');

$output = ['lines' => [], 'markers' => [], 'stats' => ['lines' => 0, 'markers' => 0]];
$simplifier = new GeoSimplifier();
$LOD_TOLS = ['coarse' => 30.0, 'mid' => 12.0, 'fine' => 4.0];

foreach ($placemarks as $pm) {
    $rawName = $xpath->query('name', $pm)[0]->nodeValue ?? '';
    
    // Process Points (Markers)
    $pointCoords = $xpath->query('.//Point/coordinates', $pm)[0]->nodeValue ?? null;
    if ($pointCoords) {
        $coords = parse_coord_block($pointCoords);
        if (count($coords) > 0) {
            [$lat, $lng] = $coords[0];
            $alim = get_alim_from_placemark($pm);
            $pot = get_potencia($pm, $xpath);

            $output['markers'][] = [
                'name' => $rawName,
                'group' => posto_group_by_name($rawName, $pm, $xpath),
                'coords' => [$lat, $lng],
                'extra' => [
                    'Alim' => $alim,
                    'Potência' => $pot,
                ]
            ];
            $output['stats']['markers']++;
        }
        continue;
    }

    // Process Lines
    $lineCoordsNodes = $xpath->query('.//LineString/coordinates | .//MultiGeometry/LineString/coordinates', $pm);
    if ($lineCoordsNodes->length > 0) {
        foreach ($lineCoordsNodes as $node) {
            $coordsRaw = parse_coord_block($node->nodeValue);
            if (count($coordsRaw) > 1) {
                $fine = $simplifier->simplify($coordsRaw, $LOD_TOLS['fine']);
                $mid = $simplifier->simplify($fine, $LOD_TOLS['mid']);
                $coarse = $simplifier->simplify($mid, $LOD_TOLS['coarse']);

                $output['lines'][] = [
                    'group' => find_feed_code_in_placemark($pm, $xpath) ?? get_alim_from_placemark($pm) ?? 'AUTO',
                    'lods' => [
                        'coarse' => $coarse,
                        'mid' => $mid,
                        'fine' => $fine,
                    ]
                ];
                $output['stats']['lines']++;
            }
        }
        continue;
    }
}

// Atomic write to output file
$tmpPath = $outputFile . '.tmp.' . uniqid();
file_put_contents($tmpPath, json_encode($output), LOCK_EX);
rename($tmpPath, $outputFile);

@unlink($tempKml);
exit(0);