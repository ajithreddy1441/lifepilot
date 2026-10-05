class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

module.exports = { HttpError, asyncHandler, notFound };
