#!/usr/bin/env node
/**
 * Publica uma versão do app de desktop — o que o atualizador dentro do app baixa.
 *
 *   node scripts/release-desktop.mjs --notes "O que mudou nesta versão"
 *   node scripts/release-desktop.mjs --dry-run      # tudo, menos publicar
 *
 * Passo a passo, e por que cada trava existe:
 *
 *  1. Recusa com a árvore suja. O instalador é gerado a partir do disco, não do
 *     commit: com arquivo alterado e não commitado, a versão publicada teria um
 *     código que não existe em lugar nenhum do histórico.
 *  2. Recusa se a tag `v<versão>` já existir. O atualizador compara versões; duas
 *     publicações com o mesmo número deixariam quem já tem a primeira sem nunca
 *     receber a segunda.
 *  3. Compila com a chave de `.secrets/updater.key`. O Tauri assina o instalador
 *     e gera o `.sig`. Sem a chave certa, o app instalado RECUSA a atualização —
 *     que é o ponto: o endereço é público, e só a assinatura impede que alguém
 *     que troque o arquivo lá rode código em todas as máquinas.
 *  4. Confere que o instalador é mais novo que o último commit. Já se entregou
 *     um instalador compilado 40 minutos antes da correção que ele devia conter.
 *  5. Monta o `latest.json` que o app consulta e publica a release no GitHub com
 *     os três arquivos.
 *
 * A chave privada NUNCA passa pela linha de comando nem é impressa: vai por
 * variável de ambiente só para o processo do build.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "avoguga/whatscord";
const SECRETS = join(RAIZ, ".secrets");

const args = process.argv.slice(2);
const seco = args.includes("--dry-run");
const iNotas = args.indexOf("--notes");
const notas = iNotas >= 0 ? args[iNotas + 1] ?? "" : "";

function falhar(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function git(...a) {
  return execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();
}

// ------------------------------------------------------------------ versão
const conf = JSON.parse(readFileSync(join(RAIZ, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const versao = conf.version;
const tag = `v${versao}`;
const nomeProduto = conf.productName;
console.log(`Versão: ${versao}  (tag ${tag})`);

if (!conf.bundle?.createUpdaterArtifacts) {
  falhar("bundle.createUpdaterArtifacts está desligado no tauri.conf.json — sem ele não sai o .sig.");
}
if (!conf.plugins?.updater?.pubkey) falhar("plugins.updater.pubkey ausente no tauri.conf.json.");

// ------------------------------------------------------------ travas git
if (git("status", "--porcelain")) {
  falhar("Há alterações não commitadas. Commite antes: o instalador sai do disco, não do histórico.");
}
if (git("tag", "--list", tag)) falhar(`A tag ${tag} já existe. Suba a versão no tauri.conf.json.`);

// --------------------------------------------------------------- segredos
const chave = join(SECRETS, "updater.key");
const envSenha = join(SECRETS, "updater.env");
if (!existsSync(chave) || !existsSync(envSenha)) {
  falhar(
    "Chave de assinatura ausente em .secrets/. Sem ela nenhuma atualização é aceita pelos apps instalados — e uma chave nova NÃO serve: a pública está embutida em cada app já instalado."
  );
}
const senha = /^TAURI_SIGNING_PRIVATE_KEY_PASSWORD=(.*)$/m.exec(readFileSync(envSenha, "utf8"))?.[1];
if (!senha) falhar("Senha da chave não encontrada em .secrets/updater.env.");

// ------------------------------------------------------------------ build
console.log("\nCompilando o instalador assinado (≈4 min)…");
const commitIso = git("log", "-1", "--format=%cI");
const build = spawnSync("npm", ["run", "dist:desktop"], {
  cwd: RAIZ,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(chave, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: senha
  }
});
if (build.status !== 0) falhar(`O build falhou (código ${build.status}).`);

const pasta = join(RAIZ, "apps/desktop/src-tauri/target/release/bundle/nsis");
const exe = `${nomeProduto}_${versao}_x64-setup.exe`;
const caminhoExe = join(pasta, exe);
const caminhoSig = `${caminhoExe}.sig`;
if (!existsSync(caminhoExe)) falhar(`Instalador não encontrado: ${caminhoExe}`);
if (!existsSync(caminhoSig)) falhar(`Assinatura não encontrada: ${caminhoSig} — a chave foi aplicada?`);

// A trava do instalador velho.
if (statSync(caminhoExe).mtime < new Date(commitIso)) {
  falhar("O instalador é MAIS VELHO que o último commit. Não publico um artefato que não contém o código atual.");
}

// ------------------------------------------------------------ latest.json
const assinatura = readFileSync(caminhoSig, "utf8").trim();
const latest = {
  version: versao,
  notes: notas,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: assinatura,
      url: `https://github.com/${REPO}/releases/download/${tag}/${exe}`
    }
  }
};
const caminhoLatest = join(pasta, "latest.json");
writeFileSync(caminhoLatest, JSON.stringify(latest, null, 2) + "\n");

console.log(`\nInstalador : ${caminhoExe} (${statSync(caminhoExe).size} bytes)`);
console.log(`Assinatura : ${caminhoSig}`);
console.log(`latest.json: ${caminhoLatest}`);

if (seco) {
  console.log("\n--dry-run: nada foi publicado.");
  process.exit(0);
}

// --------------------------------------------------------------- publicar
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  falhar("Defina GH_TOKEN com um token que possa criar releases em " + REPO + ".");
}
console.log(`\nPublicando ${tag} em ${REPO}…`);
const pub = spawnSync(
  "gh",
  [
    "release", "create", tag,
    caminhoExe, caminhoSig, caminhoLatest,
    "--repo", REPO,
    "--title", `${nomeProduto} ${versao}`,
    "--notes", notas || `${nomeProduto} ${versao}`,
    "--target", git("rev-parse", "HEAD")
  ],
  { cwd: RAIZ, stdio: "inherit" }
);
if (pub.status !== 0) falhar(`A publicação falhou (código ${pub.status}).`);

console.log(`\n✓ ${tag} publicada. Os apps instalados a partir da 0.2.0 vão encontrá-la em:`);
console.log(`  https://github.com/${REPO}/releases/latest/download/latest.json`);
