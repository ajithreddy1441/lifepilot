const { HttpError } = require('../utils/http');

/** Validates req[source] with a zod schema and replaces it with the parsed (coerced) value. */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new HttpError(422, details[0] ? `${details[0].field || 'input'}: ${details[0].message}` : 'Invalid input', details));
  }
  req[source === 'body' ? 'body' : `valid${source[0].toUpperCase()}${source.slice(1)}`] = result.data;
  next();
};

module.exports = { validate };
