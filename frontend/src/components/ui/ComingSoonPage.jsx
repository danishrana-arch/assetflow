import { Sparkles } from "lucide-react"
import PageHeader from "./PageHeader"
import EmptyState from "./EmptyState"

// Shared placeholder for a module that's gated to a role in the permission
// structure but has no real feature/data behind it yet (currently just
// Payroll Reports). Swap this out once the real page gets built.
export default function ComingSoonPage({ title, subtitle, description }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={Sparkles}
        title="Coming soon"
        description={description || "This module is reserved for your role but hasn't been built yet."}
        className="my-4"
      />
    </div>
  )
}
