import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { HaccpForm } from '@/components/HaccpForm';
import { AutoGenerator } from '@/components/AutoGenerator';
import { RecordsList } from '@/components/RecordsList';
import GoogleDriveSync from '@/components/GoogleDriveSync';
import { CompanyInfo } from '@/types/haccp';
import { getRecords } from '@/lib/haccpUtils';
import { Building2, FileText, Zap, Archive, Settings, Cloud, PenTool } from 'lucide-react';
import Semilavorati from '@/components/Semilavorati';
import OsaSignature from '@/components/OsaSignature';
import { startAutoRegisterScheduler } from '@/lib/autoRegisters';

export default function HaccpDashboard() {
  const [company, setCompany] = useState<CompanyInfo>({
    name: 'SINGH SUKH GURINDER',
    piva: '13572610965',
    address: ''
  });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // Load company info from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('haccp_settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      setCompany(settings.company);
    }
  }, []);

  const saveCompanyInfo = () => {
    const settings = { company };
    localStorage.setItem('haccp_settings', JSON.stringify(settings));
    setShowSettings(false);
  };

  const handleRecordUpdate = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const getStats = () => {
    const records = getRecords();
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const thisMonth = records.filter(record => {
      const date = new Date(record.date);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }).length;

    const thisYear = records.filter(record => {
      const date = new Date(record.date);
      return date.getFullYear() === currentYear;
    }).length;

    return {
      total: records.length,
      thisMonth,
      thisYear,
      lastRecord: records.length > 0 ? records.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )[0].date : null
    };
  };

  const stats = getStats();

  // Avvio scheduler automatico registri HACCP (Temperature e Sanificazione)
  useEffect(() => {
    const { cancel } = startAutoRegisterScheduler(company);
    return () => { try { cancel(); } catch {} };
  }, [company]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Sistema HACCP</h1>
              <p className="text-gray-600">Gestione Automatizzata Registri</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-medium">{company.name}</div>
                <div className="text-sm text-gray-500">P.IVA: {company.piva}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings className="w-4 h-4 mr-2" />
                Impostazioni
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Company Settings */}
        {showSettings && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Informazioni Azienda
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="companyName">Nome Azienda</Label>
                  <Input
                    id="companyName"
                    value={company.name}
                    onChange={(e) => setCompany(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="companyPiva">P.IVA</Label>
                  <Input
                    id="companyPiva"
                    value={company.piva}
                    onChange={(e) => setCompany(prev => ({ ...prev, piva: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="companyAddress">Indirizzo (opzionale)</Label>
                <Input
                  id="companyAddress"
                  value={company.address || ''}
                  onChange={(e) => setCompany(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>
              <Button onClick={saveCompanyInfo}>
                Salva Impostazioni
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stats Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Registri Totali</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
                </div>
                <FileText className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Questo Mese</p>
                  <p className="text-2xl font-bold text-green-600">{stats.thisMonth}</p>
                </div>
                <Archive className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Quest'Anno</p>
                  <p className="text-2xl font-bold text-purple-600">{stats.thisYear}</p>
                </div>
                <Zap className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Ultimo Registro</p>
                  <p className="text-sm font-bold text-orange-600">
                    {stats.lastRecord ? 
                      new Date(stats.lastRecord).toLocaleDateString('it-IT') : 
                      'Nessuno'
                    }
                  </p>
                </div>
                <Badge variant={stats.lastRecord ? 'default' : 'secondary'}>
                  {stats.lastRecord ? 'Aggiornato' : 'Vuoto'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="daily" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Compilazione Giornaliera
            </TabsTrigger>
            <TabsTrigger value="auto" className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Generazione Automatica
            </TabsTrigger>
            <TabsTrigger value="archive" className="flex items-center gap-2">
              <Archive className="w-4 h-4" />
              Archivio e Consultazione
            </TabsTrigger>
            <TabsTrigger value="cloud" className="flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              Google Drive
            </TabsTrigger>
            <TabsTrigger value="semilavorati"><FileText className="mr-2 h-4 w-4" /> Prodotti Semilavorati</TabsTrigger>
            <TabsTrigger value="firma-osa" className="flex items-center gap-2">
              <PenTool className="w-4 h-4" />
              Firma OSA
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <HaccpForm company={company} onRecordSaved={handleRecordUpdate} />
          </TabsContent>

          <TabsContent value="auto">
            <AutoGenerator company={company} onGenerationComplete={handleRecordUpdate} />
          </TabsContent>

          <TabsContent value="archive">
            <RecordsList company={company} refreshTrigger={refreshTrigger} />
          </TabsContent>

          <TabsContent value="cloud">
            <GoogleDriveSync company={company} />
          </TabsContent>
          <TabsContent value="semilavorati">
            <Semilavorati />
          </TabsContent>

          <TabsContent value="firma-osa">
            <OsaSignature />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}