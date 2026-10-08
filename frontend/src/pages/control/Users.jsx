import { useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react"
import StatusPill from "../../components/ui/StatusPill"
import DetailDrawer from "../../components/ui/DetailDrawer"
import Modal from "../../components/billing/Modal"
import { FieldValue, SelectField, TextField } from "../../components/ui/Field"
import DataTable from "../../components/control/DataTable"
import Toolbar, { FilterSelect } from "../../components/control/Toolbar"
import ConfirmDialog from "../../components/control/ConfirmDialog"
import SecretDialog from "../../components/control/SecretDialog"
import { platformApi } from "../../api/platform"
import { errorMessage, fmtDate, label, toneFor } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

const ROLES = ["CEO", "ADMIN", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "IT_MANAGER", "SITE_ADMIN", "EMPLOYEE"]
const STATUSES = ["ACTIVE", "ON_LEAVE", "LEFT_COMPANY"]

export default function Users() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [role, setRole] = useState("")
  const [status, setStatus] = useState("")
  const [organizationId, setOrganizationId] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState(null) // "add" | "reset" | "delete"
  const [secret, setSecret] = useState(null) // { title, intro, value }
  const [error, setError] = useState("")

  const params = { page, pageSize: 25, search: search || undefined, role: role || undefined, status: status || undefined, organizationId: organizationId || undefined }
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ["platform", "users", params], queryFn: () => platformApi.users(params), placeholderData: keepPreviousData })
  const { data: orgs } = useQuery({ queryKey: ["platform", "organizations"], queryFn: platformApi.organizations })
  const { data: roles } = useQuery({ queryKey: ["platform", "roles"], queryFn: platformApi.roles })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform"] })
  const fail = (err) => setError(errorMessage(err))
  const reset = (setter) => (v) => { setter(v); setPage(1) }
  const openUser = (u) => { setSelected(u); setError("") }
  const ask = (name) => () => { setError(""); setDialog(name) }

  const resetPw = useMutation({
    mutationFn: () => platformApi.resetUserPassword(selected.id),
    onSuccess: (r) => { setDialog(null); setSecret({ title: "Password reset", intro: `${selected.name} can sign in with this password.`, value: r.temporaryPassword }) },
    onError: fail,
  })
  const del = useMutation({
    mutationFn: () => platformApi.deleteUser(selected.id),
    onSuccess: () => { setDialog(null); setSelected(null); refresh() },
    onError: fail,
  })

  return (
    <>
      <SectionTitle
        title="Users"
        subtitle="Every account on the platform. Add, edit, assign roles, reset passwords or remove — all recorded in the audit log."
        actions={<button type="button" onClick={ask("add")} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"><Plus size={15} /> Add user</button>}
      />
      <Toolbar search={search} onSearch={reset(setSearch)} placeholder="Search name or email…">
        <FilterSelect label="All organizations" value={organizationId} onChange={reset(setOrganizationId)} options={(orgs || []).map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect label="All roles" value={role} onChange={reset(setRole)} options={ROLES.map((r) => ({ value: r, label: label(r) }))} />
        <FilterSelect label="All statuses" value={status} onChange={reset(setStatus)} options={STATUSES.map((s) => ({ value: s, label: label(s) }))} />
      </Toolbar>
      {loadError && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(loadError)}</p>}
      <DataTable
        loading={isLoading}
        rows={data?.rows || []}
        page={page}
        pageSize={data?.pageSize || 25}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onRowClick={openUser}
        columns={[
          { key: "name", header: "User", render: (u) => <div className="min-w-0"><p className="truncate font-medium">{u.name}</p><p className="truncate text-xs text-muted">{u.email}</p></div> },
          { key: "organization", header: "Organization", hideBelow: "md", render: (u) => u.organization.name },
          { key: "role", header: "Role", render: (u) => (u.customRole ? <span>{u.customRole.name} <span className="text-xs text-muted">custom</span></span> : label(u.role)) },
          { key: "status", header: "Status", render: (u) => <StatusPill tone={toneFor(u.status)}>{label(u.status)}</StatusPill> },
        ]}
        actions={(u) => [
          { label: "Edit", icon: Pencil, onClick: () => openUser(u) },
          { label: "Reset password…", icon: KeyRound, onClick: () => { openUser(u); ask("reset")() } },
          { label: "Delete…", icon: Trash2, danger: true, onClick: () => { openUser(u); ask("delete")() } },
        ]}
      />

      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} resetKey={selected?.id} title={selected?.name} subtitle={selected?.email} breadcrumb={[{ label: "Users", onClick: () => setSelected(null) }, { label: selected?.name || "" }]}>
        {selected && (
          <UserEditor
            key={selected.id}
            user={selected}
            roles={roles}
            onSaved={() => { refresh(); setSelected(null) }}
            onReset={ask("reset")}
            onDelete={ask("delete")}
          />
        )}
      </DetailDrawer>

      {dialog === "add" && <AddUserDialog orgs={orgs} roles={roles} onClose={() => setDialog(null)} onCreated={(r) => { setDialog(null); refresh(); setSecret({ title: "User created", intro: `${r.user.name} (${r.user.email}) can sign in with this password.`, value: r.temporaryPassword }) }} />}
      {dialog === "reset" && selected && (
        <ConfirmDialog title={`Reset ${selected.name}'s password?`} message="Their current password stops working immediately. You'll be shown a new temporary one." confirmLabel="Reset password" busy={resetPw.isPending} error={error} onClose={() => setDialog(null)} onConfirm={() => resetPw.mutate()} />
      )}
      {dialog === "delete" && selected && (
        <ConfirmDialog title={`Delete ${selected.name}?`} message="Their account and the records tied to it are removed permanently. To keep history, set their status to “Left company” instead." confirmLabel="Delete user" danger busy={del.isPending} error={error} onClose={() => setDialog(null)} onConfirm={() => del.mutate()} />
      )}
      {secret && <SecretDialog title={secret.title} intro={secret.intro} secret={secret.value} onClose={() => setSecret(null)} />}
    </>
  )
}

function UserEditor({ user, roles, onSaved, onReset, onDelete }) {
  const [form, setForm] = useState({ name: user.name, email: user.email, designation: user.designation || "", status: user.status, access: user.customRoleId ? `custom:${user.customRoleId}` : user.role })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const isPlatform = user.role === "PLATFORM_ADMIN"
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: form.name, email: form.email, designation: form.designation, status: form.status }
      const current = user.customRoleId ? `custom:${user.customRoleId}` : user.role
      if (form.access !== current && form.access.startsWith("custom:")) body.customRoleId = form.access.slice(7)
      await platformApi.updateUser(user.id, body)
      // A built-in role goes through the audited role endpoint (also drops any custom role).
      if (form.access !== current && !form.access.startsWith("custom:")) await platformApi.changeUserRole(user.id, form.access, "Changed from the user editor")
    },
    onSuccess: onSaved,
    onError: (err) => setError(errorMessage(err)),
  })

  if (isPlatform) return <p className="text-sm text-muted">Platform administrators are managed outside the app.</p>
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(""); save.mutate() }} className="space-y-5">
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-4">
        <FieldValue label="Organization" value={user.organization.name} />
        <FieldValue label="Joined" value={fmtDate(user.createdAt)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} required />
        <TextField label="Designation" value={form.designation} onChange={(e) => set({ designation: e.target.value })} maxLength={120} />
        <SelectField label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </SelectField>
        <SelectField label="Role" value={form.access} onChange={(e) => set({ access: e.target.value })} className="sm:col-span-2">
          <optgroup label="Built-in roles">{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</optgroup>
          {roles?.custom.length > 0 && <optgroup label="Custom roles">{roles.custom.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</optgroup>}
        </SelectField>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={save.isPending} className="pill-accent px-5 py-2.5 text-sm">{save.isPending ? "Saving…" : "Save changes"}</button>
        <button type="button" onClick={onReset} className="pill-secondary px-4 py-2.5 text-sm">Reset password…</button>
        <button type="button" onClick={onDelete} className="ml-auto rounded-full px-4 py-2.5 text-sm font-semibold text-danger hover:bg-surface-2">Delete user…</button>
      </div>
    </form>
  )
}

function AddUserDialog({ orgs, roles, onClose, onCreated }) {
  const [form, setForm] = useState({ organizationId: "", name: "", email: "", designation: "", access: "EMPLOYEE" })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const create = useMutation({
    mutationFn: () => platformApi.createUser({
      organizationId: form.organizationId,
      name: form.name,
      email: form.email,
      designation: form.designation,
      ...(form.access.startsWith("custom:") ? { customRoleId: form.access.slice(7) } : { role: form.access }),
    }),
    onSuccess: onCreated,
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <Modal
      title="Add a user"
      subtitle="They get a temporary password you'll see once."
      onClose={onClose}
      busy={create.isPending}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={create.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="add-user-form" disabled={create.isPending || !form.organizationId} className="pill-accent px-5 py-2.5 text-sm">{create.isPending ? "Creating…" : "Create user"}</button>
        </>
      }
    >
      <form id="add-user-form" onSubmit={(e) => { e.preventDefault(); setError(""); create.mutate() }} className="space-y-3 pb-2">
        <SelectField label="Organization" value={form.organizationId} onChange={(e) => set({ organizationId: e.target.value })} required>
          <option value="">Choose…</option>
          {(orgs || []).filter((o) => o.status === "ACTIVE").map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </SelectField>
        <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} required />
        <TextField label="Designation" value={form.designation} onChange={(e) => set({ designation: e.target.value })} maxLength={120} />
        <SelectField label="Role" value={form.access} onChange={(e) => set({ access: e.target.value })}>
          <optgroup label="Built-in roles">{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</optgroup>
          {roles?.custom.length > 0 && <optgroup label="Custom roles">{roles.custom.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</optgroup>}
        </SelectField>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
