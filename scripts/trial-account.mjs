// Gestão de contas de avaliação.
//
//   criar:    ACTION=create EMAIL=... DAYS=20 [PASSWORD=...] node ... scripts/trial-account.mjs
//   status:   ACTION=status EMAIL=... node ... scripts/trial-account.mjs
//   nota:     ACTION=note   EMAIL=... NOTE="..." node ... scripts/trial-account.mjs
//   estender: ACTION=extend EMAIL=... DAYS=10 node ... scripts/trial-account.mjs
//   excluir:  ACTION=delete EMAIL=... CONFIRM=SIM node ... scripts/trial-account.mjs
//
// Rodar com: node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local
//
// A exclusão é irreversível e exige CONFIRM=SIM: apaga o usuário e TODOS os
// dados do workspace dele. Nunca é automática por vencimento — o bloqueio de
// acesso ao expirar já protege o produto, e é reversível.

import { randomBytes } from "node:crypto";
import { dbQuery } from "../src/lib/db.ts";
import { setTrial, getTrialFor, clearTrial } from "../src/lib/trial.ts";

const ACTION = (process.env.ACTION || "status").toLowerCase();
const EMAIL = process.env.EMAIL;
const DAYS = Number(process.env.DAYS || 20);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

if (!EMAIL) {
  console.error("Defina EMAIL.");
  process.exit(1);
}
if (!SUPABASE_URL || !SECRET) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY.");
  process.exit(1);
}

async function admin(path, init) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
}

async function findUser(email) {
  const list = await admin(`/admin/users?page=1&per_page=200`);
  return (list.body?.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

/** Senha forte e legível para repassar por canal seguro. */
function generatePassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${body}#7`;
}

const TABLES_BY_WORKSPACE = [
  "workspace_settings",
  "workspace_accounts",
  "workspace_integrations",
  "workspace_product_costs",
  "workspace_tiktok_shops",
  "workspace_marketplace_orders",
  "workspace_marketplace_shipments",
  "workspace_marketplace_products",
  "workspace_marketplace_syncs",
  "workspace_marketplace_events",
  "workspace_persistent_cache",
  "workspace_channel_orders",
  "workspace_channel_order_items",
  "workspace_channel_order_fees",
  "workspace_channel_products",
];

if (ACTION === "create") {
  const password = process.env.PASSWORD || generatePassword();
  let user = await findUser(EMAIL);
  if (!user) {
    const created = await admin("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
    });
    if (!created.ok) {
      console.error("falha ao criar usuario:", created.status, JSON.stringify(created.body));
      process.exit(1);
    }
    user = created.body;
    console.log("usuario criado:", user.id);
  } else {
    const updated = await admin(`/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!updated.ok) {
      console.error("falha ao atualizar senha:", updated.status);
      process.exit(1);
    }
    console.log("usuario ja existia; senha redefinida:", user.id);
  }

  const trial = await setTrial(user.id, {
    startsAt: new Date(),
    days: DAYS,
    note: process.env.NOTE,
  });
  console.log("\n--- credenciais (repassar por canal seguro) ---");
  console.log("e-mail:", EMAIL);
  console.log("senha: ", password);
  console.log("\n--- periodo de avaliacao ---");
  console.log("workspace:", user.id);
  console.log("inicio:   ", new Date(trial.startsAt).toLocaleString("pt-BR"));
  console.log("fim:      ", new Date(trial.endsAt).toLocaleString("pt-BR"));
  console.log("dias:     ", DAYS, `(restam ${trial.daysLeft})`);
} else if (ACTION === "status") {
  const user = await findUser(EMAIL);
  if (!user) {
    console.log("usuario nao encontrado:", EMAIL);
    process.exit(0);
  }
  const trial = await getTrialFor(user.id);
  console.log("workspace:", user.id);
  if (!trial) {
    console.log("sem periodo de avaliacao (conta normal)");
  } else {
    console.log("inicio:", new Date(trial.startsAt).toLocaleString("pt-BR"));
    console.log("fim:   ", new Date(trial.endsAt).toLocaleString("pt-BR"));
    console.log("estado:", trial.expired ? "VENCIDO" : `ativo, ${trial.daysLeft} dia(s) restante(s)`);
  }
} else if (ACTION === "note") {
  // Troca só a mensagem, preservando as datas — usar extend aqui reiniciaria o
  // período, o que não é o que se quer ao ajustar um texto.
  const user = await findUser(EMAIL);
  if (!user) {
    console.error("usuario nao encontrado:", EMAIL);
    process.exit(1);
  }
  const current = await getTrialFor(user.id);
  if (!current) {
    console.error("essa conta nao tem periodo de avaliacao.");
    process.exit(1);
  }
  const startsAt = new Date(current.startsAt);
  const days = (new Date(current.endsAt) - startsAt) / 86_400_000;
  const trial = await setTrial(user.id, { startsAt, days, note: process.env.NOTE });
  console.log("nota atualizada.");
  console.log("periodo preservado:", new Date(trial.startsAt).toLocaleString("pt-BR"), "->", new Date(trial.endsAt).toLocaleString("pt-BR"));
} else if (ACTION === "extend") {
  const user = await findUser(EMAIL);
  if (!user) {
    console.error("usuario nao encontrado:", EMAIL);
    process.exit(1);
  }
  const trial = await setTrial(user.id, { startsAt: new Date(), days: DAYS, note: process.env.NOTE });
  console.log("periodo estendido ate", new Date(trial.endsAt).toLocaleString("pt-BR"));
} else if (ACTION === "delete") {
  if (process.env.CONFIRM !== "SIM") {
    console.error("Exclusao IRREVERSIVEL. Repita com CONFIRM=SIM para confirmar.");
    process.exit(1);
  }
  const user = await findUser(EMAIL);
  if (!user) {
    console.error("usuario nao encontrado:", EMAIL);
    process.exit(1);
  }
  for (const table of TABLES_BY_WORKSPACE) {
    try {
      await dbQuery(`DELETE FROM ${table} WHERE workspace_id = $1`, [user.id]);
    } catch (error) {
      console.log(`  (aviso) ${table}: ${error.message}`);
    }
  }
  await clearTrial(user.id).catch(() => {});
  const removed = await admin(`/admin/users/${user.id}`, { method: "DELETE" });
  console.log(removed.ok ? `usuario ${EMAIL} e dados do workspace removidos` : `falha ao remover usuario: ${removed.status}`);
} else {
  console.error("ACTION invalida. Use create | status | note | extend | delete.");
  process.exit(1);
}

process.exit(0);
