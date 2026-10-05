import { currentAdmin, unauthorized } from "@/lib/auth";
import { businessDate, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  const query = new URL(request.url).searchParams;
  const people = db.prepare(`SELECT p.id,p.code,p.name,p.active,p.access_allowed,p.payment_due_date,
    (SELECT COUNT(*) FROM enrollments e WHERE e.person_id=p.id) AS enrollment_count
    FROM people p ORDER BY p.name`).all();
  const devices = db.prepare(`SELECT d.id,d.label,d.active,d.paired_at,
    (SELECT MAX(server_time) FROM attempts a WHERE a.device_id=d.id) AS last_attempt
    FROM devices d ORDER BY d.created_at DESC`).all();
  const where: string[] = [];
  const values: string[] = [];
  const personId = query.get("personId");
  const deviceId = query.get("deviceId");
  const decision = query.get("decision");
  const from = query.get("from");
  const to = query.get("to");
  if (personId && /^[0-9a-f-]{36}$/i.test(personId)) { where.push("a.person_id=?"); values.push(personId); }
  if (deviceId && /^[0-9a-f-]{36}$/i.test(deviceId)) { where.push("a.device_id=?"); values.push(deviceId); }
  if (decision && ["allowed", "denied"].includes(decision)) { where.push("a.decision=?"); values.push(decision); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("a.server_time>=?"); values.push(`${from}T00:00:00`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("a.server_time<=?"); values.push(`${to}T23:59:59.999Z`); }
  const base = `SELECT a.id,a.device_id,a.device_label,a.person_id,p.name AS person_name,
    a.face_result,a.decision,a.reason,a.server_time,
    (SELECT note FROM attempt_adjustments x WHERE x.attempt_id=a.id ORDER BY x.created_at DESC LIMIT 1) AS adjustment_note
    FROM attempts a LEFT JOIN people p ON p.id=a.person_id`;
  const attempts = db.prepare(`${base}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY a.server_time DESC LIMIT 5`).all(...values);
  const latest = db.prepare(`${base} ORDER BY a.server_time DESC LIMIT 1`).get();
  const auditRows = admin.role === "admin" ? db.prepare("SELECT actor,action,target,at FROM audit ORDER BY at DESC LIMIT 10").all() : [];
  const totals = db.prepare(`SELECT
    (SELECT COUNT(*) FROM attempts) AS attempts,
    (SELECT COUNT(*) FROM people WHERE active=1) AS active_people,
    (SELECT COUNT(*) FROM devices WHERE active=1 AND paired_at IS NOT NULL) AS connected_devices`).get();
  return Response.json({ admin: { email: admin.email, role: admin.role }, today: businessDate(), people, devices, attempts, latest, audit: auditRows, totals },
    { headers: { "Cache-Control": "no-store" } });
}
