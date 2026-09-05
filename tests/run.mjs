/**
 * Bateria de testes de integração contra a API WhatsCord em produção.
 *
 *   node tests/run.mjs                      # tudo
 *   node tests/run.mjs --only=realtime,dm   # só algumas seções
 *   WC_BASE=https://outra-api node tests/run.mjs
 *
 * Cada execução é independente: registra usuários novos com e-mail e username
 * aleatórios e cria as próprias salas, espaços e arquivos. Não lê nem apaga
 * nada de execuções anteriores, então pode rodar quantas vezes quiser, em
 * paralelo inclusive. Os dados ficam no banco (usuários descartáveis).
 *
 * Código de saída: 0 tudo passou · 1 houve FAIL · 2 a suíte não conseguiu rodar.
 */
import {
  BASE,
  GET,
  POST,
  PATCH,
  DEL,
  check,
  fail,
  pass,
  note,
  t,
  results,
  makeUser,
  connectSocket,
  short,
  sleep
} from "./helpers.mjs";

const state = {};

/* ================================================================== */
/* 1. Básico: registro, login, refresh, me, logout                     */
/* ================================================================== */

async function secBasico() {
  console.log("\n=== 1. Autenticação básica ===");

  const [A, B, C, D] = await Promise.all([
    makeUser("A"),
    makeUser("B"),
    makeUser("C"),
    makeUser("D")
  ]);
  Object.assign(state, { A, B, C, D });
  pass("registro de 4 usuários distintos (201 com user/accessToken/refreshToken)");

  await t("login", async () => {
    const r = await POST("/auth/login", { body: { identifier: A.email, password: A.password } });
    check(
      "login com e-mail e senha corretos",
      r.status === 200 && r.json?.accessToken,
      "200 com accessToken",
      short(r)
    );
  });

  await t("login username", async () => {
    const r = await POST("/auth/login", {
      body: { identifier: A.username, password: A.password }
    });
    check("login pelo username", r.status === 200 && r.json?.accessToken, "200", short(r));
  });

  await t("login username maiúsculo", async () => {
    const r = await POST("/auth/login", {
      body: { identifier: A.username.toUpperCase(), password: A.password }
    });
    check(
      "login pelo username em MAIÚSCULAS (deve normalizar)",
      r.status === 200,
      "200",
      short(r)
    );
  });

  await t("login e-mail maiúsculo", async () => {
    const r = await POST("/auth/login", {
      body: { identifier: A.email.toUpperCase(), password: A.password }
    });
    check("login com e-mail em MAIÚSCULAS", r.status === 200, "200", short(r));
  });

  await t("senha errada", async () => {
    const r = await POST("/auth/login", { body: { identifier: A.email, password: "errada12345" } });
    check("login com senha errada é rejeitado", r.status === 401, "401", short(r));
  });

  await t("usuário inexistente", async () => {
    const r = await POST("/auth/login", {
      body: { identifier: "nao-existe-mesmo@teste.dev", password: "qualquer123" }
    });
    check("login de usuário inexistente é rejeitado", r.status === 401, "401", short(r));
  });

  await t("username duplicado", async () => {
    const r = await POST("/auth/register", {
      body: {
        email: `outro-${Date.now()}@teste.dev`,
        username: A.username,
        displayName: "Clone",
        password: "senha-de-teste-123"
      }
    });
    check("registro com username duplicado é rejeitado", r.status === 409, "409", short(r));
  });

  await t("e-mail duplicado", async () => {
    const r = await POST("/auth/register", {
      body: {
        email: A.email,
        username: `zz${Date.now().toString(36)}`,
        displayName: "Clone",
        password: "senha-de-teste-123"
      }
    });
    check("registro com e-mail duplicado é rejeitado", r.status === 409, "409", short(r));
  });

  await t("e-mail duplicado com outra caixa", async () => {
    const r = await POST("/auth/register", {
      body: {
        email: A.email.toUpperCase(),
        username: `zy${Date.now().toString(36)}`,
        displayName: "Clone",
        password: "senha-de-teste-123"
      }
    });
    check(
      "registro com o mesmo e-mail em MAIÚSCULAS é rejeitado",
      r.status === 409,
      "409",
      short(r)
    );
  });

  for (const [desc, username] of [
    ["maiúscula", "TesteMaiusc"],
    ["espaço", "teste com espaco"],
    ["acento", "usuário"],
    ["curto demais (2 chars)", "ab"],
    ["vazio", ""]
  ]) {
    await t(`username ${desc}`, async () => {
      const r = await POST("/auth/register", {
        body: {
          email: `t-${Math.random().toString(36).slice(2, 9)}@teste.dev`,
          username,
          displayName: "Teste",
          password: "senha-de-teste-123"
        }
      });
      check(`registro com username com ${desc} é rejeitado`, r.status === 400, "400", short(r));
    });
  }

  await t("senha curta", async () => {
    const r = await POST("/auth/register", {
      body: {
        email: `t-${Math.random().toString(36).slice(2, 9)}@teste.dev`,
        username: `zx${Date.now().toString(36)}`,
        displayName: "Teste",
        password: "1234"
      }
    });
    check("registro com senha de 4 caracteres é rejeitado", r.status === 400, "400", short(r));
  });

  await t("me", async () => {
    const r = await GET("/auth/me", { token: A.token });
    check(
      "GET /auth/me devolve o próprio usuário",
      r.status === 200 && r.json?.user?.id === A.id,
      `200 com id ${A.id}`,
      short(r)
    );
    check(
      "GET /auth/me não vaza passwordHash nem email",
      !("passwordHash" in (r.json?.user ?? {})) && !("email" in (r.json?.user ?? {})),
      "sem passwordHash/email",
      JSON.stringify(Object.keys(r.json?.user ?? {}))
    );
  });

  await t("me sem token", async () => {
    const r = await GET("/auth/me");
    check("GET /auth/me sem token é 401", r.status === 401, "401", short(r));
  });

  await t("me com token inválido", async () => {
    const r = await GET("/auth/me", { token: "nao.e.um.jwt" });
    check("GET /auth/me com token inválido é 401", r.status === 401, "401", short(r));
  });

  await t("refresh", async () => {
    const r = await POST("/auth/refresh", { body: { refreshToken: D.refreshToken } });
    check(
      "refresh devolve novo par de tokens",
      r.status === 200 && r.json?.accessToken && r.json?.refreshToken,
      "200 com accessToken e refreshToken",
      short(r)
    );
    if (r.json?.accessToken) {
      const me = await GET("/auth/me", { token: r.json.accessToken });
      check("access token vindo do refresh funciona", me.status === 200, "200", short(me));
    }
    // reuso do refresh antigo (já rotacionado) deve falhar
    const reuse = await POST("/auth/refresh", { body: { refreshToken: D.refreshToken } });
    check(
      "reuso de refresh token já rotacionado é rejeitado",
      reuse.status === 401,
      "401",
      short(reuse)
    );
    if (r.json?.refreshToken) D.refreshToken = r.json.refreshToken;
  });

  await t("refresh inválido", async () => {
    const r = await POST("/auth/refresh", { body: { refreshToken: "lixo-total" } });
    check("refresh com token inválido é 401", r.status === 401, "401", short(r));
  });

  await t("logout", async () => {
    const r = await POST("/auth/logout", { body: { refreshToken: D.refreshToken }, token: D.token });
    check("logout responde ok", r.status === 200, "200", short(r));
    const after = await POST("/auth/refresh", { body: { refreshToken: D.refreshToken } });
    check(
      "refresh após logout é rejeitado",
      after.status === 401,
      "401",
      short(after)
    );
    const me = await GET("/auth/me", { token: D.token });
    if (me.status === 200) {
      note(
        "após o logout o access token antigo continua válido até expirar (JWT sem lista de revogação) — aceitável, mas registrado"
      );
    }
  });
}

/* ================================================================== */
/* 2. DMs                                                              */
/* ================================================================== */

async function secDm() {
  console.log("\n=== 2. DMs ===");
  const { A, B, C } = state;

  await t("abrir DM", async () => {
    const r = await POST("/rooms/dm", { token: A.token, body: { userId: B.id } });
    check(
      "A abre DM com B (201, created:true)",
      r.status === 201 && r.json?.created === true,
      "201 created:true",
      short(r)
    );
    state.dmAB = r.json?.room?.id;
  });

  await t("DM idempotente", async () => {
    const r = await POST("/rooms/dm", { token: A.token, body: { userId: B.id } });
    check(
      "abrir a mesma DM de novo devolve created:false",
      r.json?.created === false,
      "created:false",
      short(r)
    );
    check(
      "abrir a mesma DM de novo devolve a MESMA sala",
      r.json?.room?.id === state.dmAB,
      `room.id === ${state.dmAB}`,
      short(r)
    );
  });

  await t("DM pelo outro lado", async () => {
    const r = await POST("/rooms/dm", { token: B.token, body: { userId: A.id } });
    check(
      "B abrindo DM com A cai na mesma sala",
      r.json?.room?.id === state.dmAB && r.json?.created === false,
      `mesma sala ${state.dmAB}, created:false`,
      short(r)
    );
  });

  await t("DM consigo mesmo", async () => {
    const r = await POST("/rooms/dm", { token: A.token, body: { userId: A.id } });
    check("DM consigo mesmo é rejeitada", r.status === 400, "400", short(r));
  });

  await t("DM com id inexistente", async () => {
    const r = await POST("/rooms/dm", { token: A.token, body: { userId: "cl00000000000000000000000" } });
    check("DM com usuário inexistente é 404", r.status === 404, "404", short(r));
  });

  await t("DM sem userId", async () => {
    const r = await POST("/rooms/dm", { token: A.token, body: {} });
    check("DM sem userId é 400", r.status === 400, "400", short(r));
  });

  await t("DM em paralelo (corrida)", async () => {
    const [r1, r2] = await Promise.all([
      POST("/rooms/dm", { token: A.token, body: { userId: C.id } }),
      POST("/rooms/dm", { token: C.token, body: { userId: A.id } })
    ]);
    const ok = [r1, r2].every((r) => r.status === 200 || r.status === 201);
    check(
      "duas aberturas simultâneas da mesma DM não quebram (sem 500)",
      ok,
      "ambas 200/201",
      `r1=${short(r1)} | r2=${short(r2)}`
    );
    const ids = [r1.json?.room?.id, r2.json?.room?.id].filter(Boolean);
    if (ids.length === 2) {
      check(
        "duas aberturas simultâneas apontam para a mesma sala",
        ids[0] === ids[1],
        "mesmo roomId",
        ids.join(" != ")
      );
    }
    state.dmAC = ids[0];
  });

  await t("listar salas", async () => {
    const r = await GET("/rooms", { token: A.token });
    const found = r.json?.rooms?.find((x) => x.id === state.dmAB);
    check("GET /rooms lista a DM criada", Boolean(found), "a DM aparece na lista", short(r));
    if (found) {
      check(
        "a DM vem nomeada com o nome do outro participante",
        found.name === B.user.displayName,
        `name === "${B.user.displayName}"`,
        `name === "${found.name}"`
      );
    }
  });

  await t("GET /rooms/:id", async () => {
    const r = await GET(`/rooms/${state.dmAB}`, { token: A.token });
    check(
      "GET /rooms/:id devolve a sala com os 2 membros",
      r.status === 200 && r.json?.room?.members?.length === 2,
      "200 com 2 membros",
      short(r)
    );
  });
}

/* ================================================================== */
/* 3. Mensagens                                                        */
/* ================================================================== */

async function secMensagens() {
  console.log("\n=== 3. Mensagens ===");
  const { A, B } = state;
  const room = state.dmAB;

  await t("enviar", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "primeira mensagem" }
    });
    check(
      "enviar mensagem devolve 201 com a mensagem",
      r.status === 201 && r.json?.message?.id,
      "201 com message.id",
      short(r)
    );
    state.msg1 = r.json?.message?.id;
  });

  await t("listar", async () => {
    const r = await GET(`/rooms/${room}/messages`, { token: B.token });
    check(
      "B lista as mensagens da DM e vê a de A",
      r.status === 200 && r.json?.messages?.some((m) => m.id === state.msg1),
      "200 contendo a mensagem",
      short(r)
    );
  });

  await t("mensagem vazia", async () => {
    const r = await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: "" } });
    check("mensagem vazia sem anexo é rejeitada", r.status === 400, "400", short(r));
  });

  await t("mensagem só com espaços", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "     \n\t  " }
    });
    check("mensagem só com espaços é rejeitada", r.status === 400, "400", short(r));
  });

  await t("sem body", async () => {
    const r = await POST(`/rooms/${room}/messages`, { token: A.token });
    check(
      "POST de mensagem sem corpo é rejeitado com 4xx",
      r.status >= 400 && r.status < 500,
      "4xx",
      short(r)
    );
  });

  await t("editar própria", async () => {
    const r = await PATCH(`/messages/${state.msg1}`, {
      token: A.token,
      body: { content: "editada" }
    });
    check(
      "autor edita a própria mensagem",
      r.status === 200 && r.json?.message?.content === "editada",
      "200 com conteúdo novo",
      short(r)
    );
    check(
      "mensagem editada marca editedAt",
      Boolean(r.json?.message?.editedAt),
      "editedAt preenchido",
      String(r.json?.message?.editedAt)
    );
  });

  await t("editar de outro", async () => {
    const r = await PATCH(`/messages/${state.msg1}`, {
      token: B.token,
      body: { content: "invadida" }
    });
    check("editar mensagem de outro é 403", r.status === 403, "403", short(r));
  });

  await t("editar inexistente", async () => {
    const r = await PATCH("/messages/cl00000000000000000000000", {
      token: A.token,
      body: { content: "x" }
    });
    check("editar mensagem inexistente é 404", r.status === 404, "404", short(r));
  });

  await t("responder", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: B.token,
      body: { content: "respondendo", replyToId: state.msg1 }
    });
    check(
      "responder a uma mensagem preenche replyTo",
      r.status === 201 && r.json?.message?.replyTo?.id === state.msg1,
      "201 com replyTo.id",
      short(r)
    );
    state.reply = r.json?.message?.id;
  });

  await t("reagir", async () => {
    const r1 = await POST(`/messages/${state.msg1}/reactions`, {
      token: B.token,
      body: { emoji: "👍" }
    });
    check(
      "reagir adiciona a reação (added:true)",
      r1.status === 200 && r1.json?.added === true,
      "200 added:true",
      short(r1)
    );
    const r2 = await POST(`/messages/${state.msg1}/reactions`, {
      token: B.token,
      body: { emoji: "👍" }
    });
    check(
      "reagir de novo com o mesmo emoji remove (added:false)",
      r2.status === 200 && r2.json?.added === false,
      "200 added:false",
      short(r2)
    );
    const list = await GET(`/rooms/${room}/messages`, { token: B.token });
    const m = list.json?.messages?.find((x) => x.id === state.msg1);
    check(
      "após desreagir a mensagem fica sem reações",
      (m?.reactions?.length ?? 0) === 0,
      "reactions vazio",
      JSON.stringify(m?.reactions)
    );
  });

  await t("reagir em paralelo", async () => {
    const msg = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "alvo de reação concorrente" }
    });
    const id = msg.json?.message?.id;
    const [r1, r2] = await Promise.all([
      POST(`/messages/${id}/reactions`, { token: B.token, body: { emoji: "🔥" } }),
      POST(`/messages/${id}/reactions`, { token: B.token, body: { emoji: "🔥" } })
    ]);
    const statuses = `${r1.status}/${r2.status}`;
    check(
      "duas reações idênticas simultâneas não geram erro 500",
      r1.status < 500 && r2.status < 500,
      "nenhuma 5xx",
      `${short(r1)} || ${short(r2)}`
    );
    const list = await GET(`/rooms/${room}/messages`, { token: B.token });
    const m = list.json?.messages?.find((x) => x.id === id);
    const n = m?.reactions?.find((x) => x.emoji === "🔥")?.userIds?.length ?? 0;
    note(
      `reação concorrente: status ${statuses}, estado final = ${n} reação(ões) 🔥 na mensagem`
    );
    // Duas requisições de "adicionar" simultâneas (duplo clique / retry) não
    // podem se cancelar nem duplicar: o esperado é a reação ficar presente.
    check(
      "duas adições simultâneas da mesma reação terminam com a reação presente",
      n === 1,
      "1 reação no estado final",
      n === 0
        ? "0 — as duas adições se cancelaram (lost update do toggle read-then-write)"
        : `${n} — reação duplicada`
    );
  });

  await t("reagir emoji vazio", async () => {
    const r = await POST(`/messages/${state.msg1}/reactions`, { token: B.token, body: { emoji: "" } });
    check("reagir com emoji vazio é 400", r.status === 400, "400", short(r));
  });

  await t("deletar de outro", async () => {
    const r = await DEL(`/messages/${state.msg1}`, { token: B.token });
    check("deletar mensagem de outro é 403", r.status === 403, "403", short(r));
  });

  await t("deletar própria", async () => {
    const m = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "vou apagar essa" }
    });
    const id = m.json?.message?.id;
    const r = await DEL(`/messages/${id}`, { token: A.token });
    check("autor deleta a própria mensagem", r.status === 200, "200", short(r));

    const list = await GET(`/rooms/${room}/messages`, { token: A.token });
    const found = list.json?.messages?.find((x) => x.id === id);
    if (found) {
      check(
        "mensagem deletada volta na listagem com conteúdo vazio e deleted:true",
        found.deleted === true && found.content === "",
        "deleted:true e content vazio",
        JSON.stringify(found).slice(0, 160)
      );
      note("mensagens deletadas continuam aparecendo na listagem como tombstone (deleted:true)");
    } else {
      pass("mensagem deletada some da listagem");
    }
    const again = await DEL(`/messages/${id}`, { token: A.token });
    check(
      "deletar duas vezes a mesma mensagem não dá 500",
      again.status < 500,
      "<500",
      short(again)
    );
  });
}

/* ================================================================== */
/* 4. Paginação                                                        */
/* ================================================================== */

function paginationReport(label, sentIds, seen) {
  const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
  const missing = sentIds.filter((id) => !seen.includes(id));
  const extra = seen.filter((id) => !sentIds.includes(id));
  check(
    `${label}: nenhuma mensagem REPETIDA na paginação`,
    dupes.length === 0,
    "0 duplicadas",
    `${dupes.length} duplicadas (${[...new Set(dupes)].slice(0, 5).join(", ")})`
  );
  check(
    `${label}: nenhuma mensagem SUMIU na paginação`,
    missing.length === 0,
    "0 faltando",
    `${missing.length} faltando (${missing.slice(0, 5).join(", ")})`
  );
  if (extra.length) note(`${label}: ${extra.length} mensagens extras (de testes anteriores) na sala`);
}

async function pageAll(token, room, limit) {
  const seen = [];
  const pages = [];
  let cursor = null;
  for (let i = 0; i < 40; i++) {
    const qs = `limit=${limit}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`;
    const r = await GET(`/rooms/${room}/messages?${qs}`, { token });
    if (r.status !== 200) throw new Error(`paginação falhou: ${short(r)}`);
    const ids = r.json.messages.map((m) => m.id);
    pages.push(ids.length);
    seen.push(...ids);
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  return { seen, pages };
}

async function secPaginacao() {
  console.log("\n=== 4. Paginação ===");
  const { A, B } = state;

  // Sala nova e limpa, para o conjunto ser exatamente o que enviamos.
  const g = await POST("/rooms/group", {
    token: A.token,
    body: { name: "paginacao", memberIds: [B.id] }
  });
  const room = g.json.room.id;
  state.groupPag = room;

  const sentSeq = [];
  for (let i = 0; i < 60; i++) {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: `seq ${i}` }
    });
    if (r.status !== 201) throw new Error(`envio ${i} falhou: ${short(r)}`);
    sentSeq.push(r.json.message.id);
  }
  pass("60 mensagens enviadas em sequência");

  await t("paginação sequencial", async () => {
    const { seen, pages } = await pageAll(A.token, room, 20);
    note(`paginação limit=20 em 60 mensagens sequenciais: páginas ${pages.join("+")} = ${seen.length}`);
    paginationReport("60 mensagens sequenciais (limit=20)", sentSeq, seen);
  });

  await t("ordem cronológica", async () => {
    const r = await GET(`/rooms/${room}/messages?limit=30`, { token: A.token });
    const stamps = r.json.messages.map((m) => new Date(m.createdAt).getTime());
    const ascending = stamps.every((v, i) => i === 0 || v >= stamps[i - 1]);
    check(
      "cada página volta em ordem cronológica crescente",
      ascending,
      "createdAt não decrescente dentro da página",
      `${stamps.length} mensagens fora de ordem a partir do índice ${stamps.findIndex((v, i) => i > 0 && v < stamps[i - 1])}`
    );
    const tail = r.json.messages.map((m) => m.id);
    check(
      "a última página (sem before) traz as mensagens MAIS RECENTES",
      tail[tail.length - 1] === sentSeq[sentSeq.length - 1],
      `a última mensagem da página é a última enviada (${sentSeq[sentSeq.length - 1]})`,
      String(tail[tail.length - 1])
    );
  });

  await t("paginação limit=7", async () => {
    const { seen } = await pageAll(A.token, room, 7);
    paginationReport("mesmas 60 mensagens (limit=7)", sentSeq, seen);
  });

  // Rajada: mensagens em paralelo produzem timestamps idênticos ao milissegundo,
  // que é onde um cursor baseado em createdAt costuma quebrar.
  await t("paginação com rajada paralela", async () => {
    const burst = await POST("/rooms/group", {
      token: A.token,
      body: { name: "rajada", memberIds: [B.id] }
    });
    const r2 = burst.json.room.id;
    const sent = [];
    for (let b = 0; b < 4; b++) {
      const batch = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          POST(`/rooms/${r2}/messages`, { token: A.token, body: { content: `burst ${b}-${i}` } })
        )
      );
      for (const r of batch) {
        if (r.status === 201) sent.push(r.json.message.id);
      }
    }
    check("60 mensagens em rajada foram aceitas", sent.length === 60, "60 criadas", String(sent.length));

    const all = await GET(`/rooms/${r2}/messages?limit=100`, { token: A.token });
    const stamps = all.json.messages.map((m) => m.createdAt);
    const collisions = stamps.length - new Set(stamps).size;
    note(`rajada: ${collisions} mensagens compartilham timestamp com outra (colisões de createdAt)`);

    const { seen, pages } = await pageAll(A.token, r2, 10);
    note(`paginação limit=10 na rajada: páginas ${pages.join("+")} = ${seen.length} de ${sent.length}`);
    paginationReport("60 mensagens em rajada (limit=10)", sent, seen);
  });

  await t("limites de paginação", async () => {
    const zero = await GET(`/rooms/${room}/messages?limit=0`, { token: A.token });
    check("limit=0 é rejeitado com 400", zero.status === 400, "400", short(zero));
    const big = await GET(`/rooms/${room}/messages?limit=101`, { token: A.token });
    check("limit=101 é rejeitado com 400", big.status === 400, "400", short(big));
    const max = await GET(`/rooms/${room}/messages?limit=100`, { token: A.token });
    check("limit=100 é aceito", max.status === 200, "200", short(max));
    const neg = await GET(`/rooms/${room}/messages?limit=-5`, { token: A.token });
    check("limit=-5 é rejeitado com 400", neg.status === 400, "400", short(neg));
  });

  await t("cursor inválido", async () => {
    for (const [desc, value] of [
      ["texto solto", "nao-e-data"],
      ["só timestamp (formato antigo)", new Date().toISOString()],
      ["separador sem id", `${new Date().toISOString()}|`],
      ["data inválida com id", "2026-13-45T99:99:99.000Z|clabc"]
    ]) {
      const r = await GET(`/rooms/${room}/messages?before=${encodeURIComponent(value)}`, {
        token: A.token
      });
      check(`cursor malformado (${desc}) devolve 400`, r.status === 400, "400", short(r));
    }
  });

  await t("cursor bem formado com id inexistente", async () => {
    const r = await GET(
      `/rooms/${room}/messages?before=${encodeURIComponent(`${new Date().toISOString()}|cl00000000000000000000000`)}`,
      { token: A.token }
    );
    check(
      "cursor válido apontando para id inexistente não quebra",
      r.status === 200,
      "200",
      short(r)
    );
  });
}

/* ================================================================== */
/* 5. Autorização                                                      */
/* ================================================================== */

async function secAutorizacao() {
  console.log("\n=== 5. Autorização (C fora da sala) ===");
  const { A, C, D } = state;
  const room = state.dmAB;

  const cases = [
    ["ler mensagens da sala alheia", () => GET(`/rooms/${room}/messages`, { token: C.token })],
    [
      "postar na sala alheia",
      () => POST(`/rooms/${room}/messages`, { token: C.token, body: { content: "invadi" } })
    ],
    ["ver detalhes da sala alheia", () => GET(`/rooms/${room}`, { token: C.token })],
    ["marcar sala alheia como lida", () => POST(`/rooms/${room}/read`, { token: C.token, body: {} })],
    [
      "silenciar sala alheia",
      () => PATCH(`/rooms/${room}/mute`, { token: C.token, body: { muted: true } })
    ],
    [
      "adicionar membros na sala alheia",
      () => POST(`/rooms/${room}/members`, { token: C.token, body: { userIds: [D.id] } })
    ],
    ["pegar token de chamada da sala alheia", () => POST(`/rooms/${room}/call/token`, { token: C.token })],
    ["tocar a campainha na sala alheia", () => POST(`/rooms/${room}/call/ring`, { token: C.token })]
  ];

  for (const [desc, run] of cases) {
    await t(desc, async () => {
      const r = await run();
      const denied = r.status === 403 || r.status === 404;
      if (r.status >= 500) {
        fail(
          `C não consegue ${desc}`,
          "403 ou 404",
          `${short(r)} — negou, mas com erro de servidor`
        );
      } else {
        check(`C não consegue ${desc}`, denied, "403 ou 404", short(r));
      }
    });
  }

  await t("sair de sala alheia", async () => {
    const r = await DEL(`/rooms/${room}/members/me`, { token: C.token });
    check("C não consegue sair de uma sala em que nunca esteve (404)", r.status === 404, "404", short(r));
  });

  await t("verificar que C não alterou nada", async () => {
    const r = await GET(`/rooms/${room}`, { token: A.token });
    check(
      "a sala de A/B continua com 2 membros após as tentativas de C",
      r.json?.room?.members?.length === 2,
      "2 membros",
      String(r.json?.room?.members?.length)
    );
  });

  await t("sala inexistente", async () => {
    const r = await GET("/rooms/cl00000000000000000000000/messages", { token: A.token });
    check("ler mensagens de sala inexistente é 404", r.status === 404, "404", short(r));
  });

  await t("adicionar usuário inexistente ao grupo", async () => {
    const r = await POST(`/rooms/${state.groupPag}/members`, {
      token: A.token,
      body: { userIds: ["cl00000000000000000000000"] }
    });
    check(
      "adicionar usuário inexistente devolve 4xx, não 500",
      r.status < 500,
      "4xx",
      short(r)
    );
  });

  await t("membro comum adiciona gente no grupo", async () => {
    const { B } = state;
    const r = await POST(`/rooms/${state.groupPag}/members`, {
      token: B.token,
      body: { userIds: [D.id] }
    });
    if (r.status === 200) {
      note(
        "qualquer MEMBER de um grupo pode adicionar terceiros (não há checagem de role em POST /rooms/:id/members) — informativo"
      );
    }
    check("adicionar membro por um membro comum não quebra", r.status < 500, "<500", short(r));
  });

  await t("adicionar membro numa DM", async () => {
    const r = await POST(`/rooms/${state.dmAB}/members`, {
      token: A.token,
      body: { userIds: [D.id] }
    });
    check("não é possível adicionar gente numa DM", r.status === 400, "400", short(r));
  });
}

/* ================================================================== */
/* 6. Espaços                                                          */
/* ================================================================== */

async function secEspacos() {
  console.log("\n=== 6. Espaços ===");
  const { A, B, C } = state;

  await t("criar espaço", async () => {
    const r = await POST("/spaces", { token: A.token, body: { name: "Espaço de Teste" } });
    check(
      "criar espaço devolve 201 com inviteCode e 2 canais",
      r.status === 201 && r.json?.space?.inviteCode && r.json?.space?.channels?.length === 2,
      "201 com inviteCode e 2 canais",
      short(r)
    );
    state.space = r.json?.space;
    state.generalId = r.json?.space?.channels?.find((c) => c.kind === "TEXT")?.id;
  });

  await t("criar espaço sem nome", async () => {
    const r = await POST("/spaces", { token: A.token, body: { name: "" } });
    check("criar espaço sem nome é 400", r.status === 400, "400", short(r));
  });

  // Histórico anterior à entrada de B, para o teste de não lidas.
  await t("histórico no canal general", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(`/rooms/${state.generalId}/messages`, {
        token: A.token,
        body: { content: `histórico antigo ${i}` }
      });
    }
    pass("5 mensagens de histórico postadas antes de B entrar");
  });

  await t("entrar por código", async () => {
    const r = await POST(`/spaces/join/${state.space.inviteCode}`, { token: B.token });
    check("B entra no espaço pelo código", r.status === 200, "200", short(r));
  });

  await t("entrar duas vezes", async () => {
    const r = await POST(`/spaces/join/${state.space.inviteCode}`, { token: B.token });
    check("entrar duas vezes com o mesmo usuário é idempotente", r.status === 200, "200", short(r));
    const m = await GET(`/spaces/${state.space.id}/members`, { token: A.token });
    const bTimes = m.json?.members?.filter((x) => x.id === B.id).length ?? 0;
    check("B aparece uma única vez na lista de membros", bTimes === 1, "1", String(bTimes));
  });

  await t("código inválido", async () => {
    const r = await POST("/spaces/join/codigo-que-nao-existe", { token: C.token });
    check("entrar com código inválido é 404", r.status === 404, "404", short(r));
  });

  await t("B vê os canais", async () => {
    const r = await GET("/spaces", { token: B.token });
    const s = r.json?.spaces?.find((x) => x.id === state.space.id);
    check("B enxerga o espaço em GET /spaces", Boolean(s), "espaço na lista", short(r));
    check(
      "B enxerga os 2 canais do espaço",
      (s?.channels?.length ?? 0) === 2,
      "2 canais",
      String(s?.channels?.length)
    );
    check("B entra como MEMBER", s?.role === "MEMBER", "MEMBER", String(s?.role));
  });

  await t("A vê B nos membros", async () => {
    const r = await GET(`/spaces/${state.space.id}/members`, { token: A.token });
    check(
      "A vê B na lista de membros do espaço",
      r.json?.members?.some((m) => m.id === B.id),
      "B na lista",
      short(r)
    );
  });

  await t("canal como MEMBER", async () => {
    const r = await POST(`/spaces/${state.space.id}/channels`, {
      token: B.token,
      body: { name: "canal-do-membro" }
    });
    check("MEMBER não pode criar canal (403)", r.status === 403, "403", short(r));
  });

  await t("canal como OWNER", async () => {
    const r = await POST(`/spaces/${state.space.id}/channels`, {
      token: A.token,
      body: { name: "canal-do-dono" }
    });
    check("OWNER cria canal (201)", r.status === 201, "201", short(r));
    state.newChannel = r.json?.channel?.id;

    const bSpaces = await GET("/spaces", { token: B.token });
    const s = bSpaces.json?.spaces?.find((x) => x.id === state.space.id);
    check(
      "B recebe automaticamente o canal novo",
      s?.channels?.some((c) => c.id === state.newChannel),
      "canal novo na lista de B",
      JSON.stringify(s?.channels?.map((c) => c.name))
    );
    const post = await POST(`/rooms/${state.newChannel}/messages`, {
      token: B.token,
      body: { content: "oi do canal novo" }
    });
    check("B consegue postar no canal novo do espaço", post.status === 201, "201", short(post));
  });

  await t("não-membro no espaço", async () => {
    const r = await GET(`/spaces/${state.space.id}/members`, { token: C.token });
    check("C (fora do espaço) não lista membros", r.status === 404, "404", short(r));
    const ch = await POST(`/spaces/${state.space.id}/channels`, {
      token: C.token,
      body: { name: "invasao" }
    });
    check("C (fora do espaço) não cria canal", ch.status === 404 || ch.status === 403, "404/403", short(ch));
    const read = await GET(`/rooms/${state.generalId}/messages`, { token: C.token });
    check("C (fora do espaço) não lê o canal general", read.status === 404, "404", short(read));
  });
}

/* ================================================================== */
/* 7. Não lidas                                                        */
/* ================================================================== */

async function unreadOf(token, roomId) {
  const r = await GET("/rooms", { token });
  return r.json?.rooms?.find((x) => x.id === roomId)?.unread;
}

async function secNaoLidas() {
  console.log("\n=== 7. Não lidas ===");
  const { A, B } = state;

  // Sala limpa para contar do zero.
  const g = await POST("/rooms/group", {
    token: A.token,
    body: { name: "nao-lidas", memberIds: [B.id] }
  });
  const room = g.json.room.id;

  await t("contagem de não lidas", async () => {
    const zero = await unreadOf(B.token, room);
    check("sala nova começa com 0 não lidas", zero === 0, "0", String(zero));

    for (let i = 0; i < 3; i++) {
      await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: `nova ${i}` } });
    }
    const three = await unreadOf(B.token, room);
    check("após 3 mensagens de A, B tem unread=3", three === 3, "3", String(three));

    const own = await unreadOf(A.token, room);
    check("as próprias mensagens não contam como não lidas para o autor", own === 0, "0", String(own));
  });

  await t("marcar como lida", async () => {
    const r = await POST(`/rooms/${room}/read`, { token: B.token, body: {} });
    check("marcar como lida responde 200", r.status === 200, "200", short(r));
    const after = await unreadOf(B.token, room);
    check("após marcar lida, unread=0", after === 0, "0", String(after));
  });

  await t("não lidas voltam a subir", async () => {
    await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: "depois da leitura" } });
    const n = await unreadOf(B.token, room);
    check("mensagem nova após a leitura conta 1 não lida", n === 1, "1", String(n));
  });

  await t("não lidas ao entrar num espaço com histórico", async () => {
    const n = await unreadOf(B.token, state.generalId);
    note(
      `B entrou num espaço cujo canal #general já tinha 5 mensagens antigas e começou com unread=${n}`
    );
    check(
      "quem entra num espaço não herda o histórico inteiro como não lido",
      n === 0,
      "0 (o histórico anterior à entrada não deveria contar)",
      `${n} não lidas — todo o histórico anterior à entrada foi marcado como não lido`
    );
  });

  await t("mensagem deletada some das não lidas", async () => {
    const g2 = await POST("/rooms/group", {
      token: A.token,
      body: { name: "nao-lidas-2", memberIds: [B.id] }
    });
    const r2 = g2.json.room.id;
    const m = await POST(`/rooms/${r2}/messages`, { token: A.token, body: { content: "apagar" } });
    await DEL(`/messages/${m.json.message.id}`, { token: A.token });
    const n = await unreadOf(B.token, r2);
    check("mensagem apagada não fica contando como não lida", n === 0, "0", String(n));
  });

  await t("marcar lida com messageId", async () => {
    const g3 = await POST("/rooms/group", {
      token: A.token,
      body: { name: "read-com-id", memberIds: [B.id] }
    });
    const r3 = g3.json.room.id;
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const m = await POST(`/rooms/${r3}/messages`, { token: A.token, body: { content: `m${i}` } });
      ids.push(m.json.message.id);
    }
    check("3 mensagens não lidas antes de marcar", (await unreadOf(B.token, r3)) === 3, "3", String(await unreadOf(B.token, r3)));

    const r = await POST(`/rooms/${r3}/read`, { token: B.token, body: { messageId: ids[2] } });
    check("POST /rooms/:id/read com messageId responde 200", r.status === 200, "200", short(r));
    check(
      "após marcar lida com messageId, unread=0",
      (await unreadOf(B.token, r3)) === 0,
      "0",
      String(await unreadOf(B.token, r3))
    );

    // Marcar pela PRIMEIRA mensagem: o contrato documentado é "tudo até agora",
    // então isso zera mesmo. Registro para o caso de quererem leitura parcial.
    await POST(`/rooms/${r3}/messages`, { token: A.token, body: { content: "m3" } });
    await POST(`/rooms/${r3}/messages`, { token: A.token, body: { content: "m4" } });
    await POST(`/rooms/${r3}/read`, { token: B.token, body: { messageId: ids[0] } });
    const partial = await unreadOf(B.token, r3);
    note(
      `marcar lida citando a 1ª mensagem zerou o contador mesmo assim (unread=${partial}): messageId é só um marcador, não faz leitura parcial`
    );

    const foreign = await POST(`/rooms/${r3}/read`, {
      token: B.token,
      body: { messageId: state.msg1 }
    });
    if (foreign.status === 200) {
      note(
        "POST /rooms/:id/read aceita um messageId de OUTRA sala sem validar (grava como lastReadMessageId) — informativo"
      );
    }
    check("read com messageId de outra sala não quebra", foreign.status < 500, "<500", short(foreign));

    const bad = await POST(`/rooms/${r3}/read`, { token: B.token, body: { messageId: 12345 } });
    check("read com messageId não-string é rejeitado ou ignorado, sem 500", bad.status < 500, "<500", short(bad));
  });

  await t("silenciar", async () => {
    const r = await PATCH(`/rooms/${room}/mute`, { token: B.token, body: { muted: true } });
    check("silenciar a própria sala responde 200", r.status === 200, "200", short(r));
    const list = await GET("/rooms", { token: B.token });
    const found = list.json?.rooms?.find((x) => x.id === room);
    check("a sala volta marcada como muted", found?.muted === true, "muted:true", String(found?.muted));
    await PATCH(`/rooms/${room}/mute`, { token: B.token, body: { muted: false } });
  });
}

/* ================================================================== */
/* 8. Realtime                                                         */
/* ================================================================== */

async function secRealtime() {
  console.log("\n=== 8. Realtime ===");
  const { A, B, C } = state;
  const room = state.dmAB;

  const sockA = await connectSocket(A.token, "A");
  const sockB = await connectSocket(B.token, "B");
  const sockC = await connectSocket(C.token, "C");
  state.sockets = [sockA, sockB, sockC];
  // Guardados para a seção de idempotência, que roda depois desta.
  Object.assign(state, { sockA, sockB, sockC });
  pass("3 sockets autenticados conectaram");

  await t("socket sem token", async () => {
    try {
      await connectSocket("token-invalido", "X");
      fail("socket com token inválido é recusado", "connect_error", "conectou normalmente");
    } catch {
      pass("socket com token inválido é recusado");
    }
  });

  await sleep(600);
  sockA.clear();
  sockB.clear();
  sockC.clear();

  await t("message:new chega uma vez", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "mensagem em tempo real" }
    });
    const id = r.json?.message?.id;
    await sleep(1500);

    const bHits = sockB.of("message:new").filter((e) => e.payload?.id === id);
    check(
      "o destinatário recebe message:new exatamente UMA vez",
      bHits.length === 1,
      "1 evento",
      `${bHits.length} eventos`
    );

    const aHits = sockA.of("message:new").filter((e) => e.payload?.id === id);
    note(`o REMETENTE recebeu message:new da própria mensagem ${aHits.length} vez(es)`);
    check(
      "o remetente não recebe a própria mensagem duplicada (0 ou 1 evento)",
      aHits.length <= 1,
      "0 ou 1",
      `${aHits.length} eventos`
    );

    const cHits = sockC.of("message:new").filter((e) => e.payload?.id === id);
    check(
      "um usuário fora da sala NÃO recebe message:new",
      cHits.length === 0,
      "0 eventos",
      `${cHits.length} eventos — vazamento de mensagem`
    );
  });

  await t("message:update e message:delete", async () => {
    const r = await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: "ciclo" } });
    const id = r.json.message.id;
    await sleep(400);
    sockB.clear();
    await PATCH(`/messages/${id}`, { token: A.token, body: { content: "ciclo editado" } });
    await sleep(1200);
    check(
      "edição dispara message:update para o outro lado",
      sockB.of("message:update").some((e) => e.payload?.id === id),
      "1 message:update",
      String(sockB.countOf("message:update"))
    );
    sockB.clear();
    await DEL(`/messages/${id}`, { token: A.token });
    await sleep(1200);
    check(
      "remoção dispara message:delete para o outro lado",
      sockB.of("message:delete").some((e) => e.payload?.id === id),
      "1 message:delete",
      String(sockB.countOf("message:delete"))
    );
  });

  await t("room:new ao abrir DM", async () => {
    const { D } = state;
    sockB.clear();
    await POST("/rooms/dm", { token: D.token, body: { userId: B.id } });
    await sleep(1500);
    check(
      "abrir uma DM avisa o outro lado com room:new",
      sockB.countOf("room:new") >= 1,
      ">=1 room:new",
      String(sockB.countOf("room:new"))
    );
  });

  await t("room:read", async () => {
    sockA.clear();
    await POST(`/rooms/${room}/read`, { token: B.token, body: {} });
    await sleep(1200);
    check(
      "marcar como lida avisa a sala com room:read",
      sockA.countOf("room:read") >= 1,
      ">=1 room:read",
      String(sockA.countOf("room:read"))
    );
  });

  await t("typing", async () => {
    sockB.clear();
    sockA.socket.emit("typing:start", { roomId: room });
    await sleep(1200);
    check(
      "typing:start do outro participante chega",
      sockB.countOf("typing:start") === 1,
      "1 typing:start",
      String(sockB.countOf("typing:start"))
    );
    sockA.clear();
    sockA.socket.emit("typing:start", { roomId: room });
    await sleep(800);
    check(
      "quem digita não recebe o próprio typing:start",
      sockA.countOf("typing:start") === 0,
      "0",
      String(sockA.countOf("typing:start"))
    );
    sockB.clear();
    sockA.socket.emit("typing:stop", { roomId: room });
    await sleep(1000);
    check(
      "typing:stop chega no outro participante",
      sockB.countOf("typing:stop") === 1,
      "1 typing:stop",
      String(sockB.countOf("typing:stop"))
    );
  });

  await t("typing de quem não é da sala", async () => {
    sockB.clear();
    sockC.socket.emit("typing:start", { roomId: room });
    await sleep(1200);
    check(
      "C (fora da sala) não consegue injetar typing na sala de A/B",
      sockB.countOf("typing:start") === 0,
      "0 eventos",
      `${sockB.countOf("typing:start")} eventos — o socket aceita typing de qualquer um`
    );
  });

  await t("room:subscribe sem ser membro", async () => {
    sockC.clear();
    sockC.socket.emit("room:subscribe", { roomId: room });
    await sleep(800);
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "segredo entre A e B" }
    });
    const id = r.json?.message?.id;
    await sleep(1500);
    const leaked = sockC.of("message:new").filter((e) => e.payload?.id === id);
    check(
      "room:subscribe não deixa um estranho escutar sala alheia",
      leaked.length === 0,
      "0 eventos",
      `${leaked.length} eventos — C leu "${leaked[0]?.payload?.content ?? ""}" sem ser membro`
    );
  });

  await t("ex-membro continua escutando a sala", async () => {
    // C entra num grupo, sai, e tenta continuar escutando — pelo socket que já
    // estava aberto e por um socket novo que só chama room:subscribe.
    const g = await POST("/rooms/group", {
      token: A.token,
      body: { name: "grupo-saida", memberIds: [C.id] }
    });
    const gid = g.json.room.id;
    await sleep(800);

    const out = await DEL(`/rooms/${gid}/members/me`, { token: C.token });
    check("C consegue sair do grupo", out.status === 200, "200", short(out));

    const denied = await GET(`/rooms/${gid}/messages`, { token: C.token });
    check("depois de sair, C não lê o histórico por HTTP", denied.status === 404, "404", short(denied));

    sockC.clear();
    const m1 = await POST(`/rooms/${gid}/messages`, {
      token: A.token,
      body: { content: "conversa depois que C saiu" }
    });
    await sleep(1500);
    const stillOpen = sockC.of("message:new").filter((e) => e.payload?.id === m1.json?.message?.id);
    check(
      "o socket já aberto de um ex-membro para de receber message:new",
      stillOpen.length === 0,
      "0 eventos",
      `${stillOpen.length} eventos — o socket nunca sai do canal da sala ao perder a associação`
    );

    const fresh = await connectSocket(C.token, "C2");
    state.sockets.push(fresh);
    fresh.socket.emit("room:subscribe", { roomId: gid });
    await sleep(800);
    const m2 = await POST(`/rooms/${gid}/messages`, {
      token: A.token,
      body: { content: "segunda mensagem depois da saída" }
    });
    await sleep(1500);
    const resubscribed = fresh.of("message:new").filter((e) => e.payload?.id === m2.json?.message?.id);
    check(
      "socket novo de ex-membro não consegue reentrar na sala via room:subscribe",
      resubscribed.length === 0,
      "0 eventos",
      `${resubscribed.length} eventos — leu "${resubscribed[0]?.payload?.content ?? ""}" após ter saído`
    );
  });

  await t("presença", async () => {
    sockA.clear();
    sockC.clear();
    const { D } = state;
    const sockD = await connectSocket(D.token, "D");
    state.sockets.push(sockD);
    await sleep(1500);

    // A tem DM com D (aberta na seção anterior); C não compartilha sala nenhuma
    // com D. A presença tem que chegar só para A.
    const dPresence = sockA.of("presence:online").filter((e) => e.payload?.userId === D.id);
    check(
      "presence:online de D chega para A, que compartilha sala com D",
      dPresence.length >= 1,
      ">=1 presence:online",
      String(dPresence.length)
    );

    const cSaw = sockC.of("presence:online").filter((e) => e.payload?.userId === D.id);
    check(
      "presence:online de D NÃO chega para C, que não compartilha sala nenhuma",
      cSaw.length === 0,
      "0 eventos",
      `${cSaw.length} eventos — presença ainda vaza em broadcast global`
    );

    const presence = await POST("/users/presence", { token: A.token, body: { userIds: [D.id, B.id] } });
    check(
      "POST /users/presence marca D como online",
      presence.json?.online?.includes(D.id),
      "D na lista de online",
      short(presence)
    );

    sockA.clear();
    sockC.clear();
    sockD.socket.disconnect();
    await sleep(1800);
    check(
      "desconexão dispara presence:offline para quem compartilha sala",
      sockA.of("presence:offline").some((e) => e.payload?.userId === D.id),
      ">=1 presence:offline de D",
      String(sockA.countOf("presence:offline"))
    );
    check(
      "presence:offline de D NÃO chega para C",
      sockC.of("presence:offline").filter((e) => e.payload?.userId === D.id).length === 0,
      "0 eventos",
      String(sockC.of("presence:offline").filter((e) => e.payload?.userId === D.id).length)
    );
  });
}

/* ================================================================== */
/* 8b. Idempotência de envio (clientMsgId)                             */
/* ================================================================== */

async function secIdempotencia() {
  console.log("\n=== 8b. Idempotência (clientMsgId) ===");
  const { A, B } = state;
  const room = state.dmAB;
  const sockA = state.sockA;
  const sockB = state.sockB;
  const cid = () => `cmid-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;

  await t("envios simultâneos com o mesmo clientMsgId", async () => {
    const clientMsgId = cid();
    const [r1, r2] = await Promise.all([
      POST(`/rooms/${room}/messages`, {
        token: A.token,
        body: { content: "retry simultâneo", clientMsgId }
      }),
      POST(`/rooms/${room}/messages`, {
        token: A.token,
        body: { content: "retry simultâneo", clientMsgId }
      })
    ]);

    check(
      "nenhum dos dois envios simultâneos devolve 5xx",
      r1.status < 500 && r2.status < 500,
      "nenhuma 5xx",
      `${short(r1)} || ${short(r2)}`
    );

    const codes = [r1.status, r2.status].sort();
    check(
      "os dois envios simultâneos devolvem um 201 e um 200",
      codes[0] === 200 && codes[1] === 201,
      "200 e 201",
      codes.join(" e ")
    );

    const ids = [r1.json?.message?.id, r2.json?.message?.id];
    check(
      "os dois envios simultâneos apontam para a MESMA mensagem",
      ids[0] && ids[0] === ids[1],
      "mesmo message.id",
      ids.join(" != ")
    );

    const list = await GET(`/rooms/${room}/messages?limit=100`, { token: A.token });
    const copies = list.json.messages.filter((m) => m.content === "retry simultâneo");
    check(
      "só UMA mensagem foi criada no envio simultâneo",
      copies.length === 1,
      "1 mensagem",
      `${copies.length} mensagens`
    );
    state.dedupeId = ids[0];
  });

  await t("reenvio posterior do mesmo clientMsgId", async () => {
    const clientMsgId = cid();
    const first = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "envio único", clientMsgId }
    });
    check("primeiro envio devolve 201", first.status === 201, "201", short(first));

    const again = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "envio único", clientMsgId }
    });
    check("reenvio do mesmo clientMsgId devolve 200", again.status === 200, "200", short(again));
    check(
      "reenvio devolve a MESMA mensagem",
      again.json?.message?.id === first.json?.message?.id,
      `message.id === ${first.json?.message?.id}`,
      String(again.json?.message?.id)
    );

    // Um reenvio com conteúdo diferente não pode sobrescrever o original.
    const tampered = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "conteúdo trocado no retry", clientMsgId }
    });
    check(
      "reenvio com conteúdo diferente devolve a mensagem original, sem alterá-la",
      tampered.json?.message?.content === "envio único",
      '"envio único"',
      String(tampered.json?.message?.content)
    );

    const list = await GET(`/rooms/${room}/messages?limit=100`, { token: A.token });
    const copies = list.json.messages.filter((m) => m.content === "envio único");
    check("o reenvio não criou uma segunda mensagem", copies.length === 1, "1", String(copies.length));
  });

  await t("mesmo clientMsgId em outra sala", async () => {
    const clientMsgId = cid();
    const first = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "primeira sala", clientMsgId }
    });
    check("envio na primeira sala devolve 201", first.status === 201, "201", short(first));

    const other = await POST(`/rooms/${state.groupPag}/messages`, {
      token: A.token,
      body: { content: "outra sala", clientMsgId }
    });
    check(
      "o mesmo clientMsgId em OUTRA sala devolve 409",
      other.status === 409,
      "409",
      short(other)
    );

    const list = await GET(`/rooms/${state.groupPag}/messages?limit=100`, { token: A.token });
    check(
      "o 409 não deixou mensagem órfã na outra sala",
      !list.json.messages.some((m) => m.content === "outra sala"),
      "nenhuma mensagem criada",
      "a mensagem foi criada mesmo com 409"
    );
  });

  await t("clientMsgId é escopado por autor", async () => {
    const clientMsgId = cid();
    const fromA = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "de A", clientMsgId }
    });
    const fromB = await POST(`/rooms/${room}/messages`, {
      token: B.token,
      body: { content: "de B", clientMsgId }
    });
    check("A envia com o clientMsgId (201)", fromA.status === 201, "201", short(fromA));
    check(
      "B consegue enviar com o MESMO clientMsgId (escopo é por autor)",
      fromB.status === 201,
      "201",
      short(fromB)
    );
    check(
      "as duas mensagens são distintas",
      fromA.json?.message?.id !== fromB.json?.message?.id,
      "ids diferentes",
      `ambos ${fromA.json?.message?.id}`
    );
  });

  await t("socket no caminho de dedupe", async () => {
    sockB.clear();
    sockA.clear();
    const clientMsgId = cid();
    const body = { content: "dedupe no socket", clientMsgId };

    const first = await POST(`/rooms/${room}/messages`, { token: A.token, body });
    await sleep(1500);
    const id = first.json?.message?.id;
    const afterFirst = sockB.of("message:new").filter((e) => e.payload?.id === id).length;
    check(
      "o primeiro envio emite message:new uma vez",
      afterFirst === 1,
      "1 evento",
      `${afterFirst} eventos`
    );

    await POST(`/rooms/${room}/messages`, { token: A.token, body });
    await POST(`/rooms/${room}/messages`, { token: A.token, body });
    await sleep(1800);
    const total = sockB.of("message:new").filter((e) => e.payload?.id === id).length;
    check(
      "os reenvios deduplicados NÃO emitem message:new de novo",
      total === 1,
      "1 evento no total",
      `${total} eventos — o retry reemite a mensagem e o outro lado a vê duplicada`
    );
  });

  await t("validação do clientMsgId", async () => {
    const curto = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "id curto", clientMsgId: "abc" }
    });
    check("clientMsgId com menos de 8 caracteres é rejeitado", curto.status === 400, "400", short(curto));

    const longo = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "id longo", clientMsgId: "x".repeat(65) }
    });
    check("clientMsgId com mais de 64 caracteres é rejeitado", longo.status === 400, "400", short(longo));

    const sem = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "sem clientMsgId" }
    });
    check(
      "enviar sem clientMsgId continua funcionando (campo opcional)",
      sem.status === 201,
      "201",
      short(sem)
    );
  });
}

/* ================================================================== */
/* 9. Arquivos                                                         */
/* ================================================================== */

async function upload(token, bytes, name, type) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  return POST("/files", { token, body: fd });
}

async function secArquivos() {
  console.log("\n=== 9. Arquivos ===");
  const { A, B, C } = state;

  await t("upload e download", async () => {
    const content = "conteúdo do arquivo de teste " + Date.now();
    const r = await upload(A.token, Buffer.from(content, "utf8"), "teste.txt", "text/plain");
    check(
      "upload devolve 201 com key/url",
      r.status === 201 && r.json?.key && r.json?.url,
      "201 com key e url",
      short(r)
    );
    state.fileA = r.json;

    const dl = await fetch(`${BASE}${r.json.url}`);
    const text = await dl.text();
    check("download devolve o mesmo conteúdo", dl.status === 200 && text === content, "200 com o conteúdo original", `${dl.status} "${text.slice(0, 60)}"`);
    note("GET /files/* é público por desenho (a URL é a capability) — quem tiver a key baixa sem token");
  });

  await t("upload sem arquivo", async () => {
    const r = await POST("/files", { token: A.token, body: new FormData() });
    check("upload sem arquivo é 400", r.status === 400, "400", short(r));
  });

  await t("upload sem token", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from("x")], { type: "text/plain" }), "x.txt");
    const r = await POST("/files", { body: fd });
    check("upload sem token é 401", r.status === 401, "401", short(r));
  });

  await t("upload de arquivo vazio", async () => {
    const r = await upload(A.token, Buffer.alloc(0), "vazio.txt", "text/plain");
    check("upload de arquivo de 0 byte é rejeitado com 400", r.status === 400, "400", short(r));
  });

  await t("key carrega o dono", async () => {
    const parts = String(state.fileA.key).split("/");
    check(
      "a key do upload tem o formato aaaa/mm/<userId>/<uuid>.<ext>",
      parts.length === 4 && parts[2] === A.id,
      `4 segmentos com ${A.id} na 3ª posição`,
      state.fileA.key
    );
  });

  await t("anexar key de outro usuário", async () => {
    const r = await POST(`/rooms/${state.dmAB}/messages`, {
      token: B.token,
      body: {
        content: "anexo alheio",
        attachments: [
          {
            key: state.fileA.key,
            name: "roubado.txt",
            mime: "text/plain",
            size: state.fileA.size
          }
        ]
      }
    });
    check("B não consegue anexar a key de um arquivo de A (400)", r.status === 400, "400", short(r));
  });

  await t("anexar a própria key", async () => {
    const r = await POST(`/rooms/${state.dmAB}/messages`, {
      token: A.token,
      body: {
        content: "anexo legítimo",
        attachments: [
          { key: state.fileA.key, name: "meu.txt", mime: "text/plain", size: state.fileA.size }
        ]
      }
    });
    check(
      "o dono continua conseguindo anexar o próprio arquivo (sem regressão)",
      r.status === 201 && r.json?.message?.attachments?.length === 1,
      "201 com 1 anexo",
      short(r)
    );
  });

  await t("anexar key inexistente", async () => {
    // Key com o prefixo de dono correto, mas que não existe no armazenamento:
    // isola a checagem de existência da checagem de dono.
    const r = await POST(`/rooms/${state.dmAB}/messages`, {
      token: A.token,
      body: {
        content: "anexo fantasma",
        attachments: [
          {
            key: `2020/01/${A.id}/nao-existe.txt`,
            name: "fantasma.txt",
            mime: "text/plain",
            size: 10
          }
        ]
      }
    });
    check("anexo com key inexistente é rejeitado com 400", r.status === 400, "400", short(r));
  });

  await t("allowlist de MIME", async () => {
    const html = "<html><body><script>alert(1)</script></body></html>";
    const up = await upload(A.token, Buffer.from(html), "pagina.html", "text/html");
    check("upload de HTML é aceito", up.status === 201, "201", short(up));
    if (up.status !== 201) return;
    check(
      "o MIME de HTML é neutralizado para application/octet-stream",
      up.json.mime === "application/octet-stream",
      "application/octet-stream",
      String(up.json.mime)
    );

    const dl = await fetch(`${BASE}${up.json.url}`);
    check(
      "o download de HTML não vem com Content-Type text/html",
      !String(dl.headers.get("content-type") ?? "").includes("text/html"),
      "sem text/html",
      String(dl.headers.get("content-type"))
    );
    check(
      "o download traz X-Content-Type-Options: nosniff",
      String(dl.headers.get("x-content-type-options") ?? "").toLowerCase() === "nosniff",
      "nosniff",
      String(dl.headers.get("x-content-type-options"))
    );
    check(
      "o download de tipo não-inline traz Content-Disposition: attachment",
      String(dl.headers.get("content-disposition") ?? "").includes("attachment"),
      "attachment",
      String(dl.headers.get("content-disposition"))
    );

    const svg = await upload(A.token, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "x.svg", "image/svg+xml");
    check(
      "SVG também é neutralizado (não fica image/svg+xml)",
      svg.status === 201 && svg.json.mime === "application/octet-stream",
      "201 com application/octet-stream",
      short(svg)
    );

    const png = await upload(A.token, Buffer.from([0x89, 0x50, 0x4e, 0x47]), "x.png", "image/png");
    check(
      "tipos da allowlist passam intactos (image/png)",
      png.status === 201 && png.json.mime === "image/png",
      "201 com image/png",
      short(png)
    );
  });

  await t("11 anexos", async () => {
    const att = Array.from({ length: 11 }, (_, i) => ({
      key: state.fileA.key,
      name: `a${i}.txt`,
      mime: "text/plain",
      size: 10
    }));
    const r = await POST(`/rooms/${state.dmAB}/messages`, {
      token: A.token,
      body: { content: "muitos anexos", attachments: att }
    });
    check("mensagem com 11 anexos é rejeitada (máx. 10)", r.status === 400, "400", short(r));
    const ok = await POST(`/rooms/${state.dmAB}/messages`, {
      token: A.token,
      body: { content: "dez anexos", attachments: att.slice(0, 10) }
    });
    check("mensagem com 10 anexos é aceita", ok.status === 201, "201", short(ok));
  });

  await t("anexo com size inválido", async () => {
    const r = await POST(`/rooms/${state.dmAB}/messages`, {
      token: A.token,
      body: {
        content: "size negativo",
        attachments: [{ key: state.fileA.key, name: "n.txt", mime: "text/plain", size: -5 }]
      }
    });
    check("anexo com size negativo é rejeitado", r.status === 400, "400", short(r));
  });

  await t("download de key inexistente", async () => {
    const r = await fetch(`${BASE}/files/2020/01/nao-existe-mesmo.bin`);
    check("baixar key inexistente é 404", r.status === 404, "404", String(r.status));
  });

  for (const [desc, path] of [
    ["../ codificado", "/files/..%2F..%2F..%2Fetc%2Fpasswd"],
    ["../ literal no meio", "/files/2026%2F..%2F..%2F..%2Fetc%2Fpasswd"],
    ["duplo encoding", "/files/%252e%252e%252f%252e%252e%252fetc%252fpasswd"],
    ["backslash windows", "/files/..%5C..%5C..%5Cwindows%5Cwin.ini"],
    ["ponto-ponto sem barra", "/files/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd"],
    ["absoluto", "/files/%2Fetc%2Fpasswd"]
  ]) {
    await t(`path traversal ${desc}`, async () => {
      const r = await fetch(`${BASE}${path}`);
      const body = await r.text();
      const leaked = /root:x:|\[extensions\]|\[fonts\]/.test(body);
      check(
        `path traversal (${desc}) é bloqueado`,
        !leaked && (r.status === 400 || r.status === 404),
        "400 ou 404 sem vazar arquivo",
        `${r.status} ${body.slice(0, 120)}`
      );
    });
  }

  // O driver local grava um arquivo irmão "<key>.type" com o mime. Ele fica
  // dentro do UPLOAD_DIR, então a checagem de ".." não o protege: só a key é
  // que não deveria ser adivinhável a partir da key real.
  await t("sidecar .type do arquivo real", async () => {
    const r = await fetch(`${BASE}/files/${encodeURIComponent(`${state.fileA.key}.type`)}`);
    const body = await r.text();
    check(
      "o sidecar interno <key>.type não é mais servido (400)",
      r.status === 400,
      "400",
      `${r.status} ${body.slice(0, 80)}`
    );
  });

  await t("upload de C e download por A", async () => {
    const r = await upload(C.token, Buffer.from("arquivo do C"), "c.txt", "text/plain");
    check("upload de um segundo usuário devolve 201", r.status === 201, "201", short(r));
    if (r.status !== 201) return;
    const dl = await fetch(`${BASE}${r.json.url}`);
    const body = await dl.text();
    check(
      "o arquivo de C baixa íntegro pela URL",
      dl.status === 200 && body === "arquivo do C",
      '200 com "arquivo do C"',
      `${dl.status} "${body.slice(0, 40)}"`
    );
    if (dl.status === 200) {
      note("qualquer pessoa com a URL baixa o arquivo de outro usuário (URLs são UUIDs, sem ACL)");
    }
  });
}

/* ================================================================== */
/* 10. Edge cases de conteúdo                                          */
/* ================================================================== */

async function secEdge() {
  console.log("\n=== 10. Edge cases ===");
  const { A, B } = state;
  const room = state.dmAB;

  await t("8000 caracteres", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "a".repeat(8000) }
    });
    check("mensagem com 8000 caracteres é aceita", r.status === 201, "201", short(r));
    if (r.status === 201) {
      check(
        "os 8000 caracteres voltam íntegros",
        r.json.message.content.length === 8000,
        "8000",
        String(r.json.message.content.length)
      );
    }
  });

  await t("8001 caracteres", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "a".repeat(8001) }
    });
    check("mensagem com 8001 caracteres é rejeitada", r.status === 400, "400", short(r));
  });

  await t("emoji multi-codepoint", async () => {
    const emoji = "👨‍👩‍👧‍👦 🏳️‍🌈 👍🏽 é ñ 日本語";
    const r = await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: emoji } });
    check(
      "emoji multi-codepoint e unicode voltam intactos",
      r.status === 201 && r.json.message.content === emoji,
      `conteúdo === "${emoji}"`,
      short(r)
    );
    const list = await GET(`/rooms/${room}/messages?limit=5`, { token: B.token });
    const found = list.json?.messages?.find((m) => m.id === r.json?.message?.id);
    check(
      "emoji sobrevive ao round-trip de leitura",
      found?.content === emoji,
      "mesmo conteúdo",
      String(found?.content)
    );
  });

  await t("html/script no conteúdo", async () => {
    const payload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const r = await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: payload } });
    check("mensagem com HTML é aceita", r.status === 201, "201", short(r));
    if (r.status === 201) {
      check(
        "o HTML volta exatamente como enviado (sem escapar no servidor)",
        r.json.message.content === payload,
        "conteúdo preservado",
        String(r.json.message.content)
      );
      note(
        "o servidor guarda e devolve HTML cru; a proteção contra XSS depende inteiramente do cliente"
      );
    }
  });

  await t("emoji de reação com 24+ chars", async () => {
    const r = await POST(`/messages/${state.msg1}/reactions`, {
      token: B.token,
      body: { emoji: "x".repeat(25) }
    });
    check("reação com 25 caracteres é rejeitada", r.status === 400, "400", short(r));
    const txt = await POST(`/messages/${state.msg1}/reactions`, {
      token: B.token,
      body: { emoji: "isso-nao-e-emoji" }
    });
    if (txt.status === 200) {
      note("reações aceitam texto qualquer (até 24 chars), não só emoji");
      await POST(`/messages/${state.msg1}/reactions`, {
        token: B.token,
        body: { emoji: "isso-nao-e-emoji" }
      });
    }
    check("reação com texto qualquer não quebra", txt.status < 500, "<500", short(txt));
  });

  await t("replyToId de outra sala", async () => {
    const other = await POST(`/rooms/${state.groupPag}/messages`, {
      token: A.token,
      body: { content: "mensagem de outra sala" }
    });
    const foreignId = other.json.message.id;
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "respondendo mensagem de outra sala", replyToId: foreignId }
    });
    if (r.status === 201 && r.json?.message?.replyTo?.id === foreignId) {
      fail(
        "responder a mensagem de OUTRA sala deve ser rejeitado",
        "400/404 — replyToId precisa ser da mesma sala",
        `201: a mensagem foi criada citando "${r.json.message.replyTo.content}" de outra conversa (vaza conteúdo entre salas)`
      );
    } else {
      check(
        "responder a mensagem de outra sala é rejeitado",
        r.status >= 400,
        "4xx",
        short(r)
      );
    }
  });

  await t("replyToId inexistente", async () => {
    const r = await POST(`/rooms/${room}/messages`, {
      token: A.token,
      body: { content: "resposta órfã", replyToId: "cl00000000000000000000000" }
    });
    check(
      "replyToId inexistente devolve 4xx e não 500",
      r.status < 500,
      "4xx",
      short(r)
    );
  });

  await t("editar para conteúdo vazio", async () => {
    const m = await POST(`/rooms/${room}/messages`, { token: A.token, body: { content: "editar" } });
    const r = await PATCH(`/messages/${m.json.message.id}`, { token: A.token, body: { content: "" } });
    check("editar para conteúdo vazio é rejeitado", r.status === 400, "400", short(r));
    const spaces = await PATCH(`/messages/${m.json.message.id}`, {
      token: A.token,
      body: { content: "    " }
    });
    if (spaces.status === 200 && spaces.json?.message?.content === "") {
      fail(
        "editar para só espaços deve ser rejeitado",
        "400 — depois do trim a mensagem fica vazia",
        "200: a mensagem ficou com conteúdo vazio, o que o POST proíbe"
      );
    } else {
      check("editar para só espaços é rejeitado", spaces.status === 400, "400", short(spaces));
    }
  });

  await t("busca de usuários", async () => {
    const r = await GET(`/users/search?q=${encodeURIComponent(B.username.slice(0, 8))}`, {
      token: A.token
    });
    check(
      "busca encontra o usuário pelo prefixo do username",
      r.json?.users?.some((u) => u.id === B.id),
      "B nos resultados",
      short(r)
    );
    const self = await GET(`/users/search?q=${encodeURIComponent(A.username)}`, { token: A.token });
    check(
      "a busca não retorna o próprio usuário",
      !self.json?.users?.some((u) => u.id === A.id),
      "A fora dos resultados",
      short(self)
    );
    const empty = await GET("/users/search?q=", { token: A.token });
    check(
      "busca com q vazio devolve 200 com lista vazia",
      empty.status === 200 && Array.isArray(empty.json?.users) && empty.json.users.length === 0,
      "200 com users: []",
      short(empty)
    );
    const sqli = await GET(`/users/search?q=${encodeURIComponent("' OR 1=1 --")}`, { token: A.token });
    check("busca com aspas/SQL não quebra", sqli.status === 200, "200", short(sqli));
  });

  await t("atualizar perfil", async () => {
    const r = await PATCH("/users/me", { token: A.token, body: { displayName: "Nome Novo" } });
    check(
      "PATCH /users/me atualiza o displayName",
      r.status === 200 && r.json?.user?.displayName === "Nome Novo",
      "200 com o nome novo",
      short(r)
    );
    const long = await PATCH("/users/me", { token: A.token, body: { displayName: "x".repeat(49) } });
    check("displayName com 49 caracteres é rejeitado", long.status === 400, "400", short(long));
    const bio = await PATCH("/users/me", { token: A.token, body: { bio: "x".repeat(301) } });
    check("bio com 301 caracteres é rejeitada", bio.status === 400, "400", short(bio));
  });

  await t("GET /users/:id", async () => {
    const r = await GET(`/users/${B.id}`, { token: A.token });
    check("GET /users/:id devolve o perfil", r.status === 200 && r.json?.user?.id === B.id, "200", short(r));
    check(
      "GET /users/:id não vaza e-mail nem hash de senha",
      !("email" in (r.json?.user ?? {})) && !("passwordHash" in (r.json?.user ?? {})),
      "sem email/passwordHash",
      JSON.stringify(Object.keys(r.json?.user ?? {}))
    );
    const missing = await GET("/users/cl00000000000000000000000", { token: A.token });
    check("GET /users/:id inexistente é 404", missing.status === 404, "404", short(missing));
  });
}

/* ================================================================== */
/* 11. Chamadas                                                        */
/* ================================================================== */

async function secChamadas() {
  console.log("\n=== 11. Chamadas ===");
  const { A } = state;

  await t("config de chamadas", async () => {
    const r = await GET("/calls/config");
    check("GET /calls/config responde 200", r.status === 200, "200", short(r));
    state.callsEnabled = r.json?.enabled === true;
  });

  await t("token de chamada", async () => {
    const r = await POST(`/rooms/${state.dmAB}/call/token`, { token: A.token });
    if (state.callsEnabled) {
      check(
        "membro da sala recebe token de chamada",
        r.status === 200 && r.json?.token,
        "200 com token",
        short(r)
      );
      check(
        "o token vem com a sala LiveKit e a URL",
        r.json?.room === `room_${state.dmAB}` && Boolean(r.json?.url),
        `room_${state.dmAB} e url preenchida`,
        `${r.json?.room} / ${r.json?.url}`
      );
    } else {
      check("com LiveKit desligado o token é 503", r.status === 503, "503", short(r));
    }
  });

  await t("token num canal de voz", async () => {
    const spaces = await GET("/spaces", { token: A.token });
    const space = spaces.json?.spaces?.find((s) => s.id === state.space?.id);
    const voice = space?.channels?.find((c) => c.kind === "VOICE");
    check("o espaço tem um canal de voz", Boolean(voice), "canal VOICE na lista", JSON.stringify(space?.channels?.map((c) => c.kind)));
    if (!voice) return;

    const r = await POST(`/rooms/${voice.id}/call/token`, { token: A.token });
    if (state.callsEnabled) {
      check(
        "membro do espaço recebe token para o canal de voz",
        r.status === 200 && r.json?.token,
        "200 com token",
        short(r)
      );
      check(
        "o token do canal de voz aponta para a sala LiveKit certa",
        r.json?.room === `room_${voice.id}`,
        `room_${voice.id}`,
        String(r.json?.room)
      );
    } else {
      check("canal de voz com LiveKit desligado é 503", r.status === 503, "503", short(r));
    }

    const outsider = await POST(`/rooms/${voice.id}/call/token`, { token: state.C.token });
    check(
      "quem não é do espaço não pega token do canal de voz",
      outsider.status === 404 || outsider.status === 403,
      "404 ou 403",
      short(outsider)
    );

    const list = await GET(`/rooms/${voice.id}/messages`, { token: A.token });
    check(
      "o canal de voz responde à listagem de mensagens sem quebrar",
      list.status === 200,
      "200",
      short(list)
    );
  });
}

/* ================================================================== */
/* main                                                                */
/* ================================================================== */

/**
 * Toda seção depende só do que ela mesma cria ou do que as anteriores
 * guardaram em `state`. Se um pré-requisito não existir (porque a seção que o
 * criava explodiu), a seção é PULADA com aviso, em vez de despejar uma cascata
 * de exceções que esconde a falha original.
 */
function missingState(keys) {
  return keys.filter((k) => !state[k]);
}

async function main() {
  const only = process.argv
    .filter((a) => a.startsWith("--only="))
    .flatMap((a) => a.slice(7).split(","))
    .filter(Boolean);

  console.log(`Alvo: ${BASE}`);
  console.log(`Início: ${new Date().toISOString()}`);
  const health = await GET("/health");
  console.log(`Health: ${short(health)}`);
  if (health.status !== 200) {
    console.log("A API não respondeu /health com 200 — abortando antes de criar usuários.");
    process.exit(2);
  }
  console.log("");

  // [nome curto, função, pré-requisitos em `state`]
  const sections = [
    ["basico", secBasico, []],
    ["dm", secDm, ["A", "B", "C"]],
    ["mensagens", secMensagens, ["dmAB"]],
    ["paginacao", secPaginacao, ["A", "B"]],
    ["autorizacao", secAutorizacao, ["dmAB", "groupPag"]],
    ["espacos", secEspacos, ["A", "B", "C"]],
    ["naolidas", secNaoLidas, ["A", "B", "generalId"]],
    ["realtime", secRealtime, ["dmAB", "D"]],
    ["idempotencia", secIdempotencia, ["dmAB", "groupPag", "sockA", "sockB"]],
    ["arquivos", secArquivos, ["dmAB"]],
    ["edge", secEdge, ["dmAB", "msg1", "groupPag"]],
    ["chamadas", secChamadas, ["dmAB", "space", "C"]]
  ];

  for (const [name, section, needs] of sections) {
    if (only.length && !only.includes(name)) continue;
    const missing = missingState(needs);
    if (missing.length) {
      console.log(
        `\nPULADA: seção "${name}" — faltam pré-requisitos criados por seções anteriores (${missing.join(", ")})`
      );
      results.skipped.push(`${name} (faltou: ${missing.join(", ")})`);
      continue;
    }
    try {
      await section();
    } catch (err) {
      fail(`seção ${name}`, "rodar até o fim", `exceção: ${err?.stack?.split("\n").slice(0, 2).join(" | ")}`);
    }
  }

  for (const s of state.sockets ?? []) {
    try {
      s.socket.disconnect();
    } catch {
      /* ignore */
    }
  }

  console.log("\n================ SUMÁRIO ================");
  console.log(`Total:    ${results.total}`);
  console.log(`Passou:   ${results.passed}`);
  console.log(`Falhou:   ${results.failed}`);
  if (results.skipped.length) {
    console.log(`Puladas:  ${results.skipped.length} seção(ões): ${results.skipped.join(", ")}`);
  }
  if (results.failures.length) {
    console.log("\n--- FALHAS ---");
    results.failures.forEach((f, i) => {
      console.log(`${i + 1}. ${f.desc}`);
      console.log(`   esperado: ${f.expected}`);
      console.log(`   obtido:   ${f.actual}`);
    });
  }
  if (results.notes.length) {
    console.log("\n--- OBSERVAÇÕES ---");
    results.notes.forEach((n, i) => console.log(`${i + 1}. ${n}`));
  }
  console.log(`\nFim: ${new Date().toISOString()}`);

  // 0 = tudo passou, 1 = houve FAIL (a suíte rodou até o fim mesmo assim),
  // 2 = não deu para rodar (API fora do ar).
  process.exit(results.failed > 0 ? 1 : 0);
}

process.on("unhandledRejection", (err) => {
  fail("promessa não tratada", "nenhuma", String(err?.stack ?? err).split("\n")[0]);
});

main().catch((err) => {
  console.error("A suíte abortou:", err);
  process.exit(2);
});
