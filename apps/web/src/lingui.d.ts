/**
 * O plugin do Lingui transforma `.po` em módulo na hora do build. Sem esta
 * declaração o TypeScript não sabe disso e recusa o import do catálogo.
 */
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
