import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Frente M (decisão da Ana, 28/08/2026): widget do Crisp SÓ no app logado,
// dormente sem a env, identidade mínima (nome + e-mail, parecer LGPD).

test("o widget é dormente sem a env e só seta e-mail/nome — nada de dado de operação", async () => {
  const fonte = await readFile(new URL("../src/app/components/CrispChat.tsx", import.meta.url), "utf8");
  const gate = fonte.indexOf("if (!CRISP_WEBSITE_ID) return;");
  const script = fonte.indexOf("client.crisp.chat");
  assert.ok(gate > -1 && script > -1 && gate < script, "o gate da env vem antes de qualquer script");
  assert.match(fonte, /user:email/);
  assert.match(fonte, /user:nickname/);
  // Identidade mínima: nenhuma outra chave do Crisp além de email/nickname.
  const pushes = fonte.match(/\$crisp\.push\(\["set", "([^"]+)"/g) ?? [];
  assert.deepEqual(
    pushes.map((p) => p.match(/"set", "([^"]+)"/)[1]).sort(),
    ["user:email", "user:nickname"],
    "payload do Crisp cresceu além do parecer LGPD"
  );
  // Identidade só com sessão real do Supabase.
  assert.match(fonte, /auth\.getUser\(\)/);
});

test("o Crisp monta DEPOIS do early-return das rotas públicas — landing/login nunca carregam", async () => {
  const shell = await readFile(new URL("../src/app/components/AppShell.tsx", import.meta.url), "utf8");
  const publicReturn = shell.indexOf('pathname.startsWith("/landing")');
  const crisp = shell.indexOf("<CrispChat />");
  assert.ok(publicReturn > -1 && crisp > -1 && publicReturn < crisp,
    "o CrispChat precisa ficar no ramo autenticado, após o early-return público");
  // E nenhuma página pública importa o componente diretamente.
  for (const publica of ["../src/app/landing/page.tsx", "../src/app/login/LoginForm.tsx", "../src/app/privacidade/page.tsx"]) {
    const fonte = await readFile(new URL(publica, import.meta.url), "utf8");
    assert.doesNotMatch(fonte, /CrispChat|crisp\.chat/, `${publica} não pode carregar o Crisp`);
  }
});

test("a env nova está nos build-args do deploy e no Dockerfile — NEXT_PUBLIC entra no bundle no build", async () => {
  const deploy = await readFile(new URL("../scripts/fly-deploy.sh", import.meta.url), "utf8");
  assert.match(deploy, /--build-arg NEXT_PUBLIC_CRISP_WEBSITE_ID=/);
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG NEXT_PUBLIC_CRISP_WEBSITE_ID/);
  assert.match(dockerfile, /NEXT_PUBLIC_CRISP_WEBSITE_ID=\$NEXT_PUBLIC_CRISP_WEBSITE_ID/);
});

test("a política de privacidade lista o Crisp como subprocessador com o escopo mínimo", async () => {
  const politica = await readFile(new URL("../src/app/privacidade/page.tsx", import.meta.url), "utf8");
  assert.match(politica, /Crisp/);
  assert.match(politica, /apenas seu nome e\s*\n?\s*e-mail/);
  assert.match(politica, /União Europeia/);
});
