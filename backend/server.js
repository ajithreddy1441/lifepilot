const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { pool } = require('./config/db');
const { migrateOnce, schemaReady } = require('./db/migrateLib');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error');

const isServerless = Boolean(process.env.VERCEL);

if (env.missing.length) {
  console.error(`\n✗ Missing required env vars: ${env.missing.join(', ')}\n  Copy backend/.env.example to backend/.env (or set them in Vercel) and fill them in.\n`);
  if (!isServerless) process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // The SPA needs inline theme bootstrap, Google Fonts, and the service worker.
  contentSecurityPolicy: false,
}));
app.use(
  cors({
    origin(origin, cb) {
      // Native apps (Capacitor) send capacitor://localhost or https://localhost; allow configured origins only.
      if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
      return cb(Object.assign(new Error(`Origin ${origin} not allowed by CORS`), { status: 403 }));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/', (_req, res) => {
  res.json({
    ok: !env.missing.length,
    service: 'lifepilot-api',
    missing: env.missing.length ? env.missing : undefined,
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const schema = await schemaReady();
    if (!schema) {
      await migrateOnce();
    }
    res.json({
      ok: true,
      db: 'up',
      schema: (await schemaReady()) ? 'up' : 'missing',
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      db: 'down',
      error: env.isProd ? err.code || 'db_error' : err.message,
    });
  }
});

app.use('/api', routes);
app.use('/api', notFoundHandler);

// Optional: serve the built frontend from the same Node app (single-domain Hostinger deploy).
const dist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

if (!isServerless) {
  app.listen(env.port, () => {
    console.log(`LifePilot AI API listening on :${env.port} (${env.nodeEnv})`);
    if (env.runWorkerInProcess) require('./workers/schedulerWorker').start();
  });
}

module.exports = app;
