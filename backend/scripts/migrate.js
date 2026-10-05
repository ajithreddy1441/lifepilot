const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { pool } = require('../config/db');
const { ensureUserDefaults } = require('../models/userModel');
const { runMigrate } = require('../db/migrateLib');

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
  const n = await runMigrate();
  await bootstrapAdmin();
  console.log(`\nMigration complete (${n} statements).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
