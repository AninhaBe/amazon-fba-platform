import crypto from "crypto";

const PREFIX = "enc:v1:";
const PLAIN_PREFIX = "plain:";

function encryptionKey(): Buffer | null {
  const value = process.env.INTEGRATION_TOKEN_KEY;
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest();
}

export function protectSecret(value?: string): string | undefined {
  if (!value) return undefined;
  const key = encryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Configure INTEGRATION_TOKEN_KEY para proteger tokens em produção.");
    }
    return `${PLAIN_PREFIX}${value}`;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function revealSecret(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.startsWith(PLAIN_PREFIX)) return value.slice(PLAIN_PREFIX.length);
  if (!value.startsWith(PREFIX)) return value;

  const key = encryptionKey();
  if (!key) throw new Error("INTEGRATION_TOKEN_KEY ausente; não é possível descriptografar tokens.");
  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
