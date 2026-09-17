/**
 * Ponta a ponta, contra produção: o arquivo enviado numa conversa volta com o
 * nome original no Content-Disposition.
 *
 *   node tests/e2e-nome-download.mjs
 *
 * Cria dois usuários descartáveis, como tests/run.mjs.
 */
import { BASE, POST, makeUser } from "./helpers.mjs";

const A = await makeUser("nomeA");
const B = await makeUser("nomeB");
const dm = await POST("/rooms/dm", { token: A.token, body: { userId: B.id } });
const sala = dm.json.room.id;

const nome = "WhatsCord_0.2.1_x64-setup (cópia).exe";
const fd = new FormData();
fd.append("file", new Blob([new Uint8Array([77, 90, 0, 1, 2, 3])], { type: "application/x-msdownload" }), nome);
const up = await POST("/files", { token: A.token, body: fd });
if (up.status !== 201) throw new Error("upload: " + up.status);

const msg = await POST(`/rooms/${sala}/messages`, {
  token: A.token,
  body: { content: "", attachments: [{ key: up.json.key, name: up.json.name, mime: up.json.mime, size: up.json.size }] }
});
if (msg.status !== 201 && msg.status !== 200) throw new Error("mensagem: " + msg.status + " " + JSON.stringify(msg.json));

const r = await fetch(BASE + up.json.url);
const cd = r.headers.get("content-disposition");
console.log("status        ", r.status);
console.log("content-type  ", r.headers.get("content-type"));
console.log("disposition   ", cd);

const esperado = `filename*=UTF-8''${encodeURIComponent(nome).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
const ok = r.status === 200 && cd?.startsWith("attachment;") && cd.includes(esperado);
console.log(ok ? "\nOK: o download sai com o nome original" : "\nFALHOU: esperado conter " + esperado);
process.exit(ok ? 0 : 1);
