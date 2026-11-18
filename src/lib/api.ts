import { invokeFunction, supabase, type FunctionError } from './supabaseClient';
import { captureError } from './observability';
// Solo tipi: lo schema Zod (~126 kB) viene importato on demand dentro
// `semi.get`, l'unico punto che valida a runtime un payload non tipizzato.
// Così zod resta fuori dal bundle di avvio dell'app.
import type { SemiGetResponse, SemiProductTemplate } from './schemas';
import type { HaccpRecord, CleaningCheck, Equipment, EquipmentKind } from '@/types/haccp';

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
 * Vero se l'errore è dovuto all'impossibilità di contattare il backend
 * (`status` 0: nessuna risposta HTTP). Distingue l'offline — dove la modifica
 * viene accodata e ritentata — da un rifiuto del server, che invece va
 * annullato lato client perché i dati non sono accettabili.
 */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
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
    const status = e?.status ?? 0;
    // Un errore di rete (status 0) o un 5xx indica un problema reale dell'app:
    // lo segnaliamo all'osservabilità. I 4xx sono comportamenti attesi del
    // client (permessi, validazione) e non vengono riportati come anomalie.
    if (status === 0 || status >= 500) {
      captureError(err, {
        source: 'api',
        level: status === 0 ? 'warning' : 'error',
        context: { fn, status, code: e?.code ?? null },
      });
    }
    throw new ApiError(e?.message ?? 'Errore inatteso', status, e?.code);
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
  /** Sede della scheda: se assente il backend usa la sede predefinita. */
  locationId?: string;
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

/**
 * Sede attiva a livello di modulo: impostata dal negozio delle sedi.
 * I registri e gli abbattimenti sono organizzati per sede; quando nessuna sede
 * è selezionata il backend ricade sulla sede predefinita dell'azienda, quindi
 * le aziende a sede unica funzionano senza alcuna selezione.
 */
let activeLocationId: string | null = null;
export function setActiveLocation(id: string | null): void {
  activeLocationId = id;
}
export function getActiveLocation(): string | null {
  return activeLocationId;
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

// ── Sedi (multi-sede) ────────────────────────────────────────────────────
// I registri HACCP e gli abbattimenti sono organizzati per sede; una sede
// predefinita viene creata automaticamente per ogni azienda, così le aziende
// a sede unica restano identiche a prima.

/** Sede dell'azienda così come restituita dal backend. */
export interface Location {
  id: string;
  nome: string;
  indirizzo: string;
  citta: string;
  note: string;
  /** Ordine di visualizzazione (crescente). */
  posizione: number;
  /** Vero per la sede predefinita (una sola per azienda, non eliminabile). */
  predefinita: boolean;
  createdAt: number;
}

/** Payload di creazione/aggiornamento di una sede. */
export interface LocationPayload {
  /** Presente per l'aggiornamento; assente per la creazione (id dal backend). */
  id?: string;
  nome: string;
  indirizzo?: string;
  citta?: string;
  note?: string;
  posizione?: number;
}

// ── Utenti e inviti (lato azienda) ───────────────────────────────────────

/** Ruolo di un collaboratore all'interno dell'azienda. */
export type TeamRole = 'owner' | 'admin' | 'staff' | 'viewer';

/** Collaboratore dell'azienda attiva (membro con ruolo). */
export interface TeamMember {
  user_id: string;
  email: string | null;
  role: TeamRole;
  /** Vero se il membro è l'utente attualmente connesso. */
  is_self: boolean;
}

/** Invito in attesa di accettazione. */
export interface CompanyInvitation {
  id: string;
  email: string;
  role: TeamRole;
  /** Segreto per costruire il link di accettazione. */
  token: string;
  created_at: string;
  expires_at: string;
}

/** Esito della creazione di un invito. */
export interface CreateInvitationResult {
  invitation: CompanyInvitation;
  /** Falso se l'email non è stata inviata (es. utente già esistente). */
  emailSent: boolean;
}

// ── Piano di sanificazione ───────────────────────────────────────────────

/** Cadenza di un'attività del piano di sanificazione. */
export type CleaningFrequency =
  | 'giornaliera'
  | 'settimanale'
  | 'quindicinale'
  | 'mensile'
  | 'trimestrale'
  | 'semestrale'
  | 'annuale';

/** Attività del piano di sanificazione (anagrafica configurabile). */
export interface CleaningPlanItem {
  id: string;
  /** Zona/area del locale. */
  area: string;
  /** Attività prevista dal piano. */
  activity: string;
  frequency: CleaningFrequency;
  product: string;
  dosage: string;
  responsible: string;
  notes: string;
  position: number;
  createdAt: number;
}

/** Payload di creazione/aggiornamento di una voce del piano. */
export interface CleaningPlanItemPayload {
  id?: string;
  area: string;
  activity: string;
  frequency: CleaningFrequency;
  product?: string;
  dosage?: string;
  responsible?: string;
  notes?: string;
  position?: number;
}

/** Payload per il salvataggio di un registro HACCP giornaliero. */
export interface RecordUpsertPayload {
  date: string;
  /** Sede del registro: se assente il backend usa la sede predefinita. */
  locationId?: string;
  temperatures: HaccpRecord['temperatures'];
  cleaning: HaccpRecord['cleaning'];
  /** Esito della checklist guidata del piano (assente nei registri storici). */
  cleaningPlan?: CleaningCheck[];
  notes?: string;
  signature?: string;
}

/** Stato del ciclo di vita di una scorta (nessuna cancellazione fisica). */
export type StockStatus = 'active' | 'archived' | 'discarded';

/** Materia prima in ingresso così come restituita dal backend. */
export interface IncomingFoodRow {
  id: string;
  nome: string;
  lotto: string;
  dataAcquisto: string;
  dataScadenza: string;
  fornitore: string;
  /** Quantità iniziale e residua (opzionali finché non tracciate). */
  quantita: number | null;
  quantitaResidua: number | null;
  unita: string;
  categoria: string;
  stato: StockStatus;
  archiviatoIl: string | null;
  scartatoIl: string | null;
  createdAt: number;
}

/** Payload per la creazione/aggiornamento di una materia prima in ingresso. */
export interface IncomingFoodPayload {
  id?: string;
  /** Sede del prodotto: se assente il backend usa la sede predefinita. */
  locationId?: string;
  nome: string;
  lotto?: string;
  dataAcquisto?: string;
  dataScadenza?: string;
  fornitore?: string;
  quantita?: number | null;
  quantitaResidua?: number | null;
  unita?: string;
  categoria?: string;
  stato?: StockStatus;
}

/** Lotto di semilavorato prodotto internamente. */
export interface SemiProductBatch {
  id: string;
  prodotto: string;
  lotto: string;
  dataProduzione: string;
  dataScadenza: string;
  quantitaIniziale: number | null;
  quantitaResidua: number | null;
  unita: string;
  /** Categoria del prodotto (dal modello di produzione); '' se non assegnata. */
  categoria: string;
  ingredienti: { nome: string; lotto: string }[];
  note: string;
  stato: StockStatus;
  archiviatoIl: string | null;
  scartatoIl: string | null;
  createdAt: number;
}

/** Payload per registrare/aggiornare un lotto di semilavorato. */
export interface SemiProductBatchPayload {
  /** Sede del lotto: se assente il backend usa la sede predefinita. */
  locationId?: string;
  prodotto: string;
  lotto: string;
  dataProduzione?: string;
  dataScadenza?: string;
  quantitaIniziale?: number | null;
  quantitaResidua?: number | null;
  unita?: string;
  /** Categoria del prodotto: abilita le regole di scadenza per categoria. */
  categoria?: string;
  ingredienti?: { nome: string; lotto: string }[];
  note?: string;
}

/** Aggiornamento parziale di un lotto (consumo, scarto, note). */
export interface SemiProductBatchPatch {
  id: string;
  quantitaResidua?: number;
  note?: string;
  stato?: StockStatus;
}

/**
 * Registrazione di un consumo: riduce la quantità residua di una scorta.
 * Il backend blocca l'uso di lotti scaduti o non attivi.
 */
export interface ConsumePayload {
  /** Identificativo della scorta (alimento in ingresso o lotto di semilavorato). */
  id: string;
  /** Quantità utilizzata (deve essere > 0 e non superare la residua). */
  consumed: number;
  /** Nota facoltativa (tracciata solo per i lotti di semilavorato). */
  note?: string;
  /** Archivia automaticamente la scorta quando il consumo la esaurisce. */
  archiveIfEmpty?: boolean;
}

/** Esito di un consumo su una materia prima in ingresso. */
export interface IncomingConsumeResult {
  id: string;
  quantitaResidua: number;
  stato: StockStatus;
}

// ── Abbattimenti termici (raffreddamento rapido) ──────────────────────────

/** Tipo di trattamento di raffreddamento rapido. */
export type BlastKind = 'abbattimento' | 'surgelamento';
/** Esito del ciclo: in corso, conforme o non conforme (calcolato dal backend). */
export type BlastOutcome = 'in_corso' | 'conforme' | 'non_conforme';

/** Ciclo di abbattimento termico così come restituito dal backend. */
export interface BlastChilling {
  id: string;
  /** Sede del ciclo: fissata alla creazione e non modificabile. */
  locationId?: string;
  prodotto: string;
  lotto: string;
  tipo: BlastKind;
  /** Istante di inizio (ISO). */
  iniziatoIl: string;
  /** Istante di fine (ISO) oppure null se ancora in corso. */
  terminatoIl: string | null;
  temperaturaIniziale: number | null;
  temperaturaFinale: number | null;
  /** Soglia di riferimento (°C) derivata dal tipo di trattamento. */
  temperaturaObiettivo: number;
  /** Tempo massimo consentito (minuti) derivato dal tipo di trattamento. */
  minutiMassimi: number;
  /** Durata effettiva in minuti (null finché il ciclo è in corso). */
  durataMinuti: number | null;
  attrezzatura: string;
  operatore: string;
  esito: BlastOutcome;
  note: string;
  firma: string;
  createdAt: number;
}

/**
 * Payload di creazione/aggiornamento di un abbattimento. Esito e durata NON
 * vengono inviati: il backend li calcola dagli orari e dalle temperature, così
 * il dispositivo non può dichiarare conforme un ciclo che non lo è.
 */
export interface BlastChillingPayload {
  id?: string;
  /** Sede del ciclo: usata solo alla creazione (fissata in seguito). */
  locationId?: string;
  prodotto: string;
  lotto?: string;
  tipo: BlastKind;
  iniziatoIl: string;
  terminatoIl?: string | null;
  temperaturaIniziale?: number | null;
  temperaturaFinale?: number | null;
  attrezzatura?: string;
  operatore?: string;
  note?: string;
  firma?: string;
}

// ── Anagrafica fornitori ──────────────────────────────────────────────────

/** Fornitore dell'azienda (anagrafica collegata agli alimenti in ingresso). */
export interface Supplier {
  id: string;
  nome: string;
  categoria: string;
  partitaIva: string;
  indirizzo: string;
  telefono: string;
  email: string;
  referente: string;
  note: string;
  createdAt: number;
}

/** Payload di creazione/aggiornamento di un fornitore. */
export interface SupplierPayload {
  id?: string;
  nome: string;
  categoria?: string;
  partitaIva?: string;
  indirizzo?: string;
  telefono?: string;
  email?: string;
  referente?: string;
  note?: string;
}

// ── Registro (audit trail) dell'archiviazione delle scorte ─────────────────

/**
 * Azioni tracciate nel registro dell'archiviazione. Le stesse azioni sono
 * scritte dal backend (Edge Function `haccp-data` e funzione SQL
 * `archive_expired_stock`): la convenzione è `stock.<operazione>.<origine>`.
 */
export type StockAuditAction =
  | 'stock.archive.manual'
  | 'stock.archive.auto'
  | 'stock.archive.consumed'
  | 'stock.discard.manual'
  | 'stock.restore.manual'
  | 'stock.consume';

/** Origine di una modifica: utente oppure sistema (job automatico). */
export type StockAuditSource = 'user' | 'auto';

/** Voce del registro dell'archiviazione e degli scarti. */
export interface StockAuditEntry {
  id: string;
  action: string;
  /** Tabella di dominio interessata ('incoming_foods' | 'semi_product_batches'). */
  entity: string | null;
  entityId: string | null;
  userId: string | null;
  /** Nome leggibile dell'autore ('Sistema' per le archiviazioni automatiche). */
  userName: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

// ── Tracciabilità a ritroso (Recall) ───────────────────────────────────────
// Ricerca per lotto (o prodotto/fornitore) che ricostruisce la catena di
// filiera: alimento in ingresso → impiego nei semilavorati e negli
// abbattimenti, con i movimenti registrati. La ricerca copre l'intera azienda.

/** Come un lotto di semilavorato è stato trovato nella ricerca. */
export type RecallMatchType = 'lot' | 'ingredient';

/** Alimento in ingresso trovato dalla ricerca di tracciabilità. */
export interface RecallIncoming {
  id: string;
  nome: string;
  lotto: string;
  fornitore: string;
  /** Recapiti del fornitore se presente in anagrafica (match per nome). */
  fornitoreDettaglio: Supplier | null;
  dataAcquisto: string;
  dataScadenza: string;
  quantita: number | null;
  quantitaResidua: number | null;
  unita: string;
  categoria: string;
  stato: StockStatus;
  sede: string;
  createdAt: number;
}

/** Lotto di semilavorato trovato dalla ricerca di tracciabilità. */
export interface RecallSemiBatch {
  id: string;
  prodotto: string;
  lotto: string;
  dataProduzione: string;
  dataScadenza: string;
  quantitaIniziale: number | null;
  quantitaResidua: number | null;
  unita: string;
  categoria: string;
  stato: StockStatus;
  sede: string;
  matchType: RecallMatchType;
  /** Ingredienti che hanno generato il match (matchType = 'ingredient'). */
  matchedIngredients: { nome: string; lotto: string }[];
  ingredienti: { nome: string; lotto: string }[];
  createdAt: number;
}

/** Ciclo di abbattimento trovato dalla ricerca di tracciabilità. */
export interface RecallBlast {
  id: string;
  prodotto: string;
  lotto: string;
  tipo: BlastKind;
  iniziatoIl: string;
  esito: string;
  sede: string;
}

/** Movimento di magazzino collegato a una scorta individuata. */
export interface RecallEvent {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  userName: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** Esito completo di una ricerca di tracciabilità a ritroso. */
export interface RecallResult {
  query: string;
  generatedAt: string;
  summary: { incoming: number; semiBatches: number; blast: number; events: number };
  incoming: RecallIncoming[];
  semiBatches: RecallSemiBatch[];
  blast: RecallBlast[];
  events: RecallEvent[];
}

// ── Regole di scadenza configurabili per azienda ───────────────────────────
// La logica vive nel modulo puro `@/lib/expiryRules` (nessuna dipendenza dal
// client): qui la ri-esportiamo per mantenere validi i punti di import esistenti
// e restare coerenti con la struttura letta dal backend (Edge/SQL).
export {
  DEFAULT_EXPIRY_RULES,
  EXPIRY_RULE_LIMITS,
  MAX_CATEGORY_LENGTH,
  findCategoryExpiryRule,
  normalizeCategory,
  normalizeExpiryDays,
  readExpiryRules,
  resolveExpiryRule,
  validateExpiryRules,
  withExpiryRules,
} from './expiryRules';
export type {
  CategoryExpiryRule,
  CategoryRuleFieldErrors,
  CategoryRuleInput,
  ExpiryRule,
  ExpiryRuleKind,
  ExpiryRules,
  ExpiryRulesErrors,
  ExpiryRuleFieldErrors,
  ExpiryRulesFormInput,
  ExpiryRulesValidation,
} from './expiryRules';

// ── Consumo residuo e FEFO ─────────────────────────────────────────────────
// La logica pura vive in `@/lib/consumption` (client e server condividono la
// stessa semantica di blocco del lotto scaduto).
export {
  checkConsumption,
  daysToExpiry,
  effectiveRemaining,
  fefoOrder,
  findEarlierFefoLot,
  isExpired,
  isUsable,
  parseQuantity,
  pickFefoLot,
} from './consumption';
export type {
  ConsumableLot,
  ConsumptionBlock,
  ConsumptionCheck,
  LotStatus,
} from './consumption';

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

// ── Modulo Controllo Infestanti ────────────────────────────────────────────
export interface PestOverview {
  stations: { total: number; active: number; due: number; maintenance: number };
  anomalies: { open: number };
  schedules: { planned: number; overdue: number };
  documents: { expiringSoon: number };
  inspections: { total: number; last30: number };
  recentInspections: {
    id: string;
    inspectedAt: string;
    outcome: string | null;
    stationCode: string;
    stationName: string;
  }[];
}

export type PestStationStatus = 'attiva' | 'da_controllare' | 'manutenzione' | 'sospesa' | 'rimossa';
export type PestStationCategory = 'roditori' | 'insetti_striscianti' | 'insetti_volanti' | 'altro';

export interface PestArea { id: string; name: string; description: string | null; color: string | null; position: number; }
export interface PestFloorplan {
  id: string;
  name: string;
  area_id: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
}

export interface PestStationType {
  id: string;
  name: string;
  category: PestStationCategory;
  icon: string | null;
  color: string | null;
  default_frequency_days: number | null;
  position: number;
}

export interface PestStation {
  id: string;
  code: string;
  name: string | null;
  station_type_id: string | null;
  area_id: string | null;
  floorplan_id: string | null;
  location: string | null;
  pos_x: number | null;
  pos_y: number | null;
  install_date: string | null;
  brand: string | null;
  model: string | null;
  device_kind: string | null;
  status: PestStationStatus;
  control_frequency_days: number | null;
  responsible: string | null;
  qr_token: string;
  photo_path: string | null;
  notes: string | null;
  // §10 — campi specifici delle lampade UV / monitoraggio insetti volanti.
  lamp_type: string | null;
  glue_plate_type: string | null;
  last_replacement_date: string | null;
  next_verification_date: string | null;
  replacement_frequency_days: number | null;
}

/** Campi liberi in scrittura: il backend valida e accetta solo le colonne ammesse. */
export type PestUpsertPayload = Record<string, unknown> & { id?: string };

export interface PestInspection {
  id: string;
  station_id: string;
  inspected_at: string;
  operator_name: string | null;
  check_type: string | null;
  outcome: string | null;
  pest_present: boolean | null;
  pest_type: string | null;
  evidence_level: string | null;
  trap_condition: string | null;
  device_intact: boolean | null;
  bait_present: boolean | null;
  replacement_needed: boolean;
  action_taken: string | null;
  photo_paths: string[];
  notes: string | null;
  signature: string | null;
  next_due: string | null;
}

export type PestInterventionKind = 'disinfestazione' | 'derattizzazione';

export interface PestIntervention {
  id: string;
  code: string | null;
  kind: PestInterventionKind;
  performed_at: string;
  area_id: string | null;
  station_id: string | null;
  pest_type: string | null;
  problem: string | null;
  executor_type: 'ditta_esterna' | 'personale_interno';
  intervention_nature: 'programmato' | 'straordinario';
  technician: string | null;
  external_company_id: string | null;
  product_id: string | null;
  active_ingredient: string | null;
  quantity: string | null;
  application_method: string | null;
  outcome: string | null;
  instructions: string | null;
  reentry_time: string | null;
  next_check_date: string | null;
  photo_paths: string[];
  document_paths: string[];
  notes: string | null;
  signature: string | null;
}

export interface PestProduct {
  id: string;
  name: string;
  producer: string | null;
  category: string | null;
  active_ingredient: string | null;
  authorization_number: string | null;
  lot: string | null;
  purchase_date: string | null;
  expiry_date: string | null;
  usage_method: string | null;
  precautions: string | null;
  tech_doc_path: string | null;
  sds_path: string | null;
  label_path: string | null;
}

export interface PestExternalCompany {
  id: string;
  name: string;
  vat: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  service_types: string[];
  contract_path: string | null;
  notes: string | null;
}

/** §13 — Anomalia / non conformità rilevata su una postazione o area. */
export interface PestAnomaly {
  id: string;
  code: string | null;
  detected_at: string;
  reported_by: string | null;
  reported_by_name: string | null;
  area_id: string | null;
  station_id: string | null;
  inspection_id: string | null;
  intervention_id: string | null;
  anomaly_type: string | null;
  description: string | null;
  photo_paths: string[];
  priority: string;
  risk_assessment: string | null;
  status: string;
  resolved_at: string | null;
  resolution_notes: string | null;
}

/** §13 — Azione correttiva collegata a un'anomalia. */
export interface PestCorrectiveAction {
  id: string;
  anomaly_id: string;
  description: string;
  responsible: string | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  verification_notes: string | null;
  verified_at: string | null;
}

/** §14 — Attività programmata nel calendario del modulo. */
export interface PestSchedule {
  id: string;
  title: string;
  kind: string;
  due_date: string;
  due_time: string | null;
  frequency: string;
  frequency_days: number | null;
  responsible: string | null;
  area_id: string | null;
  station_id: string | null;
  notes: string | null;
  status: string;
  completed_at: string | null;
}

/** §15 — Documento dell'archivio documentale del modulo. */
export interface PestDocument {
  id: string;
  name: string;
  category: string | null;
  storage_path: string;
  issued_date: string | null;
  expiry_date: string | null;
  entity_type: string | null;
  entity_id: string | null;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
}

/** §17 — Voce dello storico modifiche del modulo (dall'audit log). */
export interface PestAuditEntry {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** §4 — Piano di monitoraggio degli infestanti. */
export interface PestPlan {
  id: string;
  name: string;
  plan_year: number | null;
  scope: string | null;
  risk_basis: string | null;
  description: string | null;
  status: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

// ── Centro avvisi / motore di scadenze HACCP ───────────────────────────────

/** Gravità di un avviso: critico (scaduto/fuori range) o da controllare. */
export type AlertSeverity = 'critical' | 'warning';

/** Categoria dell'avviso, mappata sull'area dell'app di riferimento. */
export type AlertCategory =
  | 'temperature'
  | 'semilavorati'
  | 'lotti'
  | 'pest_piano'
  | 'pest_certificazioni'
  | 'pest_controlli';

export interface AlertItem {
  /** Chiave stabile dell'avviso (dedup e stato "letto"). */
  key: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  dueDate: string | null;
  daysLeft: number | null;
  entityId: string | null;
  /** true se l'utente corrente ha già preso visione dell'avviso. */
  read: boolean;
}

export interface AlertListResult {
  alerts: AlertItem[];
  counts: { total: number; unread: number; critical: number; warning: number };
  generatedAt: string;
}

// ── Osservabilità ed error monitoring (consultazione per il gestore) ────────

/** Singolo report di errore raccolto dal frontend. */
export interface TelemetryReport {
  id: number;
  created_at: string;
  company_id: string | null;
  company_name?: string | null;
  user_id: string | null;
  level: 'error' | 'warning' | 'info';
  source: string;
  message: string;
  stack: string | null;
  route: string | null;
  app_version: string | null;
  user_agent: string | null;
  session_id: string | null;
  context: Record<string, unknown>;
  fingerprint: string;
  resolved_at: string | null;
}

/** Gruppo di errori equivalenti (stessa impronta) con il numero di occorrenze. */
export interface TelemetryGroup {
  fingerprint: string;
  level: string;
  source: string;
  count: number;
  lastSeen: string;
  resolved: boolean;
}

/** Aggregati per il cruscotto di osservabilità. */
export interface TelemetryStats {
  since: string;
  total: number;
  unresolved: number;
  truncated: boolean;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  byDay: Record<string, number>;
  groups: TelemetryGroup[];
}

export const api = {
  allergenTable: {
    list: (companyId: string, locationId?: string) =>
      call<{ products: AllergenRow[] }>('allergen-table', { action: 'list', locationId }, companyId),
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

  // Utenti e inviti dell'azienda attiva. Riservato a owner/admin (verificato
  // lato server). L'accettazione dell'invito non usa l'azienda attiva: si basa
  // sul token ricevuto per email, perché l'invitato non è ancora membro.
  team: {
    listMembers: (companyId: string) =>
      call<{ items: TeamMember[] }>('team', { action: 'members.list' }, companyId),
    setMemberRole: (companyId: string, userId: string, role: TeamRole) =>
      call<{ user_id: string; role: TeamRole }>('team', { action: 'members.setRole', user_id: userId, role }, companyId),
    removeMember: (companyId: string, userId: string) =>
      call<{ ok: boolean }>('team', { action: 'members.remove', user_id: userId }, companyId),
    listInvitations: (companyId: string) =>
      call<{ items: CompanyInvitation[] }>('team', { action: 'invitations.list' }, companyId),
    createInvitation: (companyId: string, payload: { email: string; role: TeamRole }) =>
      call<CreateInvitationResult>('team', { action: 'invitations.create', ...payload }, companyId),
    revokeInvitation: (companyId: string, id: string) =>
      call<{ ok: boolean }>('team', { action: 'invitations.revoke', id }, companyId),
    previewInvitation: (token: string) =>
      call<{ company_name: string; role: TeamRole; email: string }>('team', { action: 'invitations.preview', token }),
    acceptInvitation: (token: string) =>
      call<{ company_id: string; company_name: string; role: TeamRole }>('team', {
        action: 'invitations.accept',
        token,
      }),
  },

  // Dati di dominio: registri HACCP, materie prime in ingresso, modelli semilavorati.
  data: {
    records: {
      list: (companyId: string, locationId?: string) =>
        call<{ records: HaccpRecord[] }>('haccp-data', { action: 'records.list', locationId }, companyId),
      upsert: (companyId: string, payload: RecordUpsertPayload) =>
        call<{ record: HaccpRecord }>('haccp-data', { action: 'records.upsert', ...payload }, companyId),
      upsertMany: (companyId: string, records: RecordUpsertPayload[]) =>
        call<{ saved: number }>('haccp-data', { action: 'records.upsertMany', records }, companyId),
      // Generazione massiva riservata al gestore dell'applicazione (verificata lato server).
      generateRange: (companyId: string, records: RecordUpsertPayload[]) =>
        call<{ saved: number }>('haccp-data', { action: 'records.generateRange', records }, companyId),
      deleteByDate: (companyId: string, date: string, locationId?: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteByDate', date, locationId }, companyId),
      deleteByMonth: (companyId: string, year: number, month: number, locationId?: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteByMonth', year, month, locationId }, companyId),
      deleteAll: (companyId: string, locationId?: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'records.deleteAll', locationId }, companyId),
    },
    incoming: {
      list: (companyId: string, locationId?: string) =>
        call<{ items: IncomingFoodRow[] }>('haccp-data', { action: 'incoming.list', locationId }, companyId),
      upsert: (companyId: string, payload: IncomingFoodPayload) =>
        call<{ id: string }>('haccp-data', { action: 'incoming.upsert', ...payload }, companyId),
      setStatus: (companyId: string, id: string, stato: StockStatus) =>
        call<{ id: string; stato: StockStatus }>('haccp-data', { action: 'incoming.setStatus', id, stato }, companyId),
      // Consumo residuo: riduce la quantità disponibile. Blocca lotti scaduti.
      consume: (companyId: string, payload: ConsumePayload) =>
        call<IncomingConsumeResult>('haccp-data', { action: 'incoming.consume', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'incoming.delete', id }, companyId),
    },
    semi: {
      // Il contenuto è JSON libero scritto dal client: viene validato e
      // normalizzato a runtime dallo schema, così un payload corrotto diventa
      // un errore esplicito invece di propagarsi non tipizzato.
      get: async (companyId: string): Promise<SemiGetResponse> => {
        const raw = await call<unknown>('haccp-data', { action: 'semi.get' }, companyId);
        const { semiGetResponseSchema } = await import('./schemas');
        const parsed = semiGetResponseSchema.safeParse(raw);
        if (!parsed.success) {
          captureError(parsed.error, {
            source: 'api',
            level: 'warning',
            context: { fn: 'haccp-data', action: 'semi.get', code: 'invalid_payload' },
          });
          throw new ApiError('Risposta dei semilavorati non valida', 502, 'invalid_payload');
        }
        return parsed.data;
      },
      save: (companyId: string, payload: { templates: SemiProductTemplate[]; categories: string[] }) =>
        call<{ ok: boolean }>('haccp-data', { action: 'semi.save', ...payload }, companyId),
      // Lotti di produzione registrati (tracciabilità, scadenze, archivio).
      batches: {
        list: (companyId: string, locationId?: string) =>
          call<{ items: SemiProductBatch[] }>('haccp-data', { action: 'semi.batches.list', locationId }, companyId),
        upsert: (companyId: string, payload: SemiProductBatchPayload) =>
          call<{ item: SemiProductBatch }>('haccp-data', { action: 'semi.batches.upsert', ...payload }, companyId),
        update: (companyId: string, payload: SemiProductBatchPatch) =>
          call<{ item: SemiProductBatch }>('haccp-data', { action: 'semi.batches.update', ...payload }, companyId),
        // Consumo residuo: riduce la quantità disponibile. Blocca lotti scaduti.
        consume: (companyId: string, payload: ConsumePayload) =>
          call<{ item: SemiProductBatch }>('haccp-data', { action: 'semi.batches.consume', ...payload }, companyId),
      },
    },
    // Registro dell'archiviazione e degli scarti delle scorte (audit trail).
    stock: {
      audit: (companyId: string, params?: { entity?: 'incoming_foods' | 'semi_product_batches'; limit?: number }) =>
        call<{ items: StockAuditEntry[] }>('haccp-data', { action: 'stock.audit', ...params }, companyId),
    },
    // Tracciabilità a ritroso (recall): ricerca a livello azienda che collega
    // un lotto al fornitore, agli impieghi (semilavorati, abbattimenti) e ai
    // movimenti di magazzino.
    trace: {
      recall: (companyId: string, query: string) =>
        call<RecallResult>('haccp-data', { action: 'trace.recall', query }, companyId),
    },
    equipment: {
      list: (companyId: string) =>
        call<{ equipment: Equipment[] }>('haccp-data', { action: 'equipment.list' }, companyId),
      upsert: (companyId: string, payload: { id?: string; kind: EquipmentKind; name: string }) =>
        call<{ equipment: Equipment }>('haccp-data', { action: 'equipment.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'equipment.delete', id }, companyId),
    },
    // Abbattimenti termici: registro del raffreddamento rapido (abbattimento
    // positivo e surgelamento). Esito e durata sono calcolati dal backend.
    blast: {
      list: (companyId: string, locationId?: string) =>
        call<{ items: BlastChilling[] }>('haccp-data', { action: 'blast.list', locationId }, companyId),
      upsert: (companyId: string, payload: BlastChillingPayload) =>
        call<{ item: BlastChilling }>('haccp-data', { action: 'blast.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'blast.delete', id }, companyId),
    },
    // Anagrafica fornitori: elenco strutturato collegato agli alimenti in
    // ingresso (tracciabilità di filiera).
    suppliers: {
      list: (companyId: string) =>
        call<{ items: Supplier[] }>('haccp-data', { action: 'suppliers.list' }, companyId),
      upsert: (companyId: string, payload: SupplierPayload) =>
        call<{ item: Supplier }>('haccp-data', { action: 'suppliers.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'suppliers.delete', id }, companyId),
    },
    // Piano di sanificazione: anagrafica configurabile delle attività di
    // pulizia/sanificazione, base della checklist guidata del registro.
    cleaningPlan: {
      list: (companyId: string) =>
        call<{ items: CleaningPlanItem[] }>('haccp-data', { action: 'cleaningPlan.list' }, companyId),
      upsert: (companyId: string, payload: CleaningPlanItemPayload) =>
        call<{ item: CleaningPlanItem }>('haccp-data', { action: 'cleaningPlan.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'cleaningPlan.delete', id }, companyId),
    },
    // Anagrafica delle sedi: i registri e gli abbattimenti sono filtrati per
    // sede. L'id può essere generato dal client per creare una sede offline.
    locations: {
      list: (companyId: string) =>
        call<{ items: Location[] }>('haccp-data', { action: 'locations.list' }, companyId),
      upsert: (companyId: string, payload: LocationPayload) =>
        call<{ item: Location }>('haccp-data', { action: 'locations.upsert', ...payload }, companyId),
      remove: (companyId: string, id: string) =>
        call<{ ok: boolean }>('haccp-data', { action: 'locations.delete', id }, companyId),
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

  // Modulo Controllo Infestanti: piano, aree, planimetrie, postazioni, controlli,
  // interventi, anomalie, azioni correttive, calendario e documentazione.
  // Tutte le operazioni passano dall'Edge Function "pest-control" (RLS + feature).
  pest: {
    overview: (companyId: string) =>
      call<PestOverview>('pest-control', { action: 'overview' }, companyId),
    stationByQr: (companyId: string, token: string) =>
      call<{ item: PestStation }>('pest-control', { action: 'stations.byQr', token }, companyId),
    stationDetail: (companyId: string, id: string) =>
      call<{ item: PestStation; lastInspection: PestInspection | null; openAnomalies: number }>(
        'pest-control',
        { action: 'stations.detail', id },
        companyId,
      ),
    list: <T = unknown>(companyId: string, entity: string) =>
      call<{ items: T[] }>('pest-control', { action: `${entity}.list` }, companyId),
    upsert: <T = unknown>(companyId: string, entity: string, payload: PestUpsertPayload) =>
      call<{ item: T }>('pest-control', { action: `${entity}.upsert`, ...payload }, companyId),
    remove: (companyId: string, entity: string, id: string) =>
      call<{ ok: boolean }>('pest-control', { action: `${entity}.delete`, id }, companyId),
    /** §17 — Storico modifiche del modulo (audit log dell'azienda). */
    audit: (companyId: string, limit = 100) =>
      call<{ items: PestAuditEntry[] }>('pest-control', { action: 'audit.list', limit }, companyId),
  },

  // Centro avvisi: motore di scadenze calcolato lato server (temperature fuori
  // range, lotti in scadenza, piano infestanti, certificazioni ditte esterne,
  // controlli periodici). Lo stato "letto" è per utente.
  alerts: {
    list: (companyId: string) =>
      call<AlertListResult>('alerts', { action: 'list' }, companyId),
    markRead: (companyId: string, keys?: string[]) =>
      call<{ ok: boolean; marked: number }>(
        'alerts',
        keys ? { action: 'mark-read', keys } : { action: 'mark-read' },
        companyId,
      ),
  },

  // Osservabilità: consultazione dei report di errore. Riservata al gestore
  // (nessun company_id: l'autorizzazione è verificata lato server).
  telemetry: {
    list: (params?: {
      level?: 'error' | 'warning' | 'info';
      source?: string;
      company_id?: string;
      fingerprint?: string;
      resolved?: boolean;
      limit?: number;
    }) => call<{ items: TelemetryReport[] }>('telemetry', { action: 'list', ...params }),
    stats: (days = 7) => call<TelemetryStats>('telemetry', { action: 'stats', days }),
    resolve: (ids: number[], resolved = true) =>
      call<{ ok: boolean; updated: number; resolved: boolean }>('telemetry', {
        action: 'resolve',
        ids,
        resolved,
      }),
  },
};

/** Varianti che usano automaticamente l'azienda attiva (per i moduli non-React). */
export const activeData = {
  team: {
    listMembers: () => api.team.listMembers(requireCompany()),
    setMemberRole: (userId: string, role: TeamRole) =>
      api.team.setMemberRole(requireCompany(), userId, role),
    removeMember: (userId: string) => api.team.removeMember(requireCompany(), userId),
    listInvitations: () => api.team.listInvitations(requireCompany()),
    createInvitation: (payload: { email: string; role: TeamRole }) =>
      api.team.createInvitation(requireCompany(), payload),
    revokeInvitation: (id: string) => api.team.revokeInvitation(requireCompany(), id),
  },
  records: {
    list: () => api.data.records.list(requireCompany(), getActiveLocation() ?? undefined),
    upsert: (payload: RecordUpsertPayload) => api.data.records.upsert(requireCompany(), payload),
    upsertMany: (records: RecordUpsertPayload[]) => api.data.records.upsertMany(requireCompany(), records),
    generateRange: (records: RecordUpsertPayload[]) => api.data.records.generateRange(requireCompany(), records),
    deleteByDate: (date: string) =>
      api.data.records.deleteByDate(requireCompany(), date, getActiveLocation() ?? undefined),
    deleteByMonth: (year: number, month: number) =>
      api.data.records.deleteByMonth(requireCompany(), year, month, getActiveLocation() ?? undefined),
    deleteAll: () => api.data.records.deleteAll(requireCompany(), getActiveLocation() ?? undefined),
  },
  incoming: {
    list: () => api.data.incoming.list(requireCompany(), getActiveLocation() ?? undefined),
    upsert: (payload: IncomingFoodPayload) => api.data.incoming.upsert(requireCompany(), payload),
    setStatus: (id: string, stato: StockStatus) => api.data.incoming.setStatus(requireCompany(), id, stato),
    consume: (payload: ConsumePayload) => api.data.incoming.consume(requireCompany(), payload),
    remove: (id: string) => api.data.incoming.remove(requireCompany(), id),
  },
  semi: {
    get: () => api.data.semi.get(requireCompany()),
    save: (payload: { templates: SemiProductTemplate[]; categories: string[] }) =>
      api.data.semi.save(requireCompany(), payload),
    batches: {
      list: () => api.data.semi.batches.list(requireCompany(), getActiveLocation() ?? undefined),
      upsert: (payload: SemiProductBatchPayload) => api.data.semi.batches.upsert(requireCompany(), payload),
      update: (payload: SemiProductBatchPatch) => api.data.semi.batches.update(requireCompany(), payload),
      consume: (payload: ConsumePayload) => api.data.semi.batches.consume(requireCompany(), payload),
    },
  },
  stock: {
    audit: (params?: { entity?: 'incoming_foods' | 'semi_product_batches'; limit?: number }) =>
      api.data.stock.audit(requireCompany(), params),
  },
  trace: {
    // La ricerca di tracciabilità copre l'intera azienda (non la sola sede
    // attiva): un lotto può essere stato distribuito su più sedi.
    recall: (query: string) => api.data.trace.recall(requireCompany(), query),
  },
  equipment: {
    list: () => api.data.equipment.list(requireCompany()),
    upsert: (payload: { id?: string; kind: EquipmentKind; name: string }) =>
      api.data.equipment.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.equipment.remove(requireCompany(), id),
  },
  blast: {
    list: () => api.data.blast.list(requireCompany(), getActiveLocation() ?? undefined),
    upsert: (payload: BlastChillingPayload) => api.data.blast.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.blast.remove(requireCompany(), id),
  },
  suppliers: {
    list: () => api.data.suppliers.list(requireCompany()),
    upsert: (payload: SupplierPayload) => api.data.suppliers.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.suppliers.remove(requireCompany(), id),
  },
  cleaningPlan: {
    list: () => api.data.cleaningPlan.list(requireCompany()),
    upsert: (payload: CleaningPlanItemPayload) =>
      api.data.cleaningPlan.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.cleaningPlan.remove(requireCompany(), id),
  },
  locations: {
    list: () => api.data.locations.list(requireCompany()),
    upsert: (payload: LocationPayload) => api.data.locations.upsert(requireCompany(), payload),
    remove: (id: string) => api.data.locations.remove(requireCompany(), id),
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


