import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileText, Upload, Trash2, ExternalLink } from "lucide-react"
import api from "../api/client"
import { SelectField, TextField } from "./ui/Field"

// Employee document pictures (passport, civil ID, other) on the profile.
// Files are fetched with the session (they're behind auth), so each one is
// loaded as a blob and shown via an object URL — never a raw file path.
const KINDS = [
  { key: "PASSPORT", label: "Passport" },
  { key: "CIVIL_ID", label: "Civil / ID document" },
  { key: "OTHER", label: "Other documents" },
]
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf"

function fileUrl(employeeId, docId) {
  return `/employees/${employeeId}/documents/${docId}/file`
}

function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function DocumentCard({ employeeId, doc, canManage, onDelete, deleting }) {
  const [thumb, setThumb] = useState(null)
  const isImage = doc.mimeType.startsWith("image/")

  useEffect(() => {
    if (!isImage) return undefined
    let url = null
    let cancelled = false
    api.get(fileUrl(employeeId, doc.id), { responseType: "blob" })
      .then((res) => {
        if (cancelled) return
        url = URL.createObjectURL(res.data)
        setThumb(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [employeeId, doc.id, isImage])

  async function open() {
    // Open the tab inside the click (popup blockers), then point it at the file.
    const tab = window.open("", "_blank")
    try {
      const res = await api.get(fileUrl(employeeId, doc.id), { responseType: "blob" })
      const url = URL.createObjectURL(res.data)
      if (tab) tab.location.href = url
      else window.location.assign(url)
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      tab?.close()
    }
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <button type="button" onClick={open} className="flex h-28 items-center justify-center bg-surface-2" title="Open document">
        {isImage && thumb ? (
          <img src={thumb} alt={doc.label || doc.fileName} className="h-full w-full object-cover" />
        ) : (
          <FileText size={28} className="text-muted-2" />
        )}
      </button>
      <div className="flex items-start justify-between gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{doc.label || doc.fileName}</p>
          <p className="truncate text-[10px] text-muted-2">{doc.mimeType === "application/pdf" ? "PDF" : "Image"} · {sizeLabel(doc.size)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={open} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Open document">
            <ExternalLink size={13} />
          </button>
          {canManage && (
            <button type="button" onClick={() => onDelete(doc)} disabled={deleting} className="rounded-lg p-1 text-danger hover:bg-surface-2 disabled:opacity-50" aria-label="Remove document">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EmployeeDocuments({ employeeId, documents, canManage }) {
  const queryClient = useQueryClient()
  const fileRef = useRef(null)
  const [kind, setKind] = useState("PASSPORT")
  const [label, setLabel] = useState("")
  const [error, setError] = useState("")

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["employee", employeeId] })

  const upload = useMutation({
    mutationFn: (file) => {
      const form = new FormData()
      form.append("file", file)
      form.append("kind", kind)
      if (label.trim()) form.append("label", label.trim())
      return api.post(`/employees/${employeeId}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } })
    },
    onSuccess: () => { setLabel(""); setError(""); refresh() },
    onError: (err) => setError(err.response?.data?.error || "Could not upload the document"),
  })

  const remove = useMutation({
    mutationFn: (docId) => api.delete(`/employees/${employeeId}/documents/${docId}`),
    onSuccess: refresh,
    onError: (err) => setError(err.response?.data?.error || "Could not remove the document"),
  })

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return setError("That file is too large — the limit is 5MB")
    setError("")
    upload.mutate(file)
  }

  function handleDelete(doc) {
    if (window.confirm(`Remove "${doc.label || doc.fileName}"? This can't be undone.`)) remove.mutate(doc.id)
  }

  return (
    <div className="w-full border-t border-border pt-4 text-left">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Documents</p>
        <p className="mt-0.5 text-[11px] text-muted-2">
          {canManage ? "Passport, civil ID and other document pictures (JPG, PNG, WEBP, GIF or PDF, up to 5MB)." : "Documents HR has on file for you."}
        </p>
      </div>

      {canManage && (
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-[180px_1fr_auto]">
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </SelectField>
          <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Passport — front page" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="pill-secondary flex h-10 items-center justify-center gap-1.5 px-4 text-sm disabled:opacity-60"
          >
            <Upload size={14} /> {upload.isPending ? "Uploading…" : "Upload"}
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT} onChange={handleFile} className="hidden" />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 space-y-4">
        {KINDS.map((k) => {
          const items = documents.filter((d) => d.kind === k.key)
          return (
            <div key={k.key}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-2">{k.label} ({items.length})</p>
              {items.length ? (
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                  {items.map((doc) => (
                    <DocumentCard key={doc.id} employeeId={employeeId} doc={doc} canManage={canManage} onDelete={handleDelete} deleting={remove.isPending} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">None uploaded.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
