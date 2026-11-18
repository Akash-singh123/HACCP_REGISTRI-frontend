import type { TeamRole } from './api';

/** Ruoli assegnabili tramite invito o cambio ruolo: il titolare resta unico. */
export const ASSIGNABLE_ROLES: TeamRole[] = ['admin', 'staff', 'viewer'];

/** Etichetta leggibile di un ruolo, condivisa tra squadra e accettazione invito. */
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Titolare',
  admin: 'Amministratore',
  staff: 'Operatore',
  viewer: 'Solo lettura',
};

export function teamRoleLabel(role: string): string {
  return TEAM_ROLE_LABEL[role as TeamRole] ?? role;
}

export function isAssignableRole(role: string): boolean {
  return ASSIGNABLE_ROLES.includes(role as TeamRole);
}

/**
 * Link di accettazione di un invito. Usato come alternativa quando l'email non
 * parte (es. servizio di posta non configurato): il titolare può inoltrarlo.
 */
export function inviteLink(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/invito?token=${encodeURIComponent(token)}`;
}
