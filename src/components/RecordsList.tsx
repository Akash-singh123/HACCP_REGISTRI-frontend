import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { Download, Calendar, FileText, Archive, Thermometer, Droplets, Trash2, Truck, ChefHat } from 'lucide-react';
import { getRecords, generateMonthlyPDF, generateMonthlySanificationPDF, generateZipArchive, deleteAllRecords, deleteRecordsByMonth } from '@/lib/haccpUtils';
import { HaccpRecord, CompanyInfo } from '@/types/haccp';
import { DOC_FOLDERS, readTextFile, saveBlob } from '@/lib/docs';
import { useIncomingFoodsStore } from '@/store/incomingFoodsStore';
import {
  collectSemesters,
  generateIncomingRegistryPdf,
  generateSemiRegistryPdf,
  isInSemester,
  parseSemiRegistry,
  semesterFileSuffix,
  semesterKey,
  semesterLabel,
  SEMI_REGISTRY_CSV,
  type Semester,
  type SemiRegistryEntry,
} from '@/lib/registers';
import { toast } from 'sonner';

interface RecordsListProps {
  company: CompanyInfo;
  refreshTrigger?: number;
}

function RecordsList({ company, refreshTrigger = 0 }: RecordsListProps) {
  const [records, setRecords] = useState<HaccpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [semiEntries, setSemiEntries] = useState<SemiRegistryEntry[]>([]);
  const [semiLoading, setSemiLoading] = useState(true);
  const { items: incomingItems, load: loadIncomingFoods } = useIncomingFoodsStore();
  const { confirm, confirmDialog } = useConfirm();

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setRecords(await getRecords());
    } catch (e) {
      console.error(e);
      toast.error('Errore nel caricamento dei registri');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSemiRegistry = useCallback(async () => {
    try {
      setSemiLoading(true);
      const csvText = await readTextFile(DOC_FOLDERS.semilavorati, SEMI_REGISTRY_CSV);
      setSemiEntries(csvText ? parseSemiRegistry(csvText) : []);
    } catch (e) {
      console.error(e);
      toast.error('Errore nel caricamento del registro semilavorati');
    } finally {
      setSemiLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords, refreshTrigger]);

  useEffect(() => {
    loadSemiRegistry();
  }, [loadSemiRegistry, refreshTrigger]);

  useEffect(() => {
    loadIncomingFoods();
  }, [loadIncomingFoods]);

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

  // Semestri disponibili per i registri lunghi (file suddivisi ogni 6 mesi)
  const incomingSemesters = collectSemesters(incomingItems.map((item) => item.dataAcquisto));
  const semiSemesters = collectSemesters(semiEntries.map((entry) => entry.dataProduzione));

  const incomingBySemester = incomingItems.reduce((acc, item) => {
    const key = semesterKey(
      incomingSemesters.find((s) => isInSemester(item.dataAcquisto, s)) ?? { year: 0, half: 1 }
    );
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const semiBySemester = semiEntries.reduce((acc, entry) => {
    const key = semesterKey(
      semiSemesters.find((s) => isInSemester(entry.dataProduzione, s)) ?? { year: 0, half: 1 }
    );
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleDeleteAll = async () => {
    if (!records.length) return;
    confirm({
      title: 'Eliminare tutti i registri?',
      description: 'Verranno rimossi definitivamente tutti i registri temperature e sanificazione. Questa azione è irreversibile.',
      confirmLabel: 'Elimina tutti',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteAllRecords();
          setRecords([]);
          toast.success('Tutti i registri sono stati eliminati');
        } catch (e) {
          console.error(e);
          toast.error('Errore durante l\'eliminazione dei registri');
        }
      },
    });
  };

  const handleDeleteMonth = async (year: number, month: number) => {
    const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    confirm({
      title: `Eliminare i registri di ${monthName}?`,
      description: `Tutti i registri del mese di ${monthName} verranno rimossi definitivamente. L'operazione non può essere annullata.`,
      confirmLabel: 'Elimina mese',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteRecordsByMonth(year, month);
          await loadRecords();
          toast.success(`Registri di ${monthName} eliminati`);
        } catch (e) {
          console.error(e);
          toast.error('Errore durante l\'eliminazione del mese');
        }
      },
    });
  };

  const downloadMonthlyTemperaturePDF = async (year: number, month: number, monthRecords: HaccpRecord[]) => {
    try {
      const pdf = await generateMonthlyPDF(monthRecords, company, year, month);
      const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      saveBlob(pdf.output('blob'), `HACCP_Temperature_${monthName.replace(/\s+/g, '_')}.pdf`);
      toast.success('Registro Temperature mensile scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Temperature mensile', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const downloadMonthlySanificationPDF = async (year: number, month: number, monthRecords: HaccpRecord[]) => {
    try {
      const pdf = await generateMonthlySanificationPDF(monthRecords, company, year, month);
      const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      saveBlob(pdf.output('blob'), `HACCP_Sanificazione_${monthName.replace(/\s+/g, '_')}.pdf`);
      toast.success('Registro Sanificazione mensile scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Sanificazione mensile', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const downloadAllRecords = async () => {
    try {
      if (records.length === 0) return;
      const zipBlob = await generateZipArchive(records, company);
      saveBlob(zipBlob, 'HACCP_Registri_Completi.zip');
      toast.success('Archivio ZIP scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download dell\'archivio ZIP');
    }
  };

  // Registro alimenti in ingresso: PDF cronologico, completo e aggiornato, per semestre.
  const downloadIncomingSemesterPDF = (semester: Semester) => {
    try {
      const pdf = generateIncomingRegistryPdf(incomingItems, company, semester);
      saveBlob(pdf.output('blob'), `Registro_Alimenti_Ingresso_${semesterFileSuffix(semester)}.pdf`);
      toast.success(`Registro Alimenti in Ingresso scaricato (${semesterLabel(semester)})`);
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Alimenti in Ingresso');
    }
  };

  // Registro semilavorati: PDF per semestre.
  const downloadSemiSemesterPDF = (semester: Semester) => {
    try {
      const filtered = semiEntries.filter((entry) => isInSemester(entry.dataProduzione, semester));
      const pdf = generateSemiRegistryPdf(filtered, company, semesterLabel(semester));
      saveBlob(pdf.output('blob'), `Registro_Semilavorati_${semesterFileSuffix(semester)}.pdf`);
      toast.success(`Registro Semilavorati scaricato (${semesterLabel(semester)})`);
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del Registro Semilavorati');
    }
  };

  const months = Object.entries(recordsByMonth).sort(([a], [b]) => b.localeCompare(a));

  if (loading) {
    return (
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>Archivio registri</CardTitle>
              <CardDescription>Caricamento dei registri in corso…</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── (a) Download completo / azioni globali ─────────────── */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Archive className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Archivio completo</CardTitle>
                <CardDescription>
                  Esporta l'intero archivio oppure gestisci tutti i registri in un'unica azione.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {records.length} registri
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={downloadAllRecords} disabled={!records.length} className="h-auto justify-start gap-3 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-foreground/15">
                <Download className="h-4 w-4" />
              </span>
              Scarica tutti i registri (ZIP)
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={!records.length}
              className="h-auto justify-start gap-3 py-3"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive-foreground/15">
                <Trash2 className="h-4 w-4" />
              </span>
              Elimina tutti i registri
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            L'archivio ZIP include i registri temperature e sanificazione di tutti i mesi.
          </p>
        </CardContent>
      </Card>

      {/* ── (b) Registri mensili (Temperature / Sanificazione) ─── */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <Calendar className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Registri mensili</CardTitle>
                <CardDescription>
                  Registri temperature e sanificazione, mese per mese.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {months.length} mesi
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {months.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <Thermometer className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Nessun registro mensile</p>
                <p className="text-sm text-muted-foreground">
                  Non ci sono ancora registri temperature o sanificazione.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {months.map(([monthKey, monthRecords]) => {
                const [year, month] = monthKey.split('-').map(Number);
                const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', {
                  month: 'long',
                  year: 'numeric',
                });

                return (
                  <div key={monthKey} className="flex flex-col rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold capitalize">{monthName}</p>
                        <p className="text-xs text-muted-foreground">Registro mensile</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {monthRecords.length} registri
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadMonthlyTemperaturePDF(year, month, monthRecords)}
                      >
                        <Thermometer className="h-4 w-4" />
                        Temperature
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadMonthlySanificationPDF(year, month, monthRecords)}
                      >
                        <Droplets className="h-4 w-4" />
                        Sanificazione
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Elimina mese"
                        aria-label={`Elimina i registri di ${monthName}`}
                        onClick={() => handleDeleteMonth(year, month)}
                        className="ml-auto h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── (c) Registro Alimenti in Ingresso per semestre ─────── */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
                <Truck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Registro alimenti in ingresso</CardTitle>
                <CardDescription>
                  Registro cronologico completo e aggiornato, suddiviso per semestre (gennaio-giugno / luglio-dicembre)
                  per non diventare troppo pesante nel tempo.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {incomingSemesters.length} semestri
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {incomingSemesters.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <Truck className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Nessun alimento in ingresso</p>
                <p className="text-sm text-muted-foreground">
                  Non è ancora stato registrato alcun alimento in ingresso.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {incomingSemesters.map((semester) => {
                const key = semesterKey(semester);
                return (
                  <div key={key} className="flex flex-col rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold capitalize">{semesterLabel(semester)}</p>
                        <p className="text-xs text-muted-foreground">
                          {incomingBySemester[key] ?? 0} voci registrate
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {incomingBySemester[key] ?? 0}
                      </Badge>
                    </div>
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <Button variant="outline" size="sm" onClick={() => downloadIncomingSemesterPDF(semester)}>
                        <Download className="h-4 w-4" />
                        Scarica PDF
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── (d) Registro Semilavorati per semestre ─────────────── */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
                <ChefHat className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Registro semilavorati</CardTitle>
                <CardDescription>
                  Prodotti semilavorati con i lotti degli ingredienti, suddivisi per semestre (gennaio-giugno / luglio-dicembre).
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {semiSemesters.length} semestri
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {semiLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : semiSemesters.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <ChefHat className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Nessuna registrazione semilavorati</p>
                <p className="text-sm text-muted-foreground">
                  Non è ancora stata registrata alcuna produzione di semilavorati.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {semiSemesters.map((semester) => {
                const key = semesterKey(semester);
                return (
                  <div key={key} className="flex flex-col rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold capitalize">{semesterLabel(semester)}</p>
                        <p className="text-xs text-muted-foreground">
                          {semiBySemester[key] ?? 0} registrazioni
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {semiBySemester[key] ?? 0}
                      </Badge>
                    </div>
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <Button variant="outline" size="sm" onClick={() => downloadSemiSemesterPDF(semester)}>
                        <Download className="h-4 w-4" />
                        Scarica PDF
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}

export default RecordsList;
// Add named export for compatibility with existing imports
export { RecordsList };
