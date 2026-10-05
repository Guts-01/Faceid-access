import { db, audit } from "@/lib/db";
import { issueSession, sameOrigin, setSessionCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (email.length > 254 || password.length > 1024) return Response.json({ error: "Credenciais inválidas" }, { status: 401 });
  const limit = db.prepare("SELECT failures,locked_until FROM login_limits WHERE email=?").get(email) as { failures: number; locked_until: string | null } | undefined;
  if (limit?.locked_until && limit.locked_until > new Date().toISOString())
    return Response.json({ error: "Muitas tentativas. Tente mais tarde." }, { status: 429 });
  const admin = db.prepare("SELECT id,password_hash FROM admins WHERE email=?").get(email) as { id: string; password_hash: string } | undefined;
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    const failures = (limit?.failures ?? 0) + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 5 * 60_000).toISOString() : null;
    db.prepare(`INSERT INTO login_limits(email,failures,locked_until) VALUES (?,?,?)
      ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until`).run(email, failures, lockedUntil);
    return Response.json({ error: "Credenciais inválidas" }, { status: 401 });
  }
  db.prepare("DELETE FROM login_limits WHERE email=?").run(email);
  const { token, expires } = issueSession(admin.id);
  await setSessionCookie(token, expires);
  audit(admin.id, "login");
  return Response.json({ ok: true });
}
