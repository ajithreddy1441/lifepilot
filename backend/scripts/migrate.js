const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { pool } = require('../config/db');
const { ensureUserDefaults } = require('../models/userModel');

async function ensureColumn(table, column, ddl) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [env.db.name, table, column],
  );
  if (!Number(rows[0].n)) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`✓ ${table}.${column}`);
  }
}

async function bootstrapAdmin() {
  if (!env.adminEmail || !env.adminPassword) {
    console.log('• Skip admin bootstrap (set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env)');
    return;
  }
  if (env.adminPassword.length < 8) {
    console.warn('• ADMIN_PASSWORD must be at least 8 characters — admin not created');
    return;
  }
  const hash = await bcrypt.hash(env.adminPassword, 12);
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [env.adminEmail]);
  if (rows.length) {
    await pool.query("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?", [hash, rows[0].id]);
    console.log(`✓ Admin password refreshed for ${env.adminEmail}`);
    return;
  }
  const [res] = await pool.query(
    'INSERT INTO users (name, email, password_hash, timezone, role) VALUES (?, ?, ?, ?, ?)',
    ['LifePilot Admin', env.adminEmail, hash, env.defaultTimezone, 'admin'],
  );
  await ensureUserDefaults(res.insertId);
  await pool.query('UPDATE user_preferences SET onboarded = 1 WHERE user_id = ?', [res.insertId]);
  console.log(`✓ Admin account created: ${env.adminEmail}`);
}

async function main() {
  if (env.missing.length) {
    console.error(`Missing env vars: ${env.missing.join(', ')}. Copy .env.example to .env first.`);
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  for (const stmt of statements) {
    const name = (stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1] || stmt.slice(0, 40);
    await pool.query(stmt);
    console.log(`✓ ${name}`);
  }

  await ensureColumn('users', 'role', "role ENUM('user','admin') NOT NULL DEFAULT 'user'");
  await ensureColumn('users', 'last_seen_at', 'last_seen_at DATETIME NULL');

  await bootstrapAdmin();

  console.log(`\nMigration complete (${statements.length} statements).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
