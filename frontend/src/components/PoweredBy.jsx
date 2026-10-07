export default function PoweredBy({ className = "" }) {
  return (
    <p className={`pb-2 text-center text-sm text-muted ${className}`}>
      Powered by{" "}
      <a
        href="https://cloudnext360.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-ink underline-offset-2 hover:text-accent hover:underline"
      >
        CloudNext360
      </a>
    </p>
  )
}
