import { useState } from "react"
import { Download, FileSpreadsheet, Users, Boxes, Building2, Ticket } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"

const EXPORTS = [
  { key: "employees", label: "Employees", filename: "Employees.xlsx", icon: Users, tone: "blue", desc: "Full employee directory" },
  { key: "inventory", label: "Inventory", filename: "Inventory.xlsx", icon: Boxes, tone: "purple", desc: "All assets and their assignment" },
  { key: "departments", label: "Departments", filename: "Departments.xlsx", icon: Building2, tone: "cyan", desc: "Departments with counts" },
  { key: "tickets", label: "Tickets", filename: "Tickets.xlsx", icon: Ticket, tone: "orange", desc: "Open and resolved support tickets" },
]

export default function Export() {
  const [busy, setBusy] = useState(null)

  async function downloadExport(item) {
    setBusy(item.key)
    try {
      const res = await api.get(`/export/${item.key}`, { responseType: "blob" })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", item.filename)
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => window.URL.revokeObjectURL(url), 1000)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Export Data"
        subtitle="Download spreadsheets of your workspace for accounting, audits and backups."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {EXPORTS.map((item) => (
          <div key={item.key} className="card flex items-center gap-4 p-5">
            <IconChip icon={item.icon} tone={item.tone} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <FileSpreadsheet size={13} className="text-muted-2" />
                {item.label}
              </p>
              <p className="mt-0.5 text-xs text-muted">{item.desc}</p>
            </div>
            <button
              onClick={() => downloadExport(item)}
              disabled={busy === item.key}
              className="pill-secondary flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50"
            >
              <Download size={13} />
              {busy === item.key ? "…" : "Download"}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
