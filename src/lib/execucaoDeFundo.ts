import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marca o trabalho de FUNDO (sync, cron, retenção) para que ele use um pool de
 * conexões próprio, separado do pool que serve a pessoa olhando a tela.
 *
 * ## Por que existe (incidente de 29/08/2026)
 *
 * Havia **um** pool de 10 conexões compartilhado entre tudo. Medido naquela
 * noite: **uma carga do dashboard pede 28 transações** — quase três vezes o pool
 * inteiro —, e os quatro canais de sync batiam a cada 2 minutos nas mesmas 10.
 *
 * O resultado foi o trabalho de fundo **matando de fome** quem estava esperando
 * a tela: requisições de usuário morrendo com `ECHECKOUTTIMEOUT` após 15s, e o
 * dashboard levando **54 segundos** — com as consultas executando em 0,030ms.
 * Não era consulta lenta; era fila.
 *
 * ## A regra
 *
 * Com dois pools, o fundo **não enxerga** o pool do usuário. A fome deixa de
 * depender de escalonamento feliz e passa a ser **impossível por construção** —
 * que é a única forma de garantia que sobrevive a uma madrugada movimentada.
 *
 * ⚠️ Números conservadores de propósito (8 + 3 = 11 contra os 10 de antes): o
 * teto de conexões do tenant no pooler **não é conhecido** — só o painel da
 * Supabase mostra. Subir para 12+4 poderia trocar fome interna por rejeição no
 * pooler, ou seja, consertar um problema criando outro. Os dois valores vêm de
 * variável de ambiente para subirem sem deploy quando o número for confirmado.
 */
const armazenamento = new AsyncLocalStorage<true>();

/** Roda `fn` marcado como trabalho de fundo. Usado pelas rotas de cron. */
export function runComoFundo<T>(fn: () => Promise<T>): Promise<T> {
  return armazenamento.run(true, fn);
}

/** `true` dentro de trabalho de fundo. Fora dele — requisição de usuário — `false`. */
export function ehFundo(): boolean {
  return armazenamento.getStore() === true;
}

/**
 * Cronometra um trabalho disparado por `after()` e diz em QUAL pool ele correu.
 *
 * ⚠️ Por que existe (29/08/2026): descobrimos que as oito rotas com `after()`
 * — inclusive o sync que a TELA dispara a cada abertura — não passam por
 * `runComoFundo`. Elas usam os 8 slots do pool de USUÁRIO, os mesmos que a tela
 * precisa para desenhar. A cerca das 4h da manhã isolou o caminho frio (cron) e
 * deixou o quente sem cerca — e por isso "com tudo desligado" nunca foi com tudo
 * desligado: desligar o agendador não desligou o sync das telas.
 *
 * Este log existe para medir com o tráfego REAL dela em vez de gerar carga nova
 * numa sonda. Sai uma linha por trabalho, com duração e pool.
 */
export async function medirTrabalhoDeFundo<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  const comecou = performance.now();
  const pool = ehFundo() ? "fundo" : "usuario";
  try {
    return await fn();
  } finally {
    console.info("[after]", { trabalho: nome, ms: Math.round(performance.now() - comecou), pool });
  }
}
