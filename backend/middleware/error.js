const env = require('../config/env');

function publicMessage(err) {
  const code = err.code || err.errno;
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 1045 || /Access denied for user/i.test(err.message || '')) {
    return 'Cannot reach the database. Check DB_HOST in backend/.env — Hostinger credentials only work on the server (localhost) or with Remote MySQL enabled from this PC.';
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'PROTOCOL_CONNECTION_LOST') {
    return 'The LifePilot server cannot connect to MySQL. Confirm the database is running and DB_HOST is correct.';
  }
  if (code === 'ER_BAD_DB_ERROR' || code === 1049) {
    return 'Database not found. Run npm run migrate in the backend folder.';
  }
  if (err.status && err.status < 500) return err.message;
  if (env.isProd) return 'Something went wrong';
  return err.message;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.code && String(err.code).startsWith('ER_') ? 503 : err.code === 'ECONNREFUSED' ? 503 : 500);
  if (status >= 500 || status === 503) console.error(`[${req.method} ${req.originalUrl}]`, err.code || '', err.message);
  res.status(status).json({
    error: publicMessage(err),
    details: err.details,
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

module.exports = { errorHandler, notFoundHandler };
