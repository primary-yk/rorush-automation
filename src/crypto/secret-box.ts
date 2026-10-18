import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LEN = 12;

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    tag,
    enc,
  ]).toString("base64");
}

export function decryptSecret(payloadB64: string, key: Buffer): string {
  const buf = Buffer.from(payloadB64, "base64");
  if (buf[0] !== VERSION) {
    throw new Error("Unsupported secret payload version.");
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + 16);
  const data = buf.subarray(1 + IV_LEN + 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
