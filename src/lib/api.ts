import { invokeFunction, supabase, type FunctionError } from './supabaseClient';
import type { HaccpRecord, Equipment, EquipmentKind } from '@/types/haccp';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Layer API unico verso il backend.
 * Ogni chiamata passa dal contesto azienda (header x-company-id) che il server
 * verifica contro l'appartenenza reale dell'utente (Zero Trust Client).
 */
async function call<T>(
  fn: string,
  body: unknown,
  companyId?: string
): Promise<T> {
  try {
    return await invokeFunction<T>(fn, body, companyId ? { 'x-company-id': companyId } : undefined);
  } catch (err) {
    const e = err as FunctionError;
    throw new ApiError(e?.message ?? 'Errore inatteso', e?.status ?? 0, e?.code);
  }
}

export interface AllergenRow {
  id: string;
  name: string;
  description?: string | null;
  allergens: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AllergenUpsertPayload {
  id?: string;
  name: string;
  description?: string;
  allergens: string[];
}

/**
 * Azienda attiva a livello di modulo: impostata da AuthProvider.
 * Permette ai servizi non-React di usare sempre il tenant corretto.
 */
let activeCompanyId: string | null = null;
export function setActiveCompany(id: string | null): void {
  activeCompanyId = id;
}
export function getActiveCompany(): string | null {
  return activeCompanyId;
}
function requireCompany(): string {
  if (!activeCompanyId) throw new ApiError('Azienda non selezionata', 400, 'no_company');
  return activeCompanyId;
}

export interface AdminCompany {
  id: string;
  name: string;
  slug?: string | null;
  logo_url?: string | null;
  info?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface AdminLicense {
  company_id: string;
  plan: string;
  status: string;
  features: string[];
  current_period_end: string | null;
}

/** Licenza dell'azienda a cui appartiene l'utente (sola lettura). */
export interface CompanyLicense {
  plan: string;
  status: string;
  features: string[] | null;
  current_period_end: string | null;
  /** Sospensione manuale del gestore: prevale sullo stato dell'abbonamento. */
  suspended_at: string | null;
}

export interface AdminUser {
  user_id: string;
  email: string | null;
  role: string;
}

export interface AdminClient {
  id: string;
  name: string;
  slug?: string | null;
  logo_url?: string | null;
  created_at?: string;
  owner_email?: string | null;
  members_count?: number;
  plan?: string | null;
  /** Stato effettivo mostrato nel pannello (può essere "expired"/"suspended"). */
  status?: string | null;
  /** Stato grezzo memorizzato sulla licenza (per i form di modifica). */
  license_status?: string | null;
  current_period_end?: string | null;
  features?: string[];
  /** Date di attivazione/aggiornamento della licenza (monitoraggio abbonamenti). */
  license_created_at?: string | null;
  license_updated_at?: string | null;
  /** Riferimenti Stripe, mostrati al gestore per il controllo dei pagamenti. */
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  cancel_at_period_end?: boolean;
  /** Sospensione manuale: quando valorizzata l'accesso è bloccato. */
  suspended_at?: string | null;
}

/** Payload per il salvataggio di un registro HACCP giornaliero. */
export interface RecordUpsertPayload {
  date: string;
  temperatures: HaccpRecord['temperatures'];
  cleaning: HaccpRecord['cleaning'];
  notes?: string;
  signature?: string;
}

/** Materia prima in ingresso così come restituita dal backend. */
export interface IncomingFoodRow {
  id: string;
  nome: string;
  lotto: string;
  dataAcquisto: string;
  dataScadenza: string;
  fornitore: string;
  createdAt: number;
}

/** Payload per la creazione/aggiornamento di una materia prima in ingresso. */
export interface IncomingFoodPayload {
  id?: string;
  nome: string;
  lotto?: string;
  dataAcquisto?: string;
  dataScadenza?: string;
  fornitore?: string;
}

/** File archiviato nel bucket documenti dell'azienda. */
export interface DocFile {
  path: string;
  name: string;
  size: number | null;
  updatedAt: string | null;
}

/** Piano pubblicato su Stripe (prezzo dell'abbonamento). */
export interface BillingPrice {
  id: string;
  /** Importo in centesimi (es. 5000 = 50,00 €). */
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  productName: string | null;
}

/** Stato dell'abbonamento dell'azienda attiva. */
export interface BillingStatus {
  /** false quando i pagamenti non sono ancora configurati sul server. */
  configured: boolean;
  plan: string;
  status: string;
  features: string[];
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  /** true quando il gestore ha sospeso manualmente l'account. */
  suspended: boolean;
  price: BillingPrice | null;
}

/** Campi estratti dall'etichetta di un prodotto tramite lettura assistita (AI). */
export interface LabelOcrResult {
  prodotto: string | null;
  lotto: string | null;
  scadenza: string | null;
  fornitore: string | null;
  altro: string | null;
  confidenza: 'alta' | 'media' | 'bassa';
}

/** Catalogo piani mostrato nella pagina di login (dati pubblici). */
export interface PublicPlans {
  /** false quando i pagamenti non sono ancora configurati sul server. */
  configured: boolean;
  trialDays: number;
  features: string[];
  plan: BillingPrice | null;
}

// ── Stampa etichette ───────────────────────────────────────────────────────

/** Tipo di connessione della stampante. */
export type PrinterConnection = 'ble' | 'classic' | 'usb' | 'serial' | 'network' | 'agent';
/** Linguaggio di comando della stampante. */
export type PrintProtocol = 'escpos' | 'tspl' | 'cpcl' | 'zpl' | 'raster';
/** Stato di un lavoro di stampa. */
export type PrintJobStatus = 'queued' | 'sending' | 'sent' | 'confirmed' | 'failed';

/** Formato etichetta configurabile. */
export interface LabelFormatConfig {
  widthMm: number;
  heightMm: number;
  dpi: number;
  marginMm?: number;
  fontScale?: number;
  copies?: number;
  orientation?: 'portrait' | 'landscape';
  showQr?: boolean;
  showBarcode?: boolean;
  barcodeFormat?: 'CODE128' | 'EAN13' | 'CODE39';
  showRestaurant?: boolean;
}

/** Stampante configurata per l'azienda attiva. */
export interface PrinterConfig {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  connection: PrinterConnection;
  protocol: PrintProtocol;
  driver: string;
  address: Record<string, unknown>;
  labelFormat: LabelFormatConfig;
  target: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterUpsertPayload {
  id?: string;
  name: string;
  manufacturer?: string;
  model?: string;
  connection: PrinterConnection;
  protocol: PrintProtocol;
  driver?: string;
  address?: Record<string, unknown>;
  labelFormat?: LabelFormatConfig;
  target?: string;
  isDefault?: boolean;
}

/** Dati originali dell'etichetta, conservati per la ristampa. */
export interface LabelPayload {
  prodotto: string;
  lottoProdotto: string;
  dataProduzione: string;
  dataScadenza: string;
  quantita?: string;
  unita?: string;
  ristorante?: string;
  preparatoIl?: string;
}

/** Lavoro di stampa registrato nello storico. */
export interface PrintJob {
  id: string;
  printerId: string | null;
  idempotencyKey: string;
  status: PrintJobStatus;
  copies: number;
  protocol: string;
  driver: string;
  lotto: string;
  payload: LabelPayload | Record<string, unknown>;
  error: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrintJobRecordPayload {
  idempotencyKey: string;
  status: PrintJobStatus;
  copies?: number;
  protocol?: string;
  driver?: string;
  lotto?: string;
  payload?: LabelPayload | Record<string, unknown>;
  printerId?: string;
}

export const api = {
  allergenTable: {
    list: (companyId: string) =>
      call<{ products: AllergenRow[] }>('allergen-table', { action: 'list' }, companyId),
    upsert: (companyId: string, payload: AllergenUpsertPayload) =>
      call<{ product: AllergenRow }>('allergen-table', { action: 'upsert', ...payload }, companyId),
    remove: (companyId: string, id: string) =>
      call<{ ok: boolean }>('allergen-table', { action: 'delete', id }, companyId),
  },

  records: {
    // Generazione PDF lato server: la logica di layout è proprietaria.
    pdf: (companyId: string, payload: Record<string, unknown>) =>
      call<{ base64: string; filename: string }>('generate-records-pdf', payload, companyId),
  },

  // Gestione dei clienti (solo platform admin). Il backend usa la service_role.
  admin: {
    listClients: () => call<{ clients: AdminClient[] }>('admin-clients', { action: 'list-clients' }),
    createClient: (payload: {
      company_name: string;
      email: string;
      password: string;
    }) => call<{ company_id: string; user_id: string; email: string }>('admin-clients', { action: 'create-client', ...payload }),
    updateClient: (payload: {
      company_id: string;
      name?: string;
      slug?: string | null;
      logo_url?: string | null;
      info?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    }) => call<{ company: AdminCompany }>('admin-clients', { action: 'update-client', ...payload }),
    setLicense: (payload: {
      company_id: string;
      plan?: string;
      status?: 'trialing' | 'active' | 'past_due' | 'canceled';
      features?: string[];
      current_period_end?: string | null;
    }) => call<{ license: AdminLicense }>('admin-clients', { action: 'set-license', ...payload }),
    setSuspension: (companyId: string, suspended: boolean) =>
      call<{ suspended_at: string | null }>('admin-clients', {
        action: 'set-suspension',
        company_id: companyId,
        suspended,
      }),
    setPassword: (userId: string, password: string) =>
      call<{ ok: boolean }>('admin-clients', { action: 'set-password', user_id: userId, password }),
    listUsers: (companyId: string) =>
      call<{ users: AdminUser[] }>('admin-clients', { action: 'list-users', company_id: companyId }),
    addUser: (payload: { company_id: string; email: string; password: string; role: string }) =>
      call<{ user_id: string; email: string; role: string }>('admin-clients', { action: 'add-user', ...payload }),
    deleteClient: (companyId: string) =>
      call<{ ok: boolean }>('admin-clients', { action: 'delete-client', company_id: companyId }),
  },

  // Stato della licenza dell'azienda attiva. La RLS consente la lettura ai
  // membri; la verifica autorevole resta comunque lato Edge Functions.
  license: {
    get: async (companyId: string): Promise<CompanyLicense | null> => {
      const { data, error } = await supabase
        .from('licenses')
        .select('plan, status, features, current_period_end, suspended_at')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();
      if (error) throw new ApiError(error.message, 500, 'license_read_failed');
      return (data as CompanyLicense | null) ?? null;
    },
  },

  // Profilo e branding dell'azienda attiva (protetto da RLS: owner/admin).
  company: {
    updateProfile: async (
      companyId: string,
      patch: { name?: string; info?: Record<string, unknown>; settings?: Record<string, unknown> }
    ): Promise<void> => {
      const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
      if (error) throw new ApiError(error.message, 500, 'update_failed');
    },
    uploadLogo: async (companyId: string, file: File): Promise<string> => {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${companyId}/logo.${ext}`;
      const { error } = await supabase.storage
        .from('branding')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new ApiError(error.message, 500, 'upload_failed');

      const { data } = supabase.storage.from('branding').getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase
        .from('companies')
        .update({ logo_url: url })
        .eq('id', companyId);
      if (updateError) throw new ApiError(updateError.message, 500, 'update_failed');
      return url;
    },
  },

  // Dati di dominio: registri HACCP, materie prime in ingresso, modelli semilavorati.
  data: {
    records: {
      list: (companyId: string) =>
        call<{ records: HaccpRecord[] }>('haccp-data', { action: 'records.list' }, companyId),
      upsert: (companyId: string, payload: RecordUpsertPayload) =>
        call<{ record: HaccpRecord }>('haccp-data', { action: 'records.upsert', ...payload }, companyId),
      upsertMany: (companyId: string, records: RecordUpsertPayload[]) =>
        call<{ saved: number }>('haccp-data', { action: 'records.upsertMany', records }, companyId),
      deleteByDate: (companyId: string, date: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteByDate', date }, companyId),
      deleteByMonth: (companyId: string, year: number, month: number) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteByMonth', year, month }, companyId),
      deleteAll: (companyId: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteAll' }, companyId),
    },
    incoming: {
      list: (companyId: string) =>
        call<{ items: IncomingFoodRow[] }>('haccp-data', { action: 'incoming.list' }, companyId),
      upsert: (companyId: string, payload: IncomingFoodPayload) =>
        call<{ id: string }>('haccp-data', { action: 'incoming.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'incoming.delete', id }, companyId),
    },
    semi: {
      get: (companyId: string) =>
        call<{ templates: unknown; categories: unknown }>('haccp-data', { action: 'semi.get' }, companyId),
      save: (companyId: string, payload: { templates: unknown[]; categories: string[] }) =>
        call<{ ok: boolean }>('haccp-data', { action: 'semi.save', ...payload }, companyId),
    },
    equipment: {
      list: (companyId: string) =>
        call<{ equipment: Equipment[] }>('haccp-data', { action: 'equipment.list' }, companyId),
      upsert: (companyId: string, payload: { id?: string; kind: EquipmentKind; name: string }) =>
        call<{ equipment: Equipment }>('haccp-data', { action: 'equipment.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'equipment.delete', id }, companyId),
    },
  },

  // Registrazione autonoma e catalogo piani pubblici (pagina di login).
  // È l'unica area che non richiede una sessione: il backend non restituisce
  // mai dati aziendali né segreti, solo il listino pubblico.
  signup: {
    plans: () => call<PublicPlans>('signup', { action: 'plans.list' }),
    create: (payload: { company_name: string; email: string; password: string }) =>
      call<{ ok: boolean; email: string; trialDays: number }>('signup', {
        action: 'signup.create',
        ...payload,
      }),
  },

  // Accesso: passa dall'Edge Function per applicare rate limit e audit prima
  // della verifica delle credenziali. I token restituiti vengono poi salvati
  // nel client con setSession.
  auth: {
    login: (email: string, password: string) =>
      call<{
        access_token: string;
        refresh_token: string;
        expires_in: number | null;
        expires_at: number | null;
        token_type: string;
        user: { id: string | null; email: string };
      }>('auth-login', { action: 'login', email, password }),
  },

  // Abbonamento dell'azienda. La chiave Stripe resta un secret del backend:
  // il client riceve solo lo stato e un link di pagamento firmato.
  billing: {
    status: (companyId: string) =>
      call<BillingStatus>('billing', { action: 'status.get' }, companyId),
    checkout: (companyId: string) =>
      call<{ url: string }>('billing', { action: 'checkout.create' }, companyId),
    portal: (companyId: string) =>
      call<{ url: string }>('billing', { action: 'portal.create' }, companyId),
  },

  // Lettura assistita dell'etichetta tramite modello AI multimodale.
  // PRIVACY: l'immagine è usata solo in memoria per la singola analisi e non
  // viene mai salvata (nessun upload, nessuna scrittura su database).
  labelOcr: {
    analyze: (companyId: string, payload: { imageBase64: string; mimeType: string }) =>
      call<{ result: LabelOcrResult; provider: string }>('label-ocr', payload, companyId),
  },

  // Archiviazione documenti su Supabase Storage (bucket privato per azienda).
  docs: {
    upload: (companyId: string, payload: { path: string; base64: string; mimeType: string }) =>
      call<{ path: string }>('haccp-docs', { action: 'upload', ...payload }, companyId),
    list: (companyId: string, prefix?: string) =>
      call<{ files: DocFile[] }>('haccp-docs', { action: 'list', prefix }, companyId),
    signedUrl: (companyId: string, path: string) =>
      call<{ url: string }>('haccp-docs', { action: 'signed-url', path }, companyId),
    download: (companyId: string, path: string) =>
      call<{ base64: string; mimeType: string }>('haccp-docs', { action: 'download', path }, companyId),
    remove: (companyId: string, path: string) =>
      call<{ ok: boolean }>('haccp-docs', { action: 'remove', path }, companyId),
  },

  // Stampa etichette: configurazione stampanti e storico lavori.
  printing: {
    listPrinters: (companyId: string) =>
      call<{ printers: PrinterConfig[] }>('printing', { action: 'printers.list' }, companyId),
    upsertPrinter: (companyId: string, payload: PrinterUpsertPayload) =>
      call<{ printer: PrinterConfig }>('printing', { action: 'printers.upsert', ...payload }, companyId),
    setDefaultPrinter: (companyId: string, id: string) =>
      call<{ ok: boolean }>('printing', { action: 'printers.setDefault', id }, companyId),
    deletePrinter: (companyId: string, id: string) =>
      call<{ ok: boolean }>('printing', { action: 'printers.delete', id }, companyId),
    recordJob: (companyId: string, payload: PrintJobRecordPayload) =>
      call<{ job: PrintJob }>('printing', { action: 'jobs.record', ...payload }, companyId),
    updateJob: (companyId: string, payload: { id: string; status: PrintJobStatus; error?: string; attempts?: number }) =>
      call<{ job: PrintJob }>('printing', { action: 'jobs.update', ...payload }, companyId),
    listJobs: (companyId: string, opts?: { lotto?: string; limit?: number }) =>
      call<{ jobs: PrintJob[] }>('printing', { action: 'jobs.list', ...opts }, companyId),
  },
};

/** Varianti che usano automaticamente l'azienda attiva (per i moduli non-React). */
export const activeData = {
  records: {
    list: () => api.data.records.list(requireCompany()),
    upsert: (payload: RecordUpsertPayload) => api.data.records.upsert(requireCompany(), payload),
    upsertMany: (records: RecordUpsertPayload[]) => api.data.records.upsertMany(requireCompany(), records),
    deleteByDate: (date: string) => api.data.records.deleteByDate(requireCompany(), date),
    deleteByMonth: (year: number, month: number) => api.data.records.deleteByMonth(requireCompany(), year, month),
    deleteAll: () => api.data.records.deleteAll(requireCompany()),
  },
  incoming: {
    list: () => api.data.incoming.list(requireCompany()),
    upsert: (payload: IncomingFoodPayload) => api.data.incoming.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.incoming.remove(requireCompany(), id),
  },
  semi: {
    get: () => api.data.semi.get(requireCompany()),
    save: (payload: { templates: unknown[]; categories: string[] }) =>
      api.data.semi.save(requireCompany(), payload),
  },
  equipment: {
    list: () => api.data.equipment.list(requireCompany()),
    upsert: (payload: { id?: string; kind: EquipmentKind; name: string }) =>
      api.data.equipment.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.equipment.remove(requireCompany(), id),
  },
  labelOcr: {
    analyze: (payload: { imageBase64: string; mimeType: string }) =>
      api.labelOcr.analyze(requireCompany(), payload),
  },
  billing: {
    status: () => api.billing.status(requireCompany()),
    checkout: () => api.billing.checkout(requireCompany()),
    portal: () => api.billing.portal(requireCompany()),
  },
};

export const activeDocs = {
  upload: (payload: { path: string; base64: string; mimeType: string }) =>
    api.docs.upload(requireCompany(), payload),
  list: (prefix?: string) => api.docs.list(requireCompany(), prefix),
  signedUrl: (path: string) => api.docs.signedUrl(requireCompany(), path),
  download: (path: string) => api.docs.download(requireCompany(), path),
  remove: (path: string) => api.docs.remove(requireCompany(), path),
};

/** Stampa etichette per l'azienda attiva (per i moduli non-React). */
export const activePrinting = {
  listPrinters: () => api.printing.listPrinters(requireCompany()),
  upsertPrinter: (payload: PrinterUpsertPayload) => api.printing.upsertPrinter(requireCompany(), payload),
  setDefaultPrinter: (id: string) => api.printing.setDefaultPrinter(requireCompany(), id),
  deletePrinter: (id: string) => api.printing.deletePrinter(requireCompany(), id),
  recordJob: (payload: PrintJobRecordPayload) => api.printing.recordJob(requireCompany(), payload),
  updateJob: (payload: { id: string; status: PrintJobStatus; error?: string; attempts?: number }) =>
    api.printing.updateJob(requireCompany(), payload),
  listJobs: (opts?: { lotto?: string; limit?: number }) => api.printing.listJobs(requireCompany(), opts),
};


