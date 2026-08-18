const crypto = require("crypto")
const ALGORITHM = "aes-256-gcm"

function getKey() {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY is missing or invalid — set a 64-char hex string (32 bytes) in your .env. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return Buffer.from(hex, "hex")
}
function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`
}

function decryptField(stored) {
  if (stored === null || stored === undefined || stored === "") return stored
  const parts = String(stored).split(":")
  if (parts.length !== 3) return stored // not our format (e.g. pre-encryption legacy plaintext)
  try {
    const [ivHex, authTagHex, ciphertextHex] = parts
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"))
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ])
    return plaintext.toString("utf8")
  } catch {
    return stored // couldn't decrypt (wrong key / corrupted) — fail safe, don't crash the request
  }
}

module.exports = { encryptField, decryptField }
