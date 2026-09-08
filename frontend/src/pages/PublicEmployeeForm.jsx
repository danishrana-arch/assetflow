import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { CheckCircle2, FileText } from "lucide-react"
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

  const submit = useMutation({
    mutationFn: () => api.post(`/public/employee-forms/${token}/submit`, form),
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
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><FileText size={19} className="text-accent" /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-muted">AssetFlow</p><h1 className="text-xl font-semibold text-ink sm:text-2xl">{formInfo.title}</h1></div></div>
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
