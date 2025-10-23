// Google Drive Integration for HACCP Records
export interface GoogleDriveConfig {
  clientId: string;
  apiKey: string;
  discoveryDoc: string;
  scopes: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
}

export class GoogleDriveManager {
  private gapi: any;
  private isInitialized = false;
  private isSignedIn = false;

  private config: GoogleDriveConfig = {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
    discoveryDoc: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    scopes: 'https://www.googleapis.com/auth/drive.file'
  };

  constructor() {
    this.loadGoogleAPI();
  }

  private async loadGoogleAPI(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Google API can only be loaded in browser environment'));
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        const gisScript = document.createElement('script');
        gisScript.src = 'https://accounts.google.com/gsi/client';
        gisScript.onload = () => resolve();
        gisScript.onerror = () => reject(new Error('Failed to load Google Identity Services'));
        document.head.appendChild(gisScript);
      };
      script.onerror = () => reject(new Error('Failed to load Google API'));
      document.head.appendChild(script);
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.config.clientId || !this.config.apiKey) {
      console.error('Credenziali Google mancanti! Verifica le variabili d\'ambiente.');
      throw new Error('Google credentials missing');
    }

    try {
      await this.loadGoogleAPI();
      await new Promise<void>((resolve, reject) => {
        (window as any).gapi.load('client', { callback: resolve, onerror: reject });
      });
      await (window as any).gapi.client.init({
        apiKey: this.config.apiKey,
        discoveryDocs: [this.config.discoveryDoc],
      });
      this.gapi = (window as any).gapi;
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Google Drive API:', error);
      throw error;
    }
  }

  async checkExistingToken(): Promise<boolean> {
    const savedToken = localStorage.getItem('gd_token');
    if (savedToken) {
      try {
        const token = JSON.parse(savedToken);
        this.gapi.client.setToken(token);
        this.isSignedIn = true;
        try {
          await this.gapi.client.drive.files.list({ pageSize: 1, fields: 'files(id)' });
          console.log('Token esistente valido');
          return true;
        } catch {
          console.log('Token esistente non valido, necessario nuovo login');
          localStorage.removeItem('gd_token');
          this.isSignedIn = false;
          return false;
        }
      } catch (error) {
        console.error('Errore nel recupero del token salvato:', error);
        return false;
      }
    }
    return false;
  }

  async signIn(): Promise<boolean> {
    if (!this.isInitialized) await this.initialize();

    return new Promise((resolve) => {
      try {
        const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: this.config.clientId,
          scope: this.config.scopes,
          prompt: 'consent',

          callback: (response: any) => {
            if (response.error) {
              console.error('Errore di autenticazione:', response.error, response);
              this.isSignedIn = false;
              resolve(false);
            } else if (response.access_token) {
              console.log('Autenticazione riuscita, token ricevuto');
              this.gapi.client.setToken({ access_token: response.access_token });
              this.isSignedIn = true;
              localStorage.setItem('gd_token', JSON.stringify(this.gapi.client.getToken()));
              resolve(true);
            } else {
              console.error('Nessun access_token nella risposta:', response);
              this.isSignedIn = false;
              resolve(false);
            }
          },
        });
        tokenClient.requestAccessToken({
          prompt: 'consent'
        });
      } catch (error) {
        console.error('Errore durante la richiesta del token:', error);
        resolve(false);
      }
    });
  }

  async signOut(): Promise<void> {
    if (this.isSignedIn) {
      const token = this.gapi.client.getToken();
      if (token) (window as any).google.accounts.oauth2.revoke(token.access_token);
      this.gapi.client.setToken('');
      this.isSignedIn = false;
      localStorage.removeItem('gd_token');
    }
  }

  isAuthenticated(): boolean {
    return this.isSignedIn;
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    if (!this.isSignedIn) throw new Error('Not authenticated with Google Drive');
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined };
    const response = await this.gapi.client.drive.files.create({ resource: metadata });
    return response.result.id;
  }

  async uploadFile(fileName: string, fileBlob: Blob, parentFolderId?: string): Promise<string> {
    if (!this.isSignedIn) throw new Error('Not authenticated with Google Drive');
    const metadata = { name: fileName, parents: parentFolderId ? [parentFolderId] : undefined };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileBlob);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.gapi.client.getToken().access_token}` },
      body: form
    });
    const result = await response.json();
    return result.id;
  }

  async listFiles(folderId?: string): Promise<DriveFile[]> {
    if (!this.isSignedIn) throw new Error('Not authenticated with Google Drive');
    let query = "trashed=false";
    if (folderId) query += ` and '${folderId}' in parents`;
    const response = await this.gapi.client.drive.files.list({ q: query, fields: 'files(id,name,mimeType,createdTime,modifiedTime,size)', orderBy: 'modifiedTime desc' });
    return response.result.files || [];
  }

  async downloadFile(fileId: string): Promise<Blob> {
    if (!this.isSignedIn) throw new Error('Not authenticated with Google Drive');
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { 'Authorization': `Bearer ${this.gapi.client.getToken().access_token}` } });
    return await response.blob();
  }

  async findOrCreateHaccpFolder(): Promise<string> {
    const files = await this.listFiles();
    const haccpFolder = files.find(f => f.name === 'HACCP_Registri' && f.mimeType === 'application/vnd.google-apps.folder');
    return haccpFolder ? haccpFolder.id : await this.createFolder('HACCP_Registri');
  }

  async findOrCreateMonthFolder(year: number, month: number, parentFolderId: string): Promise<string> {
    const monthName = new Date(year, month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    const files = await this.listFiles(parentFolderId);
    const monthFolder = files.find(f => f.name === monthName && f.mimeType === 'application/vnd.google-apps.folder');
    return monthFolder ? monthFolder.id : await this.createFolder(monthName, parentFolderId);
  }

  async getHaccpFolderStructure(): Promise<{ rootId: string; monthFolders: Record<string, string> }> {
    const rootId = await this.findOrCreateHaccpFolder();
    const monthFolders: Record<string, string> = {};
    const files = await this.listFiles(rootId);
    files.forEach(file => { if (file.mimeType === 'application/vnd.google-apps.folder') monthFolders[file.name] = file.id; });
    return { rootId, monthFolders };
  }

  async findFileByName(name: string, folderId?: string): Promise<DriveFile | null> {
    const files = await this.listFiles(folderId);
    const match = files.find(f => f.name === name);
    return match || null;
  }

  async updateFile(fileId: string, fileName: string, fileBlob: Blob): Promise<void> {
    const token = this.gapi.client.getToken().access_token;
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
      body: (() => {
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({ name: fileName })], { type: 'application/json' }));
        form.append('file', fileBlob);
        return form;
      })()
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = this.gapi.client.getToken().access_token;
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }

  async uploadOrUpdateJsonFile(fileName: string, json: any, parentFolderId?: string): Promise<string> {
    const blob = new Blob([typeof json === 'string' ? json : JSON.stringify(json)], { type: 'application/json' });
    const existing = await this.findFileByName(fileName, parentFolderId);
    if (existing) {
      await this.updateFile(existing.id, fileName, blob);
      return existing.id;
    }
    return await this.uploadFile(fileName, blob, parentFolderId);
  }

  async uploadOrUpdateTextFile(fileName: string, text: string, parentFolderId?: string, mime: string = 'text/plain'): Promise<string> {
    const blob = new Blob([text], { type: mime });
    const existing = await this.findFileByName(fileName, parentFolderId);
    if (existing) {
      await this.updateFile(existing.id, fileName, blob);
      return existing.id;
    }
    return await this.uploadFile(fileName, blob, parentFolderId);
  }

  async uploadOrUpdateFile(fileName: string, fileBlob: Blob, parentFolderId?: string): Promise<string> {
    const existing = await this.findFileByName(fileName, parentFolderId);
    if (existing) {
      try {
        await this.updateFile(existing.id, fileName, fileBlob);
        return existing.id;
      } catch (e) {
        // Fallback: delete then re-upload
        try {
          await this.deleteFile(existing.id);
        } catch {}
        return await this.uploadFile(fileName, fileBlob, parentFolderId);
      }
    }
    return await this.uploadFile(fileName, fileBlob, parentFolderId);
  }
}

// Singleton instance
export const googleDriveManager = new GoogleDriveManager();
