// Emissor de autorização de migration (Ed25519) — ver ADR-021.
//
// O runner exige uma autorização assinada para aplicar qualquer migration, e este
// repositório passou meses sem emissor: por isso TODA migration de 0003 em diante
// foi aplicada fora do fluxo. O emissor agora existe; a CHAVE PRIVADA continua
// fora do repo, que é o que faz a assinatura significar alguma coisa.
//
// Uso:
//   node scripts/migration-authorize.mjs --plan <plano.json> \
//     --key <caminho/da/chave-privada.pem> --actor "<quem autoriza>" \
//     --reference "<por que>" --out <autorizacao.json>
//
// Gerar o par de chaves (uma vez, FORA do repositório):
//   node scripts/migration-authorize.mjs --generate --out-dir <pasta fora do repo>
//
// A pública vai para `MIGRATION_AUTH_PUBLIC_KEY` no ambiente de quem aplica; a
// privada fica só com quem autoriza. Se a privada vazar, a autorização vira
// carimbo — trocar o par é o único remédio.

import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AUTH_MAX_AGE_MS, parseArgs, verifyPlan } from "./migration-safety.mjs";

// Mesma ordem e mesmo separador do `authorizationPayload` que o runner verifica.
// Divergir aqui produz assinatura que falha sem dizer por quê — por isso os campos
// são montados a partir do objeto final, nunca redigitados.
const CAMPOS = ["nonce", "reference", "actor", "environment", "targetFingerprint", "planHash", "expiresAt"];

// `parseArgs` é do runner e trata todo `--x` como par chave-valor: um `--generate`
// solto engoliria o `--out-dir` seguinte como se fosse seu valor. Tiro a flag
// antes de passar adiante em vez de ensinar booleanos ao parser compartilhado —
// mexer nele mexeria no caminho do apply, que não tem nada a ver com isto.
const argv = process.argv.slice(2);
const gerarChaves = argv.includes("--generate");
const args = parseArgs(argv.filter((a) => a !== "--generate"));

if (gerarChaves) {
  const destino = args["out-dir"];
  if (!destino) throw new Error("BLOCKED: --generate exige --out-dir (uma pasta FORA do repositório).");
  if (path.resolve(destino).startsWith(path.resolve("."))) {
    throw new Error("BLOCKED: --out-dir aponta para dentro do repositório; a chave privada não pode ser versionável.");
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  await mkdir(destino, { recursive: true });
  const priv = path.join(destino, "migration-auth-private.pem");
  const pub = path.join(destino, "migration-auth-public.pem");
  // `wx`: nunca sobrescrever um par existente. Sobrescrever invalidaria em
  // silêncio a chave pública já publicada no ambiente de apply.
  await writeFile(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
  await writeFile(pub, publicKey.export({ type: "spki", format: "pem" }), { flag: "wx" });
  console.log(`chave privada: ${priv}  (NÃO versionar, NÃO copiar para o repo)`);
  console.log(`chave pública: ${pub}`);
  console.log("\nColoque no .env.local de quem aplica, com as quebras de linha reais:\nMIGRATION_AUTH_PUBLIC_KEY=\"<conteúdo do .pem público>\"");
  process.exit(0);
}

for (const obrigatorio of ["plan", "key", "actor", "reference", "out"]) {
  if (!args[obrigatorio]) throw new Error(`BLOCKED: --${obrigatorio} é obrigatório.`);
}

const plano = JSON.parse(await readFile(args.plan, "utf8"));

// Assinar plano adulterado seria assinar o que não se leu. O runner também
// verifica, mas falhar aqui é mais barato e diz a verdade mais cedo.
verifyPlan(plano);

const validade = Number(args.minutos ?? 10);
if (!Number.isFinite(validade) || validade <= 0 || validade * 60_000 > AUTH_MAX_AGE_MS) {
  throw new Error(`BLOCKED: --minutos deve ficar entre 1 e ${AUTH_MAX_AGE_MS / 60_000}.`);
}

const autorizacao = {
  nonce: randomUUID(),
  reference: args.reference,
  actor: args.actor,
  environment: plano.environment,
  targetFingerprint: plano.target.fingerprint,
  planHash: plano.planHash,
  expiresAt: new Date(Date.now() + validade * 60_000).toISOString(),
};

const chave = await readFile(args.key, "utf8");
autorizacao.signature = sign(null, Buffer.from(CAMPOS.map((c) => autorizacao[c]).join("\n")), chave).toString("base64");

await writeFile(args.out, `${JSON.stringify(autorizacao, null, 2)}\n`, { flag: "wx" });

console.log(`autorização emitida: ${args.out}`);
console.log(`  plano ......: ${plano.planHash}`);
console.log(`  ambiente ...: ${plano.environment}`);
console.log(`  pendentes ..: ${plano.migrations.filter((m) => m.status === "pending").map((m) => `${m.name} [${m.operations}]`).join(", ") || "nenhuma"}`);
console.log(`  vale até ...: ${autorizacao.expiresAt} (${validade} min)`);
