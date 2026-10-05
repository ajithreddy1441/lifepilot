const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { pool } = require('../config/db');

async function ensureColumn(table, column, ddl) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [env.db.name, table, column],
  );
  if (!Number(rows[0].n)) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  }
}

async function schemaReady() {
  try {
    await pool.query('SELECT id FROM users LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

let migrating = null;

async function runMigrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await pool.query(stmt);
  }

  await ensureColumn('users', 'role', "role ENUM('user','admin') NOT NULL DEFAULT 'user'");
  await ensureColumn('users', 'last_seen_at', 'last_seen_at DATETIME NULL');
  return statements.length;
}

function migrateOnce() {
  if (!migrating) {
    migrating = runMigrate().catch((err) => {
      migrating = null;
      throw err;
    });
  }
  return migrating;
}

module.exports = { ensureColumn, schemaReady, runMigrate, migrateOnce };
