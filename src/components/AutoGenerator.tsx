import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SignaturePad } from './SignaturePad';
import { Progress } from '@/components/ui/progress';
import { CompanyInfo } from '@/types/haccp';
import { createHaccpRecord, saveRecord, generateDateRange } from '@/lib/haccpUtils';
import { toast } from 'sonner';
import { Zap, Calendar, Download } from 'lucide-react';

interface AutoGeneratorProps {
  company: CompanyInfo;
  onGenerationComplete: () => void;
}

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

      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const record = createHaccpRecord(date, signature, company);
        saveRecord(record);
        
        // Update progress
        const currentProgress = ((i + 1) / totalDates) * 100;
        setProgress(currentProgress);
        
        // Small delay to show progress and prevent UI blocking
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      toast.success(`${totalDates} registri generati con successo!`);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          Generazione Automatica Registri
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="startDate">Data Inizio</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isGenerating}
            />
          </div>
          
          <div>
            <Label htmlFor="endDate">Data Fine</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isGenerating}
            />
          </div>
        </div>

        {startDate && endDate && (
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 text-blue-700">
              <Calendar className="w-4 h-4" />
              <span className="font-medium">
                Verranno generati {calculateDays()} registri giornalieri
              </span>
            </div>
          </div>
        )}

        <SignaturePad
          onSignatureChange={setSignature}
          initialSignature={signature}
        />

        {isGenerating && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Generazione in corso...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        <Button 
          onClick={handleGenerate} 
          className="w-full" 
          size="lg"
          disabled={isGenerating || !startDate || !endDate || !signature}
        >
          <Download className="w-4 h-4 mr-2" />
          {isGenerating ? 'Generazione in corso...' : 'Genera Registri'}
        </Button>
      </CardContent>
    </Card>
  );
};