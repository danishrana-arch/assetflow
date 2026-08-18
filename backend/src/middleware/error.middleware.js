function notFound(req, res, next) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` })
}

function errorHandler(err, req, res, next) {
  console.error(err)

  if (err.code === "P2002") {
    return res.status(409).json({ error: `Duplicate value for field(s): ${err.meta?.target}` })
  }
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found" })
  }
  if (err.code === "P2003") {
    return res.status(409).json({ error: "This action is blocked by related records that still reference it" })
  }

  const status = err.status || 500
  const isProd = process.env.NODE_ENV === "production"
  // Don't leak internal error details (stack traces, driver messages) to
  // clients in production; the full error is still logged above.
  const message = status >= 500 && isProd ? "Internal server error" : err.message || "Internal server error"
  res.status(status).json({ error: message })
}

module.exports = { notFound, errorHandler }
