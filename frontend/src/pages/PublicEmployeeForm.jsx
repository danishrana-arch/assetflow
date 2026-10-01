import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { CheckCircle2, FileText, Plus, Trash2 } from "lucide-react"
import api from "../api/client"
import { TextField, SelectField } from "../components/ui/Field"

const emptyForm = {
  name: "",
  fatherName: "",
  personalEmail: "",
  companyEmail: "",
  phone: "",
  address: "",
  cnic: "",
  dob: "",
  education: "",
  currentUniversity: "",
  seniorityLevel: "",
  linkedinUrl: "",
  notes: "",
}

// Same everyday categories as Inventory, so HR can match them up later.
const EQUIPMENT_TYPES = [
  "Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Headset", "Keyboard", "Mouse",
  "Webcam", "Docking Station", "External Hard Drive", "Accessories", "Furniture", "Other",
]
const MAX_ITEMS = 20
const emptyItem = { category: "", name: "", serialNumber: "", condition: "GOOD", receivedOn: "", notes: "" }

export default function PublicEmployeeForm() {
  const { token } = useParams()
  const [form, setForm] = useState(emptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState("")

  const { data: formInfo, isLoading } = useQuery({
    queryKey: ["public-employee-form", token],
    queryFn: () => api.get(`/public/employee-forms/${token}`).then((r) => r.data),
    retry: false,
  })

  const [equipment, setEquipment] = useState([{ ...emptyItem }])
  const [noEquipment, setNoEquipment] = useState(false)
  function updateItem(index, key, value) {
    setEquipment((list) => list.map((item, i) => (i === index ? { ...item, [key]: value } : item)))
  }
  function addItem() { setEquipment((list) => (list.length < MAX_ITEMS ? [...list, { ...emptyItem }] : list)) }
  function removeItem(index) { setEquipment((list) => list.filter((_, i) => i !== index)) }

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/public/employee-forms/${token}/submit`, {
        ...form,
        inventory: {
          none: noEquipment,
          items: noEquipment ? [] : equipment.filter((i) => i.category || i.name.trim() || i.serialNumber.trim()),
        },
      }),
    onSuccess: () => { setSubmitted(true); setError("") },
    onError: (err) => setError(err.response?.data?.error || "Could not submit the form. Please try again."),
  })

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas p-5 text-sm text-muted">Loading form…</div>
  }

  if (!formInfo) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas p-5"><div className="card max-w-lg p-7 text-center"><p className="text-lg font-semibold text-ink">This form is unavailable</p><p className="mt-2 text-sm text-muted">The link may have expired or been deactivated. Please ask the administrator for a new link.</p></div></div>
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-5">
        <div className="card w-full max-w-lg p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-chip-green-bg text-chip-green-fg"><CheckCircle2 size={28} /></div>
          <h1 className="mt-5 text-2xl font-semibold text-ink">Information submitted</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Thank you. Your information has been securely submitted to the organization.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="card overflow-hidden">
          <div className="border-b border-border p-6 sm:p-8">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><FileText size={19} className="text-accent" /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-muted">ManagementDock</p><h1 className="text-xl font-semibold text-ink sm:text-2xl">{formInfo.title}</h1></div></div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">Please provide accurate information. The organization will use these details to create and maintain your employee record.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); submit.mutate() }} className="space-y-6 p-6 sm:p-8">
            <section>
              <p className="mb-3 text-sm font-semibold text-ink">Personal information</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Full name *" value={form.name} onChange={(e) => update("name", e.target.value)} required />
                <TextField label="Father name" value={form.fatherName} onChange={(e) => update("fatherName", e.target.value)} />
                <TextField label="Personal email" type="email" value={form.personalEmail} onChange={(e) => update("personalEmail", e.target.value)} />
                <TextField label="Company email" type="email" value={form.companyEmail} onChange={(e) => update("companyEmail", e.target.value)} />
                <TextField label="Contact number" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
                <TextField label="CNIC" value={form.cnic} onChange={(e) => update("cnic", e.target.value)} placeholder="XXXXX-XXXXXXX-X" />
                <TextField label="Date of birth" type="date" value={form.dob} onChange={(e) => update("dob", e.target.value)} />
                <TextField label="Current address" value={form.address} onChange={(e) => update("address", e.target.value)} />
              </div>
            </section>

            <section>
              <p className="mb-3 text-sm font-semibold text-ink">Education & employment</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Education / qualification" value={form.education} onChange={(e) => update("education", e.target.value)} placeholder="e.g. BS Computer Science" />
                <TextField label="Current university / institute" value={form.currentUniversity} onChange={(e) => update("currentUniversity", e.target.value)} />
                <SelectField label="Employee type" value={form.seniorityLevel} onChange={(e) => update("seniorityLevel", e.target.value)}>
                  <option value="">Select</option><option value="INTERN">Intern</option><option value="JUNIOR">Junior</option>
                </SelectField>
                <TextField label="LinkedIn profile" type="url" value={form.linkedinUrl} onChange={(e) => update("linkedinUrl", e.target.value)} placeholder="https://www.linkedin.com/in/..." />
              </div>
            </section>

            <section>
              <p className="text-sm font-semibold text-ink">Company equipment you have</p>
              <p className="mb-3 mt-1 text-xs leading-5 text-muted">
                List any company items you were given — laptop, monitor, phone, headset, keyboard, mouse, etc. The serial
                number is usually on a sticker underneath the device.
              </p>
              <label className="mb-3 flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={noEquipment}
                  onChange={(e) => setNoEquipment(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                I don&apos;t have any company equipment
              </label>
              {!noEquipment && (
                <div className="space-y-3">
                  {equipment.map((item, index) => (
                    <div key={index} className="rounded-2xl border border-border bg-surface-2 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Item {index + 1}</p>
                        {equipment.length > 1 && (
                          <button type="button" onClick={() => removeItem(index)} className="flex items-center gap-1 text-xs font-semibold text-danger hover:underline">
                            <Trash2 size={13} /> Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <SelectField label="Item type" value={item.category} onChange={(e) => updateItem(index, "category", e.target.value)}>
                          <option value="">Select</option>
                          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </SelectField>
                        <TextField label="Brand / model" value={item.name} onChange={(e) => updateItem(index, "name", e.target.value)} placeholder="e.g. Dell Latitude 7440" />
                        <TextField label="Serial number" value={item.serialNumber} onChange={(e) => updateItem(index, "serialNumber", e.target.value)} placeholder="Printed on the device sticker" />
                        <SelectField label="Condition" value={item.condition} onChange={(e) => updateItem(index, "condition", e.target.value)}>
                          <option value="GOOD">Good — working fine</option>
                          <option value="NEEDS_REPAIR">Needs repair</option>
                          <option value="DAMAGED">Damaged</option>
                        </SelectField>
                        <TextField label="Received on" type="date" value={item.receivedOn} onChange={(e) => updateItem(index, "receivedOn", e.target.value)} />
                        <TextField label="Notes" value={item.notes} onChange={(e) => updateItem(index, "notes", e.target.value)} placeholder="e.g. with charger and bag" />
                      </div>
                    </div>
                  ))}
                  {equipment.length < MAX_ITEMS && (
                    <button type="button" onClick={addItem} className="pill-secondary flex items-center gap-1.5 px-4 py-2 text-xs">
                      <Plus size={13} /> Add another item
                    </button>
                  )}
                </div>
              )}
            </section>

            <section>
              <TextField label="Additional information" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Anything else the organization should know" />
            </section>

            <div className="rounded-2xl bg-surface-2 p-4 text-xs leading-5 text-muted">By submitting this form, you confirm that the information you provide is accurate and may be used for your employee record.</div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={submit.isPending} className="pill-accent w-full px-5 py-3 text-sm font-semibold disabled:opacity-60">{submit.isPending ? "Submitting…" : "Submit information"}</button>
          </form>
        </div>
      </div>
    </div>
  )
}
