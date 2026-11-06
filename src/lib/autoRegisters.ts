import { activeDocs } from '@/lib/api';
import { DOC_FOLDERS, blobToBase64 } from '@/lib/docs';
import { generateMonthlyPDF, generateMonthlySanificationPDF, getRecordsByMonth } from '@/lib/haccpUtils';
import type { CompanyInfo } from '@/types/haccp';
import { toast } from 'sonner';

function parseTimeToNextDelay(timeHHMM: string): number {
  const [hhStr, mmStr] = timeHHMM.split(':');
  const hh = Math.max(0, Math.min(23, Number(hhStr) || 0));
  const mm = Math.max(0, Math.min(59, Number(mmStr) || 0));
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function buildMonthFileNames(year: number, month: number) {
  const date = new Date(year, month - 1, 1);
  const monthLabel = date.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const safeLabel = monthLabel.replace(/\s+/g, '_');
  return {
    temp: `HACCP_Temperature_${safeLabel}.pdf`,
    sani: `HACCP_Sanificazione_${safeLabel}.pdf`
  };
}

async function uploadPdf(fileName: string, blob: Blob) {
  const path = `${DOC_FOLDERS.registri}/${fileName}`;
  const base64 = await blobToBase64(blob);
  await activeDocs.upload({ path, base64, mimeType: 'application/pdf' });
}

async function runOnce(company: CompanyInfo) {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // 1..12

    const records = await getRecordsByMonth(year, month);
    if (!records.length) {
      console.warn('[AutoRegisters] Nessun registro per il mese corrente, salto l\'aggiornamento');
      return false;
    }

    const tempDoc = await generateMonthlyPDF(records, company, year, month);
    const saniDoc = await generateMonthlySanificationPDF(records, company, year, month);
    const names = buildMonthFileNames(year, month);

    await uploadPdf(names.temp, tempDoc.output('blob'));
    await uploadPdf(names.sani, saniDoc.output('blob'));

    console.log('[AutoRegisters] Aggiornamento automatico completato');
    toast.success('Aggiornamento registri automatico completato');
    return true;
  } catch (e) {
    console.error('[AutoRegisters] Errore nell\'esecuzione programmata', e);
    toast.error('Errore aggiornamento automatico registri');
    return false;
  }
}

export function startAutoRegisterScheduler(company: CompanyInfo, timeHHMM?: string) {
  const configured = timeHHMM || '20:00';

  // Schedule first run
  const delay = parseTimeToNextDelay(configured);
  const timer = setTimeout(async function tick() {
    await runOnce(company);
    // schedule next 24h
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, delay);

  console.log(`[AutoRegisters] scheduler attivo alle ${configured}`);
  return { cancel: () => clearTimeout(timer) };
}
