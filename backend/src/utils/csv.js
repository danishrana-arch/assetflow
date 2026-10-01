// `delimiter` defaults to ","; utils/sheet.js passes "\t" or ";" for TSV
// and European-locale Excel CSVs.
function parseCsv(text, delimiter = ",") {
  const rows = []
  let row = []
  let field = ""
  let inQuotes = false
  // Normalize line endings so \r\n and \r alone don't produce empty rows.
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field.trim())
      field = ""
    } else if (char === "\n") {
      row.push(field.trim())
      if (row.some((c) => c !== "")) rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field.trim())
    if (row.some((c) => c !== "")) rows.push(row)
  }

  return rows
}

module.exports = { parseCsv }
