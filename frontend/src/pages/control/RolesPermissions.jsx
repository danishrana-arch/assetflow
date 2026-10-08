import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import Modal from "../../components/billing/Modal"
import { SelectField, TextAreaField, TextField } from "../../components/ui/Field"
import DataTable from "../../components/control/DataTable"
import ConfirmDialog from "../../components/control/ConfirmDialog"
import PermissionMatrix from "../../components/control/PermissionMatrix"
import { platformApi } from "../../api/platform"
import { errorMessage, label } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

export default function RolesPermissions() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // role | "new"
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState("")
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ["platform", "roles"], queryFn: platformApi.roles })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform"] })

  const remove = useMutation({
    mutationFn: (role) => platformApi.deleteRole(role.id),
    onSuccess: () => { setDeleting(null); setError(""); refresh() },
    onError: (err) => setError(errorMessage(err)),
  })

  if (loadError) return <p role="alert" className="text-sm text-danger">{errorMessage(loadError)}</p>
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />

  const featureOfModule = Object.fromEntries(data.modules.map((m) => [m.key, m.feature]))
  const allRoles = [
    ...data.roles.filter((r) => r.role !== "PLATFORM_ADMIN").map((r) => ({ key: r.role, label: label(r.role), sub: `${r.users} ${r.users === 1 ? "user" : "users"}`, modules: r.modules })),
    ...data.custom.map((r) => ({ key: `custom:${r.id}`, label: r.name, sub: "custom", modules: r.modules })),
  ]
  const has = (rowKey, moduleKey) => {
    const mods = allRoles.find((r) => r.key === rowKey)?.modules || []
    return mods.includes("*") || mods.includes(moduleKey)
  }
  const hasFeature = (rowKey, featureKey) => {
    const mods = allRoles.find((r) => r.key === rowKey)?.modules || []
    return mods.includes("*") || mods.some((m) => featureOfModule[m] === featureKey)
  }
  const rows = allRoles.map((r) => ({ key: r.key, label: r.label, sub: r.sub }))

  return (
    <>
      <SectionTitle
        title="Roles & Permissions"
        subtitle="Create roles as named sets of modules, then assign them to users. Access also requires the organization to be entitled to the feature."
        actions={<button type="button" onClick={() => setEditing("new")} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"><Plus size={15} /> Add role</button>}
      />

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Custom roles</h3>
      <DataTable
        rows={data.custom}
        empty={<p className="py-6 text-center text-sm text-muted">No custom roles yet. Add one to give people exactly the modules you choose.</p>}
        onRowClick={setEditing}
        columns={[
          { key: "name", header: "Role", render: (r) => <div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted">{r.description || "—"}</p></div> },
          { key: "baseRole", header: "Base role", render: (r) => label(r.baseRole) },
          { key: "modules", header: "Modules", sortValue: (r) => r.modules.length, render: (r) => `${r.modules.length} selected` },
          { key: "users", header: "Users" },
        ]}
        actions={(r) => [
          { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
          { label: "Delete…", icon: Trash2, danger: true, onClick: () => { setError(""); setDeleting(r) } },
        ]}
      />

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Roles by feature</h3>
      <PermissionMatrix caption="Roles by feature" rows={rows} columns={data.features} allowed={hasFeature} />

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Roles by module</h3>
      <PermissionMatrix caption="Roles by module" rows={rows} columns={data.moduleKeys.map((k) => ({ key: k, label: k }))} allowed={has} />

      <div className="mt-4 space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        <p><span className="font-semibold text-ink">Built-in roles</span> are defined in code and can't be edited here. <span className="font-semibold text-ink">Custom roles</span> sit on a base role: the module list you pick replaces the base role's modules, and the base role still decides everything else (for example who can approve what).</p>
        <p>Per-company attendance permissions are edited on each organization's Permissions tab.</p>
      </div>

      {editing && <RoleEditor role={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete the ${deleting.name} role?`}
          message={deleting.users ? `${deleting.users} ${deleting.users === 1 ? "person has" : "people have"} this role and will fall back to their base role (${label(deleting.baseRole)}).` : "No one has this role."}
          confirmLabel="Delete role"
          danger
          busy={remove.isPending}
          error={error}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
        />
      )}
    </>
  )
}

function RoleEditor({ role, data, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: role?.name || "",
    description: role?.description || "",
    baseRole: role?.baseRole || "EMPLOYEE",
    modules: role?.modules || [],
  })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const save = useMutation({
    mutationFn: () => (role ? platformApi.updateRole(role.id, form) : platformApi.createRole(form)),
    onSuccess: onSaved,
    onError: (err) => setError(errorMessage(err)),
  })
  const featureLabel = Object.fromEntries(data.features.map((f) => [f.key, f.label]))
  const groups = {}
  for (const m of data.modules) (groups[m.feature ? featureLabel[m.feature] : "Other"] ||= []).push(m.key)
  const toggle = (key) => set({ modules: form.modules.includes(key) ? form.modules.filter((k) => k !== key) : [...form.modules, key] })

  return (
    <Modal
      title={role ? `Edit ${role.name}` : "Add a role"}
      subtitle="Pick the modules this role can use."
      size="lg"
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={save.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="role-form" disabled={save.isPending || !form.name.trim()} className="pill-accent px-5 py-2.5 text-sm">{save.isPending ? "Saving…" : role ? "Save changes" : "Create role"}</button>
        </>
      }
    >
      <form id="role-form" onSubmit={(e) => { e.preventDefault(); setError(""); save.mutate() }} className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required />
          <SelectField label="Base role" value={form.baseRole} onChange={(e) => set({ baseRole: e.target.value })}>
            {data.assignableRoles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </SelectField>
        </div>
        <TextAreaField label="Description" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Modules</legend>
          {Object.entries(groups).map(([group, keys]) => (
            <div key={group}>
              <p className="mb-1 text-xs font-semibold text-ink">{group}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {keys.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink">
                    <input type="checkbox" checked={form.modules.includes(k)} onChange={() => toggle(k)} className="h-4 w-4 accent-[var(--accent)]" />
                    {k}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
