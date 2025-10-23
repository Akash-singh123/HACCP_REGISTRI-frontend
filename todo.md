Piano di sviluppo Web App HACCP
Obiettivo
Creare una web app per la gestione automatizzata dei registri HACCP con interfaccia pulita e responsive.

File da creare/modificare (max 8 file):
src/pages/Index.tsx - Homepage principale con dashboard
src/components/HaccpForm.tsx - Form per compilazione giornaliera registri
src/components/AutoGenerator.tsx - Componente per generazione automatica registri
src/components/RecordsList.tsx - Lista e consultazione registri salvati
src/components/SignaturePad.tsx - Componente per firma digitale OSA
src/lib/haccpUtils.ts - Utilities per generazione temperature, PDF export, localStorage
src/types/haccp.ts - Tipi TypeScript per i dati HACCP
index.html - Aggiornamento titolo e meta
Funzionalità implementate:
1. Compilazione giornaliera
Form con campi: temperature (frigo 0-4°C, congelatore -18/-22°C), pulizie (OK/Non OK), note, firma OSA
Validazione dati e salvataggio localStorage
2. Generazione automatica
Input: data inizio, data fine, firma OSA
Generazione automatica temperature nei range HACCP
Creazione registri per ogni giorno del periodo
3. Esportazione e archiviazione
Visualizzazione registri per giorno/mese/anno
Export PDF singolo giorno
Export PDF mensile
Export ZIP multipli mesi
Layout identico ai modelli forniti
4. Interfaccia
Design responsive con shadcn-ui
Dashboard con statistiche
Navigazione intuitiva tra sezioni
Archiviazione automatica per data
Struttura dati localStorage:
haccp_records: array registri giornalieri
haccp_signatures: firme OSA salvate
haccp_settings: impostazioni azienda