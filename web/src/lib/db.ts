import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const globalDb = globalThis as typeof globalThis & { catracaDb?: DatabaseSync };
function getDb(): DatabaseSync {
  if (globalDb.catracaDb) return globalDb.catracaDb;
  const path = resolve(/* turbopackIgnore: true */ process.env.CATRACA_DB_PATH || "data/catraca.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  connection.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','operator')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limits (
  email TEXT PRIMARY KEY, failures INTEGER NOT NULL, locked_until TEXT
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, access_allowed INTEGER NOT NULL DEFAULT 0,
  payment_due_date TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, public_key TEXT,
  active INTEGER NOT NULL DEFAULT 1, paired_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollment_tokens (
  token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL, PRIMARY KEY(device_id, person_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  device_label TEXT NOT NULL,
  person_id TEXT REFERENCES people(id), face_result TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allowed','denied')),
  reason TEXT NOT NULL, device_time TEXT, server_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_time ON attempts(server_time DESC);
CREATE TABLE IF NOT EXISTS attempt_adjustments (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id),
  actor_id TEXT NOT NULL REFERENCES admins(id), note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempt_adjustments_attempt ON attempt_adjustments(attempt_id,created_at DESC);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, at TEXT NOT NULL
);
`);
  // Bancos criados antes do controle de mensalidade continuam utilizáveis.
  const columns = connection.prepare("PRAGMA table_info(people)").all() as { name: string }[];
  if (!columns.some(column => column.name === "payment_due_date"))
    connection.exec("ALTER TABLE people ADD COLUMN payment_due_date TEXT");
  const attemptColumns = connection.prepare("PRAGMA table_info(attempts)").all() as { name: string }[];
  if (!attemptColumns.some(column => column.name === "device_label")) {
    // Preserva tentativas e ajustes antigos ao permitir excluir o aparelho vinculado.
    connection.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
    try {
      connection.exec(`CREATE TABLE attempts_new (
        id TEXT PRIMARY KEY, device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        device_label TEXT NOT NULL, person_id TEXT REFERENCES people(id),
        face_result TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('allowed','denied')),
        reason TEXT NOT NULL, device_time TEXT, server_time TEXT NOT NULL
      );
      INSERT INTO attempts_new(id,device_id,device_label,person_id,face_result,decision,reason,device_time,server_time)
        SELECT a.id,CASE WHEN d.id IS NULL THEN NULL ELSE a.device_id END,
          COALESCE(d.label,'Aparelho excluído'),a.person_id,a.face_result,a.decision,a.reason,a.device_time,a.server_time
        FROM attempts a LEFT JOIN devices d ON d.id=a.device_id;
      DROP TABLE attempts;
      ALTER TABLE attempts_new RENAME TO attempts;
      CREATE INDEX attempts_time ON attempts(server_time DESC);
      COMMIT;`);
    } catch (error) {
      connection.exec("ROLLBACK;");
      throw error;
    } finally {
      connection.exec("PRAGMA foreign_keys=ON;");
    }
  }
  globalDb.catracaDb = connection;
  return connection;
}
export const db = new Proxy({} as DatabaseSync, {
  get(_target, key) {
    const connection = getDb();
    const value = Reflect.get(connection, key);
    return typeof value === "function" ? value.bind(connection) : value;
  }
});

export function now() { return new Date().toISOString(); }
export function businessDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function audit(actor: string, action: string, target?: string) {
  db.prepare("INSERT INTO audit VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), actor, action, target ?? null, now());
}
