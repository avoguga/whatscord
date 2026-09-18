/**
 * Sair da chamada de verdade.
 *
 *   npx tsx tests/chamada.test.ts
 *
 * O defeito que gerou este arquivo, medido em produção com dois navegadores e a
 * API de administração do LiveKit: quatro minutos depois de a tela de chamada
 * fechar, `ListParticipants` ainda devolvia a pessoa como ACTIVE, publicando
 * áudio, enquanto `GET /calls/presence` já dizia que a sala estava vazia. O
 * aviso de saída é mandado pelo navegador de quem sai, e um navegador congelado
 * — aba em segundo plano, janela minimizada — o enfileira e nunca o entrega;
 * como o soquete dele continua aberto, nem o tempo limite do LiveKit derruba.
 *
 * A correção é o servidor expulsar. O risco dela é expulsar quem já VOLTOU, e é
 * essa decisão que este arquivo cobre — ela é pura de propósito, para caber num
 * teste sem rede.
 */
import {
  FOLGA_DE_ENTRADA_MS,
  deveExpulsar,
  entradaEmMs
} from "../apps/api/src/lib/expulsao.js";

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

function section(nome: string) {
  console.log(`\n${nome}`);
}

// ---------------------------------------------------------------------------
section("quando expulsar do LiveKit");

const SAIU_EM = Date.UTC(2026, 8, 18, 12, 0, 0);

check(
  "ninguém com essa identidade na sala: não há o que expulsar",
  deveExpulsar(null, SAIU_EM) === false
);
check(
  "a sessão entrou dez minutos antes de sair: é a que ficou presa, expulsa",
  deveExpulsar(SAIU_EM - 10 * 60_000, SAIU_EM) === true
);
check(
  "entrou um segundo antes (a folga exata): ainda é a antiga, expulsa",
  deveExpulsar(SAIU_EM - FOLGA_DE_ENTRADA_MS, SAIU_EM) === true
);

/*
 * O caso que impede a correção de virar um defeito pior. Sair e entrar de novo
 * depressa é o que mais se faz numa chamada: caiu o áudio, entra de novo; trocou
 * de aparelho; clicou errado. Uma expulsão atrasada derrubaria essa pessoa.
 */
check(
  "a sessão entrou DEPOIS do pedido de saída: já voltou, não expulsa",
  deveExpulsar(SAIU_EM + 2_000, SAIU_EM) === false
);
check(
  "entrou meio segundo depois, e o relógio do LiveKit só tem segundos: não expulsa",
  deveExpulsar(SAIU_EM - 500, SAIU_EM) === false
);
check(
  "empate dentro da folga: na dúvida não expulsa",
  deveExpulsar(SAIU_EM, SAIU_EM) === false
);
check("entrada ilegível não expulsa", deveExpulsar(Number.NaN, SAIU_EM) === false);
check("pedido ilegível não expulsa", deveExpulsar(SAIU_EM - 60_000, Number.NaN) === false);

// ---------------------------------------------------------------------------
section("o joinedAt do LiveKit, que vem em segundos e como bigint");

check("bigint de segundos vira milissegundos", entradaEmMs(1789743237n) === 1789743237000);
check("número de segundos também", entradaEmMs(1789743237) === 1789743237000);
check("ausente é nulo", entradaEmMs(undefined) === null && entradaEmMs(null) === null);
/*
 * Zero não é "entrou em 1970": é o campo vazio que o LiveKit manda para uma
 * sessão que ainda não terminou de entrar. Tratá-lo como data faria a conta
 * dizer "entrou há 56 anos" e a pessoa levaria a expulsão no meio da entrada.
 */
check("zero é ausente, e não 1970", entradaEmMs(0n) === null);
check("negativo é ausente", entradaEmMs(-5) === null);

// ---------------------------------------------------------------------------
section("as duas pontas juntas, como a rota usa");

const daSala = (joinedAt: bigint | null) => deveExpulsar(entradaEmMs(joinedAt), SAIU_EM);
check(
  "participante de antes da saída: expulsa",
  daSala(BigInt(Math.floor((SAIU_EM - 120_000) / 1000))) === true
);
check(
  "participante que entrou depois: fica",
  daSala(BigInt(Math.floor((SAIU_EM + 30_000) / 1000))) === false
);
check("sessão ainda entrando (joinedAt 0): fica", daSala(0n) === false);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) process.exit(1);
