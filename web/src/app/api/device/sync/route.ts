import { db } from "@/lib/db";
import { verifyDevice } from "@/lib/device";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const raw = await request.text();
  const device = await verifyDevice(request, raw);
  if (!device) return Response.json({ error: "Aparelho não autenticado" }, { status: 401 });
  const people = db.prepare("SELECT person_id FROM enrollments WHERE device_id=?").all(device.id) as { person_id: string }[];
  return Response.json({ personIds: people.map(person => person.person_id) },
    { headers: { "Cache-Control": "no-store" } });
}
