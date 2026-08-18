import IconChip from "./IconChip"

export default function ListRow({
  icon,
  tone = "blue",
  title,
  subtitle,
  trailing,
  as: Tag = "div",
  className = "",
  ...rest
}) {
  return (
    <Tag
      className={`flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-surface-2 ${className}`}
      {...rest}
    >
      {icon && <IconChip icon={icon} tone={tone} size="md" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {trailing && <div className="shrink-0 text-right text-xs text-muted">{trailing}</div>}
    </Tag>
  )
}
