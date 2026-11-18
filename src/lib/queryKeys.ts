// src/lib/queryKeys.ts
// FACTORY CENTRALIZZATA DELLE QUERY KEY.
//
// Le chiavi seguono una gerarchia coerente (dominio → entità → parametri) così
// che le invalidazioni mirate restino semplici ed evitino collisioni tra i
// moduli. Le letture dipendenti dalla sede attiva includono il `locationId`,
// mentre le anagrafiche a livello azienda (fornitori, sanificazione, sedi) non
// lo richiedono.

export const queryKeys = {
  // ── Registri e dati operativi (per sede) ──────────────────────────────────
  records: (locationId: string | null) => ['haccp', 'records', locationId] as const,
  incoming: (locationId: string | null) => ['haccp', 'incoming', locationId] as const,
  semiBatches: (locationId: string | null) => ['haccp', 'semi-batches', locationId] as const,
  blast: (locationId: string | null) => ['haccp', 'blast', locationId] as const,

  // ── Anagrafiche a livello azienda ─────────────────────────────────────────
  equipment: () => ['haccp', 'equipment'] as const,
  suppliers: () => ['haccp', 'suppliers'] as const,
  cleaningPlan: () => ['haccp', 'cleaning-plan'] as const,
  locations: () => ['haccp', 'locations'] as const,

  // ── Tabella allergeni (per azienda e sede) ────────────────────────────────
  allergenTable: (companyId: string, locationId: string | null) =>
    ['allergen-table', companyId, locationId] as const,

  // ── Centro avvisi (motore scadenze) ───────────────────────────────────────
  alerts: (companyId: string) => ['alerts', companyId] as const,

  // ── Squadra: collaboratori e inviti ───────────────────────────────────────
  team: {
    members: (companyId: string) => ['team', 'members', companyId] as const,
    invitations: (companyId: string) => ['team', 'invitations', companyId] as const,
  },

  // ── Registro semilavorati (file CSV su storage, per azienda) ──────────────
  semiRegistry: (companyId: string) => ['semi-registry', companyId] as const,

  // ── Storico archiviazione delle scorte (audit trail, per tipologia) ───────
  stockAudit: (scope: string) => ['stock', 'audit', scope] as const,

  // ── Modulo controllo infestanti ───────────────────────────────────────────
  pest: {
    overview: (companyId: string) => ['pest', 'overview', companyId] as const,
    /** Elenco di una qualsiasi entità del modulo (aree, postazioni, prodotti…). */
    list: (companyId: string, entity: string) => ['pest', 'list', companyId, entity] as const,
    audit: (companyId: string, limit: number) => ['pest', 'audit', companyId, limit] as const,
  },
} as const;
