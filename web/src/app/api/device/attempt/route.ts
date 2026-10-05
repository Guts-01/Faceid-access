import { audit, businessDate, db, now } from "@/lib/db";
import { verifyDevice } from "@/lib/device";

export const runtime = "nodejs";
type Attempt = { id: string; device_id: string; person_id: string | null; decision: string; reason: string; server_time: string };
export async function POST(request: Request) {
  const raw = await request.text();
  const device = await verifyDevice(request, raw);
  if (!device) return Response.json({ error: "Aparelho não autenticado" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = request.headers.get("x-request-id")!;
  const faceResult = String(body.faceResult ?? "");
  const personId = body.personId == null ? null : String(body.personId);
  const deviceTime = body.deviceTime == null ? null : String(body.deviceTime);
  if (!["matched", "no_match", "pad_failed"].includes(faceResult) || (personId && !/^[0-9a-f-]{36}$/i.test(personId)))
    return Response.json({ error: "Tentativa inválida" }, { status: 400 });
  if (faceResult === "matched" && !personId) return Response.json({ error: "Pessoa obrigatória" }, { status: 400 });
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT * FROM attempts WHERE id=?").get(id) as Attempt | undefined;
    if (existing) {
      db.exec("COMMIT");
      if (existing.device_id !== device.id) return Response.json({ error: "ID duplicado" }, { status: 409 });
      return Response.json({ id, decision: existing.decision, reason: existing.reason, serverTime: existing.server_time });
    }
    const person = personId ? db.prepare("SELECT active,access_allowed,payment_due_date FROM people WHERE id=?").get(personId) as { active: number; access_allowed: number; payment_due_date: string | null } | undefined : undefined;
    const enrollment = personId ? db.prepare("SELECT 1 FROM enrollments WHERE device_id=? AND person_id=?").get(device.id, personId) : undefined;
    let reason = "authorized";
    if (faceResult === "pad_failed") reason = "presence_failed";
    else if (faceResult === "no_match") reason = "unknown_face";
    else if (!person || !enrollment) reason = "unknown_person";
    else if (!person.active) reason = "inactive_person";
    else if (!person.access_allowed) reason = "access_disabled";
    else if (person.payment_due_date && person.payment_due_date < businessDate()) reason = "payment_overdue";
    const decision = reason === "authorized" ? "allowed" : "denied";
    const serverTime = now();
    db.prepare(`INSERT INTO attempts(id,device_id,device_label,person_id,face_result,decision,reason,device_time,server_time)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, device.id, device.label, person ? personId : null, faceResult, decision, reason, deviceTime, serverTime);
    audit(`device:${device.id}`, "access.attempt", id);
    db.exec("COMMIT");
    return Response.json({ id, decision, reason, serverTime });
  } catch { db.exec("ROLLBACK"); return Response.json({ error: "Falha ao registrar" }, { status: 500 }); }
}
