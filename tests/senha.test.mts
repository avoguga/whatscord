/**
 * "Esqueci a senha": o que decide, sem rede.
 *
 *   npx tsx tests/senha.test.mts
 *
 * O envio de verdade depende das credenciais do Gmail no servidor. O que dá
 * para conferir sem elas é tudo o que vem antes: quando um link vale, quantos
 * pedidos cabem, e o e-mail em si — que carrega um nome escrito pela própria
 * pessoa e por isso tem de sair escapado.
 */
import nodemailer from "nodemailer";
import {
  PEDIDOS_POR_HORA,
  VALIDADE_DO_LINK_MS,
  escaparHtml,
  idiomaDoEmail,
  linkDeRedefinicao,
  montarEmailDeRedefinicao,
  podePedirOutro,
  redefinicaoValida
} from "../apps/api/src/lib/redefinirSenha.js";
import { tokenDeSenhaEm } from "../apps/web/src/lib/linkDeSenha.js";

let passed = 0;
const failures: string[] = [];
function check(desc: string, ok: boolean, esperado?: unknown, obtido?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${desc}`);
  } else {
    failures.push(desc);
    console.log(`  FALHOU ${desc}${esperado !== undefined ? ` — esperado ${esperado}, obtido ${obtido}` : ""}`);
  }
}
const section = (n: string) => console.log(`\n${n}`);

const agora = new Date("2026-09-24T12:00:00Z");
const depois = (ms: number) => new Date(agora.getTime() + ms);

// ---------------------------------------------------------------------------
section("quando o link ainda vale");

check("vale por 30 minutos", VALIDADE_DO_LINK_MS === 30 * 60 * 1000);
check("dentro do prazo e nunca usado: vale", redefinicaoValida({ expiresAt: depois(60_000), usedAt: null }, agora));
check("já usado: não vale, mesmo no prazo", !redefinicaoValida({ expiresAt: depois(60_000), usedAt: agora }, agora));
check("vencido: não vale", !redefinicaoValida({ expiresAt: depois(-1), usedAt: null }, agora));
check("vence exatamente agora: não vale", !redefinicaoValida({ expiresAt: agora, usedAt: null }, agora));
check("pedido inexistente: não vale", !redefinicaoValida(null, agora));

// ---------------------------------------------------------------------------
section("quantos pedidos cabem por hora");

check("o teto é 3", PEDIDOS_POR_HORA === 3);
check("nenhum ainda: cabe", podePedirOutro(0));
check("dois: cabe o terceiro", podePedirOutro(2));
check("três: não cabe o quarto", !podePedirOutro(3));
check("número ilegível: não cabe", !podePedirOutro(Number.NaN));
check("negativo: não cabe", !podePedirOutro(-1));

// ---------------------------------------------------------------------------
section("o link");

check(
  "aponta para o site, com ?reset=",
  linkDeRedefinicao("https://exemplo.dev", "abc") === "https://exemplo.dev/?reset=abc"
);
check(
  "a barra final da base não duplica",
  linkDeRedefinicao("https://exemplo.dev/", "abc") === "https://exemplo.dev/?reset=abc"
);
check(
  "o token vai codificado",
  linkDeRedefinicao("https://x.dev", "a b&c") === "https://x.dev/?reset=a%20b%26c"
);

// ---------------------------------------------------------------------------
section("idioma");

check("pt fica pt", idiomaDoEmail("pt") === "pt");
check("es fica es", idiomaDoEmail("es") === "es");
check("en fica en", idiomaDoEmail("en") === "en");
check("desconhecido cai no português", idiomaDoEmail("fr") === "pt");
check("ausente cai no português", idiomaDoEmail(undefined) === "pt");

// ---------------------------------------------------------------------------
section("o e-mail — e o nome escrito pela pessoa");

check("escapa as cinco perigosas", escaparHtml(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");

/*
 * O caso que o escape existe para barrar: um nome de perfil que, sem escape,
 * viraria um link clicável dentro de um e-mail que sai com o NOSSO remetente.
 */
const malicioso = montarEmailDeRedefinicao({
  nome: `<a href="https://golpe.example">Clique</a>`,
  usuario: "fulano",
  link: "https://whatscord.dev/?reset=TOKEN123",
  idioma: "pt"
});
check("o nome não vira tag no HTML", !malicioso.html.includes(`<a href="https://golpe.example">`));
check("ele aparece escapado", malicioso.html.includes("&lt;a href=&quot;https://golpe.example&quot;&gt;"));
check("o único link é o nosso", (malicioso.html.match(/<a /g) ?? []).length === 1);

const normal = montarEmailDeRedefinicao({
  nome: "Alisson",
  usuario: "vieiraguitar",
  link: "https://whatscord.dev/?reset=TOKEN123",
  idioma: "pt"
});
check("assunto em português", normal.assunto === "Redefinir sua senha do WhatsCord");
check("cumprimenta pelo nome", normal.texto.startsWith("Oi, Alisson."));
check("cita a conta, para a pessoa saber qual", normal.texto.includes("@vieiraguitar"));
check("o link vai por extenso no texto", normal.texto.includes("https://whatscord.dev/?reset=TOKEN123"));
check("e no HTML, no botão", normal.html.includes(`href="https://whatscord.dev/?reset=TOKEN123"`));
check("avisa o prazo", normal.texto.includes("30 minutos"));
check("diz o que fazer se não foi você", normal.texto.includes("pode ignorar"));

const semNome = montarEmailDeRedefinicao({ nome: "  ", usuario: "fulano", link: "x", idioma: "en" });
check("sem nome, cumprimenta pelo usuário", semNome.texto.startsWith("Hi, fulano."));

// ---------------------------------------------------------------------------
section("a mensagem montada de verdade pelo nodemailer");

/*
 * `jsonTransport` monta a mensagem inteira — cabeçalhos, as duas partes, a
 * codificação — sem abrir conexão com ninguém. É a prova de que o que
 * `enviarEmail` entrega ao Gmail é uma mensagem válida, antes de haver Gmail.
 */
const transporte = nodemailer.createTransport({ jsonTransport: true });
const info = await transporte.sendMail({
  from: "WhatsCord <remetente@gmail.com>",
  to: "vieiraguitar.contact@gmail.com",
  subject: normal.assunto,
  text: normal.texto,
  html: normal.html
});
const montada = JSON.parse(String(info.message));
check("destinatário certo", montada.to?.[0]?.address === "vieiraguitar.contact@gmail.com");
check("remetente com nome", montada.from?.name === "WhatsCord");
check("leva texto e HTML", Boolean(montada.text) && Boolean(montada.html));
check("o assunto sobrevive à codificação", montada.subject === "Redefinir sua senha do WhatsCord");

// ---------------------------------------------------------------------------
section("o cliente lendo o link do e-mail");

const TOKEN_REAL = "Qh3kL9xZ_2mN-pR7tV4wY8bC1dF6gJ0sA5eH3iK2lMn"; // 43 chars, como o servidor gera
check("lê o token do ?reset=", tokenDeSenhaEm(`?reset=${TOKEN_REAL}`) === TOKEN_REAL);
check("aceita sem o ?", tokenDeSenhaEm(`reset=${TOKEN_REAL}`) === TOKEN_REAL);
check("convive com outros parâmetros", tokenDeSenhaEm(`?join=abc123&reset=${TOKEN_REAL}`) === TOKEN_REAL);
check("sem reset, nada", tokenDeSenhaEm("?join=abc123") === null);
check("curto demais, descarta", tokenDeSenhaEm("?reset=abc") === null);
check("com caractere estranho, descarta", tokenDeSenhaEm(`?reset=${TOKEN_REAL}<script>`) === null);
check("vazio, nada", tokenDeSenhaEm("") === null);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) process.exit(1);
