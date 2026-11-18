import { describe, it, expect } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  TEAM_ROLE_LABEL,
  inviteLink,
  isAssignableRole,
  teamRoleLabel,
} from '@/lib/team';

describe('utenti e inviti - helper', () => {
  it('non rende assegnabile il ruolo di titolare', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('owner');
    expect(isAssignableRole('owner')).toBe(false);
    expect(isAssignableRole('admin')).toBe(true);
    expect(isAssignableRole('viewer')).toBe(true);
  });

  it('traduce i ruoli in etichette leggibili', () => {
    expect(teamRoleLabel('owner')).toBe('Titolare');
    expect(teamRoleLabel('staff')).toBe(TEAM_ROLE_LABEL.staff);
    // Un ruolo sconosciuto viene restituito così com'è, senza rompere l'interfaccia.
    expect(teamRoleLabel('sconosciuto')).toBe('sconosciuto');
  });

  it('costruisce il link di accettazione codificando il token', () => {
    expect(inviteLink('abc 123')).toContain('/invito?token=abc%20123');
  });
});
