#!/usr/bin/env node
// scripts/copy-tesseract.mjs
// Prepara gli asset dell'OCR locale (Tesseract) dentro "public/tesseract", così
// che il riconoscimento avvenga INTERAMENTE sul dispositivo, servito dalla nostra
// origine. Nessun CDN esterno a runtime: la CSP resta stretta e nulla viene
// inviato a server terzi.
//
// Asset scaricati ad ogni build (con cache su disco, non committati in git):
//   - worker.min.js                          (Web Worker di Tesseract)
//   - tesseract-core-*-lstm.wasm.js          (core WASM con binario embeddato)
//   - ita.traineddata.gz                     (modello lingua italiano "fast")
//
// Nota tecnica: i file "tesseract-core-*-lstm.wasm.js" contengono già il binario
// WASM in base64 (SINGLE_FILE). I file ".wasm" separati NON servono e non vengono
// scaricati.
//
// Varianti del core: l'app usa OEM=LSTM_ONLY, quindi il worker carica una di
// queste in base al supporto SIMD del dispositivo (relaxedSIMD → SIMD → base).
//
// Se un download fallisce il build NON viene interrotto: l'OCR locale degrada
// con un errore gestito a runtime (resta disponibile la lettura via AI/manuale).

import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'tesseract');

const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const CDN = 'https://cdn.jsdelivr.net/npm';
const TESSDATA = 'https://tessdata.projectnaptha.com/4.0.0_fast';

// Varianti del core (OEM=LSTM_ONLY): il worker ne carica una in base al SIMD.
const CORE_VARIANTS = ['lstm', 'simd-lstm', 'relaxedsimd-lstm'];

const ASSETS = [
  { url: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`, file: 'worker.min.js' },
  ...CORE_VARIANTS.map((v) => ({
    url: `${CDN}/tesseract.js-core@${CORE_VERSION}/tesseract-core-${v}.wasm.js`,
    file: `tesseract-core-${v}.wasm.js`,
  })),
  { url: `${TESSDATA}/ita.traineddata.gz`, file: 'ita.traineddata.gz' },
];

async function download(url, file) {
  const target = join(OUT_DIR, file);
  if (existsSync(target) && statSync(target).size > 0) {
    return { file, skipped: true };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buffer);
  return { file, size: buffer.length };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('OCR locale: preparazione asset Tesseract…');

  const failures = [];
  for (const asset of ASSETS) {
    try {
      const r = await download(asset.url, asset.file);
      if (r.skipped) console.log(`  = ${r.file} (già presente)`);
      else console.log(`  + ${r.file} (${Math.round(r.size / 1024)} KB)`);
    } catch (e) {
      failures.push({ file: asset.file, error: e.message });
      console.warn(`  ! ${asset.file}: ${e.message}`);
    }
  }

  if (failures.length > 0) {
    console.warn(
      `\nAttenzione: ${failures.length} asset OCR non scaricato/i. ` +
        'La lettura offline potrebbe non funzionare in questa build (la lettura AI resta disponibile).'
    );
  } else {
    console.log('Asset OCR pronti in public/tesseract.\n');
  }
}

main();
