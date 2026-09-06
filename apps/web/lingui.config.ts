import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

/**
 * Catálogos de tradução.
 *
 * Inglês é o idioma-fonte: é nele que as strings estão escritas dentro do
 * código, então `en` nunca precisa ser traduzido — sai do próprio JSX. Português
 * e espanhol são os catálogos de verdade.
 *
 * Formato `po` e não `json`: é o formato que todo tradutor humano e toda
 * ferramenta de tradução já lê, guarda o comentário de contexto ao lado da
 * frase e marca sozinho o que ficou obsoleto. JSON não faz nada disso.
 */
export default defineConfig({
  locales: ["en", "pt", "es"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["<rootDir>/src/**/*.{ts,tsx}"]
    }
  ],
  /*
   * `lineNumbers: false` de propósito: com eles ligados, mexer numa linha
   * qualquer de um componente reescreve o número em todas as mensagens abaixo,
   * e o diff do catálogo fica ilegível — some a tradução que mudou de verdade
   * no meio de centenas de linhas de ruído.
   */
  format: formatter({ lineNumbers: false })
});
