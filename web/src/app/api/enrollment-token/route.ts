import { currentAdmin, hashToken, makeToken, sameOrigin, unauthorized } from "@/lib/auth";
import { audit, db } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const person = db.prepare("SELECT id FROM people WHERE id=? AND active=1").get(String(body?.personId ?? ""));
  const device = db.prepare("SELECT id FROM devices WHERE id=? AND active=1 AND public_key IS NOT NULL").get(String(body?.deviceId ?? ""));
  if (!person || !device) return Response.json({ error: "Pessoa ou aparelho indisponível" }, { status: 400 });
  const token = makeToken();
  db.prepare("INSERT INTO enrollment_tokens VALUES (?,?,?,?)").run(hashToken(token), body.deviceId, body.personId, new Date(Date.now() + 10 * 60_000).toISOString());
  audit(admin.id, "enrollment.ticket", body.personId);
  return Response.json({ token, expiresInMinutes: 10 });
}
