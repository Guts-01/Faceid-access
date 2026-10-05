import { clearSession, currentAdmin, sameOrigin, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return unauthorized();
  audit(admin.id, "logout");
  await clearSession();
  return Response.json({ ok: true });
}
