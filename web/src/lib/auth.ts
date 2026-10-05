import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, now } from "./db";

export type Admin = { id: string; email: string; role: "admin" | "operator" };
const SESSION = "catraca_session";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const makeToken = () => randomBytes(32).toString("base64url");

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}
export async function currentAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get(SESSION)?.value;
  if (!token) return null;
  return (db.prepare(`SELECT a.id,a.email,a.role FROM sessions s JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), now()) as Admin | undefined) ?? null;
}
export function issueSession(adminId: string) {
  const token = makeToken();
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hashToken(token), adminId, expires.toISOString());
  return { token, expires };
}
export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires });
}
export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(SESSION)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
  jar.delete(SESSION);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
export const unauthorized = () => Response.json({ error: "Não autorizado" }, { status: 401 });
