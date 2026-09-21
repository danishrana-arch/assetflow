function ts() {
  return new Date().toISOString()
}

function line(level, msg, meta) {
  const base = `[${ts()}] [${level}] ${msg}`
  if (meta && Object.keys(meta).length) {
    try { return `${base} ${JSON.stringify(meta)}` } catch { return base }
  }
  return base
}

module.exports = {
  info: (msg, meta) => console.log(line("INFO", msg, meta)),
  warn: (msg, meta) => console.warn(line("WARN", msg, meta)),
  error: (msg, meta) => console.error(line("ERROR", msg, meta)),
  debug: (msg, meta) => { if (process.env.LOG_LEVEL === "debug") console.log(line("DEBUG", msg, meta)) },
}
