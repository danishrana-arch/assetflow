const http = require("http")
const https = require("https")
const { URL } = require("url")
function requestRelay(relayUrl, secret, action, seconds) {
  return new Promise((resolve, reject) => {
    const u = new URL(relayUrl)
    const body = JSON.stringify({ action, seconds })
    const lib = u.protocol === "https:" ? https : http
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: `${u.pathname}${u.search}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(secret ? { "X-Relay-Secret": secret } : {}) } }, res => {
      let b=""; res.on("data", c=>b+=c); res.on("end", ()=> res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`relay returned ${res.statusCode}: ${b}`)))
    })
    req.on("error", reject); req.setTimeout(8000, ()=>req.destroy(new Error("relay timeout"))); req.write(body); req.end()
  })
}
async function unlockDoor(relayUrl, secret, seconds) {
  const duration = Math.max(1, Math.min(120, Number(seconds || 5)))
  await requestRelay(relayUrl, secret, "unlock", duration)
  await new Promise(r => setTimeout(r, duration * 1000))
  await requestRelay(relayUrl, secret, "lock", 0)
}
module.exports={unlockDoor}
