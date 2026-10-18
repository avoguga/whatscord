/**
 * Reuniões por link: o formato, o nome de quem entra sem conta, e quem é quem.
 *
 *   npx tsx tests/reuniao.test.ts
 */
import {
  NOME_MAXIMO,
  TETO_DA_REUNIAO,
  cabeNaReuniao,
  criarLimite,
  ehCodigoDeReuniao,
  ehConvidado,
  gerarCodigo,
  identidadeDeConvidado,
  nomeDeConvidado,
  reuniaoAtiva,
  salaDaReuniao
} from "../apps/api/src/lib/reuniao.js";
import { codigoColado, codigoDeReuniaoEm, iniciais } from "../apps/web/src/lib/linkDeReuniao.js";

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

// ---------------------------------------------------------------------------
section("o código do link");

const sempreZero = () => 0;
check("formato abc-defg-hij", gerarCodigo(sempreZero) === "aaa-aaaa-aaa");
let i = 0;
const emSequencia = (max: number) => i++ % max;
const seq = gerarCodigo(emSequencia);
check("usa as letras sorteadas, na ordem", seq === "abc-defg-hij", "abc-defg-hij", seq);
check("um código gerado passa na validação", ehCodigoDeReuniao(gerarCodigo((m) => Math.floor(Math.random() * m))));
check("maiúsculas não passam (o servidor nunca gera)", !ehCodigoDeReuniao("ABC-DEFG-HIJ"));
check("sem hífens não passa na rota", !ehCodigoDeReuniao("abcdefghij"));
check("número não passa", !ehCodigoDeReuniao("ab1-defg-hij"));
check("tamanho errado não passa", !ehCodigoDeReuniao("abc-def-hij"));
check("não-texto não passa", !ehCodigoDeReuniao(undefined));
check("sala própria no LiveKit", salaDaReuniao("x") === "meet_x");

// ---------------------------------------------------------------------------
section("o nome de quem entra sem conta");

check("nome normal fica", nomeDeConvidado("Maria Souza") === "Maria Souza");
check("espaços nas pontas saem", nomeDeConvidado("   Ana  ") === "Ana");
check("espaços repetidos viram um", nomeDeConvidado("Ana     Paula") === "Ana Paula");
check("vazio não é nome", nomeDeConvidado("") === null);
check("só espaço não é nome", nomeDeConvidado("     ") === null);
check("não-texto não é nome", nomeDeConvidado(42) === null && nomeDeConvidado(null) === null);
/*
 * Caracteres invisíveis de controle e de formatação — como o que inverte a
 * direção do texto — bagunçam a tela de todo mundo, ou escondem um nome dentro
 * de outro. Saem.
 */
check("caractere de controle sai", nomeDeConvidado("Ana\u0000Bia") === "AnaBia");
check("inversor de direção sai", nomeDeConvidado("Ana‮Bia") === "AnaBia");
check("quebra de linha vira espaço", nomeDeConvidado("Ana\nBia") === "Ana Bia");
const longo = "a".repeat(100);
check(`corta em ${NOME_MAXIMO}`, nomeDeConvidado(longo)?.length === NOME_MAXIMO);
const emojis = "😀".repeat(50);
const cortado = nomeDeConvidado(emojis)!;
check("corta contando emoji como uma letra, sem partir no meio", [...cortado].length === NOME_MAXIMO && !cortado.includes("�"));
check("acento fica", nomeDeConvidado("João Ação") === "João Ação");

// ---------------------------------------------------------------------------
section("convidado ou conta");

const g = identidadeDeConvidado("abc123");
check("convidado ganha o prefixo g_", g === "g_abc123");
check("e é reconhecido como convidado", ehConvidado(g));
check("o id de uma conta (cuid) não é convidado", !ehConvidado("cmtoqqf55001wph07qbc82616"));

// ---------------------------------------------------------------------------
section("a reunião ainda aceita gente?");

const agora = new Date("2026-10-18T12:00:00Z");
const amanha = new Date(agora.getTime() + 86_400_000);
check("aberta e dentro do prazo", reuniaoAtiva({ endedAt: null, expiresAt: amanha }, agora));
check("encerrada pelo anfitrião", !reuniaoAtiva({ endedAt: agora, expiresAt: amanha }, agora));
check("vencida", !reuniaoAtiva({ endedAt: null, expiresAt: new Date(agora.getTime() - 1) }, agora));

check("o teto de partida é 12", TETO_DA_REUNIAO === 12);
check("cabe com 11", cabeNaReuniao(11, 12, false));
check("não cabe com 12", !cabeNaReuniao(12, 12, false));
check("o anfitrião entra mesmo cheia", cabeNaReuniao(12, 12, true));
check("teto ilegível fecha", !cabeNaReuniao(0, Number.NaN, false));

// ---------------------------------------------------------------------------
section("o teto de tentativas");

const pode = criarLimite(3, 60_000);
const t0 = 1_000_000;
check("1ª passa", pode("ip", t0));
check("2ª passa", pode("ip", t0 + 1));
check("3ª passa", pode("ip", t0 + 2));
check("4ª dentro da janela não passa", !pode("ip", t0 + 3));
check("outro endereço tem a própria conta", pode("outro", t0 + 3));
check("depois da janela, volta a passar", pode("ip", t0 + 60_001));

// ---------------------------------------------------------------------------
section("o cliente lendo o link");

check("lê ?call=", codigoDeReuniaoEm("?call=abc-defg-hij") === "abc-defg-hij");
check("convive com outros parâmetros", codigoDeReuniaoEm("?x=1&call=abc-defg-hij") === "abc-defg-hij");
check("maiúscula vira minúscula", codigoDeReuniaoEm("?call=ABC-DEFG-HIJ") === "abc-defg-hij");
check("lixo é descartado", codigoDeReuniaoEm("?call=<script>") === null);
check("sem call, nada", codigoDeReuniaoEm("?join=abc123") === null);

check("colar só o código", codigoColado("abc-defg-hij") === "abc-defg-hij");
check("colar o link inteiro", codigoColado("https://x.dev/?call=abc-defg-hij") === "abc-defg-hij");
check("colar sem hífens, como quem ouviu", codigoColado("abcdefghij") === "abc-defg-hij");
check("colar com espaço em volta", codigoColado("  abc-defg-hij  ") === "abc-defg-hij");
check("colar outra coisa", codigoColado("oi tudo bem") === null);

check("iniciais de nome e sobrenome", iniciais("maria souza") === "MS");
check("iniciais de um nome só", iniciais("Ana") === "A");
check("iniciais de nada", iniciais("   ") === "?");

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) process.exit(1);
