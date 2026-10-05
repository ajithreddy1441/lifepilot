const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: bool(process.env.DB_SSL),
  },

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',

  ai: {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    transcribeModel: process.env.AI_TRANSCRIBE_MODEL || 'whisper-1',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT_JSON || '',

  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  runWorkerInProcess: bool(process.env.RUN_WORKER_IN_PROCESS, true),
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS || 30000),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',

  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
};

const missing = [];
if (!env.db.name) missing.push('DB_NAME');
if (!env.db.user) missing.push('DB_USER');
if (!env.jwtSecret) missing.push('JWT_SECRET');
env.missing = missing;

module.exports = env;
