import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { googleDriveManager } from '@/lib/googleDrive';
import { Loader2, Upload, Download, Trash2, FileImage, CheckCircle } from 'lucide-react';

export default function OsaSignature() {
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [signatureExists, setSignatureExists] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        await googleDriveManager.initialize();
        const tokenValid = await googleDriveManager.checkExistingToken();
        setIsConnected(tokenValid);
        
        if (tokenValid) {
          await checkExistingSignature();
        }
      } catch (e) {
        console.error('Errore inizializzazione OSA Signature:', e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  async function checkExistingSignature() {
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      
      // Cerca cartella Firma_OSA
      let signatureFolder = await googleDriveManager.findFileByName('Firma_OSA', rootId);
      if (!signatureFolder) {
        return;
      }

      // Cerca file firma esistente (PNG, JPG, JPEG)
      const signatureFiles = await googleDriveManager.listFiles(signatureFolder.id);
      const signatureFile = signatureFiles.find(f => 
        f.name.toLowerCase().match(/\.(png|jpg|jpeg)$/i)
      );

      if (signatureFile) {
        setSignatureExists(true);
        // Crea URL temporaneo per preview
        const blob = await googleDriveManager.downloadFile(signatureFile.id);
        const url = URL.createObjectURL(blob);
        setSignatureUrl(url);
      }
    } catch (e) {
      console.error('Errore controllo firma esistente:', e);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validazione tipo file
    if (!file.type.match(/^image\/(png|jpeg|jpg)$/i)) {
      toast.error('Formato file non supportato. Usa PNG, JPG o JPEG.');
      return;
    }

    // Validazione dimensione (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File troppo grande. Dimensione massima: 5MB.');
      return;
    }

    setIsLoading(true);
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      
      // Crea cartella Firma_OSA se non esiste
      let signatureFolder = await googleDriveManager.findFileByName('Firma_OSA', rootId);
      if (!signatureFolder) {
        signatureFolder = await googleDriveManager.createFolder('Firma_OSA', rootId);
      }

      // Rimuovi firma esistente se presente
      const existingFiles = await googleDriveManager.listFiles(signatureFolder.id);
      for (const existingFile of existingFiles) {
        if (existingFile.name.toLowerCase().match(/\.(png|jpg|jpeg)$/i)) {
          await googleDriveManager.deleteFile(existingFile.id);
        }
      }

      // Carica nuova firma
      const fileName = `firma_osa.${file.name.split('.').pop()}`;
      await googleDriveManager.uploadFile(fileName, file, signatureFolder.id);

      // Aggiorna stato locale
      setSignatureExists(true);
      if (signatureUrl) {
        URL.revokeObjectURL(signatureUrl);
      }
      const newUrl = URL.createObjectURL(file);
      setSignatureUrl(newUrl);

      toast.success('Firma OSA caricata con successo');
    } catch (error) {
      console.error('Errore caricamento firma:', error);
      toast.error('Errore durante il caricamento della firma');
    } finally {
      setIsLoading(false);
      // Reset input
      event.target.value = '';
    }
  }

  async function handleDeleteSignature() {
    if (!signatureExists) return;

    setIsLoading(true);
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const signatureFolder = await googleDriveManager.findFileByName('Firma_OSA', rootId);
      
      if (signatureFolder) {
        const files = await googleDriveManager.listFiles(signatureFolder.id);
        for (const file of files) {
          if (file.name.toLowerCase().match(/\.(png|jpg|jpeg)$/i)) {
            await googleDriveManager.deleteFile(file.id);
          }
        }
      }

      // Pulisci stato locale
      setSignatureExists(false);
      if (signatureUrl) {
        URL.revokeObjectURL(signatureUrl);
        setSignatureUrl(null);
      }

      toast.success('Firma OSA eliminata');
    } catch (error) {
      console.error('Errore eliminazione firma:', error);
      toast.error('Errore durante l\'eliminazione della firma');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDownloadSignature() {
    if (!signatureExists) return;

    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const signatureFolder = await googleDriveManager.findFileByName('Firma_OSA', rootId);
      
      if (signatureFolder) {
        const files = await googleDriveManager.listFiles(signatureFolder.id);
        const signatureFile = files.find(f => 
          f.name.toLowerCase().match(/\.(png|jpg|jpeg)$/i)
        );

        if (signatureFile) {
          const blob = await googleDriveManager.downloadFile(signatureFile.id);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = signatureFile.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast.success('Firma scaricata');
        }
      }
    } catch (error) {
      console.error('Errore download firma:', error);
      toast.error('Errore durante il download della firma');
    }
  }

  // Cleanup URL quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (signatureUrl) {
        URL.revokeObjectURL(signatureUrl);
      }
    };
  }, [signatureUrl]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Gestione Firma OSA</span>
            <Badge variant={isConnected ? 'success' : 'destructive'}>
              {isConnected ? 'Drive connesso' : 'Drive non connesso'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {!isConnected ? (
              <Alert>
                <AlertDescription>
                  Connetti Google Drive per gestire la firma OSA.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Stato firma attuale */}
                <div className="flex items-center gap-4 p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileImage className="h-5 w-5" />
                      <span className="font-medium">Stato firma OSA</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {signatureExists ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-green-700">Firma caricata e disponibile</span>
                        </>
                      ) : (
                        <>
                          <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
                          <span className="text-gray-500">Nessuna firma caricata</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {signatureExists && signatureUrl && (
                    <div className="flex-shrink-0">
                      <img 
                        src={signatureUrl} 
                        alt="Anteprima firma OSA" 
                        className="h-16 w-auto max-w-32 border rounded object-contain bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* Caricamento nuova firma */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="signature-upload" className="text-base font-medium">
                      {signatureExists ? 'Sostituisci firma OSA' : 'Carica firma OSA'}
                    </Label>
                    <p className="text-sm text-gray-600 mt-1">
                      Formati supportati: PNG, JPG, JPEG. Dimensione massima: 5MB.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <Input
                      id="signature-upload"
                      type="file"
                      accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                      onChange={handleFileUpload}
                      disabled={isLoading}
                      className="flex-1"
                    />
                    
                    {signatureExists && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleDownloadSignature}
                          disabled={isLoading}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Scarica
                        </Button>
                        
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDeleteSignature}
                          disabled={isLoading}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Elimina
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Informazioni utilizzo */}
                <Alert className="bg-blue-50">
                  <AlertDescription>
                    <strong>Come funziona:</strong>
                    <ul className="mt-2 space-y-1 text-sm">
                      <li>• La firma viene salvata su Google Drive nella cartella "Firma_OSA"</li>
                      <li>• Viene applicata automaticamente ai PDF generati dai registri automatici</li>
                      <li>• La firma rimane memorizzata permanentemente fino alla sostituzione</li>
                      <li>• Per migliori risultati, usa un'immagine con sfondo trasparente (PNG)</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                {isLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    <span>Elaborazione in corso...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}