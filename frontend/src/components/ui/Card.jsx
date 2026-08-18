export default function Card({ as: Tag = "section", className = "", padded = true, children, ...rest }) {
  return (
    <Tag
      className={`card ${padded ? "p-5 sm:p-6" : ""} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}
