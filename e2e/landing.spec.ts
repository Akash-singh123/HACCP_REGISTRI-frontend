import { test, expect } from '@playwright/test';
import { mockBackend } from './helpers';

test.describe('Sito pubblico', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('la homepage mostra la proposta di valore', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('La gestione della sicurezza alimentare');
    await expect(page.getByText('Tutto sotto controllo').first()).toBeVisible();
  });

  test('la pagina Prezzi mostra il piano ricevuto dal backend con IVA inclusa', async ({ page }) => {
    await page.goto('/prezzi');
    await expect(page.getByText(/29,00/)).toBeVisible();
    await expect(page.getByText('IVA inclusa', { exact: true })).toBeVisible();
  });

  test('la navigazione porta alla pagina Funzionalità', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Funzionalità' }).first().click();
    await expect(page).toHaveURL(/\/funzionalita$/);
  });

  test('il collegamento Accedi porta alla pagina di login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Accedi' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
  });
});
