// src/printing/core/labelRenderer.ts
// Genera il documento etichetta a partire dai dati del prodotto e lo disegna su
// un canvas. Il layout è calcolato in millimetri e si adatta automaticamente al
// formato scelto, dando la massima evidenza al nome del prodotto.

import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { LabelPayload } from '@/lib/api';
import { mmToDots, type LabelDocument, type LabelElement, type ResolvedLabelFormat } from './types';

/** Formatta una data ISO (YYYY-MM-DD) in formato italiano DD/MM/YYYY. */
export function formatDateIt(iso: string | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (y && m && d) return `${d}/${m}/${y}`;
  return iso;
}

/** Contenuto informativo del QR: identificativo del prodotto e lotto. */
function qrPayload(p: LabelPayload): string {
  const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  const params = new URLSearchParams();
  params.set('prodotto', p.prodotto || '');
  params.set('lotto', p.lottoProdotto || '');
  return `${base}/?${params.toString()}`;
}

/**
 * Costruisce il documento etichetta con gli elementi posizionati.
 * Ordine visivo: nome prodotto (evidente) → righe informative → QR/barcode → ristorante.
 */
export function buildLabelDocument(payload: LabelPayload, format: ResolvedLabelFormat): LabelDocument {
  const { widthMm, heightMm, marginMm, fontScale } = format;
  const elements: LabelElement[] = [];

  const innerX = marginMm;
  const innerY = marginMm;
  const innerW = Math.max(widthMm - marginMm * 2, 8);
  const innerH = Math.max(heightMm - marginMm * 2, 6);

  // Riserve dal basso: nome ristorante e (opzionale) codice a barre.
  const brandH = format.showRestaurant ? Math.min(innerH * 0.14, 3.4) : 0;
  const barcodeH = format.showBarcode ? Math.min(innerH * 0.28, 7) : 0;

  const contentH = Math.max(innerH - brandH - barcodeH, 4);

  // Il nome del prodotto occupa la fascia superiore e resta l'elemento dominante.
  const nameH = Math.max(contentH * 0.3, 3.6);
  const infoH = Math.max(contentH - nameH, 2.5);

  const nameFont = Math.min(nameH * 0.62, 4.6) * fontScale;
  elements.push({
    type: 'text',
    text: payload.prodotto || '',
    x: innerX,
    y: innerY,
    w: innerW,
    h: nameH,
    fontMm: nameFont,
    bold: true,
    align: 'left',
    maxLines: 2,
    autoShrink: true,
  });

  // Area informativa: le righe occupano la sinistra se c'è il QR, altrimenti tutta la larghezza.
  const qrSize = format.showQr ? Math.min(infoH, innerW * 0.36) : 0;
  const gap = qrSize > 0 ? Math.max(innerW * 0.03, 1) : 0;
  const infoW = Math.max(innerW - qrSize - gap, 10);

  const lines: string[] = [`Prodotto: ${formatDateIt(payload.dataProduzione)}`];
  if (payload.preparatoIl) lines.push(`Preparato: ${payload.preparatoIl}`);
  lines.push(`Scadenza: ${formatDateIt(payload.dataScadenza)}`);
  lines.push(`Lotto: ${payload.lottoProdotto || '—'}`);
  if (payload.quantita) {
    const q = payload.unita ? `${payload.quantita} ${payload.unita}` : payload.quantita;
    lines.push(`Quantità: ${q}`);
  }

  const lineH = infoH / lines.length;
  const infoFont = Math.min(lineH * 0.66, 3.1) * fontScale;
  lines.forEach((text, i) => {
    elements.push({
      type: 'text',
      text,
      x: innerX,
      y: innerY + nameH + i * lineH,
      w: infoW,
      h: lineH,
      fontMm: infoFont,
      align: 'left',
      maxLines: 1,
      autoShrink: true,
    });
  });

  if (qrSize > 0) {
    elements.push({
      type: 'qr',
      data: qrPayload(payload),
      x: innerX + innerW - qrSize,
      y: innerY + nameH + (infoH - qrSize) / 2,
      size: qrSize,
    });
  }

  if (barcodeH > 0) {
    elements.push({
      type: 'barcode',
      data: payload.lottoProdotto || '-',
      format: format.barcodeFormat,
      x: innerX,
      y: innerY + contentH,
      w: innerW,
      h: barcodeH - 0.6,
    });
  }

  if (brandH > 0) {
    elements.push({
      type: 'text',
      text: payload.ristorante || '',
      x: innerX,
      y: innerY + innerH - brandH,
      w: innerW,
      h: brandH,
      fontMm: Math.min(brandH * 0.72, 2.6) * fontScale,
      bold: true,
      align: 'center',
      maxLines: 1,
      autoShrink: true,
    });
  }

  return { format, elements };
}

/** Spezza il testo in righe che rientrano in `maxWidthPx` (massimo `maxLines`). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidthPx: number, maxLines: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidthPx || current === '') {
      current = candidate;
    } else {
      out.push(current);
      current = word;
      if (out.length === maxLines) break;
    }
  }
  if (out.length < maxLines) out.push(current);
  return out.slice(0, maxLines);
}

/**
 * Disegna il documento su un canvas con la stessa risoluzione della stampante
 * (1 pixel canvas = 1 dot), per evitare riscalature in fase di rasterizzazione.
 */
export async function renderDocumentToCanvas(doc: LabelDocument): Promise<HTMLCanvasElement> {
  const { format } = doc;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(mmToDots(format.widthMm, format.dpi)), 8);
  canvas.height = Math.max(Math.round(mmToDots(format.heightMm, format.dpi)), 8);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponibile');
  const pxPerMm = format.dpi / 25.4;

  // Sfondo bianco, testo nero: nessun antialiasing di riempimento.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.textBaseline = 'top';

  for (const el of doc.elements) {
    if (el.type === 'rect') {
      const x = el.x * pxPerMm;
      const y = el.y * pxPerMm;
      const w = el.w * pxPerMm;
      const h = el.h * pxPerMm;
      ctx.lineWidth = Math.max(el.widthMm * pxPerMm, 1);
      if (el.stroke) ctx.strokeRect(x, y, w, h);
      else ctx.fillRect(x, y, w, h);
      continue;
    }
    if (el.type === 'line') {
      ctx.lineWidth = Math.max(el.widthMm * pxPerMm, 1);
      ctx.beginPath();
      ctx.moveTo(el.x1 * pxPerMm, el.y1 * pxPerMm);
      ctx.lineTo(el.x2 * pxPerMm, el.y2 * pxPerMm);
      ctx.stroke();
      continue;
    }
    if (el.type === 'qr') {
      const sizePx = Math.max(Math.round(el.size * pxPerMm), 16);
      // Canvas temporaneo: il QR va disegnato nitido e poi ridimensionato.
      const tmp = document.createElement('canvas');
      await QRCode.toCanvas(tmp, el.data, { margin: 0, width: sizePx, errorCorrectionLevel: 'M' });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, Math.round(el.x * pxPerMm), Math.round(el.y * pxPerMm), sizePx, sizePx);
      continue;
    }
    if (el.type === 'barcode') {
      const wPx = Math.max(Math.round(el.w * pxPerMm), 32);
      const hPx = Math.max(Math.round(el.h * pxPerMm), 12);
      const tmp = document.createElement('canvas');
      try {
        JsBarcode(tmp, el.data || '-', {
          format: el.format,
          width: 2,
          height: Math.max(hPx - 14, 10),
          displayValue: false,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, Math.round(el.x * pxPerMm), Math.round(el.y * pxPerMm), wPx, hPx);
      } catch {
        // Lotto non valido per il formato scelto: si omette il codice a barre.
      }
      continue;
    }

    // Testo: adatta il font al riquadro, riducendo la dimensione se necessario.
    const boxW = el.w * pxPerMm;
    const boxH = el.h * pxPerMm;
    let fontPx = el.fontMm * pxPerMm;
    const weight = el.bold ? '700' : '400';
    let lines: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      ctx.font = `${weight} ${fontPx}px Inter, system-ui, sans-serif`;
      lines = wrapText(ctx, el.text, boxW, el.maxLines ?? 1);
      const need = lines.length * fontPx * 1.15;
      if (need <= boxH || !el.autoShrink) break;
      fontPx *= 0.86;
    }
    ctx.font = `${weight} ${fontPx}px Inter, system-ui, sans-serif`;
    const lineHeight = fontPx * 1.15;
    lines.forEach((line, i) => {
      const textW = ctx.measureText(line).width;
      let x = el.x * pxPerMm;
      if (el.align === 'center') x += (boxW - textW) / 2;
      else if (el.align === 'right') x += boxW - textW;
      ctx.fillText(line, Math.round(x), Math.round(el.y * pxPerMm + i * lineHeight));
    });
  }

  return canvas;
}

/** Genera un'anteprima PNG (data URL) dell'etichetta. */
export async function renderLabelPreview(payload: LabelPayload, format: ResolvedLabelFormat): Promise<string> {
  const canvas = await renderDocumentToCanvas(buildLabelDocument(payload, format));
  return canvas.toDataURL('image/png');
}
