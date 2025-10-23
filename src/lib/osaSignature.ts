import { googleDriveManager } from './googleDrive';

export interface OsaSignatureInfo {
  exists: boolean;
  blob?: Blob;
  fileName?: string;
}

export interface SignatureOptions {
  clip?: { x: number; y: number; width: number; height: number };
  margin?: number; // spazio interno al box per non toccare i bordi
  center?: boolean; // centra la firma nel box di destinazione
  scale?: number; // fattore di scala (0.5–1.0), default 0.95
  trim?: boolean; // ritaglia bordi bianchi/trasparenti
  whiteThreshold?: number; // 0–255, default 250
  alphaThreshold?: number; // 0–255, default 10
}

/**
 * Recupera la firma OSA da Google Drive se disponibile
 */
export async function getOsaSignature(): Promise<OsaSignatureInfo> {
  try {
    const { rootId } = await googleDriveManager.getHaccpFolderStructure();
    
    // Cerca cartella Firma_OSA
    const signatureFolder = await googleDriveManager.findFileByName('Firma_OSA', rootId);
    if (!signatureFolder) {
      return { exists: false };
    }

    // Cerca file firma esistente (PNG, JPG, JPEG)
    const signatureFiles = await googleDriveManager.listFiles(signatureFolder.id);
    const signatureFile = signatureFiles.find(f => 
      f.name.toLowerCase().match(/\.(png|jpg|jpeg)$/i)
    );

    if (!signatureFile) {
      return { exists: false };
    }

    // Scarica il file firma
    const blob = await googleDriveManager.downloadFile(signatureFile.id);
    
    return {
      exists: true,
      blob,
      fileName: signatureFile.name
    };
  } catch (error) {
    console.error('Errore recupero firma OSA:', error);
    return { exists: false };
  }
}

/**
 * Aggiunge la firma OSA a un documento jsPDF con opzioni di
 * clipping, margine e centratura per evitare che copra le linee della tabella.
 * @param doc - Documento jsPDF
 * @param signatureBlob - Blob dell'immagine della firma
 * @param x - Posizione X del box di destinazione
 * @param y - Posizione Y del box di destinazione
 * @param width - Larghezza massima del box di destinazione
 * @param height - Altezza massima del box di destinazione
 * @param options - Opzioni di rendering (clip, margin, center)
 * @returns true se l'inserimento è riuscito, altrimenti false
 */
export async function addSignatureToPdf(
  doc: any, // jsPDF instance
  signatureBlob: Blob,
  x: number = 20,
  y: number = 20,
  width: number = 40,
  height: number = 20,
  options?: SignatureOptions
): Promise<boolean> {
  try {
    // Converti blob in base64
    const arrayBuffer = await signatureBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    
    // Determina il formato dell'immagine
    const mimeType = signatureBlob.type || 'image/png';
    let format = 'PNG';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      format = 'JPEG';
    }

    // Prepara data URL di partenza
    let imageDataUrl = `data:${mimeType};base64,${base64}`;

    // Opzionale: ritaglio dei bordi bianchi/trasparenti
    if (options?.trim !== false) {
      const alphaT = Math.max(0, Math.min(255, options?.alphaThreshold ?? 10));
      const whiteT = Math.max(0, Math.min(255, options?.whiteThreshold ?? 250));
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // carica immagine originale
        const img0 = new Image();
        img0.src = imageDataUrl;
        await new Promise((resolve, reject) => {
          img0.onload = resolve as any;
          img0.onerror = reject as any;
        });
        canvas.width = img0.naturalWidth;
        canvas.height = img0.naturalHeight;
        ctx.drawImage(img0, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // trova bounding box di pixel non bianchi/non trasparenti
        let top = 0, bottom = canvas.height - 1, left = 0, right = canvas.width - 1;
        const hasContent = (idx: number) => {
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          const isOpaque = a > alphaT;
          const isNotWhite = r < whiteT || g < whiteT || b < whiteT;
          return isOpaque && isNotWhite;
        };
        // scan top
        outerTop: for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (hasContent(i)) { top = y; break outerTop; }
          }
        }
        // scan bottom
        outerBottom: for (let y = canvas.height - 1; y >= 0; y--) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (hasContent(i)) { bottom = y; break outerBottom; }
          }
        }
        // scan left
        outerLeft: for (let x = 0; x < canvas.width; x++) {
          for (let y = top; y <= bottom; y++) {
            const i = (y * canvas.width + x) * 4;
            if (hasContent(i)) { left = x; break outerLeft; }
          }
        }
        // scan right
        outerRight: for (let x = canvas.width - 1; x >= 0; x--) {
          for (let y = top; y <= bottom; y++) {
            const i = (y * canvas.width + x) * 4;
            if (hasContent(i)) { right = x; break outerRight; }
          }
        }
        // se bounds validi, ritaglia
        if (right > left && bottom > top) {
          const w = right - left + 1;
          const h = bottom - top + 1;
          const out = document.createElement('canvas');
          out.width = w;
          out.height = h;
          const octx = out.getContext('2d');
          if (octx) {
            octx.drawImage(canvas, left, top, w, h, 0, 0, w, h);
            imageDataUrl = out.toDataURL('image/png');
            format = 'PNG'; // il ritaglio produce PNG
          }
        }
      }
    }

    // Carica l’immagine (eventualmente ritagliata) per ottenere dimensioni naturali
    const img = new Image();
    img.src = imageDataUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve as any;
      img.onerror = reject as any;
    });

    // Calcolo del box effettivo con margine
    const margin = Math.max(0, options?.margin ?? 0.8); // mm
    const boxX = x + margin;
    const boxY = y + margin;
    const boxW = Math.max(0.1, width - margin * 2);
    const boxH = Math.max(0.1, height - margin * 2);

    // Mantieni proporzioni e applica scala
    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    const ratioImg = naturalW / naturalH;
    const ratioBox = boxW / boxH;

    let drawW: number;
    let drawH: number;
    if (ratioImg > ratioBox) {
      drawW = boxW;
      drawH = boxW / ratioImg;
    } else {
      drawH = boxH;
      drawW = boxH * ratioImg;
    }
    const scale = Math.max(0.5, Math.min(1.0, options?.scale ?? 0.95));
    drawW *= scale;
    drawH *= scale;

    // Calcola centratura
    const center = options?.center !== false;
    const offsetX = center ? (boxW - drawW) / 2 : 0;
    const offsetY = center ? (boxH - drawH) / 2 : 0;
    const drawX = boxX + offsetX;
    const drawY = boxY + offsetY;

    // Clipping per non superare i bordi della cella/tabella
    const clipRect = options?.clip ?? { x, y, width, height };
    try {
      if (typeof doc.saveGraphicsState === 'function') {
        doc.saveGraphicsState();
      }
      doc.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
      if (typeof doc.clip === 'function') {
        doc.clip();
      }
      doc.addImage(imageDataUrl, format, drawX, drawY, drawW, drawH);
      if (typeof doc.restoreGraphicsState === 'function') {
        doc.restoreGraphicsState();
      }
    } catch {
      doc.addImage(imageDataUrl, format, drawX, drawY, drawW, drawH);
    }

    return true;
  } catch (error) {
    console.error('Errore aggiunta firma al PDF:', error);
    return false;
  }
}

/**
 * Verifica se la firma OSA è disponibile
 */
export async function isOsaSignatureAvailable(): Promise<boolean> {
  const signature = await getOsaSignature();
  return signature.exists;
}