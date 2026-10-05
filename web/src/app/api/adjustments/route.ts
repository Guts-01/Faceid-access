import { currentAdmin, sameOrigin, unauthorized } from "@/lib/auth";
import { audit, db, now } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const attemptId = String(body?.attemptId ?? "");
  const note = String(body?.note ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !note || note.length > 500)
    return Response.json({ error: "Ajuste inválido" }, { status: 400 });
  if (!db.prepare("SELECT 1 FROM attempts WHERE id=?").get(attemptId))
    return Response.json({ error: "Tentativa não encontrada" }, { status: 404 });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO attempt_adjustments VALUES (?,?,?,?,?)").run(id, attemptId, admin.id, note, now());
  audit(admin.id, "attempt.adjust", attemptId);
  return Response.json({ id }, { status: 201 });
}
