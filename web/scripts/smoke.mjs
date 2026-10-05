import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createSign, generateKeyPairSync, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const port = 31987;
const base = `http://127.0.0.1:${port}`;
const file = resolve('data/smoke.sqlite');
mkdirSync(resolve('data'), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
const db = new DatabaseSync(file);
db.exec(`CREATE TABLE admins (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL)`);
// Reproduz um banco da versão anterior para verificar a migração automática.
db.exec(`CREATE TABLE people (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, access_allowed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
const salt = randomBytes(16);
const password = 'test-only-password-123';
const adminId = crypto.randomUUID();
db.prepare('INSERT INTO admins VALUES (?,?,?,?,?)').run(adminId, 'smoke@example.test',
  `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`, 'admin', new Date().toISOString());
db.exec(`CREATE TABLE devices (id TEXT PRIMARY KEY,label TEXT NOT NULL,public_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,paired_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE attempts (id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),
  person_id TEXT REFERENCES people(id),face_result TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allowed','denied')),
  reason TEXT NOT NULL,device_time TEXT,server_time TEXT NOT NULL);
CREATE TABLE attempt_adjustments (id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES attempts(id),
  actor_id TEXT NOT NULL REFERENCES admins(id),note TEXT NOT NULL,created_at TEXT NOT NULL);`);
const legacyDeviceId = crypto.randomUUID();
const legacyAttemptId = crypto.randomUUID();
db.prepare('INSERT INTO devices(id,label,active,created_at) VALUES (?,?,?,?)')
  .run(legacyDeviceId, 'Aparelho legado', 0, '2000-01-01T00:00:00.000Z');
db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)')
  .run(legacyAttemptId, legacyDeviceId, null, 'no_match', 'denied', 'unknown_face', null, '2000-01-01T00:00:00.000Z');
db.prepare('INSERT INTO attempt_adjustments VALUES (?,?,?,?,?)')
  .run(crypto.randomUUID(), legacyAttemptId, adminId, 'Registro legado', '2000-01-01T00:00:00.000Z');
db.close();
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'],
  { env: { ...process.env, CATRACA_DB_PATH: file }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
async function wait() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base); if (r.ok) return; } catch { /* wait */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start: ${serverOutput}`);
}
let cookie = '';
async function api(path, method, body, headers = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', origin: base, cookie, ...headers },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return { response, data };
}
function signed(body, deviceId, privateKey) {
  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const raw = JSON.stringify(body);
  const signer = createSign('sha256');
  signer.update(`${timestamp}\n${id}\n${raw}`);
  return { 'x-device-id': deviceId, 'x-device-time': timestamp, 'x-request-id': id,
    'x-device-signature': signer.sign(privateKey).toString('base64') };
}
const todayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const datePart = type => todayParts.find(part => part.type === type).value;
const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
const shiftDay = days => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
try {
  await wait();
  const login = await api('/api/auth/login', 'POST', { email: 'smoke@example.test', password });
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  const migrated = (await api('/api/state', 'GET')).data;
  if (migrated.latest?.device_label !== 'Aparelho legado' || migrated.latest?.adjustment_note !== 'Registro legado')
    throw new Error('Historical attempt migration failed');
  const person = (await api('/api/people', 'POST', { name: 'Pessoa Teste', code: 'TESTE1' })).data;
  const device = (await api('/api/devices', 'POST', { label: 'Entrada teste' })).data;
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const paired = (await api('/api/device/pair', 'POST', { token: device.token, publicKey })).data;
  if (paired.deviceId !== device.id) throw new Error('Pairing mismatch');
  const ticket = (await api('/api/enrollment-token', 'POST', { personId: person.id, deviceId: device.id })).data;
  const enrollBody = { token: ticket.token };
  const enrolled = (await api('/api/device/enroll', 'POST', enrollBody, signed(enrollBody, device.id, keys.privateKey))).data;
  if (enrolled.personId !== person.id) throw new Error('Enrollment mismatch');
  const syncBody = {};
  const beforeDeleteSync = (await api('/api/device/sync', 'POST', syncBody, signed(syncBody, device.id, keys.privateKey))).data;
  if (!beforeDeleteSync.personIds.includes(person.id)) throw new Error('Missing template in synchronization');
  const attemptBody = { personId: person.id, faceResult: 'matched', deviceTime: new Date().toISOString() };
  const denied = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (denied.decision !== 'denied' || denied.reason !== 'access_disabled') throw new Error('Expected denied');
  await api('/api/people', 'PATCH', { id: person.id, field: 'access_allowed', value: true });
  const allowed = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (allowed.decision !== 'allowed') throw new Error('Expected allowed');
  await api('/api/people', 'PATCH', { id: person.id, field: 'payment_due_date', value: shiftDay(-1) });
  const overdue = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (overdue.decision !== 'denied' || overdue.reason !== 'payment_overdue') throw new Error('Expected overdue denial');
  await api('/api/people', 'PATCH', { id: person.id, field: 'payment_due_date', value: today });
  const dueToday = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (dueToday.decision !== 'allowed') throw new Error('Due date should be inclusive');
  await api('/api/people', 'PATCH', { id: person.id, field: 'payment_due_date', value: shiftDay(1) });
  await api('/api/people', 'PATCH', { id: person.id, field: 'access_allowed', value: false });
  const manuallyDenied = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (manuallyDenied.decision !== 'denied' || manuallyDenied.reason !== 'access_disabled') throw new Error('Manual block must override future due date');
  const invalidDate = await fetch(base + '/api/people', { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ id: person.id, field: 'payment_due_date', value: '2026-02-30' }) });
  if (invalidDate.status !== 400) throw new Error('Invalid date accepted');
  await api('/api/people', 'PATCH', { id: person.id, field: 'access_allowed', value: true });
  const future = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (future.decision !== 'allowed') throw new Error('Expected future due date to allow');
  const csv = await fetch(base + '/api/export', { headers: { cookie } });
  if (!csv.ok || !(await csv.text()).includes('Pessoa Teste')) throw new Error('CSV export failed');
  const state = (await api('/api/state', 'GET')).data;
  if (state.attempts.length !== 5 || state.totals.attempts !== 7 || state.people[0].payment_due_date !== shiftDay(1) || state.today !== today || state.audit.length > 10)
    throw new Error('State or display limit mismatch');
  await api('/api/people', 'PATCH', { id: person.id, field: 'name', value: 'Pessoa Atualizada' });
  const filtered = (await api('/api/state?decision=allowed', 'GET')).data;
  if (filtered.attempts.length !== 3 || filtered.latest.decision !== 'allowed') throw new Error('Filter mismatch');
  await api('/api/adjustments', 'POST', { attemptId: allowed.id, note: 'Conferido pelo administrador' });
  const adjusted = (await api('/api/state', 'GET')).data;
  if (adjusted.attempts.find(attempt => attempt.id === allowed.id)?.adjustment_note !== 'Conferido pelo administrador' || !adjusted.audit.length)
    throw new Error('Adjustment or audit mismatch');
  await api('/api/people', 'DELETE', { id: person.id });
  const afterDelete = (await api('/api/state', 'GET')).data;
  if (afterDelete.people.length || afterDelete.totals.attempts !== 7 || afterDelete.attempts.some(attempt => attempt.person_name !== null) ||
      afterDelete.audit[0].action !== 'person.delete') throw new Error('Deletion failed to preserve anonymous history');
  const afterDeleteSync = (await api('/api/device/sync', 'POST', syncBody, signed(syncBody, device.id, keys.privateKey))).data;
  if (afterDeleteSync.personIds.includes(person.id)) throw new Error('Deleted template still synchronized');
  const deletedAttempt = (await api('/api/device/attempt', 'POST', attemptBody, signed(attemptBody, device.id, keys.privateKey))).data;
  if (deletedAttempt.decision !== 'denied' || deletedAttempt.reason !== 'unknown_person') throw new Error('Deleted person still authorized');
  await api('/api/devices', 'PATCH', { id: device.id, active: false });
  const revokedHeaders = signed(attemptBody, device.id, keys.privateKey);
  const revoked = await fetch(base + '/api/device/attempt', {
    method: 'POST', headers: { 'content-type': 'application/json', ...revokedHeaders }, body: JSON.stringify(attemptBody)
  });
  if (revoked.status !== 401) throw new Error('Revoked device accepted');
  await api('/api/devices', 'PATCH', { id: device.id, active: true });
  await api('/api/device/sync', 'POST', syncBody, signed(syncBody, device.id, keys.privateKey));
  await api('/api/devices', 'DELETE', { id: device.id });
  const afterDeviceDelete = (await api('/api/state', 'GET')).data;
  if (afterDeviceDelete.devices.some(item => item.id === device.id) || afterDeviceDelete.totals.attempts !== 8 ||
      afterDeviceDelete.latest.device_id !== null || afterDeviceDelete.latest.device_label !== 'Entrada teste' ||
      afterDeviceDelete.audit[0].action !== 'device.delete') throw new Error('Device deletion lost history or left device active');
  const exported = await fetch(base + '/api/export', { headers: { cookie } });
  if (!exported.ok || !(await exported.text()).includes('Entrada teste')) throw new Error('Deleted device missing from history export');
  const deletedHeaders = signed(attemptBody, device.id, keys.privateKey);
  const deletedDeviceAttempt = await fetch(base + '/api/device/attempt', {
    method: 'POST', headers: { 'content-type': 'application/json', ...deletedHeaders }, body: JSON.stringify(attemptBody)
  });
  if (deletedDeviceAttempt.status !== 401) throw new Error('Deleted device accepted');
  const checked = new DatabaseSync(file, { readOnly: true });
  try {
    if (checked.prepare('PRAGMA foreign_key_check').all().length ||
        checked.prepare('SELECT COUNT(*) AS count FROM attempt_adjustments WHERE attempt_id=?').get(legacyAttemptId).count !== 1)
      throw new Error('Migration or deletion broke foreign keys or historical adjustments');
  } finally { checked.close(); }
  console.log('Smoke OK: migração do histórico, autenticação, autorização, vencimento, exclusões, sincronização e revogação.');
} finally {
  child.kill();
}
