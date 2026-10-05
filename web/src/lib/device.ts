import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { db } from "./db";

type Device = { id: string; label: string; active: number; public_key: string | null };
export async function verifyDevice(request: Request, body: string): Promise<Device | null> {
  const id = request.headers.get("x-device-id");
  const timestamp = request.headers.get("x-device-time");
  const requestId = request.headers.get("x-request-id");
  const signature = request.headers.get("x-device-signature");
  if (!id || !timestamp || !requestId || !signature || !/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 120_000) return null;
  const device = db.prepare("SELECT id,label,active,public_key FROM devices WHERE id=?").get(id) as Device | undefined;
  if (!device?.active || !device.public_key) return null;
  try {
    const key = createPublicKey({ key: Buffer.from(device.public_key, "base64"), format: "der", type: "spki" });
    const message = Buffer.from(`${timestamp}\n${requestId}\n${body}`);
    const bytes = Buffer.from(signature, "base64");
    return verify("sha256", message, key, bytes) ? device : null;
  } catch { return null; }
}
