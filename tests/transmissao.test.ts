/**
 * Quem pode assistir, e quem aparece na vitrine.
 *
 *   npx tsx tests/transmissao.test.ts
 *
 * Duas perguntas diferentes que é tentador tratar como uma só — e tratá-las
 * como uma só é o que vaza uma transmissão privada. Quem tem o código PODE
 * assistir; a transmissão dele NÃO PODE aparecer na tela de início de ninguém,
 * senão o código deixa de ser segredo no instante em que alguém abre o app.
 */
import {
  TETO_DE_ESPECTADORES,
  apareceNoInicio,
  cabeMaisUm,
  comparaCodigo,
  estaNoAr,
  podeAssistir,
  salaDaTransmissao,
  type Transmissao
} from "../apps/api/src/lib/transmissao.js";

let passed = 0;
const failures: string[] = [];

function check(desc: string, ok: boolean, esperado?: unknown, obtido?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${desc}`);
  } else {
    failures.push(desc);
    console.log(
      `  FALHOU ${desc}${esperado !== undefined ? ` — esperado ${esperado}, obtido ${obtido}` : ""}`
    );
  }
}

const section = (nome: string) => console.log(`\n${nome}`);

const DONO = "u_dono";
const OUTRO = "u_outro";
const CODIGO = "1c04fc9588";

const publica: Transmissao = {
  ownerId: DONO,
  visibility: "PUBLIC",
  spaceId: null,
  inviteCode: CODIGO
};
const doEspaco: Transmissao = {
  ownerId: DONO,
  visibility: "SPACE",
  spaceId: "sp_1",
  inviteCode: CODIGO
};
const porLink: Transmissao = {
  ownerId: DONO,
  visibility: "LINK",
  spaceId: null,
  inviteCode: CODIGO
};

const estranho = { userId: OUTRO, ehMembroDoEspaco: false };
const membro = { userId: OUTRO, ehMembroDoEspaco: true };
const dono = { userId: DONO, ehMembroDoEspaco: false };

// ---------------------------------------------------------------------------
section("pública — é para quem tem conta");

check("qualquer pessoa autenticada assiste", podeAssistir(publica, estranho) === true);
check("o dono assiste", podeAssistir(publica, dono) === true);
check("sem usuário, não", podeAssistir(publica, { userId: "", ehMembroDoEspaco: false }) === false);

// ---------------------------------------------------------------------------
section("de espaço — é para quem já está no espaço");

check("membro do espaço assiste", podeAssistir(doEspaco, membro) === true);
check("quem não é do espaço NÃO assiste", podeAssistir(doEspaco, estranho) === false);
check("o dono assiste mesmo sem ser listado como membro", podeAssistir(doEspaco, dono) === true);
/*
 * Só acontece se o CHECK do banco for burlado. Diante de um estado que não devia
 * existir, a saída segura é fechar a porta — não abri-la porque "o espaço é nulo
 * e nulo não bate com nada".
 */
check(
  "SPACE sem espaço nenhum fecha a porta, não abre",
  podeAssistir({ ...doEspaco, spaceId: null }, membro) === false
);

// ---------------------------------------------------------------------------
section("por link — é para quem tem o código");

check("com o código certo, assiste", podeAssistir(porLink, { ...estranho, codigo: CODIGO }) === true);
check("com o código errado, não", podeAssistir(porLink, { ...estranho, codigo: "0000000000" }) === false);
check("sem código nenhum, não", podeAssistir(porLink, estranho) === false);
check("código nulo não vira passe livre", podeAssistir(porLink, { ...estranho, codigo: null }) === false);
check("prefixo certo não basta", podeAssistir(porLink, { ...estranho, codigo: "1c04fc95" }) === false);
/*
 * O dono precisa entrar na própria transmissão sem carregar o próprio código.
 * Sem esta regra, abrir a tela do que você mesmo está transmitindo dependeria de
 * você ter o link à mão.
 */
check("o dono entra sem apresentar código", podeAssistir(porLink, dono) === true);

// ---------------------------------------------------------------------------
section("visibilidade que este servidor não conhece");

check(
  "valor desconhecido fecha (servidor novo escrevendo, servidor velho lendo)",
  podeAssistir({ ...publica, visibility: "QUALQUER" as never }, estranho) === false
);

// ---------------------------------------------------------------------------
section("a vitrine — assistir e aparecer não são a mesma pergunta");

check("pública aparece para todo mundo", apareceNoInicio(publica, estranho) === true);
check("de espaço aparece para o membro", apareceNoInicio(doEspaco, membro) === true);
check("de espaço NÃO aparece para quem é de fora", apareceNoInicio(doEspaco, estranho) === false);
check(
  "por link NÃO aparece nem para quem tem o código",
  apareceNoInicio(porLink, { ...estranho, codigo: CODIGO }) === false
);
check("por link aparece só para o próprio dono", apareceNoInicio(porLink, dono) === true);

// ---------------------------------------------------------------------------
section("comparação do código");

check("iguais", comparaCodigo(CODIGO, CODIGO) === true);
check("tamanhos diferentes", comparaCodigo(CODIGO, CODIGO + "a") === false);
check("um caractere diferente no fim", comparaCodigo(CODIGO, "1c04fc9589") === false);
check("um caractere diferente no começo", comparaCodigo(CODIGO, "2c04fc9588") === false);
check("vazio", comparaCodigo(CODIGO, "") === false);
check("não-texto", comparaCodigo(CODIGO, undefined) === false);

// ---------------------------------------------------------------------------
section("está no ar?");

const t0 = new Date("2026-09-18T12:00:00Z");
check("nunca começou", estaNoAr({ startedAt: null, endedAt: null }) === false);
check("começou e não terminou", estaNoAr({ startedAt: t0, endedAt: null }) === true);
check("começou e terminou", estaNoAr({ startedAt: t0, endedAt: t0 }) === false);

// ---------------------------------------------------------------------------
section("o teto de espectadores");

check("o teto de partida é 15", TETO_DE_ESPECTADORES === 15);
check("vazia, cabe", cabeMaisUm(0, 15, false) === true);
check("com 14, ainda cabe um", cabeMaisUm(14, 15, false) === true);
check("cheia, não cabe", cabeMaisUm(15, 15, false) === false);
check("passou do teto (teto baixado com gente dentro), não cabe", cabeMaisUm(20, 15, false) === false);
/*
 * Trancar o dono do lado de fora terminaria a transmissão de todo mundo — ele
 * não é mais um espectador, é a fonte.
 */
check("o dono entra mesmo com a sala cheia", cabeMaisUm(99, 15, true) === true);
check("teto zero fecha para espectador", cabeMaisUm(0, 0, false) === false);
check("teto zero não tranca o dono", cabeMaisUm(0, 0, true) === true);
check("teto ilegível fecha", cabeMaisUm(0, Number.NaN, false) === false);

// ---------------------------------------------------------------------------
section("o nome da sala no LiveKit");

check("prefixo próprio, separado do das chamadas", salaDaTransmissao("abc") === "stream_abc");
check(
  "não colide com o nome de uma sala de chamada",
  salaDaTransmissao("abc") !== `room_abc`
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) process.exit(1);
