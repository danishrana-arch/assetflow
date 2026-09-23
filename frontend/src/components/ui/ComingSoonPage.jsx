import { Sparkles } from "lucide-react"
import PageHeader from "./PageHeader"
import EmptyState from "./EmptyState"

// Shared placeholder for modules that are gated to a role in the
// permission structure but have no real feature/data behind them yet
// (Sales, Sales Team, Sales Reports, HR Reports, Financial Reports,
// Payroll Reports). Swap this out page-by-page as each one gets built.
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
