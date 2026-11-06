// supabase/functions/generate-records-pdf/index.ts
// Generazione PDF lato server: il layout è logica proprietaria, non risiede nel client.
// Il PDF viene inoltre archiviato nello storage privato dell'azienda.

import { jsPDF } from 'https://esm.sh/jspdf@2.5.2';
import { guard, audit, json, errorResponse, HttpError, corsHeaders } from '../_shared/guard.ts';

interface PdfColumn {
  key: string;
  label: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    const ctx = await guard(req, body, {
      feature: 'haccp',
      rateLimit: { limit: 20, windowSeconds: 60 },
    });

    const title = String(body.title ?? 'Registro HACCP');
    const columns = (body.columns as PdfColumn[] | undefined) ?? [];
    const rows = (body.rows as Record<string, unknown>[] | undefined) ?? [];

    if (!title.trim()) throw new HttpError(400, 'Titolo mancante', 'bad_title');
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new HttpError(400, 'Colonne mancanti', 'bad_columns');
    }
    if (!Array.isArray(rows)) throw new HttpError(400, 'Righe non valide', 'bad_rows');

    // --- Generazione PDF (A4 orizzontale) ---------------------------------
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;

    doc.setFontSize(16);
    doc.text(title, margin, margin + 6);
    doc.setFontSize(9);
    doc.text(`Generato il ${new Date().toLocaleString('it-IT')}`, margin, margin + 12);

    const tableTop = margin + 20;
    const colWidth = (pageWidth - margin * 2) / columns.length;
    let y = tableTop;

    const drawHeader = () => {
      doc.setFontSize(10);
      doc.setFillColor(37, 99, 235);
      doc.setTextColor(255, 255, 255);
      doc.rect(margin, y, pageWidth - margin * 2, 8, 'F');
      columns.forEach((col, i) => {
        const text = doc.splitTextToSize(col.label, colWidth - 4)[0] ?? '';
        doc.text(String(text), margin + i * colWidth + 2, y + 5.5);
      });
      y += 8;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
    };

    drawHeader();

    rows.forEach((row, rowIndex) => {
      if (y + 8 > pageHeight - margin) {
        doc.addPage();
        y = margin;
        drawHeader();
      }
      if (rowIndex % 2 === 0) {
        doc.setFillColor(243, 244, 246);
        doc.rect(margin, y, pageWidth - margin * 2, 8, 'F');
      }
      columns.forEach((col, i) => {
        const value = row[col.key];
        const text = doc.splitTextToSize(value === undefined || value === null ? '' : String(value), colWidth - 4)[0] ?? '';
        doc.text(String(text), margin + i * colWidth + 2, y + 5.5);
      });
      y += 8;
    });

    const arrayBuffer = doc.output('arraybuffer');
    const bytes = new Uint8Array(arrayBuffer);

    // --- Archiviazione nel bucket privato ---------------------------------
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60);
    const path = `${ctx.companyId}/${safeTitle}_${stamp}.pdf`;

    const { error: uploadErr } = await ctx.admin.storage
      .from('haccp-docs')
      .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (uploadErr) throw new HttpError(500, 'Errore archiviazione PDF', 'storage_error');

    await ctx.admin.from('haccp_records').insert({
      company_id: ctx.companyId,
      type: 'pdf',
      title,
      payload: { columns, rowCount: rows.length },
      storage_path: path,
    });

    await audit(ctx, 'records.pdf.generate', 'haccp_records', path);

    // --- Base64 per download immediato nel client -------------------------
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    return json({ base64, filename: `${safeTitle}.pdf`, path });
  } catch (err) {
    return errorResponse(err);
  }
});
