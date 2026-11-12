import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SignaturePad } from './SignaturePad';
import { CompanyInfo } from '@/types/haccp';
import { createHaccpRecord, saveRecords, generateDateRange, getEquipment, generateRandomTemperature } from '@/lib/haccpUtils';
import { toast } from 'sonner';
import {
  Zap,
  CalendarDays,
  CalendarRange,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Signature as SignatureIcon,
  Sparkles,
} from 'lucide-react';

interface AutoGeneratorProps {
  company: CompanyInfo;
  onGenerationComplete: () => void;
}

/** Converte una data YYYY-MM-DD nel formato italiano GG/MM/AAAA. */
const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  if (year && month && day) return `${day}/${month}/${year}`;
  return value;
};

export const AutoGenerator: React.FC<AutoGeneratorProps> = ({ company, onGenerationComplete }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [signature, setSignature] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      toast.error('Seleziona le date di inizio e fine');
      return;
    }

    if (!signature) {
      toast.error('La firma OSA è obbligatoria');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      toast.error('La data di inizio deve essere precedente alla data di fine');
      return;
    }

    setIsGenerating(true);
    setProgress(0);

    try {
      const dates = generateDateRange(startDate, endDate);
      const totalDates = dates.length;

      if (totalDates > 365) {
        toast.error('Il periodo selezionato è troppo lungo (massimo 1 anno)');
        setIsGenerating(false);
        return;
      }

      toast.info(`Generazione di ${totalDates} registri in corso...`);

      // Le temperature vengono generate per ogni attrezzatura configurata.
      const equipment = await getEquipment();
      const temperatures = Object.fromEntries(
        equipment.map((item) => [item.id, generateRandomTemperature(item.kind)])
      );

      // Salvataggio a blocchi per ridurre il numero di richieste al backend.
      const batchSize = 100;
      let queuedCount = 0;
      for (let i = 0; i < dates.length; i += batchSize) {
        const chunk = dates
          .slice(i, i + batchSize)
          .map((date) => createHaccpRecord(date, signature, company, { temperatures }));
        const result = await saveRecords(chunk);
        if (result.queued) queuedCount += chunk.length;

        const done = Math.min(i + batchSize, totalDates);
        setProgress((done / totalDates) * 100);
      }

      if (queuedCount > 0) {
        toast.success(`${totalDates} registri salvati sul dispositivo`, {
          description: 'Nessuna connessione: la sincronizzazione avverrà automaticamente appena torna online.',
        });
      } else {
        toast.success(`${totalDates} registri generati con successo!`);
      }
      onGenerationComplete();
    } catch (error) {
      console.error('Errore durante la generazione:', error);
      toast.error('Errore durante la generazione dei registri');
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  };

  const calculateDays = () => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const days = calculateDays();
  const rangeSelected = Boolean(startDate && endDate);
  const rangeValid = rangeSelected && new Date(startDate) <= new Date(endDate);
  const rangeTooLong = rangeValid && days > 365;

  return (
    <div className="space-y-6">
      <Card className="surface overflow-hidden animate-fade-in">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Zap className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>Generazione automatica registri</CardTitle>
              <CardDescription>
                Seleziona un intervallo di date e firma: verrà creato un registro HACCP per ogni giorno del periodo.
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1.5 border-info/30 bg-info/10 text-info">
              <Sparkles className="h-3.5 w-3.5" />
              Compilazione massiva
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {/* Intervallo date */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="startDate" className="field-label">Data inizio</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isGenerating}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endDate" className="field-label">Data fine</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isGenerating}
              />
            </div>
          </div>

          {/* Anteprima / avvisi sull'intervallo selezionato */}
          {rangeSelected ? (
            !rangeValid ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Intervallo non valido</AlertTitle>
                <AlertDescription className="break-words">
                  La data di inizio deve essere precedente alla data di fine.
                </AlertDescription>
              </Alert>
            ) : rangeTooLong ? (
              <Alert className="border-warning/40 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Periodo troppo lungo</AlertTitle>
                <AlertDescription className="break-words">
                  Sono {days} giornate: il limite massimo è di 365 registri per generazione. Riduci l'intervallo.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                    <CalendarRange className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold">
                      Verranno generati {days} registri giornalieri
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Dal {formatDate(startDate)} al {formatDate(endDate)}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="w-fit gap-1.5 border-info/30 bg-background text-info">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Intervallo valido
                </Badge>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <CalendarDays className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Seleziona l'intervallo di date</p>
                <p className="text-sm text-muted-foreground">
                  Scegli data di inizio e fine per vedere quanti registri verranno generati.
                </p>
              </div>
            </div>
          )}

          {/* Firma OSA */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SignatureIcon className="h-4 w-4 text-muted-foreground" />
              <Label className="field-label">Firma OSA *</Label>
            </div>
            <SignaturePad
              onSignatureChange={setSignature}
              initialSignature={signature}
            />
            {!signature && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                La firma OSA è obbligatoria per generare i registri.
              </p>
            )}
          </div>

          {/* Avanzamento generazione */}
          {isGenerating && (
            <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generazione in corso…
                </span>
                <span className="font-mono font-semibold text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2 w-full" />
            </div>
          )}

          {/* Azione principale */}
          <Button
            onClick={handleGenerate}
            className="w-full"
            size="lg"
            disabled={isGenerating || !startDate || !endDate || !signature}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isGenerating ? 'Generazione in corso…' : 'Genera registri'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
