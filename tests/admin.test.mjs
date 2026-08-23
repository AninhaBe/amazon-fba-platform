import test from "node:test";
import assert from "node:assert/strict";
import { ehAdmin } from "../src/lib/adminAllowlist.ts";

// O portão da tela de administração — a única rota que lê entre workspaces.
// Ver docs/adr/ADR-024-tela-de-administracao.md.

const comLista = (valor, fn) => {
  const antes = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = valor;
  try { fn(); } finally {
    if (antes === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = antes;
  }
};

test("sem ADMIN_EMAILS configurada, NINGUÉM é admin", () => {
  comLista("", () => {
    assert.equal(ehAdmin("qualquer@pessoa.com"), false);
    assert.equal(ehAdmin("admin@admin.com"), false);
  });
});

test("falha fechada: variável ausente não libera ninguém", () => {
  const antes = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
  try {
    assert.equal(ehAdmin("qualquer@pessoa.com"), false);
  } finally {
    if (antes !== undefined) process.env.ADMIN_EMAILS = antes;
  }
});

test("só quem está na lista entra", () => {
  comLista("ana@nexo.com, lucas@nexo.com", () => {
    assert.equal(ehAdmin("ana@nexo.com"), true);
    assert.equal(ehAdmin("lucas@nexo.com"), true);
    assert.equal(ehAdmin("outro@nexo.com"), false);
  });
});

test("e-mail é comparado sem depender de caixa nem espaço", () => {
  comLista("  Ana@Nexo.COM  ", () => {
    assert.equal(ehAdmin("ana@nexo.com"), true);
    assert.equal(ehAdmin("  ANA@NEXO.com "), true);
  });
});

test("ausência de e-mail nunca vira admin", () => {
  comLista("ana@nexo.com", () => {
    assert.equal(ehAdmin(null), false);
    assert.equal(ehAdmin(undefined), false);
    assert.equal(ehAdmin(""), false);
  });
});

test("não aceita e-mail parcial nem sufixo", () => {
  comLista("ana@nexo.com", () => {
    assert.equal(ehAdmin("ana@nexo.com.br"), false);
    assert.equal(ehAdmin("xana@nexo.com"), false);
    assert.equal(ehAdmin("ana@nexo.co"), false);
  });
});
