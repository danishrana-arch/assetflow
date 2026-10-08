import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import Modal from "./Modal"
import { TextAreaField, TextField } from "../ui/Field"
import { billingApi, errorText } from "../../api/billing"
import { useAuth } from "../../context/AuthContext"

// "Contact Our Team" — the Custom plan never opens checkout; it sends an inquiry.
export default function ContactModal({ onClose, onSent, defaultEmployees }) {
  const { user, organization } = useAuth()
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    company: organization?.name || "",
    employeeCount: defaultEmployees ? String(defaultEmployees) : "",
    message: "",
  })
  const [error, setError] = useState("")
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const send = useMutation({
    mutationFn: () => billingApi.sendInquiry({ ...form, employeeCount: form.employeeCount === "" ? null : Number(form.employeeCount) }),
    onSuccess: () => onSent?.(),
    onError: (err) => setError(errorText(err)),
  })

  if (send.isSuccess) {
    return (
      <Modal title="Message sent" onClose={onClose} footer={<button type="button" onClick={onClose} className="pill-accent px-5 py-2.5 text-sm">Done</button>}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={40} className="text-success" />
          <p className="text-sm text-muted">Thanks — the ManagementDock team will get back to you at <span className="font-semibold text-ink">{form.email}</span>.</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Contact Our Team"
      subtitle="Tell us what you need and we'll put together a plan for your organization."
      onClose={onClose}
      busy={send.isPending}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={send.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="submit" form="contact-form" disabled={send.isPending} className="pill-accent px-5 py-2.5 text-sm">{send.isPending ? "Sending…" : "Send message"}</button>
        </>
      }
    >
      <form id="contact-form" onSubmit={(e) => { e.preventDefault(); setError(""); send.mutate() }} className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Your name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
          <TextField label="Work email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} maxLength={200} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Company" value={form.company} onChange={(e) => set({ company: e.target.value })} maxLength={160} />
          <TextField label="Employees needed" type="number" min="1" step="1" value={form.employeeCount} onChange={(e) => set({ employeeCount: e.target.value })} />
        </div>
        <TextAreaField label="What do you need?" rows={4} value={form.message} onChange={(e) => set({ message: e.target.value })} maxLength={2000} required />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
