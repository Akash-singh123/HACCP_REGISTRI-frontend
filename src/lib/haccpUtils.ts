import { HaccpRecord, CompanyInfo, Equipment, EquipmentKind } from '@/types/haccp';
// jspdf e jszip pesano centinaia di KB e servono solo quando si genera un PDF o
// uno ZIP: vengono caricati on demand (code-splitting) invece che all'avvio.
import type { jsPDF } from 'jspdf';
import { getOsaSignature, addSignatureToPdf } from './osaSignature';
import { activeData, ApiError, getActiveCompany, type RecordUpsertPayload } from './api';
import { enqueueRecord, getPendingRecords, removePendingRecord, clearPendingRecords, type PendingRecord } from './offlineQueue';

type JsPdfConstructor = typeof import('jspdf').default;
let jsPdfConstructor: JsPdfConstructor | null = null;

/** Carica jspdf una sola volta, al primo PDF realmente richiesto. */
async function getJsPDF(): Promise<JsPdfConstructor> {
  if (!jsPdfConstructor) {
    const mod = await import('jspdf');
    jsPdfConstructor = mod.default;
  }
  return jsPdfConstructor;
}

/** Range HACCP di riferimento per tipologia di attrezzatura. */
export const EQUIPMENT_RANGES: Record<
  EquipmentKind,
  { inputMin: number; inputMax: number; targetMin: number; targetMax: number; rangeLabel: string }
> = {
  freezer: { inputMin: -25, inputMax: -15, targetMin: -22, targetMax: -18, rangeLabel: '-18 °C / -22 °C' },
  fridge: { inputMin: 0, inputMax: 4, targetMin: 0, targetMax: 4, rangeLabel: '0 °C / +4 °C' },
};

/** Etichetta breve della tipologia di attrezzatura. */
export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  freezer: 'Congelatore',
  fridge: 'Frigorifero',
};

/** Valore di temperatura proposto di default per una nuova rilevazione. */
export const defaultTemperatureForKind = (kind: EquipmentKind): number =>
  kind === 'freezer' ? -20 : 2;

// Generate random temperature within HACCP ranges
export const generateRandomTemperature = (type: EquipmentKind): number => {
  if (type === 'freezer') {
    // -18°C to -22°C
    return Math.round((Math.random() * 4 + 18) * -10) / 10;
  } else {
    // 0°C to 4°C
    return Math.round(Math.random() * 40) / 10;
  }
};

/** Attrezzature configurate per l'azienda attiva (ordine: congelatori, poi frigoriferi). */
export const getEquipment = async (): Promise<Equipment[]> => {
  const { equipment } = await activeData.equipment.list();
  return equipment;
};

/** Tronca un testo per farlo rientrare nella larghezza indicata (font corrente). */
const fitText = (pdf: jsPDF, text: string, maxWidth: number): string => {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && pdf.getTextWidth(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
};

// Generate default cleaning status (mostly OK)
export const generateDefaultCleaning = () => ({
  equipment: Math.random() > 0.1,
  surfaces: Math.random() > 0.1,
  utensils: Math.random() > 0.1,
  floors: Math.random() > 0.1,
  refrigerators: Math.random() > 0.1,
  walls: Math.random() > 0.1,
  lighting: Math.random() > 0.1,
  doors: Math.random() > 0.1,
  shelves: Math.random() > 0.1,
  toilets: Math.random() > 0.1,
  wasteContainers: Math.random() > 0.1,
  ovens: Math.random() > 0.1,
});

// Generate date range
export const generateDateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  return dates;
};

// Create HACCP record
export const createHaccpRecord = (
  date: string,
  signature: string,
  company: CompanyInfo,
  customData?: Partial<HaccpRecord>
): HaccpRecord => {
  const now = new Date().toISOString();
  
  return {
    id: `haccp_${date}_${Date.now()}`,
    date,
    temperatures: customData?.temperatures || {
      freezer: generateRandomTemperature('freezer'),
      fridge1: generateRandomTemperature('fridge'),
      fridge2: generateRandomTemperature('fridge'),
    },
    cleaning: customData?.cleaning || generateDefaultCleaning(),
    notes: customData?.notes || '',
    signature,
    createdAt: now,
    updatedAt: now,
  };
};

// Accesso ai dati dei registri: backend Supabase, isolato per azienda.
// Tutte le operazioni sono asincrone e passano dal layer API (Zero Trust Client).

/** Esito di un salvataggio: `queued` indica che il registro è stato messo in
 *  coda offline (verrà inviato appena la connessione torna disponibile). */
export interface SaveResult {
  queued: boolean;
}

const toUpsertPayload = (record: HaccpRecord): RecordUpsertPayload => ({
  date: record.date,
  temperatures: record.temperatures,
  cleaning: record.cleaning,
  notes: record.notes,
  signature: record.signature,
});

/** Un errore di rete (fetch fallita) ha sempre status 0 nel layer API. */
const isNetworkError = (err: unknown): boolean => err instanceof ApiError && err.status === 0;

/** Mette un registro in coda offline. Ritorna false se manca l'azienda attiva. */
const queueRecord = async (payload: RecordUpsertPayload): Promise<boolean> => {
  const companyId = getActiveCompany();
  if (!companyId) return false;
  await enqueueRecord(companyId, payload);
  return true;
};

const queueRecords = async (payloads: RecordUpsertPayload[]): Promise<boolean> => {
  const companyId = getActiveCompany();
  if (!companyId) return false;
  for (const payload of payloads) await enqueueRecord(companyId, payload);
  return true;
};

/** Ricostruisce il registro "virtuale" da un elemento ancora in coda. */
const pendingToRecord = (item: PendingRecord): HaccpRecord => {
  const iso = new Date(item.queuedAt).toISOString();
  return {
    id: `haccp_${item.date}`,
    date: item.date,
    temperatures: item.payload.temperatures ?? {},
    cleaning: item.payload.cleaning,
    notes: item.payload.notes ?? '',
    signature: item.payload.signature ?? '',
    createdAt: iso,
    updatedAt: iso,
  };
};

/**
 * Registri dell'azienda: quelli del backend più quelli ancora in coda offline,
 * così un registro compilato senza rete è subito visibile in archivio.
 * In caso di sovrapposizione vince la versione locale (più recente).
 */
export const getRecords = async (): Promise<HaccpRecord[]> => {
  const { records } = await activeData.records.list();
  const companyId = getActiveCompany();
  if (!companyId) return records;

  let pending: PendingRecord[] = [];
  try {
    pending = await getPendingRecords(companyId);
  } catch {
    pending = [];
  }
  if (!pending.length) return records;

  const byDate = new Map<string, HaccpRecord>();
  for (const record of records) byDate.set(record.date, record);
  for (const item of pending) byDate.set(item.date, pendingToRecord(item));
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Salva un registro. Se la rete non è disponibile il salvataggio finisce nella
 * coda offline invece di andare perso; la sincronizzazione è automatica.
 */
export const saveRecord = async (record: HaccpRecord): Promise<SaveResult> => {
  const payload = toUpsertPayload(record);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline && (await queueRecord(payload))) return { queued: true };

  try {
    await activeData.records.upsert(payload);
    return { queued: false };
  } catch (err) {
    if (isNetworkError(err) && (await queueRecord(payload))) return { queued: true };
    throw err;
  }
};

/** Salva più registri. Come saveRecord, gestisce automaticamente la coda offline. */
export const saveRecords = async (records: HaccpRecord[]): Promise<SaveResult> => {
  if (!records.length) return { queued: false };
  const payloads = records.map(toUpsertPayload);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline && (await queueRecords(payloads))) return { queued: true };

  try {
    await activeData.records.upsertMany(payloads);
    return { queued: false };
  } catch (err) {
    if (isNetworkError(err) && (await queueRecords(payloads))) return { queued: true };
    throw err;
  }
};

export const deleteRecordByDate = async (date: string): Promise<void> => {
  await activeData.records.deleteByDate(date);
  // Rimuove anche l'eventuale copia in coda, per non farla riapparire al sync.
  const companyId = getActiveCompany();
  if (companyId) await removePendingRecord(companyId, date);
};

export const deleteRecordsByMonth = async (year: number, month: number): Promise<void> => {
  await activeData.records.deleteByMonth(year, month);
  const companyId = getActiveCompany();
  if (!companyId) return;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const pending = await getPendingRecords(companyId);
  for (const item of pending) {
    if (item.date.startsWith(prefix)) await removePendingRecord(companyId, item.date);
  }
};

export const deleteAllRecords = async (): Promise<void> => {
  await activeData.records.deleteAll();
  const companyId = getActiveCompany();
  if (companyId) await clearPendingRecords(companyId);
};

export const getRecordsByMonth = async (year: number, month: number): Promise<HaccpRecord[]> => {
  const records = await getRecords();
  return records.filter(record => {
    const date = new Date(record.date);
    return date.getFullYear() === year && date.getMonth() === month - 1;
  });
};

export const getRecordByDate = async (date: string): Promise<HaccpRecord | undefined> => {
  const records = await getRecords();
  return records.find(record => record.date === date);
};

// PDF Generation - Single Day Temperature
export const generatePDF = async (
  record: HaccpRecord,
  company: CompanyInfo,
  equipment?: Equipment[]
): Promise<jsPDF> => {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF('landscape', 'mm', 'a4');
  const date = new Date(record.date);
  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];
  
  // Header
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('MANUALE DI CONTROLLO IGIENICO SANITARIO', 20, 15);
  pdf.text('REGISTRO DI CONTROLLO TEMPERATURE', 20, 22);
  
  // Month and year
  pdf.setFontSize(10);
  pdf.text(`MESE: ${monthNames[date.getMonth()]} ANNO: ${date.getFullYear()}`, 20, 30);
  pdf.text(`AZIENDA: ${company.name} P.IVA: ${company.piva}`, 20, 37);
  
  // Temperature table
  const startX = 20;
  const startY = 50;
  const cellWidth = 8;
  const cellHeight = 6;
  
  // Table headers
  pdf.setFontSize(8);
  pdf.text('GIORNO', startX, startY - 2);
  
  // Days 1-31
  for (let day = 1; day <= 31; day++) {
    pdf.text(day.toString(), startX + day * cellWidth - 2, startY - 2);
  }
  
  // Temperature rows (una riga per attrezzatura configurata)
  const equipmentList = equipment ?? (await getEquipment());
  const tempRows = equipmentList.map((item) => ({
    label: item.name,
    value: record.temperatures[item.id],
  }));
  
  tempRows.forEach((row, index) => {
    const y = startY + (index + 1) * cellHeight;
    pdf.setFontSize(7);
    pdf.text(fitText(pdf, row.label, 26), startX, y);
    
    // Fill temperature for current day
    if (typeof row.value === 'number' && Number.isFinite(row.value)) {
      const currentDay = date.getDate();
      pdf.setFontSize(8);
      pdf.text(`${row.value}°`, startX + currentDay * cellWidth - 2, y);
    }
  });
  
  // Signature row
  const sigY = startY + (tempRows.length + 1) * cellHeight;
  pdf.text('FIRMA OSA', startX, sigY);
  
  // Try to add OSA signature from Google Drive
  try {
    const osaInfo = await getOsaSignature();
    if (osaInfo.exists && osaInfo.blob) {
      await addSignatureToPdf(
        pdf,
        osaInfo.blob,
        startX + date.getDate() * cellWidth - 4,
        sigY - 4,
        10,
        6,
        { clip: { x: startX + date.getDate() * cellWidth - 4, y: sigY - 4, width: 10, height: 6 }, margin: 0.8, center: true, scale: 0.9, trim: true }
      );
    }
  } catch (error) {
    console.warn('Could not add OSA signature to PDF:', error);
  }
  
  // Fallback to record signature if OSA signature not available
  if (record.signature) {
    try {
      pdf.addImage(record.signature, 'PNG', startX + date.getDate() * cellWidth - 4, sigY - 4, 10, 6);
    } catch (error) {
      console.warn('Could not add record signature to PDF:', error);
    }
  }
  
  // Notes
  if (record.notes) {
    pdf.setFontSize(8);
    pdf.text('Note:', 20, sigY + 15);
    pdf.text(record.notes, 20, sigY + 20);
  }
  
  // Ensure bottom closing line of table
  const tableBottomY = sigY + cellHeight;
  const tableRightX = startX + 32 * cellWidth;
  pdf.line(startX, tableBottomY, tableRightX, tableBottomY);
  
  return pdf;
};

// PDF Generation - Single Day Sanification
export const generateSanificationPDF = async (record: HaccpRecord, company: CompanyInfo): Promise<jsPDF> => {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF('landscape', 'mm', 'a4');
  const date = new Date(record.date);
  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];
  
  // Header
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('MANUALE DI CONTROLLO IGIENICO SANITARIO', 20, 15);
  pdf.text('REGISTRO DI CONTROLLO SANIFICAZIONE', 20, 22);
  
  // Month and year
  pdf.setFontSize(10);
  pdf.text(`MESE: ${monthNames[date.getMonth()]} ANNO: ${date.getFullYear()}`, 20, 30);
  pdf.text(`AZIENDA: ${company.name} P.IVA: ${company.piva}`, 20, 37);
  
  // Sanification table
  const startX = 20;
  const startY = 50;
  const cellWidth = 8;
  const cellHeight = 6;
  
  // Table headers
  pdf.setFontSize(8);
  pdf.text('GIORNO', startX, startY - 2);
  
  // Days 1-31
  for (let day = 1; day <= 31; day++) {
    pdf.text(day.toString(), startX + day * cellWidth - 2, startY - 2);
  }
  
  // Sanification rows
  const sanificationRows = [
    'ATTREZZATURE',
    'SUPERFICI',
    'UTENSILI',
    'PAVIMENTI',
    'FRIGORIFERI',
    'PARETI',
    'ILLUMINAZIONE',
    'PORTE',
    'SCAFFALI',
    'SERVIZI IGIENICI',
    'CONTENITORI RIFIUTI',
    'FORNI'
  ];
  
  sanificationRows.forEach((label, index) => {
    const y = startY + (index + 1) * cellHeight;
    pdf.text(label, startX, y);
    
    // Fill X for current day (all items checked)
    const currentDay = date.getDate();
    pdf.text('X', startX + currentDay * cellWidth - 2, y);
  });
  
  // Signature row
  const sigY = startY + (sanificationRows.length + 1) * cellHeight;
  pdf.text('FIRMA OSA', startX, sigY);
  
  // Try to add OSA signature from Google Drive
  try {
    const osaInfo = await getOsaSignature();
    if (osaInfo.exists && osaInfo.blob) {
      await addSignatureToPdf(
        pdf,
        osaInfo.blob,
        startX + date.getDate() * cellWidth - 4,
        sigY - 4,
        10,
        6,
        { clip: { x: startX + date.getDate() * cellWidth - 4, y: sigY - 4, width: 10, height: 6 }, margin: 0.8, center: true, scale: 0.9, trim: true }
      );
    }
  } catch (error) {
    console.warn('Could not add OSA signature to PDF:', error);
  }
  
  // Fallback to record signature if OSA signature not available
  if (record.signature) {
    try {
      pdf.addImage(record.signature, 'PNG', startX + date.getDate() * cellWidth - 4, sigY - 4, 10, 6);
    } catch (error) {
      console.warn('Could not add record signature to PDF:', error);
    }
  }
  
  // Notes
  if (record.notes) {
    pdf.setFontSize(8);
    pdf.text('Note:', 20, sigY + 15);
    pdf.text(record.notes, 20, sigY + 20);
  }
  
  return pdf;
};

// PDF Generation - Monthly Temperature Report
export const generateMonthlyPDF = async (
  records: HaccpRecord[],
  company: CompanyInfo,
  year: number,
  month: number,
  equipment?: Equipment[]
): Promise<jsPDF> => {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF('landscape', 'mm', 'a4');
  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];
  
  // Header
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('MANUALE DI CONTROLLO IGIENICO SANITARIO', 15, 15);
  pdf.text('REGISTRO DI CONTROLLO TEMPERATURE', 15, 22);
  
  // Month and year info
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`MESE: ${monthNames[month - 1]}`, 15, 35);
  pdf.text(`ANNO ${year}`, 70, 35);
  pdf.text(`AZIENDA: ${company.name}`, 15, 42);
  pdf.text(`P.IVA: ${company.piva}`, 15, 49);
  
  // Table setup - adjusted to fit all 31 days within A4 landscape
  // La colonna delle etichette è più larga per ospitare i nomi delle attrezzature.
  const startX = 10;
  const startY = 60;
  const labelColWidth = 34;
  const dayColWidth = 7.9; // Reduced to fit all days
  const cellHeight = 6;

  // Una riga per ogni attrezzatura configurata (nome assegnato dall'utente).
  const equipmentList = equipment ?? (await getEquipment());
  const tempRows = equipmentList.map((item) => ({ id: item.id, label: item.name }));
  
  // Draw table borders
  pdf.setLineWidth(0.5);
  
  // Header row
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  
  // Draw GIORNO header cell
  pdf.rect(startX, startY - cellHeight, labelColWidth, cellHeight);
  pdf.text('GIORNO', startX + 2, startY - 2);
  
  // Days 1-31 headers
  for (let day = 1; day <= 31; day++) {
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    pdf.rect(x, startY - cellHeight, dayColWidth, cellHeight);
    
    // Center the day number
    const dayText = day.toString();
    const textWidth = pdf.getTextWidth(dayText);
    const centerX = x + (dayColWidth - textWidth) / 2;
    pdf.text(dayText, centerX, startY - 2);
  }
  
  // Temperature rows: una riga per attrezzatura
  tempRows.forEach((row, rowIndex) => {
    const y = startY + rowIndex * cellHeight;
    
    // Label cell
    pdf.rect(startX, y, labelColWidth, cellHeight);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.5);
    pdf.text(fitText(pdf, row.label, labelColWidth - 3), startX + 1.5, y + cellHeight/2 + 1);
    
    // Temperature cells for each day
    for (let day = 1; day <= 31; day++) {
      const x = startX + labelColWidth + (day - 1) * dayColWidth;
      pdf.rect(x, y, dayColWidth, cellHeight);
      
      // Fill temperature if record exists for this day
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const record = records.find(r => r.date === dateStr);
      
      if (record) {
        const temp = record.temperatures[row.id];
        if (typeof temp !== 'number' || !Number.isFinite(temp)) continue;
        
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6);
        const tempText = `${temp}°`;
        const textWidth = pdf.getTextWidth(tempText);
        const centerX = x + (dayColWidth - textWidth) / 2;
        pdf.text(tempText, centerX, y + cellHeight/2 + 1);
      }
    }
  });
  
  // Signature row
  const sigY = startY + tempRows.length * cellHeight;
  const sigCellHeight = cellHeight + 0.4; // leggero aumento altezza celle firma
  pdf.rect(startX, sigY, labelColWidth, sigCellHeight);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text('FIRMA OSA', startX + 2, sigY + sigCellHeight/2 + 1);
  // Draw signature cells for all days
  for (let day = 1; day <= 31; day++) {
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    pdf.rect(x, sigY, dayColWidth, sigCellHeight);
  }
  // Bottom closing line across table
  const bottomY = sigY + sigCellHeight;
  const rightX = startX + labelColWidth + 31 * dayColWidth;
  pdf.line(startX, bottomY, rightX, bottomY);

  // Add signatures for days with records
  let osaBlob: Blob | undefined;
  try {
    const info = await getOsaSignature();
    if (info.exists && info.blob) osaBlob = info.blob;
  } catch {
    osaBlob = undefined;
  }
  
  // Iterate day-by-day to place signature deterministically
  for (let day = 1; day <= 31; day++) {
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const record = records.find(r => r.date === dateStr);
    if (!record) continue;

    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    let signatureAdded = false;

    if (osaBlob) {
      const ok = await addSignatureToPdf(
        pdf,
        osaBlob,
        x,
        sigY,
        dayColWidth,
        sigCellHeight,
        { clip: { x, y: sigY, width: dayColWidth, height: sigCellHeight }, margin: 0.8, center: true, scale: 0.9, trim: true }
       );
      if (ok) signatureAdded = true;
    }

    if (!signatureAdded && record.signature) {
      try {
        const sigWidth = dayColWidth - 1.0;
        const sigHeight = sigCellHeight - 1.0;
        pdf.addImage(record.signature, 'PNG', x + 0.5, sigY + 0.5, sigWidth, sigHeight);
        signatureAdded = true;
      } catch (error) {
        console.warn('Could not add record signature to PDF:', error);
      }
    }

    if (!signatureAdded) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      const checkText = '✓';
      const textWidth = pdf.getTextWidth(checkText);
      const centerX = x + (dayColWidth - textWidth) / 2;
      pdf.text(checkText, centerX, sigY + sigCellHeight/2 + 1);
    }
  }
  
  return pdf;
};

// PDF Generation - Monthly Sanification Report
export const generateMonthlySanificationPDF = async (records: HaccpRecord[], company: CompanyInfo, year: number, month: number): Promise<jsPDF> => {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF('landscape', 'mm', 'a4');
  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];
  
  // Header
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('MANUALE DI CONTROLLO IGIENICO SANITARIO', 15, 15);
  pdf.text('REGISTRO DI CONTROLLO SANIFICAZIONE', 15, 22);
  
  // Month and year info
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`MESE: ${monthNames[month - 1]}`, 15, 35);
  pdf.text(`ANNO ${year}`, 70, 35);
  pdf.text(`AZIENDA: ${company.name}`, 15, 42);
  pdf.text(`P.IVA: ${company.piva}`, 15, 49);
  
  // Table setup - adjusted to fit all 31 days within A4 landscape
  const startX = 10;
  const startY = 60;
  const labelColWidth = 22;
  const dayColWidth = 8.2; // Reduced to fit all days
  const cellHeight = 5.5; // Slightly smaller for more rows
  
  // Draw table borders
  pdf.setLineWidth(0.5);
  
  // Header row
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  
  // Draw GIORNO header cell
  pdf.rect(startX, startY - cellHeight, labelColWidth, cellHeight);
  pdf.text('GIORNO', startX + 2, startY - 2);
  
  // Days 1-31 headers
  for (let day = 1; day <= 31; day++) {
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    pdf.rect(x, startY - cellHeight, dayColWidth, cellHeight);
    
    // Center the day number
    const dayText = day.toString();
    const textWidth = pdf.getTextWidth(dayText);
    const centerX = x + (dayColWidth - textWidth) / 2;
    pdf.text(dayText, centerX, startY - 2);
  }
  
  // Sanification rows
  const sanificationRows = [
    'ATTREZZATURE',
    'SUPERFICI',
    'UTENSILI',
    'PAVIMENTI',
    'FRIGORIFERI',
    'PARETI',
    'ILLUMINAZIONE',
    'PORTE',
    'SCAFFALI',
    'SERVIZI IGIENICI',
    'CONTENITORI RIFIUTI',
    'FORNI'
  ];
  
  sanificationRows.forEach((label, rowIndex) => {
    const y = startY + rowIndex * cellHeight;
    
    // Label cell
    pdf.rect(startX, y, labelColWidth, cellHeight);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6);
    pdf.text(label, startX + 1, y + cellHeight/2 + 1);
    
    // Sanification cells for each day
    for (let day = 1; day <= 31; day++) {
      const x = startX + labelColWidth + (day - 1) * dayColWidth;
      pdf.rect(x, y, dayColWidth, cellHeight);
      
      // Fill X if record exists for this day (all items checked)
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const record = records.find(r => r.date === dateStr);
      
      if (record) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        const checkText = 'X';
        const textWidth = pdf.getTextWidth(checkText);
        const centerX = x + (dayColWidth - textWidth) / 2;
        pdf.text(checkText, centerX, y + cellHeight/2 + 1);
      }
    }
  });
  
  // Signature row
  const sigY = startY + sanificationRows.length * cellHeight;
  const sigCellHeight2 = cellHeight + 0.4; // leggero aumento altezza celle firma
  pdf.rect(startX, sigY, labelColWidth, sigCellHeight2);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text('FIRMA OSA', startX + 2, sigY + sigCellHeight2/2 + 1);
  // Draw signature cells for all days
  for (let day = 1; day <= 31; day++) {
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    pdf.rect(x, sigY, dayColWidth, sigCellHeight2);
  }
  // Add signatures for days with records
  let osaBlob2: Blob | undefined;
  try {
    const info = await getOsaSignature();
    if (info.exists && info.blob) osaBlob2 = info.blob;
  } catch {
    osaBlob2 = undefined;
  }
  // Iterate day-by-day to place signature deterministically
  for (let day = 1; day <= 31; day++) {
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const record = records.find(r => r.date === dateStr);
    if (!record) continue;

    const x = startX + labelColWidth + (day - 1) * dayColWidth;

    let signatureAdded = false;
    
    if (osaBlob2) {
      const ok = await addSignatureToPdf(
        pdf,
        osaBlob2,
        x,
        sigY,
        dayColWidth,
        sigCellHeight2,
        { clip: { x, y: sigY, width: dayColWidth, height: sigCellHeight2 }, margin: 0.8, center: true, scale: 0.9, trim: true }
      );
      if (ok) signatureAdded = true;
    }
    
    if (!signatureAdded && record.signature) {
      try {
        const sigWidth = dayColWidth - 1.0;
        const sigHeight = sigCellHeight2 - 1.0;
        pdf.addImage(record.signature, 'PNG', x + 0.5, sigY + 0.5, sigWidth, sigHeight);
        signatureAdded = true;
      } catch (error) {
        console.warn('Could not add record signature to PDF:', error);
      }
    }
    
    if (!signatureAdded) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      const checkText = '✓';
      const textWidth = pdf.getTextWidth(checkText);
      const centerX = x + (dayColWidth - textWidth) / 2;
      pdf.text(checkText, centerX, sigY + sigCellHeight2/2 + 1);
    }
  }
  
  // Ensure bottom closing line of table
  const tableBottomY2 = sigY + cellHeight;
  const tableRightX2 = startX + labelColWidth + 31 * dayColWidth;
  pdf.line(startX, tableBottomY2, tableRightX2, tableBottomY2);
  
  return pdf;
};

export const generateZipArchive = async (records: HaccpRecord[], company: CompanyInfo): Promise<Blob> => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const equipment = await getEquipment();
  
  // Group records by month
  const recordsByMonth = records.reduce((acc, record) => {
    const date = new Date(record.date);
    const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(record);
    return acc;
  }, {} as Record<string, HaccpRecord[]>);
  
  // Generate PDFs for each month
  for (const [monthKey, monthRecords] of Object.entries(recordsByMonth)) {
    const [year, month] = monthKey.split('-').map(Number);
    
    // Temperature PDF
    const tempPdf = await generateMonthlyPDF(monthRecords, company, year, month, equipment);
    const tempPdfBlob = tempPdf.output('blob');
    zip.file(`HACCP_Temperature_${monthKey}.pdf`, tempPdfBlob);
    
    // Sanification PDF
    const sanitationPdf = await generateMonthlySanificationPDF(monthRecords, company, year, month);
    const sanitationPdfBlob = sanitationPdf.output('blob');
    zip.file(`HACCP_Sanificazione_${monthKey}.pdf`, sanitationPdfBlob);
  }
  
  return zip.generateAsync({ type: 'blob' });
};