import { createPublicKey } from "node:crypto";
import { hashToken } from "@/lib/auth";
import { audit, db, now } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token ?? "");
  const publicKey = String(body?.publicKey ?? "");
  if (token.length < 30 || publicKey.length > 2000) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec") throw new Error("key type");
  } catch { return Response.json({ error: "Chave inválida" }, { status: 400 }); }
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(`SELECT t.device_id FROM pairing_tokens t JOIN devices d ON d.id=t.device_id
      WHERE t.token_hash=? AND t.expires_at>? AND d.active=1 AND d.public_key IS NULL`).get(hashToken(token), now()) as { device_id: string } | undefined;
    if (!row) { db.exec("ROLLBACK"); return Response.json({ error: "Código expirado ou usado" }, { status: 403 }); }
    db.prepare("UPDATE devices SET public_key=?,paired_at=? WHERE id=?").run(publicKey, now(), row.device_id);
    db.prepare("DELETE FROM pairing_tokens WHERE token_hash=?").run(hashToken(token));
    audit(`device:${row.device_id}`, "device.pair", row.device_id);
    db.exec("COMMIT");
    return Response.json({ deviceId: row.device_id });
  } catch { db.exec("ROLLBACK"); return Response.json({ error: "Falha ao parear" }, { status: 500 }); }
}
