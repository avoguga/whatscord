import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
