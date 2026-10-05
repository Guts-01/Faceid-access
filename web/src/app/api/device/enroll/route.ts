import { hashToken } from "@/lib/auth";
import { audit, db, now } from "@/lib/db";
import { verifyDevice } from "@/lib/device";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const raw = await request.text();
  const device = await verifyDevice(request, raw);
  if (!device) return Response.json({ error: "Aparelho não autenticado" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }
  const token = String(body?.token ?? "");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(`SELECT t.person_id,p.code,p.name FROM enrollment_tokens t JOIN people p ON p.id=t.person_id
      WHERE t.token_hash=? AND t.device_id=? AND t.expires_at>? AND p.active=1`).get(hashToken(token), device.id, now()) as { person_id: string; code: string; name: string } | undefined;
    if (!row) { db.exec("ROLLBACK"); return Response.json({ error: "Código expirado ou usado" }, { status: 403 }); }
    db.prepare("INSERT OR REPLACE INTO enrollments VALUES (?,?,?)").run(device.id, row.person_id, now());
    db.prepare("DELETE FROM enrollment_tokens WHERE token_hash=?").run(hashToken(token));
    audit(`device:${device.id}`, "enrollment.confirm", row.person_id);
    db.exec("COMMIT");
    return Response.json({ personId: row.person_id, code: row.code, name: row.name });
  } catch { db.exec("ROLLBACK"); return Response.json({ error: "Falha no cadastro" }, { status: 500 }); }
}
