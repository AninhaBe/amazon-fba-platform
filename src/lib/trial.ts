import { dbQuery, hasDb } from "./db";
import { currentWorkspaceId } from "./workspaceScope";

// Período de avaliação por workspace.
//
// Guardado em workspace_settings (chave `trial`) — a tabela já existe e é por
// workspace, então não precisa migration nem coluna nova em auth.users.
//
// O que este módulo faz e o que NÃO faz:
//   - marca início/fim e diz quantos dias faltam (para o aviso na interface);
//   - ao expirar, o acesso é bloqueado (reversível: basta estender a data).
//   - NÃO apaga nada. Excluir a conta é ação destrutiva e fica com a dona do
//     produto, por script explícito — nunca automática por vencimento.

const SETTING_KEY = "trial";
const DAY = 86_400_000;

export interface TrialInfo {
  startsAt: string;
  endsAt: string;
  /** Dias inteiros restantes; 0 no último dia; negativo depois de vencido. */
  daysLeft: number;
  expired: boolean;
  note?: string;
}

interface StoredTrial {
  startsAt: string;
  endsAt: string;
  note?: string;
}

function describe(stored: StoredTrial): TrialInfo {
  const endsAt = new Date(stored.endsAt).getTime();
  const daysLeft = Math.ceil((endsAt - Date.now()) / DAY);
  return {
    startsAt: stored.startsAt,
    endsAt: stored.endsAt,
    daysLeft,
    expired: Date.now() > endsAt,
    note: stored.note,
  };
}

/** Trial do workspace atual, ou null quando a conta não é de avaliação. */
export async function getTrial(): Promise<TrialInfo | null> {
  if (!hasDb()) return null;
  const rows = await dbQuery<{ value: StoredTrial }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [currentWorkspaceId(), SETTING_KEY]
  );
  const stored = rows[0]?.value;
  if (!stored?.endsAt) return null;
  return describe(stored);
}

/** Idem, para um workspace específico (uso administrativo/scripts). */
export async function getTrialFor(workspaceId: string): Promise<TrialInfo | null> {
  if (!hasDb()) return null;
  const rows = await dbQuery<{ value: StoredTrial }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, SETTING_KEY]
  );
  const stored = rows[0]?.value;
  if (!stored?.endsAt) return null;
  return describe(stored);
}

export async function setTrial(
  workspaceId: string,
  input: { startsAt: Date; days: number; note?: string }
): Promise<TrialInfo> {
  const startsAt = input.startsAt.toISOString();
  const endsAt = new Date(input.startsAt.getTime() + input.days * DAY).toISOString();
  const value: StoredTrial = { startsAt, endsAt, note: input.note };
  await dbQuery(
    `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [workspaceId, SETTING_KEY, JSON.stringify(value)]
  );
  return describe(value);
}

export async function clearTrial(workspaceId: string): Promise<void> {
  await dbQuery(`DELETE FROM workspace_settings WHERE workspace_id = $1 AND key = $2`, [
    workspaceId,
    SETTING_KEY,
  ]);
}
