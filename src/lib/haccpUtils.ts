import { HaccpRecord, CompanyInfo } from '@/types/haccp';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { getOsaSignature, addSignatureToPdf } from './osaSignature';

// Generate random temperature within HACCP ranges
export const generateRandomTemperature = (type: 'freezer' | 'fridge'): number => {
  if (type === 'freezer') {
    // -18°C to -22°C
    return Math.round((Math.random() * 4 + 18) * -10) / 10;
  } else {
    // 0°C to 4°C
    return Math.round(Math.random() * 40) / 10;
  }
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

// LocalStorage utilities
export const saveRecord = (record: HaccpRecord): void => {
  const records = getRecords();
  const existingIndex = records.findIndex(r => r.date === record.date);
  
  if (existingIndex >= 0) {
    records[existingIndex] = { ...record, updatedAt: new Date().toISOString() };
  } else {
    records.push(record);
  }
  
  localStorage.setItem('haccp_records', JSON.stringify(records));
};

export const getRecords = (): HaccpRecord[] => {
  const stored = localStorage.getItem('haccp_records');
  return stored ? JSON.parse(stored) : [];
};

export const deleteRecordByDate = (date: string): void => {
  const records = getRecords().filter(r => r.date !== date);
  localStorage.setItem('haccp_records', JSON.stringify(records));
};

export const deleteRecordsByMonth = (year: number, month: number): void => {
  const records = getRecords().filter(r => {
    const d = new Date(r.date);
    return !(d.getFullYear() === year && d.getMonth() === month - 1);
  });
  localStorage.setItem('haccp_records', JSON.stringify(records));
};

export const deleteAllRecords = (): void => {
  localStorage.removeItem('haccp_records');
};

export const getRecordsByMonth = (year: number, month: number): HaccpRecord[] => {
  const records = getRecords();
  return records.filter(record => {
    const date = new Date(record.date);
    return date.getFullYear() === year && date.getMonth() === month - 1;
  });
};

export const getRecordByDate = (date: string): HaccpRecord | undefined => {
  const records = getRecords();
  return records.find(record => record.date === date);
};

// PDF Generation - Single Day Temperature
export const generatePDF = async (record: HaccpRecord, company: CompanyInfo): Promise<jsPDF> => {
  const pdf = new jsPDF('landscape', 'mm', 'a4');
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
  
  // Temperature rows
  const tempRows = [
    { label: 'C1', value: record.temperatures.freezer },
    { label: 'F1', value: record.temperatures.fridge1 },
    { label: 'F2', value: record.temperatures.fridge2 }
  ];
  
  tempRows.forEach((row, index) => {
    const y = startY + (index + 1) * cellHeight;
    pdf.text(row.label, startX, y);
    
    // Fill temperature for current day
    const currentDay = date.getDate();
    pdf.text(`${row.value}°`, startX + currentDay * cellWidth - 2, y);
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
  const tableRightX = startX + labelColWidth + 31 * dayColWidth;
  pdf.line(startX, tableBottomY, tableRightX, tableBottomY);
  
  return pdf;
};

// PDF Generation - Single Day Sanification
export const generateSanificationPDF = async (record: HaccpRecord, company: CompanyInfo): Promise<jsPDF> => {
  const pdf = new jsPDF('landscape', 'mm', 'a4');
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
export const generateMonthlyPDF = async (records: HaccpRecord[], company: CompanyInfo, year: number, month: number): Promise<jsPDF> => {
  const pdf = new jsPDF('landscape', 'mm', 'a4');
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
  const startX = 10;
  const startY = 60;
  const labelColWidth = 22;
  const dayColWidth = 8.2; // Reduced to fit all days
  const cellHeight = 6;
  
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
  
  // Temperature rows: C1, F1, F2
  const tempRows = ['C1', 'F1', 'F2'];
  
  tempRows.forEach((label, rowIndex) => {
    const y = startY + rowIndex * cellHeight;
    
    // Label cell
    pdf.rect(startX, y, labelColWidth, cellHeight);
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, startX + 2, y + cellHeight/2 + 1);
    
    // Temperature cells for each day
    for (let day = 1; day <= 31; day++) {
      const x = startX + labelColWidth + (day - 1) * dayColWidth;
      pdf.rect(x, y, dayColWidth, cellHeight);
      
      // Fill temperature if record exists for this day
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const record = records.find(r => r.date === dateStr);
      
      if (record) {
        let temp: number;
        switch (label) {
          case 'C1': temp = record.temperatures.freezer; break;
          case 'F1': temp = record.temperatures.fridge1; break;
          case 'F2': temp = record.temperatures.fridge2; break;
          default: temp = 0;
        }
        
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
  for (const record of records) {
    const date = new Date(record.date);
    const day = date.getDate();
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    
    // signature cell border already drawn above for every day
    
    let signatureAdded = false;
    
    // Use preloaded OSA signature if available
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
    
    // Fallback to record signature if OSA signature not available or failed
    if (!signatureAdded && record.signature) {
      try {
        const sigWidth = dayColWidth - 0.4;
        const sigHeight = cellHeight - 0.8;
        pdf.addImage(record.signature, 'PNG', x + 0.4, sigY + 0.8, sigWidth, sigHeight);
        signatureAdded = true;
      } catch (error) {
        console.warn('Could not add record signature to PDF:', error);
      }
    }
    
    // Final fallback: add "✓" text if no signature was added
    if (!signatureAdded) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      const checkText = '✓';
      const textWidth = pdf.getTextWidth(checkText);
      const centerX = x + (dayColWidth - textWidth) / 2;
      pdf.text(checkText, centerX, sigY + sigCellHeight/2 + 1);
    }
    // Ridisegna il bordo della cella firma sopra l'immagine
    pdf.rect(x, sigY, dayColWidth, sigCellHeight);
  }
  
  return pdf;
};

// PDF Generation - Monthly Sanification Report
export const generateMonthlySanificationPDF = async (records: HaccpRecord[], company: CompanyInfo, year: number, month: number): Promise<jsPDF> => {
  const pdf = new jsPDF('landscape', 'mm', 'a4');
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
  for (const record of records) {
    const date = new Date(record.date);
    const day = date.getDate();
    const x = startX + labelColWidth + (day - 1) * dayColWidth;
    
    // signature cell border already drawn above for every day
    
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
        const sigWidth = dayColWidth - 0.4;
        const sigHeight = cellHeight - 0.8;
        pdf.addImage(record.signature, 'PNG', x + 0.4, sigY + 0.8, sigWidth, sigHeight);
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
    // Ridisegna il bordo della cella firma sopra l'immagine
    pdf.rect(x, sigY, dayColWidth, sigCellHeight2);
  }
  
  // Ensure bottom closing line of table
  const tableBottomY2 = sigY + cellHeight;
  const tableRightX2 = startX + labelColWidth + 31 * dayColWidth;
  pdf.line(startX, tableBottomY2, tableRightX2, tableBottomY2);
  
  return pdf;
};

export const generateZipArchive = async (records: HaccpRecord[], company: CompanyInfo): Promise<Blob> => {
  const zip = new JSZip();
  
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
    const tempPdf = await generateMonthlyPDF(monthRecords, company, year, month);
    const tempPdfBlob = tempPdf.output('blob');
    zip.file(`HACCP_Temperature_${monthKey}.pdf`, tempPdfBlob);
    
    // Sanification PDF
    const sanitationPdf = await generateMonthlySanificationPDF(monthRecords, company, year, month);
    const sanitationPdfBlob = sanitationPdf.output('blob');
    zip.file(`HACCP_Sanificazione_${monthKey}.pdf`, sanitationPdfBlob);
  }
  
  return zip.generateAsync({ type: 'blob' });
};