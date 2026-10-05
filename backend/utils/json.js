// MariaDB exposes JSON as LONGTEXT, so JSON-ish columns are stored as TEXT and parsed here.
function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const toJson = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

module.exports = { parseJson, toJson };
