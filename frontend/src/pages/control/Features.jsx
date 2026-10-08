import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import FeatureToggle from "../../components/control/FeatureToggle"
import ConfirmDialog from "../../components/control/ConfirmDialog"
import { platformApi } from "../../api/platform"
import { errorMessage } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

// Platform-wide availability. A plan decides which features an organization
// gets (Plans); an organization override can change that (Organizations →
// Features). Switching a feature off HERE removes it for everyone.
export default function Features() {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(null) // feature being switched off
  const [error, setError] = useState("")
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ["platform", "features"], queryFn: platformApi.features })

  const set = useMutation({
    mutationFn: ({ key, enabled }) => platformApi.setFeatureAvailability(key, enabled),
    onSuccess: () => { setConfirming(null); setError(""); queryClient.invalidateQueries({ queryKey: ["platform"] }) },
    onError: (err) => setError(errorMessage(err)),
  })

  if (loadError) return <p role="alert" className="text-sm text-danger">{errorMessage(loadError)}</p>
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />

  const groups = [...new Set(data.features.map((f) => f.group))]
  return (
    <>
      <SectionTitle title="Features" subtitle="Platform-wide availability. Access needs: available here + included for the organization + a role that permits it." />
      {error && !confirming && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</h3>
            <div className="space-y-2">
              {data.features.filter((f) => f.group === g).map((f) => (
                <FeatureToggle
                  key={f.key}
                  label={f.label}
                  description={f.description}
                  checked={f.available}
                  busy={set.isPending}
                  onChange={(enabled) => (enabled ? set.mutate({ key: f.key, enabled }) : (setError(""), setConfirming(f)))}
                  trailing={
                    <p className="mt-1 text-xs text-muted">
                      Entitled in {f.organizationsEntitled} of {data.organizations} organizations
                      {f.overrides ? ` · ${f.overrides} override${f.overrides === 1 ? "" : "s"}` : ""}
                      {f.plans.length ? ` · Plans: ${f.plans.join(", ")}` : " · In no plan"}
                    </p>
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Switch off ${confirming.label} for everyone?`}
          message="Every organization loses it immediately, whatever its plan or overrides. This is recorded in the audit log."
          confirmLabel="Switch off"
          danger
          busy={set.isPending}
          error={error}
          onClose={() => setConfirming(null)}
          onConfirm={() => set.mutate({ key: confirming.key, enabled: false })}
        />
      )}
    </>
  )
}
