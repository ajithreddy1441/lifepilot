require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const { DB_NAME: db, DB_USER: user, DB_PASSWORD: pass } = process.env;
  const c = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: pass,
    multipleStatements: true,
  });
  await c.query(
    `CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await c.query(`CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?`, [user, pass]);
  await c.query(`CREATE USER IF NOT EXISTS ?@'127.0.0.1' IDENTIFIED BY ?`, [user, pass]);
  await c.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@'localhost'`, [user]);
  await c.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@'127.0.0.1'`, [user]);
  await c.query('FLUSH PRIVILEGES');
  console.log(`Local database ready: ${db} / ${user}`);
  await c.end();
})().catch((err) => {
  console.error(err.code, err.sqlMessage || err.message);
  process.exit(1);
});
