import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { HaccpForm } from '@/components/HaccpForm';
const AutoGenerator = lazy(() => import('@/components/AutoGenerator').then((m) => ({ default: m.AutoGenerator })));
const RecordsList = lazy(() => import('@/components/RecordsList'));
const DocumentsArchive = lazy(() => import('@/components/DocumentsArchive'));
import { CompanyInfo } from '@/types/haccp';
import { getRecords } from '@/lib/haccpUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import {
  Archive,
  Bug,
  Building2,
  ChefHat,
  ClipboardList,
  Clock,
  CreditCard,
  FolderOpen,
  Loader2,
  LogOut,
  PackagePlus,
  Printer,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Signature,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
const Semilavorati = lazy(() => import('@/components/Semilavorati'));
const IncomingFoods = lazy(() => import('@/components/IncomingFoods'));
const OsaSignature = lazy(() => import('@/components/OsaSignature'));
const Allergeni = lazy(() => import('@/components/Allergeni'));
const Billing = lazy(() => import('@/components/Billing'));
const PrinterManager = lazy(() => import('@/components/printing/PrinterManager'));
const PestControl = lazy(() => import('@/components/pest/PestControl'));
import { PushBell, PushSettingsRow, PwaInstallBanner } from '@/components/Pwa';
import { startAutoRegisterScheduler } from '@/lib/autoRegisters';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type TabKey = 'daily' | 'auto' | 'archive' | 'ingresso' | 'cloud' | 'semilavorati' | 'firma-osa' | 'allergeni' | 'infestanti' | 'stampanti' | 'abbonamento';

interface NavItem {
  key: TabKey;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'daily', label: 'Compilazione Giornaliera', short: 'Compila', description: 'Annota temperatura e sanificazione di oggi.', icon: ClipboardList },
  { key: 'archive', label: 'Archivio e Consultazione', short: 'Archivio', description: 'Consulta e scarica i registri per mese e semestre.', icon: Archive },
  { key: 'ingresso', label: 'Alimenti in Ingresso', short: 'Ingresso', description: 'Registra gli alimenti con lotto, fornitore e scadenza.', icon: PackagePlus },
  { key: 'semilavorati', label: 'Prodotti Semilavorati', short: 'Semilavorati', description: 'Gestisci prodotti, categorie e registra i lotti di produzione.', icon: ChefHat },
  { key: 'allergeni', label: 'Tabella Allergeni', short: 'Allergeni', description: 'Tabella allergeni per prodotto, pronta da stampare.', icon: ShieldAlert },
  { key: 'infestanti', label: 'Controllo Infestanti', short: 'Infestanti', description: 'Piano di monitoraggio, postazioni e interventi di disinfestazione.', icon: Bug },
  { key: 'cloud', label: 'Archivio Documenti', short: 'Documenti', description: 'Tutti i documenti PDF archiviati nel cloud.', icon: FolderOpen },
  { key: 'firma-osa', label: 'Firma OSA', short: 'Firma OSA', description: "Apponi la firma dell'operatore OSA.", icon: Signature },
  { key: 'stampanti', label: 'Stampanti ed Etichette', short: 'Stampanti', description: 'Collega le stampanti e configura i formati delle etichette.', icon: Printer },
  { key: 'abbonamento', label: 'Abbonamento', short: 'Piano', description: 'Stato del piano e gestione del pagamento.', icon: CreditCard },
];

const AUTO_ITEM: NavItem = {
  key: 'auto',
  label: 'Generazione Automatica',
  short: 'Auto',
  description: 'Genera automaticamente i registri del periodo.',
  icon: Zap,
};

export default function HaccpDashboard() {
  const { company: authCompany, signOut, refreshCompany } = useAuth();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [autoUnlocked, setAutoUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('daily');
  const [pestToken, setPestToken] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; thisMonth: number; thisYear: number; lastRecord: string | null }>({
    total: 0,
    thisMonth: 0,
    thisYear: 0,
    lastRecord: null,
  });
  const [profileForm, setProfileForm] = useState({ name: '', piva: '', address: '' });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const secretClicksRef = useRef<number>(0);
  const secretTimerRef = useRef<number | null>(null);
  // Barra di navigazione mobile: contenitore scorrevole e voce attiva da portare in vista.
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const activeNavRef = useRef<HTMLButtonElement>(null);

  // Info azienda per i componenti (nome, P.IVA, indirizzo) derivate dal tenant attivo.
  const companyInfo: CompanyInfo = useMemo(() => {
    const info = (authCompany?.info ?? {}) as Record<string, unknown>;
    return {
      name: authCompany?.name ?? '',
      piva: info.piva ? String(info.piva) : '',
      address: info.address ? String(info.address) : '',
    };
  }, [authCompany]);

  const navItems = useMemo(() => (autoUnlocked ? [...NAV_ITEMS.slice(0, 1), { ...AUTO_ITEM, description: AUTO_ITEM.description }, ...NAV_ITEMS.slice(1)] : NAV_ITEMS), [autoUnlocked]);

  const activeItem = useMemo(() => navItems.find((n) => n.key === activeTab) ?? NAV_ITEMS[0], [navItems, activeTab]);

  // Mantiene la voce attiva centrata nella barra di navigazione mobile scorrevole.
  useEffect(() => {
    const nav = mobileNavRef.current;
    const btn = activeNavRef.current;
    if (!nav || !btn) return;
    const target = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [activeTab]);

  // Sincronizza il form impostazioni con l'azienda attiva.
  useEffect(() => {
    if (!authCompany) return;
    const info = (authCompany.info ?? {}) as Record<string, unknown>;
    setProfileForm({
      name: authCompany.name,
      piva: info.piva ? String(info.piva) : '',
      address: info.address ? String(info.address) : '',
    });
    setLogoUrl(authCompany.logoUrl ?? null);
  }, [authCompany]);

  // Statistiche registri (ricaricate a ogni aggiornamento).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const records = await getRecords();
        if (cancelled) return;
        const now = new Date();
        const thisMonth = records.filter((r) => {
          const d = new Date(r.date);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;
        const thisYear = records.filter((r) => new Date(r.date).getFullYear() === now.getFullYear()).length;
        const lastRecord = records.length
          ? records.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date
          : null;
        setStats({ total: records.length, thisMonth, thisYear, lastRecord });
      } catch (e) {
        console.error('Errore caricamento statistiche:', e);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  // Avvio scheduler automatico registri HACCP (Temperature e Sanificazione)
  useEffect(() => {
    if (!companyInfo.name) return;
    const { cancel } = startAutoRegisterScheduler(companyInfo);
    return () => {
      try {
        cancel();
      } catch {
        /* cleanup fallito, ignora */
      }
    };
  }, [companyInfo]);

  // Deep-link QR di una postazione (?pest=<token>): apre il modulo infestanti
  // direttamente sulla scheda della postazione scansionata.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('pest');
    if (!token) return;
    setPestToken(token);
    setActiveTab('infestanti');
    params.delete('pest');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  // Ritorno da Stripe Checkout / portale: aggiorna lo stato della licenza.
  // Il webhook può arrivare con qualche secondo di ritardo, quindi ritentiamo.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('billing');
    if (!flag) return;

    // Rimuove il parametro dall'URL per non rieseguire al reload.
    params.delete('billing');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);

    let timer: number | undefined;

    if (flag === 'cancel') {
      toast.info('Pagamento annullato', { description: 'Non è stato addebitato nulla.' });
    } else if (flag === 'success') {
      setActiveTab('abbonamento');
      toast.success('Pagamento completato', { description: 'Stiamo attivando il tuo abbonamento…' });
      let attempts = 0;
      timer = window.setInterval(() => {
        attempts += 1;
        void refreshCompany();
        if (attempts >= 6 && timer) window.clearInterval(timer);
      }, 2500);
      void refreshCompany();
    } else if (flag === 'portal') {
      setActiveTab('abbonamento');
      void refreshCompany();
    }

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [refreshCompany]);

  const saveCompanyInfo = async () => {
    if (!authCompany) return;
    setSavingProfile(true);
    try {
      const info = { ...(authCompany.info ?? {}), piva: profileForm.piva, address: profileForm.address };
      await api.company.updateProfile(authCompany.id, { name: profileForm.name, info });
      await refreshCompany();
      setShowSettings(false);
      toast.success('Impostazioni salvate');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel salvataggio delle impostazioni');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !authCompany) return;
    setUploadingLogo(true);
    try {
      const url = await api.company.uploadLogo(authCompany.id, file);
      setLogoUrl(url);
      await refreshCompany();
      toast.success('Logo aggiornato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel caricamento del logo');
    } finally {
      setUploadingLogo(false);
      event.target.value = '';
    }
  };

  const handleRecordUpdate = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const goTo = (key: TabKey) => {
    setActiveTab(key);
  };

  // Trigger nascosto: triplo click sul sottotitolo sblocca la generazione automatica.
  const handleSecretClick = () => {
    if (secretTimerRef.current) {
      window.clearTimeout(secretTimerRef.current);
      secretTimerRef.current = null;
    }
    secretClicksRef.current += 1;
    if (secretClicksRef.current >= 3) {
      secretClicksRef.current = 0;
      setAutoUnlocked(true);
      return;
    }
    secretTimerRef.current = window.setTimeout(() => {
      secretClicksRef.current = 0;
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (secretTimerRef.current) {
        window.clearTimeout(secretTimerRef.current);
        secretTimerRef.current = null;
      }
    };
  }, []);

  const statCards: { label: string; value: React.ReactNode; icon: LucideIcon; tone: string; tile: string }[] = [
    {
      label: 'Registri totali',
      value: statsLoading ? '—' : stats.total,
      icon: ClipboardList,
      tone: 'text-primary',
      tile: 'bg-primary/10 text-primary',
    },
    {
      label: 'Questo mese',
      value: statsLoading ? '—' : stats.thisMonth,
      icon: TrendingUp,
      tone: 'text-success',
      tile: 'bg-success/10 text-success',
    },
    {
      label: "Quest'anno",
      value: statsLoading ? '—' : stats.thisYear,
      icon: Archive,
      tone: 'text-info',
      tile: 'bg-info/10 text-info',
    },
    {
      label: 'Ultimo registro',
      value: stats.lastRecord ? new Date(stats.lastRecord).toLocaleDateString('it-IT') : 'Nessuno',
      icon: Clock,
      tone: 'text-warning',
      tile: 'bg-warning/10 text-warning',
    },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'daily':
        return <HaccpForm company={companyInfo} onRecordSaved={handleRecordUpdate} />;
      case 'auto':
        return <AutoGenerator company={companyInfo} onGenerationComplete={handleRecordUpdate} />;
      case 'archive':
        return <RecordsList company={companyInfo} refreshTrigger={refreshTrigger} />;
      case 'ingresso':
        return <IncomingFoods />;
      case 'cloud':
        return <DocumentsArchive />;
      case 'semilavorati':
        return <Semilavorati />;
      case 'firma-osa':
        return <OsaSignature />;
      case 'allergeni':
        return <Allergeni />;
      case 'infestanti':
        return <PestControl initialToken={pestToken} onTokenConsumed={() => setPestToken(null)} />;
      case 'stampanti':
        return <PrinterManager />;
      case 'abbonamento':
        return <Billing />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan-500 text-primary-foreground shadow-glow">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-bold tracking-tight sm:text-base">Sistema HACCP</h1>
              <p className="hidden cursor-default select-none text-xs text-muted-foreground sm:block" onClick={handleSecretClick}>
                Gestione Automatizzata Registri
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <div className="hidden items-center gap-2.5 rounded-full border border-border/70 bg-card py-1.5 pl-1.5 pr-3.5 md:flex">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo azienda" className="h-7 w-7 rounded-full object-contain" />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-accent-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
              )}
              <div className="leading-tight">
                <div className="max-w-[180px] truncate text-xs font-semibold">{companyInfo.name || '—'}</div>
                <div className="text-[11px] text-muted-foreground">P.IVA {companyInfo.piva || '—'}</div>
              </div>
            </div>
            <PushBell companyId={authCompany?.id ?? null} />
            <Button
              variant={showSettings ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowSettings((v) => !v)}
              title="Impostazioni azienda"
              aria-label="Impostazioni azienda"
            >
              <Settings />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => signOut()} title="Esci" aria-label="Esci">
              <LogOut />
            </Button>
          </div>
        </div>

        {/* Navigazione desktop */}
        <nav className="hidden border-t border-border/60 lg:block">
          <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => goTo(item.key)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-200',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  ].join(' ')}
                >
                  <item.icon className="h-4 w-4" />
                  {item.short}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        {/* Intestazione sezione */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{activeItem.label}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{activeItem.description}</p>
          </div>
          {autoUnlocked && (
            <Badge variant="secondary" className="gap-1.5">
              <Zap className="h-3 w-3" />
              Modalità avanzata attiva
            </Badge>
          )}
        </div>

        {/* Impostazioni azienda */}
        {showSettings && (
          <Card className="mb-6 animate-slide-up border-border/70 shadow-card">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </span>
                Informazioni Azienda
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                Chiudi
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="companyName" className="field-label">
                    Nome azienda
                  </Label>
                  <Input
                    id="companyName"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="companyPiva" className="field-label">
                    P.IVA
                  </Label>
                  <Input
                    id="companyPiva"
                    value={profileForm.piva}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, piva: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyAddress" className="field-label">
                  Indirizzo (opzionale)
                </Label>
                <Input
                  id="companyAddress"
                  value={profileForm.address}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyLogo" className="field-label">
                  Logo aziendale (PNG/JPG)
                </Label>
                <div className="flex items-center gap-3">
                  {logoUrl && <img src={logoUrl} alt="Anteprima logo" className="h-10 w-10 rounded-lg border border-border/70 object-contain" />}
                  <Input
                    id="companyLogo"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    className="flex-1"
                  />
                  {uploadingLogo && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                </div>
              </div>
              <Button onClick={saveCompanyInfo} disabled={savingProfile}>
                {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                Salva impostazioni
              </Button>

              <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Stampanti ed etichette</p>
                  <p className="text-xs text-muted-foreground">
                    Collega le stampanti del ristorante e configura i formati delle etichette.
                  </p>
                </div>
                <Button variant="outline" onClick={() => { setShowSettings(false); setActiveTab('stampanti'); }}>
                  <Printer className="h-4 w-4" />
                  Gestisci stampanti
                </Button>
              </div>

              <PushSettingsRow companyId={authCompany?.id ?? null} />
            </CardContent>
          </Card>
        )}

        {/* Installazione PWA / attivazione notifiche (compare solo se utile) */}
        <PwaInstallBanner companyId={authCompany?.id ?? null} />

        {/* Statistiche: su mobile restano nella sezione iniziale per non rubare spazio alle altre */}
        <div className={cn('mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', activeTab !== 'daily' && 'hidden lg:grid')}>
          {statCards.map((s) => (
            <Card key={s.label} className="hover-lift border-border/70 shadow-card">
              <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{s.label}</p>
                  {statsLoading ? (
                    <Skeleton className="mt-2 h-7 w-14" />
                  ) : (
                    <p className={`mt-1 truncate text-xl font-bold sm:text-2xl ${s.tone}`}>{s.value}</p>
                  )}
                </div>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${s.tile} sm:h-11 sm:w-11`}>
                  <s.icon className="h-5 w-5" />
                </span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Contenuto sezione */}
        <div key={activeTab} className="animate-fade-in">
          <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>}>
            {renderContent()}
          </Suspense>
        </div>
      </main>

      {/* ── Navigazione mobile ───────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div
          ref={mobileNavRef}
          className="flex items-stretch gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                ref={active ? activeNavRef : undefined}
                type="button"
                onClick={() => goTo(item.key)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={[
                  'relative flex min-h-[58px] min-w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium leading-none transition-colors active:scale-95',
                  active ? 'text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                <span className={['grid h-8 w-11 place-items-center rounded-full transition-colors', active ? 'bg-primary/10' : ''].join(' ')}>
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="max-w-[64px] truncate">{item.short}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
