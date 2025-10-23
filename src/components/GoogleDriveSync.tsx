import { useState, useEffect } from 'react'; 
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Cloud, 
  CloudOff, 
  Upload, 
  Download, 
  FolderOpen, 
  CheckCircle, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { googleDriveManager, DriveFile } from '@/lib/googleDrive';
import { 
  getRecords, 
  generateMonthlyPDF, 
  generateMonthlySanificationPDF,
  getRecordsByMonth 
} from '@/lib/haccpUtils';
import { CompanyInfo } from '@/types/haccp';
import { toast } from 'sonner';

interface GoogleDriveSyncProps {
  company: CompanyInfo;
}

export default function GoogleDriveSync({ company }: GoogleDriveSyncProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);

  useEffect(() => {
    const checkToken = async () => {
      setIsLoading(true);
      try {
        await googleDriveManager.initialize();
        const tokenValid = await googleDriveManager.checkExistingToken();
        setIsConnected(tokenValid);
        if (tokenValid) toast.success('Token Google Drive valido trovato');
      } catch (error) {
        console.error('Errore durante il controllo del token esistente:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkToken();
  }, []);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      console.log('Tentativo di connessione a Google Drive...');
      console.log('Client ID:', import.meta.env.VITE_GOOGLE_CLIENT_ID ? 'Presente' : 'Mancante');
      console.log('API Key:', import.meta.env.VITE_GOOGLE_API_KEY ? 'Presente' : 'Mancante');

      const success = await googleDriveManager.signIn();
      setIsConnected(success);

      if (success) {
        toast.success('Connesso a Google Drive con successo!');
        await loadDriveFiles();
      } else {
        toast.error('Connessione a Google Drive fallita');
      }
    } catch (error) {
      console.error('Google Drive connection error:', error);
      toast.error('Errore durante la connessione a Google Drive');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await googleDriveManager.signOut();
      setIsConnected(false);
      setDriveFiles([]);
      localStorage.removeItem('gd_token');
      toast.success('Disconnesso da Google Drive');
    } catch (error) {
      console.error('Google Drive disconnection error:', error);
      toast.error('Errore durante la disconnessione');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDriveFiles = async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      setRootFolderId(rootId);
      const files = await googleDriveManager.listFiles(rootId);
      setDriveFiles(files);
      toast.success('Lista aggiornata correttamente');
    } catch (error) {
      console.error('Failed to load Drive files:', error);
      toast.error(`Errore nell'aggiornamento della lista: ${(error as any)?.message || 'sconosciuto'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadMonthlyRecords = async (year: number, month: number) => {
    if (!isConnected) return toast.error('Non connesso a Google Drive');

    setSyncStatus('syncing');
    try {
      const records = getRecordsByMonth(year, month);
      if (!records.length) return toast.error('Nessun registro trovato per il mese selezionato');

      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const monthFolderId = await googleDriveManager.findOrCreateMonthFolder(year, month, rootId);

      const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const safeLabel = monthName.replace(/\s+/g, '_');

      // Genera PDF
      const tempPdf = await generateMonthlyPDF(records, company, year, month);
      const sanitationPdf = await generateMonthlySanificationPDF(records, company, year, month);

      // Sovrascrive o ricarica mantenendo lo stesso nome
      await googleDriveManager.uploadOrUpdateFile(`HACCP_Temperature_${safeLabel}.pdf`, tempPdf.output('blob'), monthFolderId);
      await googleDriveManager.uploadOrUpdateFile(`HACCP_Sanificazione_${safeLabel}.pdf`, sanitationPdf.output('blob'), monthFolderId);

      setSyncStatus('success');
      toast.success(`Registri di ${monthName} caricati/aggiornati su Google Drive!`);
      await loadDriveFiles();
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Errore durante il caricamento su Google Drive');
      setSyncStatus('error');
    }
  };

  const uploadAllRecords = async () => {
    if (!isConnected) return toast.error('Non connesso a Google Drive');

    setSyncStatus('syncing');
    try {
      const records = getRecords();
      if (!records.length) return toast.error('Nessun registro da caricare');

      const recordsByMonth = records.reduce((acc, record) => {
        const date = new Date(record.date);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(record);
        return acc;
      }, {} as Record<string, any[]>);

      let uploadCount = 0;
      const totalMonths = Object.keys(recordsByMonth).length;

      for (const [monthKey, monthRecords] of Object.entries(recordsByMonth)) {
        const [year, month] = monthKey.split('-').map(Number);
        await uploadMonthlyRecords(year, month);
        uploadCount++;
        toast.info(`Caricamento in corso: ${uploadCount}/${totalMonths} mesi completati`);
      }

      setSyncStatus('success');
      toast.success(`Tutti i registri caricati su Google Drive! (${totalMonths} mesi)`);
    } catch (error) {
      console.error('Bulk upload failed:', error);
      toast.error('Errore durante il caricamento completo');
      setSyncStatus('error');
    }
  };

  const downloadFromDrive = async (fileId: string, fileName: string) => {
    try {
      const blob = await googleDriveManager.downloadFile(fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${fileName} scaricato da Google Drive`);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Errore durante il download da Google Drive');
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Sincronizzazione Google Drive</span>
            <Badge variant={isConnected ? "success" : "destructive"}>
              {isConnected ? "Connesso" : "Non connesso"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <Cloud className="h-5 w-5 text-green-500" />
                  <span>Connesso a Google Drive</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    onClick={handleDisconnect}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CloudOff className="mr-2 h-4 w-4" />
                    )}
                    Disconnetti
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => uploadAllRecords()}
                    disabled={isLoading || syncStatus === 'syncing'}
                  >
                    {syncStatus === 'syncing' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Carica tutti i registri
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => loadDriveFiles()}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="mr-2 h-4 w-4" />
                    )}
                    Aggiorna lista file
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => rootFolderId && window.open(`https://drive.google.com/drive/folders/${rootFolderId}`, '_blank')}
                    disabled={!rootFolderId}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Apri cartella su Drive
                  </Button>
                </div>
                
                {syncStatus === 'success' && (
                  <Alert className="bg-green-50">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <AlertDescription>Sincronizzazione completata con successo!</AlertDescription>
                  </Alert>
                )}
                
                {syncStatus === 'error' && (
                  <Alert className="bg-red-50">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <AlertDescription>Errore durante la sincronizzazione. Riprova.</AlertDescription>
                  </Alert>
                )}
                
                {/* File list */}
                {driveFiles.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium mb-2">File su Google Drive:</h3>
                    <div className="border rounded-md divide-y">
                      {driveFiles.map((file) => (
                        <div key={file.id} className="p-2 flex justify-between items-center">
                          <span className="text-sm">{file.name}</span>
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => window.open(`https://drive.google.com/file/d/${file.id}/view`, '_blank')}
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => downloadFromDrive(file.id, file.name)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <CloudOff className="h-5 w-5 text-gray-400" />
                  <span>Non connesso a Google Drive</span>
                </div>
                <Button 
                  onClick={handleConnect}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="mr-2 h-4 w-4" />
                  )}
                  Connetti a Google Drive
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
