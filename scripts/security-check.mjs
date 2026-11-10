#!/usr/bin/env node
// scripts/security-check.mjs
// Verifica il bundle di produzione (dist/) per:
//  1) assenza di segreti noti (service_role, chiavi Google, chiavi private, JWT)
//  2) assenza di sourcemap (non devono leakare il sorgente)
// Esce con codice 1 se trova violazioni: blocca la pubblicazione.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';

// Pattern di segreti che NON devono mai finire nel client.
const PATTERNS = [
  { name: 'Supabase service_role JWT', regex: /service_role/i },
  { name: 'Supabase service_role key', regex: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: 'Google API key (AIza...)', regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Google OAuth secret (GOCSPX-...)', regex: /GOCSPX-[0-9A-Za-z\-_]{28}/ },
  { name: 'Chiave privata PEM', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Segreto generico assegnato', regex: /(client_secret|private_key)\s*[:=]\s*["'][^"']{12,}["']/i },
];

// Fughe informative che non devono comparire nel bundle pubblicato.
const LEAK_PATTERNS = [
  { name: 'localizzatore del sorgente (data-mgx)', regex: /data-mgx/i },
  { name: 'riferimento a fornitore esterno (metagptx/metadl)', regex: /metagptx|metadl\.com/i },
];

// Il bundle di produzione deve riportare l'avviso di copyright proprietario.
const COPYRIGHT_MARKER = /Tutti i diritti riservati/i;

let violations = 0;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fail(msg) {
  console.error(`  ✖ ${msg}`);
  violations++;
}

console.log('🔒 Security check del bundle di produzione\n');

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`Errore: cartella "${DIST}" non trovata. Esegui prima "pnpm build".`);
  process.exit(1);
}

// 1) Nessun sourcemap
const maps = files.filter((f) => f.endsWith('.map'));
if (maps.length > 0) {
  console.log('Sourcemap:');
  maps.forEach((m) => fail(`sourcemap esposto: ${relative(DIST, m)}`));
} else {
  console.log('  ✓ nessun sourcemap nel bundle');
}

// 2) Nessun segreto
console.log('\nScansione segreti:');
// Gli asset OCR locali (Tesseract) sono glue/WASM di terze parti scaricati in
// fase di build: il binario embeddato in base64 può generare falsi positivi sui
// pattern dei segreti. Non contengono codice nostro, quindi sono esclusi.
const isOcrAsset = (f) => relative(DIST, f).replace(/\\/g, '/').startsWith('tesseract/');
const textFiles = files
  .filter((f) => /\.(js|mjs|cjs|css|html|json|txt)$/.test(f))
  .filter((f) => !isOcrAsset(f));
let found = false;
for (const file of textFiles) {
  const content = readFileSync(file, 'utf8');
  for (const { name, regex } of PATTERNS) {
    if (regex.test(content)) {
      fail(`${name} trovato in ${relative(DIST, file)}`);
      found = true;
    }
  }
}
if (!found) console.log(`  ✓ nessun segreto rilevato in ${textFiles.length} file`);

// 3) Nessuna fuga informativa (localizzatore sorgente, riferimenti al fornitore)
console.log('\nScansione fughe informative:');
let leaked = false;
for (const file of textFiles) {
  const content = readFileSync(file, 'utf8');
  for (const { name, regex } of LEAK_PATTERNS) {
    if (regex.test(content)) {
      fail(`${name} trovato in ${relative(DIST, file)}`);
      leaked = true;
    }
  }
}
if (!leaked) console.log('  ✓ nessuna fuga informativa rilevata');

// 4) L'avviso di copyright deve essere presente nel bundle pubblicato
console.log('\nAvviso di copyright:');
const copyrightFound = textFiles.some((f) => {
  if (!/\.(js|mjs|cjs|html)$/.test(f)) return false;
  return COPYRIGHT_MARKER.test(readFileSync(f, 'utf8'));
});
if (copyrightFound) {
  console.log('  ✓ avviso di copyright presente nel bundle');
} else {
  fail('avviso di copyright assente: il bundle non riporta la dicitura proprietaria');
}

// 5) PWA e protezioni anti-copia (service worker, manifest, icone, impronta di build)
console.log('\nPWA e protezioni anti-copia:');
const rel = (f) => relative(DIST, f).replace(/\\/g, '/');
const hasFile = (name) => files.some((f) => rel(f) === name);
const beforePwa = violations;

const sw = files.find((f) => rel(f) === 'sw.js');
if (!sw) {
  fail('service worker assente (dist/sw.js)');
} else {
  const swContent = readFileSync(sw, 'utf8');
  if (!COPYRIGHT_MARKER.test(swContent)) fail('sw.js senza avviso di copyright');
  if (!/addEventListener\(\s*['"]fetch['"]/.test(swContent)) fail('sw.js senza gestione cache (fetch)');
  if (!/addEventListener\(\s*['"]push['"]/.test(swContent)) fail('sw.js senza gestione notifiche push');
}

if (!hasFile('manifest.webmanifest')) fail('manifest PWA assente');
if (!hasFile('icons/icon.svg')) fail('icona PWA assente (icons/icon.svg)');
if (!hasFile('icons/icon-maskable.svg')) fail('icona PWA maskable assente (icons/icon-maskable.svg)');

const indexFile = files.find((f) => rel(f) === 'index.html');
if (!indexFile) {
  fail('index.html assente nel bundle');
} else {
  const html = readFileSync(indexFile, 'utf8');
  if (!/rel="manifest"/.test(html)) fail('index.html senza collegamento al manifest PWA');
  if (!/name="app-build"/.test(html)) fail('index.html senza impronta di build (protezione integrità)');
  if (/__APP_BUILD_ID__/.test(html)) fail('impronta di build non iniettata in index.html');
}

if (violations === beforePwa) {
  console.log('  ✓ service worker, manifest, icone e impronta di build presenti');
}

console.log('');
if (violations > 0) {
  console.error(`❌ Security check FALLITO: ${violations} violazione/i.`);
  process.exit(1);
}
console.log('✅ Security check superato.');
