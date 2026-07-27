import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { dbQuery, hasDb } from "./db";
import { optionalWorkspaceId } from "./workspaceScope";

// Preferência de painel por workspace (ADR-005). Guarda quais KPIs aparecem e em
// que ordem, referenciando IDs estáveis de widget. Ausência de registro = default
// (tudo visível, ordem canônica) — usuário novo não precisa de escrita nenhuma.
// Segue o mesmo padrão do persistentCache: PostgreSQL quando há banco+workspace,
// arquivo local só como fallback de dev.

export interface DashboardLayout {
  order: string[]; // IDs na ordem desejada
  hidden: string[]; // IDs ocultados
}

const KEY_PREFIX = "dashboard_layout:";

function file(view: string): string {
  const scopedKey = `${optionalWorkspaceId() ?? "public"}_${KEY_PREFIX}${view}`;
  return dataFile("settings", `${scopedKey.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

export async function getDashboardLayout(view: string): Promise<DashboardLayout | null> {
  const workspaceId = optionalWorkspaceId();
  const key = `${KEY_PREFIX}${view}`;
  if (hasDb() && workspaceId) {
    const rows = await dbQuery<{ value: DashboardLayout }>(
      `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
      [workspaceId, key]
    );
    return rows[0]?.value ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(file(view), "utf8")) as DashboardLayout;
  } catch {
    return null;
  }
}

export async function setDashboardLayout(view: string, layout: DashboardLayout): Promise<void> {
  const workspaceId = optionalWorkspaceId();
  const key = `${KEY_PREFIX}${view}`;
  if (hasDb() && workspaceId) {
    await dbQuery(
      `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (workspace_id, key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = now()`,
      [workspaceId, key, JSON.stringify(layout)]
    );
    return;
  }
  const f = file(view);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(layout), "utf8");
}
