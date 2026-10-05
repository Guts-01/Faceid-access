import { currentAdmin, hashToken, makeToken, sameOrigin, unauthorized } from "@/lib/auth";
import { audit, db, now } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const label = String(body?.label ?? "").trim();
  if (!label || label.length > 80) return Response.json({ error: "Nome inválido" }, { status: 400 });
  const id = crypto.randomUUID();
  const token = makeToken();
  db.prepare("INSERT INTO devices(id,label,created_at) VALUES (?,?,?)").run(id, label, now());
  db.prepare("INSERT INTO pairing_tokens VALUES (?,?,?)").run(hashToken(token), id, new Date(Date.now() + 10 * 60_000).toISOString());
  audit(admin.id, "device.create", id);
  return Response.json({ id, token, expiresInMinutes: 10 }, { status: 201 });
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.id || typeof body.active !== "boolean") return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const result = db.prepare("UPDATE devices SET active=? WHERE id=?").run(body.active ? 1 : 0, body.id);
  if (!result.changes) return Response.json({ error: "Aparelho não encontrado" }, { status: 404 });
  audit(admin.id, body.active ? "device.activate" : "device.revoke", body.id);
  return Response.json({ ok: true });
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ error: "Aparelho inválido" }, { status: 400 });
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("DELETE FROM devices WHERE id=?").run(id);
    if (!result.changes) {
      db.exec("ROLLBACK");
      return Response.json({ error: "Aparelho não encontrado" }, { status: 404 });
    }
    audit(admin.id, "device.delete", id);
    db.exec("COMMIT");
    return Response.json({ ok: true });
  } catch {
    db.exec("ROLLBACK");
    return Response.json({ error: "Falha ao excluir aparelho" }, { status: 500 });
  }
}
