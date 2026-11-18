// src/hooks/useHaccpQueries.ts
// HOOK DI LETTURA BASATI SU TANSTACK REACT QUERY.
//
// Incapsulano le letture del gestionale (registri, attrezzature, anagrafiche,
// allergeni, avvisi e modulo infestanti) in `useQuery`, offrendo cache
// condivisa, deduplicazione delle richieste e refetch controllato. Le chiavi
// provengono da `@/lib/queryKeys`, così le invalidazioni restano coerenti.
//
// Le letture dipendenti dalla sede attiva includono il `locationId` nella
// chiave: cambiando sede il dato viene richiesto di nuovo automaticamente.

import { useQuery } from '@tanstack/react-query';
import {
  activeData,
  api,
  type CompanyInvitation,
  type PestAnomaly,
  type PestArea,
  type PestAuditEntry,
  type PestCorrectiveAction,
  type PestStationType,
  type TeamMember,
} from '@/lib/api';
import { getEquipment, getRecords } from '@/lib/haccpUtils';
import { DOC_FOLDERS, readTextFile } from '@/lib/docs';
import { parseSemiRegistry, SEMI_REGISTRY_CSV } from '@/lib/registers';
import { useLocationsStore } from '@/store/locationsStore';
import { queryKeys } from '@/lib/queryKeys';

/** Registri giornalieri della sede attiva (con merge delle modifiche offline). */
export function useRecords() {
  const locationId = useLocationsStore((s) => s.activeId);
  return useQuery({
    queryKey: queryKeys.records(locationId),
    queryFn: () => getRecords(),
  });
}

/** Attrezzature di conservazione dell'azienda attiva. */
export function useEquipment() {
  return useQuery({
    queryKey: queryKeys.equipment(),
    queryFn: () => getEquipment(),
  });
}

/** Alimenti in ingresso della sede attiva. */
export function useIncomingFoods() {
  const locationId = useLocationsStore((s) => s.activeId);
  return useQuery({
    queryKey: queryKeys.incoming(locationId),
    queryFn: async () => (await activeData.incoming.list()).items,
  });
}

/** Lotti di semilavorato della sede attiva. */
export function useSemiBatches() {
  const locationId = useLocationsStore((s) => s.activeId);
  return useQuery({
    queryKey: queryKeys.semiBatches(locationId),
    queryFn: async () => (await activeData.semi.batches.list()).items,
  });
}

/** Registro degli abbattimenti termici della sede attiva. */
export function useBlastChillings() {
  const locationId = useLocationsStore((s) => s.activeId);
  return useQuery({
    queryKey: queryKeys.blast(locationId),
    queryFn: async () => (await activeData.blast.list()).items,
  });
}

/** Anagrafica fornitori dell'azienda. */
export function useSuppliers() {
  return useQuery({
    queryKey: queryKeys.suppliers(),
    queryFn: async () => (await activeData.suppliers.list()).items,
  });
}

/** Piano di sanificazione dell'azienda. */
export function useCleaningPlan() {
  return useQuery({
    queryKey: queryKeys.cleaningPlan(),
    queryFn: async () => (await activeData.cleaningPlan.list()).items,
  });
}

/** Sedi dell'azienda. */
export function useCompanyLocations() {
  return useQuery({
    queryKey: queryKeys.locations(),
    queryFn: async () => (await activeData.locations.list()).items,
  });
}

/** Schede allergene dei prodotti (per azienda e sede attiva). */
export function useAllergenTable(companyId: string | null) {
  const locationId = useLocationsStore((s) => s.activeId);
  return useQuery({
    queryKey: queryKeys.allergenTable(companyId ?? '', locationId),
    queryFn: async () =>
      (await api.allergenTable.list(companyId as string, locationId ?? undefined)).products,
    enabled: Boolean(companyId),
  });
}

/**
 * Avvisi del centro notifiche. `refetchInterval` abilita l'aggiornamento
 * periodico (usato dalla campanella); il polling è sospeso quando la scheda non
 * è visibile, come da default di React Query.
 */
export function useAlerts(companyId: string | null, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: queryKeys.alerts(companyId ?? ''),
    queryFn: () => api.alerts.list(companyId as string),
    enabled: Boolean(companyId),
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Elenco di una qualsiasi entità del modulo controllo infestanti (aree, tipi di
 * postazione, postazioni, prodotti…). Tutte le entità condividono la stessa
 * chiave `pest.list(companyId, entity)`, così i pannelli e i conteggi letti
 * altrove restano sincronizzati sulla medesima cache.
 */
export function usePestList<T>(companyId: string | null, entity: string) {
  return useQuery({
    queryKey: queryKeys.pest.list(companyId ?? '', entity),
    queryFn: async () => (await api.pest.list<T>(companyId as string, entity)).items,
    enabled: Boolean(companyId),
  });
}

/** Aree/zone del locale definite nel modulo controllo infestanti. */
export function usePestAreas(companyId: string | null) {
  return usePestList<PestArea>(companyId, 'areas');
}

/** Tipi di postazione definiti nel modulo controllo infestanti. */
export function usePestStationTypes(companyId: string | null) {
  return usePestList<PestStationType>(companyId, 'stationTypes');
}

/** Anomalie del modulo controllo infestanti. */
export function usePestAnomalies(companyId: string | null) {
  return usePestList<PestAnomaly>(companyId, 'anomalies');
}

/** Azioni correttive del modulo controllo infestanti. */
export function usePestCorrectiveActions(companyId: string | null) {
  return usePestList<PestCorrectiveAction>(companyId, 'correctiveActions');
}

/** Storico modifiche (audit log) del modulo controllo infestanti. */
export function usePestAudit(companyId: string | null, limit = 50) {
  return useQuery({
    queryKey: queryKeys.pest.audit(companyId ?? '', limit),
    queryFn: async () => (await api.pest.audit(companyId as string, limit)).items,
    enabled: Boolean(companyId),
  });
}

/** Sintesi del modulo controllo infestanti (postazioni, anomalie, documenti). */
export function usePestOverview(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.pest.overview(companyId ?? ''),
    queryFn: () => api.pest.overview(companyId as string),
    enabled: Boolean(companyId),
  });
}

/** Tipo di ritorno comodo per lo storico audit. */
export type PestAuditItems = PestAuditEntry[];

/** Collaboratori dell'azienda attiva. */
export function useTeamMembers(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.team.members(companyId ?? ''),
    queryFn: async (): Promise<TeamMember[]> => (await activeData.team.listMembers()).items,
    enabled: Boolean(companyId),
  });
}

/** Inviti in attesa dell'azienda attiva. */
export function useCompanyInvitations(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.team.invitations(companyId ?? ''),
    queryFn: async (): Promise<CompanyInvitation[]> => (await activeData.team.listInvitations()).items,
    enabled: Boolean(companyId),
  });
}

/** Voci del registro semilavorati (CSV su storage) dell'azienda attiva. */
export function useSemiRegistry(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.semiRegistry(companyId ?? ''),
    queryFn: async () => {
      const csvText = await readTextFile(DOC_FOLDERS.semilavorati, SEMI_REGISTRY_CSV);
      return csvText ? parseSemiRegistry(csvText) : [];
    },
    enabled: Boolean(companyId),
  });
}

/**
 * Storico dell'archiviazione e degli scarti delle scorte (audit trail), per
 * tipologia. `enabled` sospende la lettura finché il dialogo che lo mostra non
 * è aperto; la freschezza è azzerata perché lo storico va riletto a ogni
 * apertura (i nuovi movimenti devono comparire subito).
 */
export function useStockAudit(
  scope: 'all' | 'incoming_foods' | 'semi_product_batches',
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.stockAudit(scope),
    queryFn: async () =>
      (
        await activeData.stock.audit({
          entity: scope === 'all' ? undefined : scope,
          limit: 100,
        })
      ).items,
    enabled,
    staleTime: 0,
  });
}
