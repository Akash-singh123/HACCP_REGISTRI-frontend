// src/components/pest/pestQr.ts
// Gestione dei codici QR delle postazioni.
// Il QR non contiene dati del ristorante né identificativi prevedibili: solo un
// token opaco. La risoluzione token -> postazione avviene lato server e richiede
// un utente autenticato membro dell'azienda (isolamento multi-tenant garantito).

import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import type { PestStation } from '@/lib/api';
import { statusMeta } from './pestMeta';

/** Contenuto codificato nel QR: deep-link all'app con il token della postazione. */
export function buildQrPayload(token: string): string {
  if (typeof window === 'undefined') return token;
  return `${window.location.origin}/?pest=${encodeURIComponent(token)}`;
}

/**
 * Estrae il token della postazione da un testo scansionato.
 * Accetta sia il deep-link completo sia il solo token opaco.
 */
export function extractQrToken(text: string): string | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const t = url.searchParams.get('pest');
    if (t) return t;
  } catch {
    /* non è un URL: prova come token nudo */
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw;
  return null;
}

/** Genera un QR in formato data URL PNG (per canvas/PDF/big-image). */
export function qrToDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' });
}

interface LabelMeta {
  areaName?: string | null;
  typeName?: string | null;
}

/**
 * Esporta le etichette QR in un PDF A4 (griglia 3×8 = 24 per pagina),
 * pronte da stampare su fogli adesivi e applicare alle postazioni.
 */
export async function exportQrLabelsPdf(stations: PestStation[], meta: Map<string, LabelMeta>, companyName?: string): Promise<void> {
  if (stations.length === 0) return;

  const doc = new jsPDF('portrait', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 8;
  const marginY = 10;
  const cols = 3;
  const rows = 8;
  const labelW = (pageW - marginX * 2) / cols;
  const labelH = (pageH - marginY * 2) / rows;
  const perPage = cols * rows;

  for (let i = 0; i < stations.length; i++) {
    const idxOnPage = i % perPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();

    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = marginX + col * labelW;
    const y = marginY + row * labelH;

    // Riquadro etichetta
    doc.setDrawColor(200);
    doc.roundedRect(x + 1, y + 1, labelW - 2, labelH - 2, 1.5, 1.5, 'S');

    const station = stations[i];
    const m = meta.get(station.id);
    const qrSize = Math.min(labelH - 6, 22);
    const dataUrl = await qrToDataUrl(buildQrPayload(station.qr_token), 300);
    doc.addImage(dataUrl, 'PNG', x + 3, y + 3, qrSize, qrSize);

    const textX = x + 3 + qrSize + 2;
    const maxW = labelW - (textX - x) - 3;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(station.code, textX, y + 6.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const lines = [
      station.name || m?.typeName || '',
      m?.areaName ? `Area: ${m.areaName}` : '',
      `Stato: ${statusMeta(station.status).label}`,
    ].filter(Boolean);
    let ty = y + 11;
    for (const line of lines) {
      doc.text(doc.splitTextToSize(line, maxW).slice(0, 2), textX, ty);
      ty += 3.4;
    }
  }

  // Piè di pagina con nome azienda
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(130);
    doc.text(`${companyName ? companyName + ' · ' : ''}Etichette QR postazioni · pagina ${p}/${pages}`, pageW / 2, pageH - 4, {
      align: 'center',
    });
  }

  doc.save('etichette-qr-postazioni.pdf');
}
