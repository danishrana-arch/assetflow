import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { Search, Plus, X, Boxes, Laptop2, MonitorSmartphone, Smartphone, Keyboard, PenLine, Upload, Download, Trash2, Pencil } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import StatusBadge from "../components/StatusBadge"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"
import Pagination from "../components/ui/Pagination"
import { TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const PAGE_SIZE = 25

const emptyForm = {
  name: "", category: "", customCategory: "", serialNumber: "", cpu: "", ram: "", storage: "",
  purchaseDate: "", warrantyEnd: "", departmentId: "",
}

function categoryIcon(cat) {
  const c = (cat || "").toLowerCase()
  if (c.includes("laptop") || c.includes("desktop")) return { icon: Laptop2, tone: "blue" }
  if (c.includes("monitor")) return { icon: MonitorSmartphone, tone: "purple" }
  if (c.includes("phone")) return { icon: Smartphone, tone: "cyan" }
  if (c.includes("accessor")) return { icon: Keyboard, tone: "yellow" }
  if (c.includes("stationery") || c.includes("stationary")) return { icon: PenLine, tone: "green" }
  return { icon: Boxes, tone: "orange" }
}

function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function Inventory() {
  const [q, setQ] = useState("")
  const debouncedQ = useDebouncedValue(q)
  const [category, setCategory] = useState("")
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState("")
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState("")
  const fileInputRef = useRef(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  // ADMIN/CEO may delete an asset that's still assigned (it's unassigned
  // automatically); other inventory roles must unassign it first.
  const canDeleteAssigned = ["ADMIN", "CEO"].includes(user?.role)
  const [editingId, setEditingId] = useState(null)
  const [actionError, setActionError] = useState("")
  const [actionNotice, setActionNotice] = useState("")

  // Dashboard stat cards deep-link here: ?view=all (Total Assets) lists every
  // asset without picking a category; ?warranty=expiring (Warranty Alerts)
  // lists assets whose warranty ends in the next 30 days.
  const [searchParams, setSearchParams] = useSearchParams()
  const showAll = searchParams.get("view") === "all"
  const warrantyExpiring = searchParams.get("warranty") === "expiring"
  const listActive = !!category || showAll || warrantyExpiring

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  useEffect(() => { setPage(1) }, [debouncedQ, category, showAll, warrantyExpiring])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["assets", debouncedQ, category, page, warrantyExpiring],
    queryFn: () =>
      api.get("/assets", {
        params: {
          q: debouncedQ,
          category: category || undefined,
          warranty: warrantyExpiring ? "expiring" : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: listActive,
  })
  const assets = listActive ? data?.data || [] : []
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
  })
  const { data: categories } = useQuery({
    queryKey: ["asset-categories"],
    queryFn: () => api.get("/assets/categories").then((r) => r.data),
  })

  const deleteAsset = useMutation({
    mutationFn: (asset) => api.delete(`/assets/${asset.id}`),
    onSuccess: (_, asset) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] })
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      queryClient.invalidateQueries({ queryKey: ["employee"] })
      setActionError("")
      setActionNotice(asset.assignedTo ? `${asset.name} deleted and unassigned from ${asset.assignedTo.name}.` : `${asset.name} deleted.`)
    },
    onError: (err) => { setActionNotice(""); setActionError(err.response?.data?.error || "Could not delete asset") },
  })

  const deleteCategory = useMutation({
    mutationFn: (name) => api.delete(`/assets/categories/${encodeURIComponent(name)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] })
      setCategory("")
    },
  })

  // One form for both Add and Edit (editingId set = editing that asset).
  const saveAsset = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        category: form.category === "__custom__" ? form.customCategory.trim() : form.category,
        customCategory: undefined,
      }
      return editingId
        ? api.patch(`/assets/${editingId}`, { ...payload, departmentId: form.departmentId || null })
        : api.post("/assets", { ...payload, departmentId: form.departmentId || undefined })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      queryClient.invalidateQueries({ queryKey: ["asset"] })
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] })
      setActionError("")
      setActionNotice(editingId ? `${res.data.name} updated.` : `${res.data.name} added.`)
      closeForm()
    },
    onError: (err) => setError(err.response?.data?.error || (editingId ? "Could not update asset" : "Could not create asset")),
  })

  function closeForm() { setShowForm(false); setEditingId(null); setForm(emptyForm); setError("") }

  function startEdit(asset) {
    const knownCategory = !asset.category || (categories || []).some((c) => c.name === asset.category)
    setForm({
      name: asset.name || "",
      category: knownCategory ? asset.category || "" : "__custom__",
      customCategory: knownCategory ? "" : asset.category,
      serialNumber: asset.serialNumber || "",
      cpu: asset.cpu || "", ram: asset.ram || "", storage: asset.storage || "",
      purchaseDate: asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : "",
      warrantyEnd: asset.warrantyEnd ? String(asset.warrantyEnd).slice(0, 10) : "",
      departmentId: asset.departmentId || asset.department?.id || "",
    })
    setEditingId(asset.id); setError(""); setShowForm(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function updateField(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  const importFile = useMutation({
    mutationFn: (file) => {
      const formData = new FormData()
      formData.append("file", file)
      return api.post("/assets/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      queryClient.invalidateQueries({ queryKey: ["asset-categories"] })
      setImportResult(res.data)
      setImportError("")
    },
    onError: (err) => setImportError(err.response?.data?.error || "Could not import that file"),
  })

  function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file) return
    setImportResult(null)
    setImportError("")
    importFile.mutate(file)
  }

  function handleDeleteAsset(asset) {
    const holder = asset.assignedTo?.name
    if (holder && !canDeleteAssigned) {
      setActionNotice("")
      setActionError(`${asset.name} is assigned to ${holder}. Unassign it first — only Admin or CEO can delete an assigned asset.`)
      return
    }
    const message = holder
      ? `${asset.name} is assigned to ${holder}. Deleting it will unassign it from ${holder} automatically and remove it permanently. Continue?`
      : `Delete ${asset.name}? This cannot be undone.`
    if (!window.confirm(message)) return
    deleteAsset.mutate(asset)
  }

  function handleDeleteCategory() {
    if (!category) return
    if (!window.confirm(`Remove category "${category}" from all assets? This will clear the label but not delete assets.`)) return
    deleteCategory.mutate(category)
  }

  async function handleDownloadTemplate() {
    const res = await api.get("/assets/import/template", { responseType: "blob" })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement("a")
    a.href = url
    a.download = "asset-import-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Inventory"
        subtitle="Every asset in your organization assigned, available, and in repair."
        actions={
          <>
            <div className="relative w-64">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search inventory…"
                className="field pl-9 !rounded-full"
              />
            </div>
            <button
              onClick={handleDownloadTemplate}
              className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm"
              title="Download the import template"
            >
              <Download size={14} /> Template
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importFile.isPending}
              className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm disabled:opacity-60"
            >
              <Upload size={14} /> {importFile.isPending ? "Importing…" : "Import CSV"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChosen}
              className="hidden"
            />
            <button
              onClick={() => (showForm ? closeForm() : setShowForm(true))}
              className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
            >
              {showForm ? <X size={15} /> : <Plus size={15} />}
              {showForm ? "Cancel" : "Add Asset"}
            </button>
          </>
        }
      />

      {actionError && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {actionNotice && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl bg-chip-green-bg px-3.5 py-2.5 text-sm text-chip-green-fg">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {importError && (
        <div className="mb-5 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{importError}</div>
      )}

      {importResult && (
        <div className="mb-5 card space-y-2 border-l-[6px] border-l-chip-blue-fg p-5">
          <p className="text-sm font-semibold text-ink">
            Import finished — {importResult.createdCount} added, {importResult.skippedCount} skipped.
          </p>
          {importResult.created?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-surface-2 p-3 text-xs">
              {importResult.created.map((c) => (
                <p key={c.row} className="text-muted">
                  Row {c.row}: <span className="font-medium text-ink">{c.name}</span> — {c.serialNumber}
                </p>
              ))}
            </div>
          )}
          {importResult.skipped?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-chip-yellow-bg p-3 text-xs text-chip-yellow-fg">
              {importResult.skipped.map((s, i) => (
                <p key={i}>Row {s.row}: {s.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2 items-center">
        <button
          onClick={() => { setCategory(""); setParam("view", "all") }}
          className={showAll && !category ? "folder-tab-active" : "tab-pill"}
        >
          All
        </button>
        {(categories || []).map((c) => (
          <button
            key={c.name}
            onClick={() => { setCategory(c.name); setParam("view", null) }}
            className={category === c.name ? "folder-tab-active" : "tab-pill"}
          >
            {c.name}
            <span className={category === c.name ? "ml-1.5 opacity-80" : "ml-1.5 text-muted-2"}>
              ({c.count})
            </span>
          </button>
        ))}
        {category && (
          <button
            type="button"
            onClick={handleDeleteCategory}
            className="tab-pill text-danger flex items-center gap-2"
          >
            <Trash2 size={14} />
          </button>
        )}
        {warrantyExpiring && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-chip-yellow-bg px-3 py-1.5 text-xs font-semibold text-chip-yellow-fg">
            Warranty expiring in 30 days
            <button
              type="button"
              onClick={() => setParam("warranty", null)}
              className="rounded-full p-0.5 hover:bg-black/5"
              aria-label="Clear warranty filter"
            >
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const categoryOk = form.category === "__custom__" ? form.customCategory.trim() : true
            if (form.name.trim() && form.serialNumber.trim() && categoryOk) saveAsset.mutate()
          }}
          className="card mb-5 space-y-4 p-5"
        >
          <p className="text-sm font-semibold text-ink">{editingId ? `Edit ${form.name || "asset"}` : "Add asset"}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Name *" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder='Dell Latitude 7440' required />
            <TextField label="Serial number *" value={form.serialNumber} onChange={(e) => updateField("serialNumber", e.target.value)} required />
            {form.category === "__custom__" ? (
              <TextField
                label="New category name"
                value={form.customCategory || ""}
                onChange={(e) => updateField("customCategory", e.target.value)}
                placeholder="e.g. Office Furniture"
                hint={
                  <button type="button" onClick={() => { updateField("category", ""); updateField("customCategory", "") }} className="font-medium text-accent hover:underline">
                    Choose an existing category instead
                  </button>
                }
                required
              />
            ) : (
              <SelectField label="Category" value={form.category} onChange={(e) => updateField("category", e.target.value)}>
                <option value="">Select a category</option>
                {(categories || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                <option value="__custom__">+ Add new category…</option>
              </SelectField>
            )}
            <TextField label="CPU" value={form.cpu} onChange={(e) => updateField("cpu", e.target.value)} />
            <TextField label="RAM" value={form.ram} onChange={(e) => updateField("ram", e.target.value)} placeholder="16GB" />
            <TextField label="Storage" value={form.storage} onChange={(e) => updateField("storage", e.target.value)} placeholder="512GB SSD" />
            <SelectField label="Department" value={form.departmentId} onChange={(e) => updateField("departmentId", e.target.value)}>
              <option value="">None</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <TextField label="Purchase date" type="date" value={form.purchaseDate} onChange={(e) => updateField("purchaseDate", e.target.value)} />
            <TextField label="Warranty end" type="date" value={form.warrantyEnd} onChange={(e) => updateField("warrantyEnd", e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saveAsset.isPending} className="pill-accent px-5 py-2.5 text-sm">
              {saveAsset.isPending ? "Saving…" : editingId ? "Save changes" : "Add asset"}
            </button>
            {editingId && <button type="button" onClick={closeForm} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>}
          </div>
        </form>
      )}

      {!listActive ? (
        <EmptyState
          icon={Boxes}
          title="Pick a category to see its assets"
          description="Select one of the categories above Laptops, Accessories, Stationery, or any custom one you've added."
        />
      ) : (
        <>
          {isLoading && <p className="text-sm text-muted">Loading...</p>}

    <div className="space-y-3 md:hidden">
      {assets.map((asset) => {
        const { icon, tone } = categoryIcon(asset.category)
        return (
          <div key={asset.id} className="card flex items-center gap-3 p-4">
            <Link to={`/inventory/${asset.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <IconChip icon={icon} tone={tone} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{asset.name}</p>
                <p className="truncate text-xs text-muted">{asset.category || "—"}</p>
                <p className="truncate font-mono text-[11px] text-muted-2">{asset.serialNumber}</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <StatusBadge status={asset.status} />
              <button
                type="button"
                onClick={() => startEdit(asset)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                title="Edit asset"
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAsset(asset)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-danger hover:bg-red-50"
                title="Delete asset"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )
      })}
      {assets.length === 0 && !isLoading && (
        <EmptyState icon={Boxes} title="No assets match your search" description="Try a different keyword or add a new asset." />
      )}
    </div>

    <div className="hidden card overflow-hidden md:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-3.5">Asset</th>
              <th className="px-5 py-3.5">Serial</th>
              <th className="px-5 py-3.5">Assigned To</th>
              <th className="px-5 py-3.5">Department</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Actions</th>
            </tr>
          </thead>
      <tbody>
           {assets.map((asset) => {
            const { icon, tone } = categoryIcon(asset.category)
            return (
        <tr key={asset.id} className="border-b border-border last:border-0 transition-colors hover:bg-surface-2">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <IconChip icon={icon} tone={tone} size="sm" />
              <div className="min-w-0">
                <Link to={`/inventory/${asset.id}`} className="block truncate font-semibold text-ink hover:text-accent">
                  {asset.name}
                </Link>
                <p className="truncate text-xs text-muted">{asset.category || "—"}</p>
              </div>
            </div>
          </td>
          <td className="px-5 py-3.5 font-mono text-xs text-muted">{asset.serialNumber}</td>
          <td className="px-5 py-3.5 text-muted">{asset.assignedTo?.name || "—"}</td>
          <td className="px-5 py-3.5 text-muted">{asset.department?.name || "—"}</td>
          <td className="px-5 py-3.5"><StatusBadge status={asset.status} /></td>
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => startEdit(asset)}
                className="flex items-center gap-1.5 text-muted hover:text-ink"
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAsset(asset)}
                className="text-danger flex items-center gap-1.5"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </td>
        </tr>
      )
          })}
          {assets.length === 0 && !isLoading && (
            <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No assets match your search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>

          <Pagination
            page={data?.page || 1}
            totalPages={data?.totalPages || 1}
            total={data?.total || 0}
            pageSize={data?.pageSize || PAGE_SIZE}
            onPageChange={setPage}
          />
          {isFetching && !isLoading && <p className="mt-1 text-center text-xs text-muted-2">Refreshing…</p>}
        </>
      )}
    </div>
  )
}
