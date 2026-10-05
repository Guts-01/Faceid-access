import { currentAdmin } from "@/lib/auth";
import Dashboard from "./ui/dashboard";
import Login from "./ui/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Home() {
  const admin = await currentAdmin();
  return admin ? <Dashboard /> : <Login />;
}
