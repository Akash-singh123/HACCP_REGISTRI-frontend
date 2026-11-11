import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { viteSourceLocator } from "@metagptx/vite-plugin-source-locator";
import { obfuscator } from "rollup-obfuscator";

// Software proprietario: il banner viene incorporato nel bundle di produzione
// e ne consente la tracciabilità in caso di copia non autorizzata.
const COPYRIGHT =
  "© " +
  new Date().getFullYear() +
  " Alimex — Tutti i diritti riservati. Software proprietario: copia, " +
  "distribuzione o riutilizzo non autorizzati sono vietati.";
const BUILD_ID = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === "production";

  return {
    // Impronta di build: la stessa stringa viene scritta nel bundle (define) e
    // nella shell HTML (plugin sotto). appGuard le confronta per rilevare
    // eventuali manomissioni o accostamenti di file di build diverse.
    define: {
      __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    plugins: [
      {
        name: "inject-app-build-id",
        transformIndexHtml(html) {
          return html.replace(/__APP_BUILD_ID__/g, BUILD_ID);
        },
      },
      // Il localizzatore del codice serve solo in sviluppo: in produzione non
      // deve esporre percorsi e numeri di riga del sorgente nel DOM.
      !isProd && viteSourceLocator({ prefix: "mgx" }),
      react(),
      isProd &&
        obfuscator({
          compact: true,
          simplify: true,
          stringArray: true,
          stringArrayThreshold: 1,
          stringArrayEncoding: ["base64"],
          stringArrayRotate: true,
          stringArrayIndexShift: true,
          stringArrayWrappersCount: 2,
          identifierNamesGenerator: "hexadecimal",
          deadCodeInjection: false,
          controlFlowFlattening: false,
          numbersToExpressions: true,
          splitStrings: true,
          splitStringsChunkLength: 12,
          transformObjectKeys: true,
          unicodeEscapeSequence: false,
          disableConsoleOutput: true,
        }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
    },
    esbuild: {
      // In produzione niente debugger e banner di copyright preservato.
      drop: isProd ? ["debugger"] : [],
      legalComments: "inline",
    },
    build: {
      // Mai pubblicare sorgenti o sourcemap: renderebbero il codice leggibile.
      sourcemap: false,
      minify: "esbuild",
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          banner: `/*! ${COPYRIGHT} | build ${BUILD_ID} */`,
          // Vendor splitting: i pacchetti di base, stabili nel tempo, finiscono
          // in chunk dedicati. Così un rilascio della sola logica applicativa
          // non invalida la cache del browser per React, Supabase e React Query.
          // Le librerie pesanti e opzionali (jspdf, qrcode, tesseract, recharts,
          // radix, icone) NON vengono forzate qui: restando raggiungibili solo
          // via import dinamici, Rollup le colloca in chunk caricati on demand.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            const p = id.replace(/\\/g, "/");
            if (
              /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(p)
            ) {
              return "vendor-react";
            }
            if (p.includes("/@supabase/")) return "vendor-supabase";
            if (p.includes("/@tanstack/")) return "vendor-query";
            return undefined;
          },
        },
      },
    },
  };
});
