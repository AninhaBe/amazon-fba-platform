import zlib from "zlib";
import { spapiFetch, defaultMarketplaceId } from "./spapi";

// Reports API v2021-06-30 — cria um relatório, espera processar e baixa o conteúdo (TSV).

interface CreateReportResp {
  reportId: string;
}
interface ReportResp {
  processingStatus: string;
  reportDocumentId?: string;
}
interface DocResp {
  url: string;
  compressionAlgorithm?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cria um relatório, aguarda o processamento e devolve o conteúdo como texto (TSV). */
export async function runReport(
  reportType: string,
  marketplaceId = defaultMarketplaceId()
): Promise<string> {
  const created = await spapiFetch<CreateReportResp>("/reports/2021-06-30/reports", {
    method: "POST",
    body: { reportType, marketplaceIds: [marketplaceId] },
  });

  // Poll até DONE (máx ~45s).
  let documentId: string | undefined;
  for (let i = 0; i < 15; i++) {
    const rep = await spapiFetch<ReportResp>(`/reports/2021-06-30/reports/${created.reportId}`);
    if (rep.processingStatus === "DONE") {
      documentId = rep.reportDocumentId;
      break;
    }
    if (rep.processingStatus === "FATAL" || rep.processingStatus === "CANCELLED") {
      throw new Error(`Relatório ${rep.processingStatus}`);
    }
    await sleep(3000);
  }
  if (!documentId) throw new Error("Tempo esgotado ao gerar o relatório.");

  const doc = await spapiFetch<DocResp>(`/reports/2021-06-30/documents/${documentId}`);
  const res = await fetch(doc.url); // URL pré-assinada — sem header de auth
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = doc.compressionAlgorithm === "GZIP" ? zlib.gunzipSync(buf) : buf;
  // O relatório de anúncios vem em UTF-8 (com BOM).
  return raw.toString("utf8");
}

/** Faz o parse de um TSV (cabeçalho na 1ª linha) em objetos por nome de coluna. */
export function parseTsv(text: string): Record<string, string>[] {
  // Remove BOM (UTF-8 ou o equivalente lido como latin1) do início.
  const clean = text.replace(/^﻿/, "").replace(/^ï»¿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}
