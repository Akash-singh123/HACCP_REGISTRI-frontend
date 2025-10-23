import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Calendar, FileText, Archive, Thermometer, Droplets, Trash2 } from 'lucide-react';
import { getRecords, getRecordsByMonth, generatePDF, generateSanificationPDF, generateMonthlyPDF, generateMonthlySanificationPDF, generateZipArchive, deleteAllRecords, deleteRecordsByMonth, deleteRecordByDate } from '@/lib/haccpUtils';
import { HaccpRecord, CompanyInfo } from '@/types/haccp';
import { toast } from 'sonner';

interface RecordsListProps {
  company: CompanyInfo;
}

function RecordsList({ company }: RecordsListProps) {
  const [records, setRecords] = useState<HaccpRecord[]>(() => getRecords());
  
  // Group records by month
  const recordsByMonth = records.reduce((acc, record) => {
    const date = new Date(record.date);
    const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    if (!acc[monthKey]) {
      acc[monthKey] = [];
    }
    acc[monthKey].push(record);
    return acc;
  }, {} as Record<string, HaccpRecord[]>);

  const handleDeleteAll = () => {
    if (!records.length) return;
    const ok = window.confirm('Sei sicuro di voler eliminare TUTTI i registri? Questa azione è irreversibile.');
    if (!ok) return;
    try {
      deleteAllRecords();
      setRecords([]);
      toast.success('Tutti i registri sono stati eliminati');
    } catch (e) {
      console.error(e);
      toast.error('Errore durante l\'eliminazione dei registri');
    }
  };

  const handleDeleteMonth = (year: number, month: number) => {
    const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    const ok = window.confirm(`Eliminare tutti i registri di ${monthName}?`);
    if (!ok) return;
    try {
      deleteRecordsByMonth(year, month);
      setRecords(getRecords());
      toast.success(`Registri di ${monthName} eliminati`);
    } catch (e) {
      console.error(e);
      toast.error('Errore durante l\'eliminazione del mese');
    }
  };

  const handleDeleteDate = (record: HaccpRecord) => {
    const dateLabel = new Date(record.date).toLocaleDateString('it-IT', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const ok = window.confirm(`Eliminare il registro di ${dateLabel}?`);
    if (!ok) return;
    try {
      deleteRecordByDate(record.date);
      setRecords(getRecords());
      toast.success(`Registro del ${dateLabel} eliminato`);
    } catch (e) {
      console.error(e);
      toast.error('Errore durante l\'eliminazione del registro giornaliero');
    }
  };
  
  const downloadDailyTemperaturePDF = async (record: HaccpRecord) => {
    try {
      const pdf = await generatePDF(record, company);
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `HACCP_Temperature_${record.date}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF Temperature scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del PDF Temperature');
    }
  };

  const downloadDailySanificationPDF = async (record: HaccpRecord) => {
    try {
      const pdf = await generateSanificationPDF(record, company);
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `HACCP_Sanificazione_${record.date}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF Sanificazione scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del PDF Sanificazione');
    }
  };

  const downloadMonthlyTemperaturePDF = async (year: number, month: number) => {
    try {
      const monthRecords = getRecordsByMonth(year, month);
      const pdf = await generateMonthlyPDF(monthRecords, company, year, month);
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      a.href = url;
      a.download = `HACCP_Temperature_${monthName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Registro Temperature mensile scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Temperature mensile');
    }
  };

  const downloadMonthlySanificationPDF = async (year: number, month: number) => {
    try {
      const monthRecords = getRecordsByMonth(year, month);
      const pdf = await generateMonthlySanificationPDF(monthRecords, company, year, month);
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      a.href = url;
      a.download = `HACCP_Sanificazione_${monthName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Registro Sanificazione mensile scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Sanificazione mensile');
    }
  };
  
  const downloadAllRecords = async () => {
    try {
      if (records.length === 0) return;
      const zipBlob = await generateZipArchive(records, company);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'HACCP_Registri_Completi.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Archivio ZIP scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download dell\'archivio ZIP');
    }
  };

  if (records.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Archivio Registri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Nessun registro trovato. Inizia compilando il primo registro giornaliero.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Download Completo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Button onClick={downloadAllRecords} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Scarica Tutti i Registri (ZIP)
            </Button>
            <Button variant="destructive" onClick={handleDeleteAll} className="w-full">
              <Trash2 className="h-4 w-4 mr-2" />
              Elimina Tutti i Registri
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Include registri temperature e sanificazione per tutti i mesi
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Registri Mensili
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(recordsByMonth)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([monthKey, monthRecords]) => {
              const [year, month] = monthKey.split('-').map(Number);
              const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { 
                month: 'long', 
                year: 'numeric' 
              });
              
              return (
                <div key={monthKey} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold capitalize">{monthName}</h3>
                    <Badge variant="secondary">{monthRecords.length} registri</Badge>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadMonthlyTemperaturePDF(year, month)}
                      className="flex items-center gap-2"
                    >
                      <Thermometer className="h-4 w-4" />
                      Registro Temperature
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadMonthlySanificationPDF(year, month)}
                      className="flex items-center gap-2"
                    >
                      <Droplets className="h-4 w-4" />
                      Registro Sanificazione
                    </Button>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteMonth(year, month)}
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Elimina Mese
                    </Button>
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Registri Giornalieri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {records
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map((record) => (
                <div key={record.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold capitalize">
                        {new Date(record.date).toLocaleDateString('it-IT', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </h3>
                      <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                        <span>C1: {record.temperatures.freezer}°C</span>
                        <span>F1: {record.temperatures.fridge1}°C</span>
                        <span>F2: {record.temperatures.fridge2}°C</span>
                      </div>
                    </div>
                    <Badge variant={record.signature ? 'default' : 'secondary'}>
                      {record.signature ? 'Firmato' : 'Non firmato'}
                    </Badge>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadDailyTemperaturePDF(record)}
                      className="flex items-center gap-2"
                    >
                      <Thermometer className="h-4 w-4" />
                      PDF Temperature
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadDailySanificationPDF(record)}
                      className="flex items-center gap-2"
                    >
                      <Droplets className="h-4 w-4" />
                      PDF Sanificazione
                    </Button>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteDate(record)}
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Elimina Giorno
                    </Button>
                  </div>
                  
                  {record.notes && (
                    <div className="mt-3 p-2 bg-muted rounded text-sm">
                      <strong>Note:</strong> {record.notes}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default RecordsList;
// Add named export for compatibility with existing imports
export { RecordsList };