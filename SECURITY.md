# Sicurezza — Security by Design

Questo progetto è progettato assumendo che **il client sia compromesso**. Nessuna logica
proprietaria, segreto o regola di autorizzazione risiede nel frontend.

## Architettura

```
Browser (thin client)  ──JWT──►  Edge Function (guard.ts)  ──service_role──►  PostgreSQL (RLS)
      │                                  │
      │ solo anon key                    │ JWT + membership + ruolo + licenza + rate limit
      └─ nessun segreto                  └─ audit log append-only
```

| Livello | Responsabilità |
|---|---|
| `src/lib/supabaseClient.ts` | Client con **sola anon key**; invia il JWT utente ad ogni chiamata |
| `src/lib/api.ts` | Unico punto di accesso al backend; passa `x-company-id` |
| `src/lib/docs.ts` | Helper Storage: i file vivono su Supabase Storage sotto `<company_id>/...`, nessun segreto nel client |
| `supabase/functions/_shared/guard.ts` | **Cuore della sicurezza**: verifica JWT → appartenenza → ruolo → licenza → rate limit → audit |
| `supabase/functions/haccp-docs` | Archiviazione documenti su bucket privato `haccp-docs`, isolato per azienda (`path_company_id()`) |
| `supabase/migrations/002_rls_policies.sql` | RLS: nessun dato accessibile senza appartenenza + licenza attiva |

## Misure implementate

1. **Zero Trust Client** — ogni richiesta è rivalidata lato server (JWT, membership, ruolo, licenza).
2. **Protezione segreti** — la `service_role` vive solo nei Server Secrets di Supabase, usata
   esclusivamente dalle Edge Functions. Nel bundle pubblico c'è solo la `anon key`.
3. **Multi-tenancy** — isolamento per `company_id`; `is_member(company_id)` è l'unica porta d'accesso.
4. **Licenze/abbonamento** — `has_active_license(company_id, feature)` blocca le funzionalità non attive (HTTP 402).
5. **Rate limiting** — `check_rate_limit()` su ogni azione sensibile (HTTP 429).
6. **Audit log** — ogni scrittura è tracciata (utente, azienda, azione, entità).
7. **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy (`vercel.json`).
8. **Offuscamento** — `rollup-obfuscator` in build di produzione; `sourcemap: false`.
9. **Verifica automatica** — `scripts/security-check.mjs` blocca la pubblicazione se trova segreti o sourcemap;
   eseguito in CI (`.github/workflows/security.yml`).

## Dati pubblici (QR code)

La pagina `/allergeni` è **pubblica per design**: mostra solo la tabella allergeni, dati destinati
al cliente finale. Non espone logica né dati di altri tenant.

## Test di verifica

| # | Test | Come | Atteso |
|---|---|---|---|
| T1 | Nessun segreto nel bundle | `pnpm build && pnpm security-check` | ✅ Security check superato |
| T2 | Nessun sourcemap | ispezione `dist/` | nessun file `.map` |
| T3 | Accesso negato senza JWT | `POST /functions/v1/allergen-table` senza `Authorization` | `401 no_token` |
| T4 | Isolamento tenant | chiamata con `x-company-id` di un'azienda non propria | `403 not_member` |
| T5 | Licenza inattiva | azione con licenza scaduta/assente | `402 license_inactive` |
| T6 | Rate limit | >60 richieste/min sulla stessa azione | `429 rate_limited` |
| T7 | Allergeni non validi | `upsert` con allergene fuori dai 14 | `400 bad_allergens` |
| T8 | Ruolo insufficiente | `delete` con ruolo `staff` | `403 forbidden_role` |

### Esecuzione rapida (T3–T8)

```powershell
# T3 — nessun token
curl -i -X POST "$SUPABASE_URL/functions/v1/allergen-table" `
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" `
  -d '{"action":"list","company_id":"00000000-0000-0000-0000-000000000000"}'
```

## Setup

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
supabase functions deploy allergen-table generate-records-pdf haccp-data haccp-docs admin-clients
```

Le Edge Functions ricevono automaticamente `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`; non serve configurare altri segreti.

### Multi-tenancy e provisioning clienti

Un'unica applicazione serve N ristoranti. Ogni utente appartiene a una o più aziende tramite
`memberships`; i dati (registri, allegati, materie prime, semilavorati) sono isolati per
`company_id` via RLS. Il **branding** (nome, logo, piva, informazioni) è memorizzato su
`companies` e mostrato automaticamente in base all'azienda dell'utente loggato.

La creazione dei clienti avviene dall'**Edge Function `admin-clients`** (con `service_role`),
richiamabile solo dai **platform admin** abilitati a `/admin`. Per abilitare il primo platform
admin, dopo aver creato l'utente dalla Dashboard Supabase eseguire:

```sql
insert into public.platform_admins (user_id)
values ('<USER_ID>');
```

### Archiviazione documenti — Supabase Storage

Tutti i file (registri CSV/PDF, firma OSA, allegati) sono salvati nel bucket privato
`haccp-docs`, sotto il percorso `<company_id>/<cartella>/<file>`. L'isolamento è garantito dalle
policy RLS dello Storage tramite `path_company_id()`, oltre che dalle verifiche server-side in
`haccp-docs`. Il client non vede mai credenziali di archiviazione: passa solo il proprio JWT.

