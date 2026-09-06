import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import App from "./App";
import { ativarIdioma, preferenciaSalva } from "./lib/i18n";
import "./styles.css";

/*
 * O catálogo é carregado ANTES do primeiro render, e não durante.
 *
 * Se o app montasse antes, a primeira pintura sairia em inglês e trocaria de
 * idioma no quadro seguinte — o mesmo defeito do tema, só que em texto, que é
 * bem mais visível. O custo é um pedido a mais antes da tela aparecer; o
 * catálogo é pequeno e vai junto do bundle.
 */
void ativarIdioma(preferenciaSalva()).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <App />
      </I18nProvider>
    </StrictMode>
  );
});
