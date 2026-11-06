// Helper per l'archiviazione documenti su Supabase Storage.
// I file vivono nel bucket privato "haccp-docs" sotto "<company_id>/<cartella>/<file>".
// Il client invia/riceve base64; l'isolamento per azienda è garantito lato server.

import { activeDocs } from './api';

/** Cartelle convenzionali dentro lo spazio dell'azienda. */
export const DOC_FOLDERS = {
  registri: 'registri',
  firma: 'firma',
  semilavorati: 'semilavorati',
  ingresso: 'ingresso',
  documenti: 'documenti',
} as const;

/** Converte un Blob/File in stringa base64 (senza prefisso data URL). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Impossibile leggere il file'));
    reader.readAsDataURL(blob);
  });
}

/** Ricostruisce un Blob da base64 + mime type. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

/** Avvia il download di un Blob nel browser. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Codifica una stringa UTF-8 in base64 (per il salvataggio di file di testo). */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Elenca i file di una cartella dell'azienda, opzionalmente filtrati per nome. */
export async function listFolder(folder: string) {
  const { files } = await activeDocs.list(folder);
  return files;
}

/** Cerca un file per nome esatto all'interno di una cartella dell'azienda. */
export async function findFileByName(folder: string, name: string) {
  const files = await listFolder(folder);
  return files.find((f) => f.name === name) ?? null;
}

/** Legge il contenuto testuale di un file archiviato, o null se non esiste. */
export async function readTextFile(folder: string, name: string): Promise<string | null> {
  const file = await findFileByName(folder, name);
  if (!file) return null;
  const { base64, mimeType } = await activeDocs.download(file.path);
  return await base64ToBlob(base64, mimeType).text();
}

/** Scrive (crea o sovrascrive) un file di testo in una cartella dell'azienda. */
export async function writeTextFile(
  folder: string,
  name: string,
  text: string,
  mimeType = 'text/plain'
): Promise<void> {
  await activeDocs.upload({
    path: `${folder}/${name}`,
    base64: textToBase64(text),
    mimeType,
  });
}
