import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Mandar e-mail.
 *
 * Tudo o que depende de QUEM manda está nas variáveis de ambiente, e nenhuma
 * linha de código muda para trocar de provedor. Duas formas de entrar no Gmail,
 * das quais basta uma:
 *
 * 1. SENHA DE APP (a mais simples). Com a verificação em duas etapas ligada na
 *    conta Google, gera-se uma senha de 16 letras em
 *    myaccount.google.com/apppasswords e ela vai em SMTP_PASS:
 *
 *      SMTP_HOST=smtp.gmail.com   SMTP_PORT=465
 *      SMTP_USER=voce@gmail.com   SMTP_PASS=abcdabcdabcdabcd
 *      MAIL_FROM="WhatsCord <voce@gmail.com>"
 *
 * 2. OAUTH2 (um app criado no Google Cloud). Em vez de SMTP_PASS:
 *
 *      GMAIL_CLIENT_ID=...  GMAIL_CLIENT_SECRET=...  GMAIL_REFRESH_TOKEN=...
 *
 * Sem nenhuma das duas, `emailConfigurado` é falso e o "esqueci a senha"
 * responde que o envio não está ligado — em vez de fingir que mandou.
 */

export const emailConfigurado = Boolean(
  env.SMTP_HOST &&
    env.SMTP_USER &&
    (env.SMTP_PASS || (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN))
);

let transporte: Transporter | null = null;

function montarTransporte(): Transporter {
  const oauth = !env.SMTP_PASS && env.GMAIL_CLIENT_ID;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    /*
     * 465 é TLS desde o primeiro byte; 587 começa em texto e sobe para TLS com
     * STARTTLS. Errar isto não dá erro claro: a conexão simplesmente fica
     * pendurada até o tempo limite. Por isso a porta decide sozinha, a menos
     * que SMTP_SECURE diga outra coisa.
     */
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: oauth
      ? {
          type: "OAuth2",
          user: env.SMTP_USER,
          clientId: env.GMAIL_CLIENT_ID,
          clientSecret: env.GMAIL_CLIENT_SECRET,
          refreshToken: env.GMAIL_REFRESH_TOKEN
        }
      : { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Um servidor de e-mail lento não pode prender a requisição de ninguém.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  });
}

/**
 * Manda uma mensagem. Lança se o envio falhar — quem chama decide o que fazer,
 * e no "esqueci a senha" a decisão é registrar e seguir, porque a resposta para
 * a pessoa já foi dada.
 */
export async function enviarEmail(msg: {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}): Promise<void> {
  if (!emailConfigurado) throw new Error("e-mail não configurado");
  transporte ??= montarTransporte();
  await transporte.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to: msg.para,
    subject: msg.assunto,
    text: msg.texto,
    html: msg.html
  });
}
