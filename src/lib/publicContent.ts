import {
  Bug,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  FileText,
  FolderOpen,
  KeyRound,
  Laptop,
  Leaf,
  Lock,
  Monitor,
  ScanLine,
  Server,
  ShieldCheck,
  Signature,
  Smartphone,
  Sparkles,
  Tablet,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import type { PublicPlans } from '@/lib/api';
import { AREA, type AreaAccent } from '@/lib/areaIdentity';

/** Nome commerciale mostrato nel sito pubblico: modifica qui per rinominare il prodotto. */
export const BRAND = 'Alimex';

/** Descrizione sintetica del prodotto, usata accanto al logo. */
export const TAGLINE = 'Gestionale per HACCP, tracciabilità e sicurezza alimentare';

export function intervalLabel(interval: string): string {
  if (interval === 'month') return 'mese';
  if (interval === 'year') return 'anno';
  if (interval === 'week') return 'settimana';
  return interval;
}

/** Importo del piano formattato, con periodo di fatturazione. */
export function formatPrice(plans: PublicPlans | null): string {
  const price = plans?.plan;
  if (!price) return '—';
  const value = (price.amount / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  });
  const period =
    price.intervalCount > 1
      ? `${price.intervalCount} ${intervalLabel(price.interval)}`
      : intervalLabel(price.interval);
  return `${value} / ${period}`;
}

/**
 * Aree principali del gestionale, presentate nella sezione "Tutto sotto controllo"
 * e nella pagina Funzionalità. Riflettono le funzionalità realmente disponibili
 * e hanno ciascuna una propria identità cromatica, condivisa con la dashboard.
 */
export interface PublicArea {
  key: string;
  icon: LucideIcon;
  title: string;
  text: string;
  accent: AreaAccent;
  /** Etichette sintetiche mostrate nelle illustrazioni della pagina Funzionalità. */
  points: string[];
}

export const AREAS: PublicArea[] = [
  {
    key: 'haccp',
    icon: ClipboardCheck,
    title: 'Registri HACCP',
    text: 'Tutti i registri della tua attività organizzati in un unico ambiente digitale, sempre consultabili e facilmente compilabili.',
    accent: AREA.haccp,
    points: ['Controlli giornalieri', 'Stato delle attività', 'Ricerca immediata'],
  },
  {
    key: 'temperature',
    icon: Thermometer,
    title: 'Controllo temperature',
    text: 'Monitora le temperature delle attrezzature e organizza i controlli di frigoriferi, congelatori e celle frigorifere.',
    accent: AREA.temperature,
    points: ['Frigoriferi', 'Congelatori', 'Celle frigorifere'],
  },
  {
    key: 'traceability',
    icon: ScanLine,
    title: 'Tracciabilità e ingresso merci',
    text: 'Registra le materie prime in ingresso e mantieni organizzate le informazioni necessarie alla tracciabilità alimentare.',
    accent: AREA.traceability,
    points: ['Fornitori', 'Lotti', 'Date di scadenza'],
  },
  {
    key: 'semilavorati',
    icon: ChefHat,
    title: 'Semilavorati ed etichette',
    text: 'Gestisci i semilavorati della tua cucina, registra le preparazioni e genera etichette con informazioni su produzione, lotto e scadenza.',
    accent: AREA.semilavorati,
    points: ['Preparazioni', 'Lotti di produzione', 'Etichette'],
  },
  {
    key: 'sanificazione',
    icon: Sparkles,
    title: 'Pulizia e sanificazione',
    text: 'Organizza le attività di pulizia e sanificazione, controlla gli interventi e conserva lo storico delle operazioni.',
    accent: AREA.sanificazione,
    points: ['Superfici e attrezzature', 'Procedure', 'Storico interventi'],
  },
  {
    key: 'pest',
    icon: Bug,
    title: 'Disinfestazione e infestanti',
    text: 'Gestisci i punti di monitoraggio, registra le verifiche e organizza le attività di prevenzione e controllo degli infestanti.',
    accent: AREA.pest,
    points: ['Punti di monitoraggio', 'Verifiche', 'Azioni correttive'],
  },
  {
    key: 'allergeni',
    icon: Leaf,
    title: 'Prodotti e allergeni',
    text: 'Organizza le informazioni dei prodotti e tieni sotto controllo ingredienti e allergeni.',
    accent: AREA.allergeni,
    points: ['Prodotti', 'Ingredienti', 'Allergeni'],
  },
];

/** Funzionalità di dettaglio, mostrate nella pagina dedicata. */
export interface PublicFeature {
  icon: LucideIcon;
  title: string;
  text: string;
  accent: AreaAccent;
}

export const FEATURES: PublicFeature[] = [
  {
    icon: Thermometer,
    title: 'Registro temperature',
    text: 'Frigoriferi e congelatori personalizzabili: aggiungi, rinomina ed elimina le attrezzature che vuoi, senza limiti.',
    accent: AREA.temperature,
  },
  {
    icon: ScanLine,
    title: 'Accettazione merci con IA',
    text: 'Scansiona il codice a barre o fotografa l’etichetta: lotto e scadenza vengono letti e compilati automaticamente.',
    accent: AREA.traceability,
  },
  {
    icon: Signature,
    title: 'Sanificazione e firme',
    text: 'Compila le attività di pulizia e apponi la firma digitale dell’operatore OSA in pochi secondi.',
    accent: AREA.sanificazione,
  },
  {
    icon: ChefHat,
    title: 'Prodotti semilavorati',
    text: 'Organizza categorie e prodotti e registra i lotti di produzione con numerazione automatica.',
    accent: AREA.semilavorati,
  },
  {
    icon: Bug,
    title: 'Controllo infestanti',
    text: 'Monitora postazioni e anomalie, registra gli interventi e tieni traccia delle azioni correttive.',
    accent: AREA.pest,
  },
  {
    icon: Leaf,
    title: 'Tabella allergeni',
    text: 'Tabella allergeni per prodotto, sempre aggiornata e pronta da stampare ed esporre al cliente.',
    accent: AREA.allergeni,
  },
  {
    icon: FileText,
    title: 'Registri in PDF',
    text: 'Esporta i registri giornalieri e mensili, o scarica interi archivi in un unico file ZIP.',
    accent: AREA.haccp,
  },
  {
    icon: FolderOpen,
    title: 'Archivio documenti',
    text: 'Manuale, attestati e certificazioni al sicuro nel cloud, accessibili da qualsiasi dispositivo.',
    accent: AREA.documenti,
  },
];

/** Confronto tra metodo tradizionale e digitale. */
export const COMPARISON: { traditional: string; ours: string }[] = [
  {
    traditional: 'Fogli Excel e registri cartacei che si perdono o si rovinano',
    ours: 'Tutti i registri digitali, salvati e ricercabili in qualsiasi momento',
  },
  {
    traditional: 'Mezz’ora per compilare a mano un registro',
    ours: 'Registro di giornata compilato in meno di un minuto',
  },
  {
    traditional: 'Nessun avviso sulle scadenze di prodotti e documenti',
    ours: 'Controllo scadenze centralizzato per prodotti, lotti e attestati',
  },
  {
    traditional: 'Caos durante le ispezioni: documenti introvabili',
    ours: 'Documentazione pronta all’istante, esportabile e stampabile',
  },
  {
    traditional: 'Rischio di sanzioni per registrazioni incomplete o illeggibili',
    ours: 'Registri sempre completi, datati e firmati digitalmente',
  },
  {
    traditional: 'Nessun controllo su più sedi o reparti',
    ours: 'Ogni ristorante isolato e gestito in autonomia, con dati protetti',
  },
];

/** Passaggi di attivazione, mostrati nella sezione "Come funziona". */
export const STEPS = [
  {
    icon: Sparkles,
    title: 'Crea il tuo account',
    text: 'Registrati in un minuto: la prova gratuita si attiva subito, senza carta di credito.',
  },
  {
    icon: Thermometer,
    title: 'Configura la tua attività',
    text: 'Aggiungi attrezzature, prodotti e categorie: il gestionale si adatta alla tua realtà.',
  },
  {
    icon: ClipboardCheck,
    title: 'Gestisci registri e controlli',
    text: 'Registra temperature e sanificazioni ogni giorno, con promemoria sempre attivi.',
  },
  {
    icon: FolderOpen,
    title: 'Tutto in un unico sistema',
    text: 'Registri, scadenze e documentazione restano organizzati in un solo posto.',
  },
];

/** Pilastri di sicurezza mostrati nel sito pubblico. */
export const SECURITY = [
  {
    icon: Server,
    title: 'Dati isolati per ristorante',
    text: 'Ogni azienda vede esclusivamente i propri dati, protetti a livello di database.',
  },
  {
    icon: Lock,
    title: 'Controlli lato server',
    text: 'Licenze e permessi sono verificati sul server, mai nel browser.',
  },
  {
    icon: KeyRound,
    title: 'Login protetto',
    text: 'Protezione contro i tentativi ripetuti e le password deboli.',
  },
  {
    icon: ShieldCheck,
    title: 'Pagamenti sicuri',
    text: 'Abbonamenti e rinnovi gestiti tramite Stripe, senza dati di carta sul nostro sistema.',
  },
];

/** Domande frequenti. */
export const FAQ = [
  {
    q: 'Dopo la prova gratuita devo pagare per forza?',
    a: 'No. La prova dura 7 giorni e non richiede carta di credito. Alla scadenza scegli se attivare l’abbonamento: se non lo fai, l’accesso si blocca senza alcun addebito.',
  },
  {
    q: 'Serve installare qualcosa?',
    a: 'No. Il gestionale funziona direttamente dal browser, su computer, tablet e smartphone. Ti basta una connessione internet.',
  },
  {
    q: 'Posso aggiungere tutti i frigoriferi e i congelatori che voglio?',
    a: 'Sì. Le attrezzature sono totalmente personalizzabili: ne aggiungi quante ne servono, le rinomini come preferisci e le elimini quando non le usi più. Il registro temperature si aggiorna da solo.',
  },
  {
    q: 'I miei dati sono al sicuro?',
    a: 'Sì. Ogni ristorante è isolato dagli altri e i permessi sono verificati lato server. Le chiavi e la logica sensibile non risiedono mai nel browser.',
  },
  {
    q: 'Posso disdire quando voglio?',
    a: 'Certamente. L’abbonamento non ha vincoli di durata: puoi gestirlo o disdirlo in autonomia dalla sezione abbonamento dell’app.',
  },
];

/** Dispositivi supportati, mostrati nella sezione "Accessibile ovunque". */
export const DEVICES = [
  { icon: Smartphone, label: 'iPhone' },
  { icon: Smartphone, label: 'Smartphone Android' },
  { icon: Tablet, label: 'iPad' },
  { icon: Tablet, label: 'Tablet Android' },
  { icon: Monitor, label: 'Computer desktop' },
  { icon: Laptop, label: 'Notebook' },
];

/** Vantaggi evidenziati nella sezione "Meno carta, più controllo". */
export const BENEFITS = [
  'Riduci la gestione dei documenti cartacei',
  'Organizza i registri in formato digitale',
  'Tieni sotto controllo le scadenze',
  'Gestisci la tracciabilità alimentare',
  'Semplifica le attività quotidiane',
  'Consulta le informazioni da qualsiasi dispositivo',
];

/** Settori a cui si rivolge il prodotto. */
export const SECTORS = [
  'Ristoranti',
  'Bar e caffetterie',
  'Pizzerie',
  'Gastronomie',
  'Laboratori alimentari',
  'Catene multi-sede',
];

export { CheckCircle2 };
