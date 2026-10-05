import { currentAdmin, sameOrigin, unauthorized } from "@/lib/auth";
import { audit, db, now } from "@/lib/db";

export const runtime = "nodejs";
function dueDate(value: unknown): string | null | undefined {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const code = String(body?.code ?? "").trim();
  const paymentDueDate = dueDate(body?.payment_due_date);
  if (!name || name.length > 100 || !/^[A-Za-z0-9._-]{2,40}$/.test(code))
    return Response.json({ error: "Nome ou código inválido" }, { status: 400 });
  if (paymentDueDate === undefined) return Response.json({ error: "Vencimento inválido" }, { status: 400 });
  const id = crypto.randomUUID();
  try {
    db.prepare("INSERT INTO people(id,code,name,payment_due_date,created_at) VALUES (?,?,?,?,?)")
      .run(id, code, name, paymentDueDate, now());
  } catch { return Response.json({ error: "Código já cadastrado" }, { status: 409 }); }
  audit(admin.id, "person.create", id);
  return Response.json({ id }, { status: 201 });
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.id || !["active", "access_allowed", "name", "code", "payment_due_date"].includes(body.field))
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const field = body.field as "active" | "access_allowed" | "name" | "code" | "payment_due_date";
  let value: string | number | null;
  if (field === "name") {
    value = String(body.value ?? "").trim();
    if (!value || value.length > 100) return Response.json({ error: "Nome inválido" }, { status: 400 });
  } else if (field === "code") {
    value = String(body.value ?? "").trim();
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(value)) return Response.json({ error: "Código inválido" }, { status: 400 });
  } else if (field === "payment_due_date") {
    const parsed = dueDate(body.value);
    if (parsed === undefined) return Response.json({ error: "Vencimento inválido" }, { status: 400 });
    value = parsed;
  } else {
    if (typeof body.value !== "boolean") return Response.json({ error: "Valor inválido" }, { status: 400 });
    value = body.value ? 1 : 0;
  }
  let result;
  try { result = db.prepare(`UPDATE people SET ${field}=? WHERE id=?`).run(value, body.id); }
  catch { return Response.json({ error: "Código já utilizado" }, { status: 409 }); }
  if (!result.changes) return Response.json({ error: "Pessoa não encontrada" }, { status: 404 });
  audit(admin.id, `person.${field}`, body.id);
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
    return Response.json({ error: "Pessoa inválida" }, { status: 400 });
  db.exec("BEGIN IMMEDIATE");
  try {
    const exists = db.prepare("SELECT 1 FROM people WHERE id=?").get(id);
    if (!exists) { db.exec("ROLLBACK"); return Response.json({ error: "Pessoa não encontrada" }, { status: 404 }); }
    // Preserva as decisões históricas, mas remove a associação com o cadastro excluído.
    db.prepare("UPDATE attempts SET person_id=NULL WHERE person_id=?").run(id);
    db.prepare("DELETE FROM people WHERE id=?").run(id);
    audit(admin.id, "person.delete", id);
    db.exec("COMMIT");
    return Response.json({ ok: true });
  } catch {
    db.exec("ROLLBACK");
    return Response.json({ error: "Falha ao excluir pessoa" }, { status: 500 });
  }
}
