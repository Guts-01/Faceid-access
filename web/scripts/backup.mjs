import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.CATRACA_DB_PATH || 'data/catraca.sqlite');
if (!existsSync(source)) throw new Error(`Banco não encontrado: ${source}`);
const target = resolve(process.argv[2] || `data/backups/catraca-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
if (source === target || existsSync(target)) throw new Error('Destino inválido ou já existente.');
mkdirSync(dirname(target), { recursive: true });
const temporary = target + '.partial';
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, temporary);
  renameSync(temporary, target);
  console.log(`Backup consistente criado: ${target}`);
} catch (error) {
  rmSync(temporary, { force: true });
  throw error;
} finally { db.close(); }
