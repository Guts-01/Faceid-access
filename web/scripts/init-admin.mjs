import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const dbPath = resolve(process.env.CATRACA_DB_PATH || 'data/catraca.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','operator')), created_at TEXT NOT NULL
)`);
const rl = createInterface({ input: stdin, output: stdout });
try {
  const role = process.argv[2] === 'operator' ? 'operator' : 'admin';
  const email = (await rl.question(`E-mail do ${role === 'admin' ? 'administrador' : 'operador'}: `)).trim().toLowerCase();
  if (!email.includes('@')) throw new Error('E-mail inválido.');
  if (db.prepare('SELECT 1 FROM admins WHERE email=?').get(email)) {
    console.error(`O e-mail ${email} já está cadastrado no banco. Nenhuma conta foi criada.`);
    process.exitCode = 1;
  } else {
    const password = await rl.question('Senha (mínimo 12 caracteres): ');
    if (password.length < 12) throw new Error('Senha curta.');
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    const stored = `${salt.toString('hex')}:${hash.toString('hex')}`;
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO admins(id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)`)
      .run(id, email, stored, role, new Date().toISOString());
    console.log(`${role === 'admin' ? 'Administrador' : 'Operador'} criado. Banco:`, dbPath);
  }
} finally { rl.close(); db.close(); }
