import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "FaceidAccess", description: "Painel local de controle de acesso" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
