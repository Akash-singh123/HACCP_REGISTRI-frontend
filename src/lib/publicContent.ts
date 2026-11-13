import {
  Bug,
  CalendarClock,
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
  Package,
  ScanLine,
  Server,
  ShieldCheck,
  Signature,
  Smartphone,
  Sparkles,
  Tablet,
  Thermometer,
} from 'lucide-react';
import type { PublicPlans } from '@/lib/api';

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
 * Aree principali del gestionale, presentate nella sezione "Tutto sotto controllo".
 * Riflettono le funzionalità effettivamente disponibili nella piattaforma.
 */
export const AREAS = [
  {
    icon: Thermometer,
    title: 'Registri delle temperature',
    text: 'Frigoriferi e congelatori personalizzabili, con avvisi immediati quando un valore esce dal range.',
  },
  {
    icon: ChefHat,
    title: 'Gestione dei semilavorati',
    text: 'Categorie, prodotti e lotti di produzione con numerazione automatica e storico sempre ordinato.',
  },
  {
    icon: ScanLine,
    title: 'Tracciabilità alimentare',
    text: 'Accettazione merci con lettura di lotto e scadenza dal codice a barre o dalla foto dell’etichetta.',
  },
  {
    icon: CalendarClock,
    title: 'Etichette e scadenze',
    text: 'Controllo centralizzato delle date di scadenza di prodotti, lotti e documenti, per non perdere nulla.',
  },
  {
    icon: Sparkles,
    title: 'Pulizia e sanificazione',
    text: 'Piano di sanificazione con firma digitale dell’operatore OSA, compilabile in pochi secondi.',
  },
  {
    icon: Bug,
    title: 'Disinfestazione e infestanti',
    text: 'Monitoraggio delle postazioni, anomalie e azioni correttive per il controllo infestanti.',
  },
  {
    icon: Package,
    title: 'Prodotti e materie prime',
    text: 'Anagrafiche ordinate di prodotti, ingredienti e materie prime, sempre a portata di mano.',
  },
  {
    icon: Leaf,
    title: 'Allergeni e informazioni',
    text: 'Tabella allergeni per prodotto, aggiornata e pronta da stampare ed esporre al cliente.',
  },
  {
    icon: FileText,
    title: 'Registri e documentazione HACCP',
    text: 'Esporta registri giornalieri e mensili in PDF, pronti per essere mostrati ai controlli.',
  },
];

/** Funzionalità di dettaglio, mostrate nella pagina dedicata. */
export const FEATURES = [
  {
    icon: Thermometer,
    title: 'Registro temperature',
    text: 'Frigoriferi e congelatori personalizzabili: aggiungi, rinomina ed elimina le attrezzature che vuoi, senza limiti.',
  },
  {
    icon: ScanLine,
    title: 'Accettazione merci con IA',
    text: 'Scansiona il codice a barre o fotografa l’etichetta: lotto e scadenza vengono letti e compilati automaticamente.',
  },
  {
    icon: Signature,
    title: 'Sanificazione e firme',
    text: 'Compila le attività di pulizia e apponi la firma digitale dell’operatore OSA in pochi secondi.',
  },
  {
    icon: ChefHat,
    title: 'Prodotti semilavorati',
    text: 'Organizza categorie e prodotti e registra i lotti di produzione con numerazione automatica.',
  },
  {
    icon: Bug,
    title: 'Controllo infestanti',
    text: 'Monitora postazioni e anomalie, registra gli interventi e tieni traccia delle azioni correttive.',
  },
  {
    icon: Leaf,
    title: 'Tabella allergeni',
    text: 'Tabella allergeni per prodotto, sempre aggiornata e pronta da stampare ed esporre al cliente.',
  },
  {
    icon: FileText,
    title: 'Registri in PDF',
    text: 'Esporta i registri giornalieri e mensili, o scarica interi archivi in un unico file ZIP.',
  },
  {
    icon: FolderOpen,
    title: 'Archivio documenti',
    text: 'Manuale, attestati e certificazioni al sicuro nel cloud, accessibili da qualsiasi dispositivo.',
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
  { icon: Smartphone, label: 'Smartphone' },
  { icon: Smartphone, label: 'iPhone' },
  { icon: Tablet, label: 'Tablet' },
  { icon: Tablet, label: 'iPad' },
  { icon: Monitor, label: 'Computer' },
  { icon: Laptop, label: 'Notebook' },
];

/** Vantaggi evidenziati nella sezione "Perché scegliere Alimex". */
export const BENEFITS = [
  'Meno documenti cartacei da gestire',
  'Registri sempre organizzati e ricercabili',
  'Compilazione semplice, anche da smartphone',
  'Maggiore controllo sulle scadenze',
  'Tracciabilità più ordinata dei lotti',
  'Un’unica piattaforma per la gestione quotidiana',
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
