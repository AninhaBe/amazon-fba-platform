import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORÁRIO — existe só para descobrir de qual IP o Render sai quando chama
// APIs externas. É esse endereço que a Shopee exige no IP Whitelist do Go Live
// (ver docs/api-shopee.md). Remover assim que a lista estiver declarada.
//
// Não expõe segredo: o IP de saída já é visível para qualquer serviço que a
// aplicação chama. Consulta dois refletores independentes porque um deles pode
// estar fora do ar, e repete para revelar rotação de NAT, se houver.
const REFLETORES = ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"];

async function consultar(url: string): Promise<string | null> {
  try {
    const resposta = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
    if (!resposta.ok) return null;
    return (await resposta.text()).trim();
  } catch {
    return null;
  }
}

export async function GET() {
  // Três rodadas: se o Render usar mais de um IP de saída, a repetição tende a
  // mostrar. Uma leitura só nunca prova que o conjunto tem um elemento.
  const rodadas = await Promise.all(
    [0, 1, 2].map(() => Promise.all(REFLETORES.map(consultar)))
  );
  const vistos = [...new Set(rodadas.flat().filter((ip): ip is string => !!ip))];
  return NextResponse.json({ ipsObservados: vistos, rodadas });
}
