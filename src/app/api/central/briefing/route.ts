import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { cached } from "@/lib/cache";
import { narrarBriefing, VERSAO_DO_FORMATO, type SnapshotCentral, type ModoNarracao } from "@/lib/centralBriefing";
import { coletarSinaisDeCausa } from "@/lib/centralDiagnostico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Narração diária da Visão geral. O cliente manda o snapshot que a central já
// calculou (não confiamos nele para dado de negócio — o texto é só cosmético e
// só é exibido para quem enviou), e o servidor narra com o Claude.
//
// Custo controlado por cache DIÁRIO por workspace: a primeira carga do dia gera,
// o resto do dia lê o texto pronto. Sem ANTHROPIC_API_KEY, `narrarBriefing`
// devolve null e a tela usa o alerta por regra — degradação limpa.

function diaEmBrasilia(): string {
  return new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10);
}

// A saudação é computada no servidor porque o modelo erra a hora (mandou "bom
// dia" às 14h). Brasília não tem horário de verão desde 2019: offset fixo -3h.
function saudacaoDeBrasilia(): string {
  const hora = new Date(Date.now() - 3 * 60 * 60_000).getUTCHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

// ÚLTIMA NARRAÇÃO DO DIA, para a tela poder mostrar texto de imediato.
//
// A aba de briefing só conseguia PEDIR o texto depois de carregar os 4 canais
// (`gatherCentralChannels`: /api/integrations e mais ~8 chamadas que batem nos
// marketplaces), e só então o modelo começava a escrever. Ou seja: mesmo com o
// texto do dia já pronto no cache, abrir a aba custava a corrente inteira — foi
// o "demorou pra caramba pra abrir" de 23/08/2026.
//
// Aqui fica o ponteiro que o GET lê sem precisar do snapshot. O POST segue igual
// e corrige o texto se os fatos tiverem mudado.
//
// ⚠️ A chave carrega o workspace SEMPRE. Estado de módulo no servidor é
// compartilhado por todas as requisições, e foi exatamente cache sem escopo que
// mostrou os números dela na conta do sócio. Sem workspace na chave, isto vira o
// mesmo vazamento.
const ultimaNarracao = new Map<string, string>();
const TETO_NARRACOES = 200;

function chaveDoPonteiro(modo: ModoNarracao, escopo: string, saudacao: string, dia: string): string {
  // A versão do FORMATO entra aqui TAMBÉM. Sem isso o caminho rápido do GET
  // continuaria entregando o texto da instrução antiga mesmo com o cache da
  // geração já invalidado — o defeito voltaria pela porta de trás.
  return `${currentWorkspaceId()}:v${VERSAO_DO_FORMATO[modo]}:${modo}:${escopo}:${saudacao}:${dia}`;
}

function guardarNarracao(chave: string, texto: string): void {
  // Descarta a entrada mais antiga em vez de crescer sem limite. Sem TTL de
  // propósito: a chave já morre sozinha quando o dia (ou a saudação) vira.
  if (ultimaNarracao.size >= TETO_NARRACOES) {
    const maisAntiga = ultimaNarracao.keys().next().value;
    if (maisAntiga !== undefined) ultimaNarracao.delete(maisAntiga);
  }
  ultimaNarracao.set(chave, texto);
}

/**
 * Caminho rápido: devolve a narração já gerada hoje, sem snapshot e sem modelo.
 * `texto: null` quando ainda não existe — a tela então espera o POST, que é o
 * comportamento antigo. Nunca inventa texto.
 */
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const p = req.nextUrl.searchParams;
    const modo: ModoNarracao = p.get("modo") === "briefing" ? "briefing" : "resumo";
    const escopoBruto = p.get("escopo") ?? "geral";
    const escopo = /^[a-z0-9_]{1,24}$/.test(escopoBruto) ? escopoBruto : "geral";
    const texto = ultimaNarracao.get(chaveDoPonteiro(modo, escopo, saudacaoDeBrasilia(), diaEmBrasilia())) ?? null;
    return NextResponse.json({ texto, gerado: texto != null });
  });
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    let snapshot: SnapshotCentral;
    try {
      snapshot = (await req.json()) as SnapshotCentral;
    } catch {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }
    if (!snapshot || !Array.isArray(snapshot.canais)) {
      return NextResponse.json({ error: "Snapshot incompleto." }, { status: 400 });
    }
    // "briefing" = a matéria cheia (aba de briefing); "resumo" = a manchete curta
    // (Visão geral). Modos diferentes têm cache diário separado.
    const modo: ModoNarracao = (snapshot as { modo?: ModoNarracao }).modo === "briefing" ? "briefing" : "resumo";
    // Escopo separa o cache: "geral" (Visão geral, cross-channel) não pode
    // servir o mesmo texto que "amazon" (dashboard do canal). Só letras/dígitos.
    const escopoBruto = (snapshot as { escopo?: string }).escopo ?? "geral";
    const escopo = /^[a-z0-9_]{1,24}$/.test(escopoBruto) ? escopoBruto : "geral";
    // A data e a saudação vêm do servidor. A saudação entra na chave: como muda
    // de manhã/tarde/noite, o cache diário regenera no máximo 3 vezes ao dia — se
    // não, às 15h a pessoa veria o "Bom dia" cacheado de manhã.
    const dia = diaEmBrasilia();
    const saudacao = saudacaoDeBrasilia();
    // O briefing fala de estado (ruptura, sinais) que muda; se cacheasse só por
    // dia, mostraria análise velha depois que o estoque foi reposto. A chave dele
    // leva um hash dos fatos: mesmos fatos → cacheado; fatos mudaram → regenera.
    // O resumo (financeiro do dia) é estável, então fica no cache diário simples.
    const fatosHash =
      modo === "briefing"
        ? ":" +
          createHash("sha1")
            .update(
              JSON.stringify({
                fat: snapshot.faturamento30d,
                var: snapshot.variacaoSemanaPct,
                canais: snapshot.canais,
                insights: snapshot.insights ?? [],
              })
            )
            .digest("hex")
            .slice(0, 12)
        : "";
    // A versão do FORMATO entra na chave: texto cacheado é produto do prompt, e
    // prompt novo não pode ser servido com resposta velha. Ver VERSAO_DO_FORMATO.
    const chave = `central-briefing:v${VERSAO_DO_FORMATO[modo]}:${modo}:${escopo}:${saudacao}:${currentWorkspaceId()}:${dia}${fatosHash}`;
    // Só o texto real é cacheado. Resultado vazio (sem chave, erro transitório)
    // vira throw DENTRO do cache — o helper descacheia em erro, então a próxima
    // carga tenta de novo em vez de servir vazio o dia todo.
    let texto: string | null = null;
    try {
      texto = await cached(chave, 24 * 60 * 60_000, async () => {
        // Candidatos a causa lidos AQUI, no servidor — o cliente não manda (e não
        // deveria): são fatos do banco que explicam os números, e é o que permite
        // o NEXO dizer POR QUE caiu em vez de só que caiu.
        const sinais = await coletarSinaisDeCausa().catch(() => []);
        const t = await narrarBriefing({ ...snapshot, data: dia, saudacao, sinais }, modo);
        if (t == null) throw new Error("narração indisponível");
        return t;
      });
    } catch {
      texto = null;
    }
    if (texto) guardarNarracao(chaveDoPonteiro(modo, escopo, saudacao, dia), texto);
    return NextResponse.json({ texto, gerado: texto != null });
  });
}
