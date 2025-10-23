import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SignaturePad } from './SignaturePad';
import { HaccpRecord, CompanyInfo } from '@/types/haccp';
import { createHaccpRecord, saveRecord, getRecordByDate } from '@/lib/haccpUtils';
import { toast } from 'sonner';
import { Save, Calendar } from 'lucide-react';

interface HaccpFormProps {
  company: CompanyInfo;
  onRecordSaved: () => void;
}

export const HaccpForm: React.FC<HaccpFormProps> = ({ company, onRecordSaved }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [temperatures, setTemperatures] = useState({
    freezer: -20,
    fridge1: 2,
    fridge2: 1.5
  });
  const [cleaning, setCleaning] = useState({
    equipment: true,
    surfaces: true,
    utensils: true,
    floors: true,
    refrigerators: true,
    walls: true,
    lighting: true,
    doors: true,
    shelves: true,
    toilets: true,
    wasteContainers: true,
    ovens: true,
  });
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState('');

  // Load existing record when date changes
  React.useEffect(() => {
    const existingRecord = getRecordByDate(selectedDate);
    if (existingRecord) {
      setTemperatures(existingRecord.temperatures);
      setCleaning(existingRecord.cleaning);
      setNotes(existingRecord.notes || '');
      setSignature(existingRecord.signature || '');
    }
  }, [selectedDate]);

  const handleSave = () => {
    if (!signature) {
      toast.error('La firma OSA è obbligatoria');
      return;
    }

    const record = createHaccpRecord(selectedDate, signature, company, {
      temperatures,
      cleaning,
      notes
    });

    saveRecord(record);
    toast.success('Registro salvato con successo');
    onRecordSaved();
  };

  const cleaningItems = [
    { key: 'equipment', label: 'Attrezzature Fisse' },
    { key: 'surfaces', label: 'Attrezzature Mobili' },
    { key: 'utensils', label: 'Utensili' },
    { key: 'floors', label: 'Pavimenti' },
    { key: 'refrigerators', label: 'Frigoriferi' },
    { key: 'walls', label: 'Pareti - Soffitti' },
    { key: 'lighting', label: 'Parti Illuminanti' },
    { key: 'doors', label: 'Porte Vetri Finestre' },
    { key: 'shelves', label: 'Scaffali' },
    { key: 'toilets', label: 'Servizi Igienici' },
    { key: 'wasteContainers', label: 'Contenitore Rifiuti' },
    { key: 'ovens', label: 'Forni' },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Compilazione Registro Giornaliero HACCP
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date Selection */}
          <div>
            <Label htmlFor="date">Data</Label>
            <Input
              id="date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-fit"
            />
          </div>

          {/* Temperature Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controllo Temperature</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="freezer">Congelatore (C1) °C</Label>
                  <Input
                    id="freezer"
                    type="number"
                    step="0.1"
                    min="-25"
                    max="-15"
                    value={temperatures.freezer}
                    onChange={(e) => setTemperatures(prev => ({ 
                      ...prev, 
                      freezer: parseFloat(e.target.value) 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Range: -18°C / -22°C</p>
                </div>
                
                <div>
                  <Label htmlFor="fridge1">Frigorifero 1 (F1) °C</Label>
                  <Input
                    id="fridge1"
                    type="number"
                    step="0.1"
                    min="0"
                    max="4"
                    value={temperatures.fridge1}
                    onChange={(e) => setTemperatures(prev => ({ 
                      ...prev, 
                      fridge1: parseFloat(e.target.value) 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Range: 0°C / +4°C</p>
                </div>
                
                <div>
                  <Label htmlFor="fridge2">Frigorifero 2 (F2) °C</Label>
                  <Input
                    id="fridge2"
                    type="number"
                    step="0.1"
                    min="0"
                    max="4"
                    value={temperatures.fridge2}
                    onChange={(e) => setTemperatures(prev => ({ 
                      ...prev, 
                      fridge2: parseFloat(e.target.value) 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Range: 0°C / +4°C</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cleaning Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controllo Sanificazione</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cleaningItems.map((item) => (
                  <div key={item.key} className="flex items-center justify-between space-x-2">
                    <Label htmlFor={item.key} className="text-sm">{item.label}</Label>
                    <Switch
                      id={item.key}
                      checked={cleaning[item.key as keyof typeof cleaning]}
                      onCheckedChange={(checked) => setCleaning(prev => ({
                        ...prev,
                        [item.key]: checked
                      }))}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes Section */}
          <div>
            <Label htmlFor="notes">Note (opzionale)</Label>
            <Textarea
              id="notes"
              placeholder="Inserisci eventuali note o osservazioni..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Signature Section */}
          <SignaturePad
            onSignatureChange={setSignature}
            initialSignature={signature}
          />

          {/* Save Button */}
          <Button onClick={handleSave} className="w-full" size="lg">
            <Save className="w-4 h-4 mr-2" />
            Salva Registro
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};