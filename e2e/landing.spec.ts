import { test, expect } from '@playwright/test';
import { mockBackend } from './helpers';

test.describe('Landing pubblica', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto('/');
  });

  test('mostra la proposta di valore e le funzioni principali', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('La conformità HACCP');
    await expect(page.getByText('Registro temperature').first()).toBeVisible();
    await expect(page.getByText('Tabella allergeni').first()).toBeVisible();
  });

  test('mostra il prezzo del piano ricevuto dal backend', async ({ page }) => {
    await expect(page.locator('#prezzi').getByText(/29,00/)).toBeVisible();
  });

  test('il collegamento Accedi porta alla pagina di login', async ({ page }) => {
    await page.getByRole('link', { name: 'Accedi' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
  });
});
