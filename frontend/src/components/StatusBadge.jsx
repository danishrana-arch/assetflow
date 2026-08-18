import StatusPill from "./ui/StatusPill"

const EMPLOYEE_STATUS = {
  ACTIVE: { label: "Active", tone: "green" },
  ON_LEAVE: { label: "On Leave", tone: "yellow" },
  LEFT_COMPANY: { label: "Left", tone: "pink" },
}

const ASSET_STATUS = {
  ASSIGNED: { label: "Assigned", tone: "blue" },
  AVAILABLE: { label: "Available", tone: "green" },
  REPAIR: { label: "Repair", tone: "orange" },
  LOST: { label: "Lost", tone: "pink" },
  DISPOSED: { label: "Disposed", tone: "slate" },
}

export default function StatusBadge({ type = "asset", status }) {
  const map = type === "employee" ? EMPLOYEE_STATUS : ASSET_STATUS
  const config = map[status] || { label: status, tone: "slate" }
  return <StatusPill tone={config.tone}>{config.label}</StatusPill>
}
