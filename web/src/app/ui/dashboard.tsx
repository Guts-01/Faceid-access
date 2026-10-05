"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Person = { id: string; code: string; name: string; active: number; access_allowed: number; payment_due_date: string | null; enrollment_count: number };
type Device = { id: string; label: string; active: number; paired_at: string | null; last_attempt: string | null };
type Attempt = { id: string; device_label: string; person_name: string | null; decision: "allowed" | "denied"; reason: string; server_time: string; adjustment_note: string | null };
type Audit = { actor: string; action: string; target: string | null; at: string };
type State = { admin: { email: string; role: string }; today: string; people: Person[]; devices: Device[]; attempts: Attempt[]; latest: Attempt | null; audit: Audit[]; totals: { attempts: number; active_people: number; connected_devices: number } };
type View = "overview" | "people" | "devices" | "enrollment" | "audit";

const reasonLabel: Record<string, string> = {
  authorized: "Pessoa autorizada", presence_failed: "Prova de presença falhou", unknown_face: "Rosto não reconhecido",
  unknown_person: "Cadastro facial indisponível", inactive_person: "Pessoa inativa", access_disabled: "Acesso desativado",
  payment_overdue: "Mensalidade vencida"
};
const auditLabel: Record<string, string> = {
  "person.create": "Pessoa cadastrada", "person.delete": "Pessoa excluída", "person.active": "Estado da pessoa alterado",
  "person.access_allowed": "Permissão de acesso alterada", "person.payment_due_date": "Vencimento alterado",
  "person.name": "Nome alterado", "person.code": "Matrícula alterada", "access.attempt": "Tentativa de acesso",
  "enrollment.ticket": "Código facial gerado", "enrollment.confirm": "Rosto cadastrado",
  "attempts.export": "Histórico exportado", "device.activate": "Aparelho ativado", "device.revoke": "Aparelho revogado",
  "device.delete": "Aparelho excluído"
};
const formatDate = (date: string) => date.split("-").reverse().join("/");
const formatTime = (date: string) => new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>("overview");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pair, setPair] = useState<{ id: string; token: string } | null>(null);
  const [enroll, setEnroll] = useState<{ token: string; name: string } | null>(null);
  const [selectedPerson, setSelectedPerson] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");
  const [filterPerson, setFilterPerson] = useState("");
  const [filterDevice, setFilterDevice] = useState("");
  const [filterDecision, setFilterDecision] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterPerson) params.set("personId", filterPerson);
    if (filterDevice) params.set("deviceId", filterDevice);
    if (filterDecision) params.set("decision", filterDecision);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    try {
      const response = await fetch(`/api/state?${params}`, { cache: "no-store" });
      if (response.status === 401) { window.location.reload(); return; }
      if (!response.ok) throw new Error("Painel indisponível");
      setState(await response.json());
      setOnline(true);
    } catch { setOnline(false); }
  }, [filterPerson, filterDevice, filterDecision, filterFrom, filterTo]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);

  async function call(path: string, method: string, body?: object) {
    setError(""); setNotice(""); setPending(true);
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha na operação");
      await refresh();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão");
      return null;
    } finally { setPending(false); }
  }
  async function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await call("/api/people", "POST", Object.fromEntries(new FormData(form)))) {
      form.reset(); setNotice("Usuário cadastrado com sucesso. autorize o acesso e gere um código facial.");
    }
  }
  async function editPerson(event: FormEvent<HTMLFormElement>, person: Person) {
    event.preventDefault();
    const form = event.currentTarget;
    const details = form.closest("details");
    const data = new FormData(form);
    const fields = { name: String(data.get("name")), code: String(data.get("code")), payment_due_date: String(data.get("payment_due_date")) };
    for (const [field, value] of Object.entries(fields)) {
      if (value !== String(person[field as keyof typeof fields] ?? "") && !(await call("/api/people", "PATCH", { id: person.id, field, value }))) return;
    }
    if (details) details.open = false;
    setNotice("Cadastro atualizado.");
  }
  async function deletePerson(person: Person) {
    if (!window.confirm(`Excluir ${person.name}? O cadastro facial perderá a autorização, e as tentativas anteriores ficarão sem o nome do usuário. Essa ação não pode ser desfeita.`)) return;
    if (await call("/api/people", "DELETE", { id: person.id })) {
      if (selectedPerson === person.id) setSelectedPerson("");
      if (filterPerson === person.id) setFilterPerson("");
      setEnroll(null);
      setNotice(`${person.name} foi excluído(a). O aparelho removerá o rosto local na próxima sincronização.`);
    }
  }
  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await call("/api/devices", "POST", { label: String(new FormData(form).get("label")) });
    if (result) { setPair({ id: result.id, token: result.token }); form.reset(); }
  }
  async function deleteDevice(device: Device) {
    if (!window.confirm(`Excluir ${device.label}? O aparelho perderá o acesso imediatamente. As tentativas anteriores continuarão no histórico. Essa ação não pode ser desfeita.`)) return;
    if (await call("/api/devices", "DELETE", { id: device.id })) {
      if (selectedDevice === device.id) { setSelectedDevice(""); setEnroll(null); }
      if (filterDevice === device.id) setFilterDevice("");
      if (pair?.id === device.id) setPair(null);
      setNotice(`${device.label} foi excluído. Para remover os rostos guardados no celular, limpe os dados do aplicativo no Android.`);
    }
  }
  async function ticket() {
    const person = state?.people.find(item => item.id === selectedPerson);
    const result = await call("/api/enrollment-token", "POST", { personId: selectedPerson, deviceId: selectedDevice });
    if (result) setEnroll({ token: result.token, name: person?.name ?? "Pessoa" });
  }

  const admin = state?.admin.role === "admin";
  const latest = state?.latest;
  const today = state?.today ?? "";
  const nav: { id: View; label: string; number?: number }[] = [
    { id: "overview", label: "Visão geral" },
    { id: "people", label: "Pessoas", number: state?.people.length },
    { id: "devices", label: "Aparelhos", number: state?.devices.length },
    ...(admin ? [{ id: "enrollment" as View, label: "Cadastro facial" }, { id: "audit" as View, label: "Auditoria" }] : [])
  ];

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navegação do painel">
      <div className="brand"><span className="brand-mark">F</span><div><strong>FaceId access</strong><small>Painel local</small></div></div>
      <nav className="side-nav">{nav.map(item => <button type="button" key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}><span>{item.label}</span>{item.number !== undefined && <span className="nav-count">{item.number}</span>}</button>)}</nav>
      <div className="sidebar-foot"><span className="sidebar-role">{admin ? "Administrador" : "Operador"}</span><small title={state?.admin.email}>{state?.admin.email}</small><button type="button" className="quiet-button" onClick={async () => { await call("/api/auth/logout", "POST"); window.location.reload(); }}>Sair do painel</button></div>
    </aside>
    <main className="main-content">
      <header className="page-header"><div><div className="eyebrow">CONTROLE DE ACESSO / {nav.find(item => item.id === view)?.label.toUpperCase()}</div><h1>{nav.find(item => item.id === view)?.label}</h1><p>Simulação de acesso com decisão central no servidor.</p></div><span className={online ? "system-status online" : "system-status offline"}><span className="status-dot" />{online ? "Painel conectado" : "Sem conexão"}</span></header>
      {error && <div role="alert" className="banner error">{error}</div>}
      {notice && <div role="status" className="banner">{notice}</div>}
      {!state && <section className="surface"><p className="empty">Carregando dados do painel…</p></section>}

      {view === "overview" && state && <>
        <div className="summary-grid">
          <section className="metric"><span>Pessoas ativas</span><strong>{state.totals.active_people}</strong><small>Cadastros habilitados</small></section>
          <section className="metric"><span>Aparelhos pareados</span><strong>{state.totals.connected_devices}</strong><small>Em operação no sistema</small></section>
          <section className="metric"><span>Tentativas registradas</span><strong>{state.totals.attempts}</strong><small>Histórico total no banco</small></section>
        </div>
        <section className="surface latest"><div className="section-title"><div><div className="eyebrow">MONITORAMENTO</div><h2>Última tentativa</h2></div><span className="minor">Atualiza a cada 3 segundos</span></div>
          {latest ? <div className="latest-body"><div className={latest.decision === "allowed" ? "decision-symbol allowed" : "decision-symbol denied"}>{latest.decision === "allowed" ? "✓" : "×"}</div><div><div className={latest.decision === "allowed" ? "decision-text allowed" : "decision-text denied"}>{latest.decision === "allowed" ? "Acesso autorizado" : "Acesso negado"}</div><h3>{latest.person_name || "Pessoa não identificada"}</h3><p>{reasonLabel[latest.reason] || latest.reason} · {latest.device_label}</p><small>{formatTime(latest.server_time)}</small></div></div> : <p className="empty">Aguardando a primeira tentativa do celular.</p>}
        </section>
        <section className="surface"><div className="section-title"><div><h2>Últimas 5 tentativas</h2><p>Use os filtros para encontrar as tentativas mais recentes de cada seleção.</p></div>{admin && <a className="outline-link" href="/api/export">Exportar CSV completo</a>}</div>
          <div className="filters"><label>Pessoa<select value={filterPerson} onChange={event => setFilterPerson(event.target.value)}><option value="">Todas</option>{state.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Aparelho<select value={filterDevice} onChange={event => setFilterDevice(event.target.value)}><option value="">Todos</option>{state.devices.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label><label>Decisão<select value={filterDecision} onChange={event => setFilterDecision(event.target.value)}><option value="">Todas</option><option value="allowed">Autorizado</option><option value="denied">Negado</option></select></label><label>De<input type="date" value={filterFrom} onChange={event => setFilterFrom(event.target.value)} /></label><label>Até<input type="date" value={filterTo} onChange={event => setFilterTo(event.target.value)} /></label></div>
          <div className="table-wrap"><table><thead><tr><th>Horário</th><th>Pessoa</th><th>Aparelho</th><th>Decisão</th><th>Motivo</th>{admin && <th>Ação</th>}</tr></thead><tbody>{state.attempts.map(attempt => <tr key={attempt.id}><td>{formatTime(attempt.server_time)}</td><td>{attempt.person_name || "Sem identificação"}</td><td>{attempt.device_label}</td><td><span className={`pill ${attempt.decision}`}>{attempt.decision === "allowed" ? "Autorizado" : "Negado"}</span></td><td>{reasonLabel[attempt.reason] || attempt.reason}{attempt.adjustment_note && <small className="subline">Ajuste: {attempt.adjustment_note}</small>}</td>{admin && <td><details><summary>Anotar</summary><form className="small-form" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; if (await call("/api/adjustments", "POST", { attemptId: attempt.id, note: String(new FormData(form).get("note")) })) form.reset(); }}><input name="note" aria-label="Motivo do ajuste" placeholder="Motivo do ajuste" required maxLength={500} /><button disabled={pending}>Salvar</button></form></details></td>}</tr>)}</tbody></table>{!state.attempts.length && <p className="empty">Nenhuma tentativa encontrada para estes filtros.</p>}</div>
        </section>
      </>}

      {view === "people" && state && <>
        <section className="surface"><div className="section-title"><div><h2>Cadastro de pessoas</h2><p>A câmera identifica o rosto; o servidor confere a autorização e o vencimento.</p></div><span className="minor">{state.people.length} cadastro(s)</span></div>
          {admin && <form className="form-grid" onSubmit={addPerson}><label>Nome completo<input name="name" placeholder="Nome da pessoa" required maxLength={100} /></label><label>Matrícula<input name="code" placeholder="Ex.: A001" required pattern="[A-Za-z0-9._-]{2,40}" /></label><label>Vencimento opcional<input name="payment_due_date" type="date" /></label><button disabled={pending}>Adicionar pessoa</button></form>}
          <p className="help-text">O acesso começa desativado. Com vencimento definido, o dia da data ainda é válido; depois disso, a entrada é negada.</p>
        </section>
        <section className="surface"><div className="section-title"><div><h2>Pessoas cadastradas</h2><p>Controle individual de presença e mensalidade.</p></div></div>
          {state.people.length ? <div className="person-list">{state.people.map(person => <article className="person-row" key={person.id}><div className="person-main"><span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span><div><h3>{person.name}</h3><p>{person.code} · Rosto em {person.enrollment_count} aparelho(s)</p><span className={person.payment_due_date && person.payment_due_date < today ? "date-tag overdue" : "date-tag"}>{person.payment_due_date ? `${person.payment_due_date < today ? "Vencido em" : "Válido até"} ${formatDate(person.payment_due_date)}` : "Sem vencimento"}</span></div></div><div className="person-controls"><label className="check-control"><input type="checkbox" checked={!!person.active} disabled={!admin || pending} onChange={event => void call("/api/people", "PATCH", { id: person.id, field: "active", value: event.target.checked })} />Pessoa ativa</label><label className="check-control"><input type="checkbox" checked={!!person.access_allowed} disabled={!admin || pending} onChange={event => void call("/api/people", "PATCH", { id: person.id, field: "access_allowed", value: event.target.checked })} />Autorizar acesso</label></div>{admin && <div className="person-actions"><details><summary className="text-action">Editar</summary><form className="edit-form" onSubmit={event => void editPerson(event, person)}><label>Nome<input name="name" defaultValue={person.name} required maxLength={100} /></label><label>Matrícula<input name="code" defaultValue={person.code} required pattern="[A-Za-z0-9._-]{2,40}" /></label><label>Vencimento<input name="payment_due_date" type="date" defaultValue={person.payment_due_date ?? ""} /></label><button disabled={pending}>Salvar alterações</button></form></details><button type="button" className="text-action danger" disabled={pending} onClick={() => void deletePerson(person)}>Excluir</button></div>}</article>)}</div> : <p className="empty">Nenhuma pessoa cadastrada. Use o formulário acima para começar.</p>}
        </section>
      </>}

      {view === "devices" && state && <>
        <section className="surface"><div className="section-title"><div><h2>Aparelhos</h2><p>Cadastre o celular usado como câmera do ponto de entrada.</p></div></div>{admin && <form className="form-grid compact" onSubmit={addDevice}><label>Nome do ponto de entrada<input name="label" placeholder="Ex.: Entrada principal" required maxLength={80} /></label><button disabled={pending}>Adicionar aparelho</button></form>}
          {pair && <div className="secret-box"><div><strong>Código de pareamento</strong><small>Válido por 10 minutos; exibido apenas agora.</small></div><code>{pair.token}</code><button type="button" className="outline-button" onClick={() => void navigator.clipboard.writeText(pair.token)}>Copiar código</button></div>}
        </section>
        <section className="surface"><h2>Aparelhos cadastrados</h2>{state.devices.length ? <div className="device-list">{state.devices.map(device =>
          <div className="device-row" key={device.id}>
            <div className="device-main"><strong>{device.label}</strong><small>{device.paired_at ? "Pareado" : "Aguardando pareamento"} · {device.last_attempt ? `Última tentativa: ${formatTime(device.last_attempt)}` : "Sem tentativas"}</small></div>
            <span className={device.active ? "pill neutral" : "pill denied"}>{device.active ? "Ativo" : "Revogado"}</span>
            {admin && <div className="device-actions">
              <button type="button" className="outline-button" disabled={pending} onClick={() => void call("/api/devices", "PATCH", { id: device.id, active: !device.active })}>{device.active ? "Revogar" : "Ativar"}</button>
              <button type="button" className="text-action danger" disabled={pending} onClick={() => void deleteDevice(device)}>Excluir</button>
            </div>}
          </div>)}</div> : <p className="empty">Nenhum aparelho cadastrado.</p>}</section>
      </>}

      {view === "enrollment" && admin && state && <section className="surface narrow"><div className="step-count">ETAPA DE CADASTRO FACIAL</div><h2>Gerar código de cadastro</h2><p>Confirme a identidade pessoalmente. O código fica válido por 10 minutos e serve para um aparelho específico.</p><div className="form-grid stacked"><label>Pessoa<select value={selectedPerson} onChange={event => setSelectedPerson(event.target.value)}><option value="">Selecione uma pessoa</option>{state.people.filter(person => person.active).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Aparelho pareado<select value={selectedDevice} onChange={event => setSelectedDevice(event.target.value)}><option value="">Selecione um aparelho</option>{state.devices.filter(device => device.active && device.paired_at).map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label><button type="button" disabled={!selectedPerson || !selectedDevice || pending} onClick={() => void ticket()}>Gerar código</button></div>{enroll && <div className="secret-box"><div><strong>Cadastro de {enroll.name}</strong><small>Digite no aplicativo após enquadrar o rosto.</small></div><code>{enroll.token}</code><button type="button" className="outline-button" onClick={() => void navigator.clipboard.writeText(enroll.token)}>Copiar código</button></div>}</section>}

      {view === "audit" && admin && state && <section className="surface"><div className="section-title"><div><h2>Últimos 10 registros de auditoria</h2><p>As ações anteriores continuam armazenadas no banco.</p></div></div><div className="table-wrap"><table><thead><tr><th>Horário</th><th>Ação</th><th>Ator</th><th>Alvo</th></tr></thead><tbody>{state.audit.map((item, index) => <tr key={index}><td>{formatTime(item.at)}</td><td>{auditLabel[item.action] || item.action}</td><td>{item.actor}</td><td className="mono">{item.target || "—"}</td></tr>)}</tbody></table>{!state.audit.length && <p className="empty">Ainda não há ações de auditoria.</p>}</div></section>}
      <footer>Simulação visual. Nenhum comando é enviado a uma catraca física.</footer>
    </main>
  </div>;
}
