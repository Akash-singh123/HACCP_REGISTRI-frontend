import type { Page } from '@playwright/test';

/** Catalogo piani pubblico restituito dal backend simulato. */
export const PUBLIC_PLANS = {
  configured: true,
  trialDays: 7,
  features: ['Registri illimitati', 'Firme digitali', 'Esportazione PDF'],
  plan: {
    amount: 2900,
    currency: 'eur',
    interval: 'month',
    intervalCount: 1,
    productName: 'Alimex Pro',
  },
};

/**
 * Intercetta le chiamate alle Edge Function e restituisce risposte simulate.
 * Gli E2E devono restare deterministici e non toccare mai il backend reale:
 * senza questo mock l'app (configurata con credenziali fittizie) resterebbe
 * in attesa di una risposta da un host inesistente.
 */
export async function mockBackend(page: Page): Promise<void> {
  await page.route('**/functions/v1/**', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      action = undefined;
    }

    if (action === 'plans.list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PUBLIC_PLANS),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}
