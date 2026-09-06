import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";

export default defineConfig({
  plugins: [
    /*
     * O macro do Lingui roda no Babel, dentro do plugin do React. É ele que
     * transforma `<Trans>` e `` t`...` `` em mensagens ICU em tempo de build —
     * por isso o runtime é pequeno: nada de análise de mensagem no navegador.
     */
    react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    lingui()
  ],
  /*
   * Absoluta, e nao "./".
   *
   * O comentario anterior dizia "Tauri loads the build from disk" e era heranca
   * do Tauri v1. No v2 nenhuma plataforma usa file://: desktop serve por
   * tauri://localhost ou http://tauri.localhost, e o Android por
   * WebViewAssetLoader com o manipulador na RAIZ. O template oficial do Tauri v2
   * nem define `base`, ou seja, usa o padrao "/" do Vite.
   *
   * Verificado em execucao: app construido com "/" e aberto; uma sonda de rede
   * disparada pelo bundle foi recebida, provando que o JS executou na WebView.
   *
   * Com "./" qualquer rota aninhada quebra — o navegador procura o bundle em
   * /rota/assets/ e recebe o proprio HTML pelo fallback de SPA.
   */
  base: "/",
  build: {
    outDir: "dist",
    target: "chrome110",
    sourcemap: false,
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
