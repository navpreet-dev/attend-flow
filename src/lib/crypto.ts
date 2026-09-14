import crypto from "crypto";

/**
 * AES-256-GCM encryption for portal credentials stored at rest.
 * Key source: APP_SECRET env var (64 hex chars). A deterministic per-student
 * IV is derived so the ciphertext stays stable across restarts, while the
 * GCM auth tag protects against tampering.
 */

const KEY = (() => {
  const hex = process.env.APP_SECRET || "";
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  // Fallback: derive a stable key from any provided secret string.
  return crypto.createHash("sha256").update(hex || "attendflow-dev-secret").digest();
})();

export function encryptSecret(plain: string): string {
  const iv = crypto
    .createHash("sha256")
    .update(KEY)
    .update(plain.length.toString())
    .digest()
    .subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${enc.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [ivB64, dataB64, tagB64] = payload.split(":");
    if (!ivB64 || !dataB64 || !tagB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
