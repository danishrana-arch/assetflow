import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createPortal } from "react-dom"
import { Camera, ImagePlus, Trash2, X } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import Avatar from "./ui/Avatar"

const OUTPUT_SIZE = 256 // px, square
const MAX_INPUT_BYTES = 15 * 1024 * 1024

// Centre-crops the picked picture to a square and shrinks it to a small JPEG
// data URL (~15–30 KB), which is what PUT /employees/:id/photo stores.
export function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Pick an image file (JPG, PNG or WEBP)."))
    if (file.size > MAX_INPUT_BYTES) return reject(new Error("That picture is too large (max 15 MB)."))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement("canvas")
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff" // transparent PNGs get a white background in JPEG
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE,
      )
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("This picture can't be read. Use a JPG, PNG or WEBP."))
    }
    img.src = url
  })
}

// Upload / remove someone's picture and refresh every place that shows it.
export function useProfilePhoto(employeeId) {
  const queryClient = useQueryClient()
  const { user, refreshUser } = useAuth()
  const [error, setError] = useState("")

  const mutation = useMutation({
    mutationFn: (photo) => api.put(`/employees/${employeeId}/photo`, { photo }).then((r) => r.data),
    onSuccess: () => {
      setError("")
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId] })
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      if (employeeId === user?.id) refreshUser?.()
    },
    onError: (err) => setError(err.response?.data?.error || "Could not save the picture"),
  })

  async function upload(file) {
    if (!file) return
    setError("")
    try {
      mutation.mutate(await resizeImage(file))
    } catch (err) {
      setError(err.message)
    }
  }

  return { upload, remove: () => mutation.mutate(null), pending: mutation.isPending, error, setError }
}

// Avatar with a camera button for changing the picture (when allowed).
export default function ProfilePhoto({ employeeId, name, src, size = "2xl", canEdit = false, className = "", buttonClassName = "" }) {
  const { upload, remove, pending, error } = useProfilePhoto(employeeId)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false)
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  const pick = () => {
    setMenuOpen(false)
    inputRef.current?.click()
  }

  // ADMIN / CEO can open any picture full-screen.
  const { user } = useAuth()
  const canEnlarge = Boolean(src) && ["ADMIN", "CEO"].includes(user?.role)
  const [enlarged, setEnlarged] = useState(false)

  useEffect(() => {
    if (!enlarged) return undefined
    const onKey = (e) => e.key === "Escape" && setEnlarged(false)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [enlarged])

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      {canEnlarge ? (
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          aria-label={`View ${name || "profile"} picture full size`}
          title="View full size"
          className="block cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar name={name} src={src} size={size} className={pending ? "opacity-60" : ""} />
        </button>
      ) : (
        <Avatar name={name} src={src} size={size} className={pending ? "opacity-60" : ""} />
      )}
      {enlarged &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${name || "Profile"} picture`}
            onClick={() => setEnlarged(false)}
            className="fixed inset-0 z-[100] flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-black/80 p-6 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setEnlarged(false)}
              aria-label="Close"
              className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X size={20} />
            </button>
            <img
              src={src}
              alt={name || "Profile picture"}
              onClick={(e) => e.stopPropagation()}
              className="aspect-square w-[min(88vw,80vh)] max-w-[640px] cursor-default rounded-3xl object-cover shadow-2xl"
            />
            {name && <p className="text-lg font-semibold text-white">{name}</p>}
          </div>,
          document.body,
        )}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => (src ? setMenuOpen((v) => !v) : pick())}
            disabled={pending}
            aria-label={src ? "Change profile picture" : "Add profile picture"}
            title={src ? "Change profile picture" : "Add profile picture"}
            className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 bg-accent text-on-accent shadow-card transition-transform hover:scale-105 disabled:opacity-60 ${buttonClassName || "h-8 w-8 border-surface"}`}
          >
            <Camera size={buttonClassName ? 12 : 14} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              upload(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          {menuOpen && (
            <div className="absolute left-1/2 top-full z-30 mt-2 w-48 -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface py-1 text-sm shadow-card">
              <button type="button" onClick={pick} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-ink hover:bg-surface-2">
                <ImagePlus size={15} /> Upload new picture
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  remove()
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-chip-pink-fg hover:bg-chip-pink-bg"
              >
                <Trash2 size={15} /> Remove picture
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-xl bg-chip-pink-bg px-3 py-2 text-center text-xs text-chip-pink-fg">
          {error}
        </p>
      )}
    </div>
  )
}
