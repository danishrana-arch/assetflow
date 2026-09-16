// Applied to endpoints that return PII (employee detail, payroll,
// attendance-site assignment) so browsers/proxies never cache the response.
function noStore(req, res, next) {
  res.set("Cache-Control", "no-store")
  next()
}

module.exports = { noStore }
