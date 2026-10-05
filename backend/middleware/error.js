const env = require('../config/env');
const { HttpError } = require('../utils/http');

function publicMessage(err) {
  const code = err.code || err.errno;
  if (err instanceof HttpError) return err.message;
  if (code === 'ER_NO_SUCH_TABLE' || code === 1146) {
    return 'Database tables are missing. Redeploy the API so it can create them, or run npm run migrate against this database.';
  }
  if (code === 'ER_BAD_FIELD_ERROR' || code === 1054) {
    return 'The database schema is out of date. Redeploy the API or run npm run migrate.';
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 1045 || /Access denied for user/i.test(err.message || '')) {
    return 'Cannot reach the database. On Vercel, DB_HOST cannot be localhost — use the Hostinger MySQL hostname and enable Remote MySQL.';
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'PROTOCOL_CONNECTION_LOST') {
    return 'The LifePilot server cannot connect to MySQL. Confirm DB_HOST, DB_PORT, DB_SSL, and that Remote MySQL allows Vercel.';
  }
  if (code === 'ER_BAD_DB_ERROR' || code === 1049) {
    return 'Database not found. Check DB_NAME in Vercel environment variables.';
  }
  if (code === 'ER_DUP_ENTRY' || code === 1062) {
    return 'An account with this email already exists';
  }
  if (err.status && err.status < 500) return err.message;
  if (env.isProd && code) return `Database error (${code}). Check Vercel function logs for this request.`;
  if (env.isProd) return 'Something went wrong';
  return err.message;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.code && String(err.code).startsWith('ER_') ? 503 : err.code === 'ECONNREFUSED' ? 503 : 500);
  if (status >= 500 || status === 503) console.error(`[${req.method} ${req.originalUrl}]`, err.code || '', err.message);
  res.status(status).json({
    error: publicMessage(err),
    code: err.code || undefined,
    details: err.details,
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

module.exports = { errorHandler, notFoundHandler };
