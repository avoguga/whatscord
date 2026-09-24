/**
 * "Esqueci a senha": as decisões, sem rede e sem banco.
 *
 * Pura de propósito, como `transmissao.ts` e `expulsao.ts`. Aqui mora o que é
 * delicado — quando um link ainda vale, quantos pedidos cabem, e o texto do
 * e-mail, que leva um nome escrito pela própria pessoa — e isso tem de poder
 * ser conferido por um teste que não sobe nada (`tests/senha.test.ts`).
 */

/**
 * Quanto tempo o link vale.
 *
 * Meia hora: o bastante para abrir o e-mail, achar na caixa de spam e trocar a
 * senha com calma; curto o bastante para um link esquecido numa caixa de
 * entrada antiga não continuar sendo uma chave da conta.
 */
export const VALIDADE_DO_LINK_MS = 30 * 60 * 1000;

/**
 * Quantos pedidos por conta, por hora.
 *
 * Não é para proteger quem pede: é para proteger a caixa de entrada de quem é
 * dono do e-mail. Sem teto, qualquer pessoa digitaria o e-mail de outra no
 * formulário e mandaria cem mensagens para ela — e o Gmail de onde saem as
 * mensagens passaria a ser tratado como remetente de spam.
 */
export const PEDIDOS_POR_HORA = 3;

/** O link ainda serve? Nunca usado e ainda dentro do prazo. */
export function redefinicaoValida(
  r: { expiresAt: Date; usedAt: Date | null } | null | undefined,
  agora: Date
): boolean {
  if (!r) return false;
  if (r.usedAt) return false;
  return r.expiresAt.getTime() > agora.getTime();
}

/** Cabe mais um pedido nesta hora? */
export function podePedirOutro(pedidosNaUltimaHora: number): boolean {
  if (!Number.isFinite(pedidosNaUltimaHora) || pedidosNaUltimaHora < 0) return false;
  return pedidosNaUltimaHora < PEDIDOS_POR_HORA;
}

/**
 * O endereço que vai no e-mail.
 *
 * `?reset=` segue o mesmo jeito dos outros links do app (`?join=` para espaço,
 * `?live=` para transmissão): consulta, não caminho, e aberto no navegador — que
 * é onde qualquer pessoa consegue chegar, com ou sem o app instalado.
 */
export function linkDeRedefinicao(baseDaWeb: string, token: string): string {
  return `${baseDaWeb.replace(/\/+$/, "")}/?reset=${encodeURIComponent(token)}`;
}

/**
 * Escapa texto para dentro de HTML.
 *
 * O nome que vai no e-mail é escrito pela própria pessoa, no perfil. Sem isto,
 * um nome como `<a href=...>` viraria um link de verdade dentro de um e-mail
 * que sai com o NOSSO remetente — exatamente o tipo de mensagem que as pessoas
 * foram ensinadas a confiar.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type Idioma = "pt" | "es" | "en";

/** Qualquer coisa fora dos três idiomas cai no português, que é o do público. */
export function idiomaDoEmail(valor: unknown): Idioma {
  return valor === "es" || valor === "en" || valor === "pt" ? valor : "pt";
}

const TEXTOS: Record<
  Idioma,
  {
    assunto: string;
    oi: (nome: string) => string;
    pedido: (usuario: string) => string;
    botao: string;
    prazo: string;
    naoFoiVoce: string;
  }
> = {
  pt: {
    assunto: "Redefinir sua senha do WhatsCord",
    oi: (n) => `Oi, ${n}.`,
    pedido: (u) =>
      `Alguém pediu para redefinir a senha da sua conta @${u} no WhatsCord. Se foi você, é só abrir o link abaixo:`,
    botao: "Criar uma senha nova",
    prazo: "O link vale por 30 minutos e só funciona uma vez.",
    naoFoiVoce: "Se não foi você, pode ignorar este e-mail — sua senha continua a mesma."
  },
  es: {
    assunto: "Restablecer tu contraseña de WhatsCord",
    oi: (n) => `Hola, ${n}.`,
    pedido: (u) =>
      `Alguien pidió restablecer la contraseña de tu cuenta @${u} en WhatsCord. Si fuiste tú, abre el enlace de abajo:`,
    botao: "Crear una contraseña nueva",
    prazo: "El enlace vale por 30 minutos y solo funciona una vez.",
    naoFoiVoce: "Si no fuiste tú, puedes ignorar este correo — tu contraseña sigue siendo la misma."
  },
  en: {
    assunto: "Reset your WhatsCord password",
    oi: (n) => `Hi, ${n}.`,
    pedido: (u) =>
      `Someone asked to reset the password for your account @${u} on WhatsCord. If it was you, open the link below:`,
    botao: "Choose a new password",
    prazo: "The link works for 30 minutes and only once.",
    naoFoiVoce: "If it wasn't you, you can ignore this email — your password stays the same."
  }
};

/**
 * O e-mail inteiro, nas duas formas.
 *
 * Texto E HTML, e não só HTML: há leitores de e-mail que mostram só o texto, e
 * filtros de spam desconfiam de mensagem que vem só em HTML. O link aparece por
 * extenso nos dois, para quem não confia em clicar em botão — e para quem
 * precisa copiar e colar no navegador de outro aparelho.
 */
export function montarEmailDeRedefinicao(dados: {
  nome: string;
  usuario: string;
  link: string;
  idioma: Idioma;
}): { assunto: string; texto: string; html: string } {
  const t = TEXTOS[dados.idioma] ?? TEXTOS.pt;
  const nome = dados.nome.trim() || dados.usuario;

  const texto = [t.oi(nome), "", t.pedido(dados.usuario), "", dados.link, "", t.prazo, "", t.naoFoiVoce].join(
    "\n"
  );

  const l = escaparHtml(dados.link);
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f0f2f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111b21">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:20px;font-weight:600">WhatsCord</p>
    <p style="margin:18px 0 8px;font-size:15px">${escaparHtml(t.oi(nome))}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escaparHtml(t.pedido(dados.usuario))}</p>
    <p style="margin:0 0 20px"><a href="${l}" style="display:inline-block;background:#00a884;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escaparHtml(t.botao)}</a></p>
    <p style="margin:0 0 6px;font-size:13px;color:#54656f">${escaparHtml(t.prazo)}</p>
    <p style="margin:0 0 18px;font-size:12px;color:#8696a0;word-break:break-all">${l}</p>
    <p style="margin:0;font-size:13px;color:#54656f">${escaparHtml(t.naoFoiVoce)}</p>
  </div>
</body></html>`;

  return { assunto: t.assunto, texto, html };
}
