import { currentAdmin, unauthorized } from "@/lib/auth";
import { audit, db } from "@/lib/db";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return Response.json({ error: "Sem permissão" }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "0000-01-01";
  const to = url.searchParams.get("to") || "9999-12-31";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    return Response.json({ error: "Período inválido" }, { status: 400 });
  const rows = db.prepare(`SELECT a.server_time,p.code,p.name,a.device_label AS label,a.decision,a.reason
    FROM attempts a LEFT JOIN people p ON p.id=a.person_id
    WHERE a.server_time >= ? AND a.server_time < ? ORDER BY a.server_time DESC LIMIT 10000`)
    .all(`${from}T00:00:00`, `${to}T23:59:59.999Z`) as Record<string, unknown>[];
  const csvCell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [["horario_servidor", "matricula", "pessoa", "aparelho", "decisao", "motivo"].join(";"),
    ...rows.map(row => [row.server_time, row.code, row.name, row.label, row.decision, row.reason].map(csvCell).join(";"))];
  audit(admin.id, "attempts.export", `${from}:${to}`);
  return new Response("\ufeff" + lines.join("\r\n"), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=tentativas.csv",
    "Cache-Control": "no-store"
  }});
}
