// supabase/functions/label-ocr/index.ts
// Lettura assistita dell'etichetta di un prodotto tramite modello AI multimodale.
//
// PRIVACY: l'immagine ricevuta viene usata SOLO in memoria per la singola analisi
// e non viene mai salvata (nessun upload su Storage, nessuna scrittura su database,
// nessun log del contenuto). Terminata la richiesta l'immagine è irrecuperabile.
//
// SICUREZZA: la chiave del provider AI vive esclusivamente come secret della Edge
// Function e non è mai esposta al client. Il client è considerato non attendibile.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';

/** Limite prudenziale sul payload immagine (base64). ~6 MB di immagine reale. */
const MAX_BASE64_LENGTH = 8_000_000;

const SYSTEM_PROMPT = `Sei un assistente per la sicurezza alimentare (HACCP) che legge etichette di prodotti alimentari.
Analizza l'immagine e restituisci ESCLUSIVAMENTE un oggetto JSON valido con questa forma:
{
  "prodotto": string | null,
  "lotto": string | null,
  "scadenza": string | null,
  "fornitore": string | null,
  "altro": string | null,
  "confidenza": "alta" | "media" | "bassa"
}

Regole importanti:
- "prodotto": nome commerciale del prodotto così come stampato sull'etichetta.
- "lotto": il numero di lotto (spesso preceduto da "L", "LOT", "LOTTO", "BATCH"). Riporta solo il valore, senza l'etichetta.
- "scadenza": la data di scadenza o il termine minimo di conservazione (spesso preceduta da "SCAD", "DA CONSUMARE ENTRO", "TMC", "EXP"). Convertila SEMPRE nel formato ISO "YYYY-MM-DD". Se sull'etichetta c'è solo mese e anno, usa l'ultimo giorno del mese.
- "fornitore": nome del produttore, dello stabilimento o del marchio se leggibile.
- "altro": eventuali informazioni utili (numero di riconoscimento CE, peso, temperatura di conservazione). Massimo 120 caratteri.
- Non inventare mai un valore: se un dato non è visibile o non è leggibile, usa null.
- Non aggiungere testo fuori dal JSON.`;

interface OcrResult {
  prodotto: string | null;
  lotto: string | null;
  scadenza: string | null;
  fornitore: string | null;
  altro: string | null;
  confidenza: 'alta' | 'media' | 'bassa';
}

/** Converte date leggibili (gg/mm/aaaa, aaaa-mm-gg, "12 SET 2025") in ISO YYYY-MM-DD. */
function toIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const european = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(value);
  if (european) {
    const day = european[1].padStart(2, '0');
    const month = european[2].padStart(2, '0');
    const year = european[3].length === 2 ? `20${european[3]}` : european[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'n/a') return null;
  return text.slice(0, maxLength);
}

/** Normalizza e valida l'output del modello, scartando valori non plausibili. */
function normalize(raw: Record<string, unknown>): OcrResult {
  const confidenzaRaw = String(raw.confidenza ?? '').toLowerCase();
  const confidenza: OcrResult['confidenza'] =
    confidenzaRaw === 'alta' ? 'alta' : confidenzaRaw === 'media' ? 'media' : 'bassa';

  return {
    prodotto: cleanText(raw.prodotto ?? raw.nome ?? raw.product, 120),
    lotto: cleanText(raw.lotto ?? raw.lot ?? raw.batch, 60),
    scadenza: toIsoDate(cleanText(raw.scadenza ?? raw.expiry ?? raw.expiration, 40)),
    fornitore: cleanText(raw.fornitore ?? raw.supplier ?? raw.producer, 120),
    altro: cleanText(raw.altro ?? raw.other ?? raw.note, 160),
    confidenza,
  };
}

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) throw new HttpError(502, 'Risposta del modello non interpretabile', 'ocr_bad_response');
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      throw new HttpError(502, 'Risposta del modello non interpretabile', 'ocr_bad_response');
    }
  }
}

/** Chiama OpenAI (vision) e restituisce l'oggetto JSON già normalizzato. */
async function analyzeWithOpenAI(apiKey: string, base64: string, mimeType: string): Promise<OcrResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('[label-ocr] OpenAI error', response.status, detail.slice(0, 400));
    throw new HttpError(502, 'Il servizio di lettura etichette non è disponibile in questo momento', 'ocr_provider_error');
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? '';
  return normalize(extractJson(content));
}

/** Chiama Google Gemini (vision) e restituisce l'oggetto JSON già normalizzato. */
async function analyzeWithGemini(apiKey: string, base64: string, mimeType: string): Promise<OcrResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: SYSTEM_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 600, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('[label-ocr] Gemini error', response.status, detail.slice(0, 400));
    throw new HttpError(502, 'Il servizio di lettura etichette non è disponibile in questo momento', 'ocr_provider_error');
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return normalize(extractJson(content));
}

function resolveProvider(): { provider: 'openai' | 'gemini'; apiKey: string } | null {
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPENAI_KEY');
  if (openaiKey) return { provider: 'openai', apiKey: openaiKey };
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_AI_API_KEY');
  if (geminiKey) return { provider: 'gemini', apiKey: geminiKey };
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    // Rate limit stretto: ogni analisi ha un costo per il fornitore AI.
    const ctx: GuardContext = await guard(req, body, { rateLimit: { limit: 20, windowSeconds: 60 } });

    // Il servizio è riservato ai piani che includono il modulo HACCP.
    const { data: license, error: licErr } = await ctx.admin
      .from('licenses')
      .select('status, features, current_period_end')
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (licErr) throw new HttpError(500, 'Errore verifica licenza', 'license_error');

    const active =
      license &&
      ['trialing', 'active'].includes(license.status) &&
      (!license.current_period_end || new Date(license.current_period_end) > new Date()) &&
      ((license.features as string[]) ?? []).includes('haccp');
    if (!active) throw new HttpError(402, 'Licenza non attiva per questa funzionalità', 'license_inactive');

    const providerConfig = resolveProvider();
    if (!providerConfig) {
      // Nessuna chiave configurata: il frontend propone la scansione del codice a barre.
      throw new HttpError(
        501,
        'Lettura etichette non ancora configurata su questo server',
        'ocr_not_configured'
      );
    }

    const imageBase64 = String(body.imageBase64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
    const mimeType = String(body.mimeType ?? 'image/jpeg');
    if (!imageBase64) throw new HttpError(400, 'Immagine mancante', 'no_image');
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpError(413, 'Immagine troppo grande: scatta una foto a risoluzione più bassa', 'image_too_large');
    }
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mimeType)) {
      throw new HttpError(415, 'Formato immagine non supportato', 'unsupported_media');
    }

    const result =
      providerConfig.provider === 'openai'
        ? await analyzeWithOpenAI(providerConfig.apiKey, imageBase64, mimeType)
        : await analyzeWithGemini(providerConfig.apiKey, imageBase64, mimeType);

    await audit(ctx, 'label_ocr.analyze', 'incoming_food', undefined, {
      provider: providerConfig.provider,
      confidenza: result.confidenza,
    });

    // Nessuna immagine viene restituita o conservata: solo i campi estratti.
    return json({ result, provider: providerConfig.provider });
  } catch (err) {
    return errorResponse(err);
  }
});
