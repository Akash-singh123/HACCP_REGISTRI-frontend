import { googleDriveManager } from '@/lib/googleDrive';
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

async function uploadOrUpdatePdf(fileName: string, blob: Blob, parentId: string) {
  const existing = await googleDriveManager.findFileByName(fileName, parentId);
  if (existing) {
    await googleDriveManager.updateFile(existing.id, fileName, blob);
  } else {
    await googleDriveManager.uploadFile(fileName, blob, parentId);
  }
}

async function runOnce(company: CompanyInfo) {
  try {
    await googleDriveManager.initialize();
    const connected = await googleDriveManager.checkExistingToken();
    if (!connected) {
      console.warn('[AutoRegisters] Drive non connesso, salto generazione/upload');
      return false;
    }
    const { rootId } = await googleDriveManager.getHaccpFolderStructure();
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // 1..12

    const records = getRecordsByMonth(year, month);
    const tempDoc = await generateMonthlyPDF(records, company, year, month);
    const saniDoc = await generateMonthlySanificationPDF(records, company, year, month);

    const tempBlob = tempDoc.output('blob');
    const saniBlob = saniDoc.output('blob');
    const names = buildMonthFileNames(year, month);

    await uploadOrUpdatePdf(names.temp, tempBlob, rootId);
    await uploadOrUpdatePdf(names.sani, saniBlob, rootId);

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
  const configured = timeHHMM || localStorage.getItem('haccp_auto_time') || '20:00';

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