"use client";
import { FormEvent, useState } from "react";

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
      if (!response.ok) throw new Error((await response.json()).error);
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha de conexão"); setBusy(false); }
  }
  return <main className="login-shell"><div className="login-card">
    <div className="eyebrow">CONTROLE LOCAL</div><h1>FaceId access</h1>
    <p>Entre para acompanhar as tentativas de acesso e administrar o ponto de entrada.</p>
    <form onSubmit={submit}><label>E-mail<input name="email" type="email" required autoComplete="username" /></label>
      <label>Senha<input name="password" type="password" required autoComplete="current-password" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button></form>
  </div></main>;
}
