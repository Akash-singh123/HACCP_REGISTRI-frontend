import { test, expect } from '@playwright/test';
import { mockBackend } from './helpers';

test.describe('Accesso e navigazione', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('il form di accesso è attivo quando il backend è configurato', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Backend non configurato')).toHaveCount(0);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeEnabled();
  });

  test('credenziali rifiutate dal server mostrano il messaggio di errore', async ({ page }) => {
    // Rotta più specifica registrata dopo il mock generico: ha la precedenza.
    await page.route('**/functions/v1/auth-login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Credenziali non valide' }),
      })
    );

    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('tizio@ristorante.it');
    await page.getByLabel('Password', { exact: true }).fill('Password1!');
    await page.getByRole('button', { name: 'Accedi' }).click();

    await expect(page.getByText('Credenziali non valide')).toBeVisible();
  });

  test('la registrazione richiede una password robusta e coincidente', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('tab', { name: 'Registrati' }).click();

    const submit = page.getByRole('button', { name: /Registrati e/ });

    await page.getByLabel('Nome del ristorante').fill('Ristorante Da Mario');
    await page.getByLabel('Email di accesso').fill('mario@ristorante.it');
    await page.getByLabel('Password', { exact: true }).fill('debole');
    await page.getByLabel('Conferma password').fill('debole');
    await expect(submit).toBeDisabled();

    await page.getByLabel('Password', { exact: true }).fill('Password1!');
    await expect(submit).toBeDisabled(); // conferma ancora diversa

    await page.getByLabel('Conferma password').fill('Password1!');
    await expect(submit).toBeEnabled();
  });

  test('una rotta protetta reindirizza al login', async ({ page }) => {
    await page.goto('/firma-osa');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('una rotta inesistente mostra la pagina 404', async ({ page }) => {
    await page.goto('/percorso-inesistente');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('Page Not Found')).toBeVisible();
  });
});
