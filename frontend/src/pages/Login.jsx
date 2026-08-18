import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Boxes, ShieldCheck, Sparkles } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { TextField } from "../components/ui/Field"
import logoFull from "../assets/logo1.png"

export default function Login() {
  const { login } = useAuth()
  const { mode } = useTheme()
  const navigate = useNavigate()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const isDark = mode === "dark"

  async function handleSubmit(e) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      await login(email, password)
      navigate("/")
    } catch (err) {
      setError(err.response?.data?.error || "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={`
        flex min-h-screen items-center justify-center
        p-4 transition-colors duration-300
        ${
          isDark
            ? "bg-[#0d1110]"
            : "bg-[#f4f6f5]"
        }
      `}
    >
      <div
        className={`
          grid w-full max-w-4xl
          overflow-hidden
          rounded-[28px]
          transition-all duration-300
          lg:grid-cols-2
          ${
            isDark
              ? "bg-[#171d1b] border border-white/[0.06] shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
              : "bg-white border border-black/[0.04] shadow-[0_24px_70px_rgba(0,0,0,0.12)]"
          }
        `}
      >
        <div
          className={`
            relative hidden
            flex-col justify-between
            p-10
            lg:flex
            transition-all duration-300
            ${
              isDark
                ? "bg-gradient-to-br from-[#242b3b] via-[#20232f] to-[#172a2a]"
                : "bg-gradient-to-br from-chip-blue-bg via-chip-purple-bg to-chip-cyan-bg"
            }
          `}
        >
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div
              className={`
                flex h-12 w-12
                items-center justify-center
                rounded-2xl
                backdrop-blur-md
                transition-all duration-300
                ${
                  isDark
                    ? "bg-white/[0.10] border border-white/[0.12] shadow-lg"
                    : "bg-white/45 border border-white/50 shadow-sm"
                }
              `}
            >
              <img
                src={logoFull}
                alt="AssetFlow logo"
                className="h-8 w-8 object-contain"
              />
            </div>

            <span
              className={`
                text-lg font-semibold
                ${
                  isDark
                    ? "text-white"
                    : "text-[#202525]"
                }
              `}
            >
              AssetFlow
            </span>
          </div>

          {/* Main Message */}
          <div className="space-y-6">
            <h2
              className={`
                text-3xl font-semibold
                leading-[1.15]
                transition-colors duration-300
                ${
                  isDark
                    ? "text-white"
                    : "text-[#202525]"
                }
              `}
              style={{ letterSpacing: "-0.02em" }}
            >
              Track every asset,
              <br />
              from purchase to retirement.
            </h2>

            <ul
              className={`
                space-y-3 text-sm
                ${
                  isDark
                    ? "text-white/75"
                    : "text-[#303838]"
                }
              `}
            >
              {/* Feature 1 */}
              <li className="flex items-center gap-3">
                <span
                  className={`
                    flex h-9 w-9 shrink-0
                    items-center justify-center
                    rounded-2xl
                    ${
                      isDark
                        ? "bg-black/25 text-cyan-300 border border-white/[0.06]"
                        : "bg-white/70 text-chip-blue-fg border border-white/50"
                    }
                  `}
                >
                  <Boxes size={17} />
                </span>

                <span>
                  Real-time inventory and assignment tracking
                </span>
              </li>

              {/* Feature 2 */}
              <li className="flex items-center gap-3">
                <span
                  className={`
                    flex h-9 w-9 shrink-0
                    items-center justify-center
                    rounded-2xl
                    ${
                      isDark
                        ? "bg-black/25 text-emerald-300 border border-white/[0.06]"
                        : "bg-white/70 text-chip-green-fg border border-white/50"
                    }
                  `}
                >
                  <ShieldCheck size={17} />
                </span>

                <span>
                  Warranty and lifecycle timeline for every asset
                </span>
              </li>

              {/* Feature 3 */}
              <li className="flex items-center gap-3">
                <span
                  className={`
                    flex h-9 w-9 shrink-0
                    items-center justify-center
                    rounded-2xl
                    ${
                      isDark
                        ? "bg-black/25 text-violet-300 border border-white/[0.06]"
                        : "bg-white/70 text-chip-purple-fg border border-white/50"
                    }
                  `}
                >
                  <Sparkles size={17} />
                </span>

                <span>
                  Requests, tickets & reports in one place
                </span>
              </li>
            </ul>
          </div>

          <p
            className={`
              text-xs
              ${
                isDark
                  ? "text-white/50"
                  : "text-[#4b5555]"
              }
            `}
          >
            © {new Date().getFullYear()} AssetFlow
          </p>
        </div>

        <div
          className={`
            flex flex-col justify-center
            p-8 sm:p-10
            transition-colors duration-300
            ${
              isDark
                ? "bg-[#171d1b]"
                : "bg-white"
            }
          `}
        >
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div
              className={`
                flex h-11 w-11
                items-center justify-center
                rounded-2xl
                ${
                  isDark
                    ? "bg-white/10 border border-white/10"
                    : "bg-black/5 border border-black/5"
                }
              `}
            >
              <img
                src={logoFull}
                alt="AssetFlow logo"
                className="h-7 w-7 object-contain"
              />
            </div>

            <span
              className={`
                font-semibold
                ${
                  isDark
                    ? "text-white"
                    : "text-[#202525]"
                }
              `}
            >
              AssetFlow
            </span>
          </div>

          <h1
            className={`
              text-2xl font-semibold
              transition-colors duration-300
              ${
                isDark
                  ? "text-white"
                  : "text-[#202525]"
              }
            `}
            style={{ letterSpacing: "-0.02em" }}
          >
            Welcome back
          </h1>

          <p
            className={`
              mt-1 text-sm
              ${
                isDark
                  ? "text-white/55"
                  : "text-[#687272]"
              }
            `}
          >
            Sign in to continue to your dashboard
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-4"
          >
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
            />

            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            {error && (
              <div
                className={`
                  rounded-2xl
                  px-3.5 py-2.5
                  text-sm
                  ${
                    isDark
                      ? "bg-red-500/10 text-red-300 border border-red-400/10"
                      : "bg-chip-pink-bg text-chip-pink-fg"
                  }
                `}
              >
                {error}
              </div>
            )}

            {/* Sign In */}
            <button
              type="submit"
              disabled={loading}
              className="
                pill-accent
                w-full
                py-3
                text-sm
                font-semibold
                transition-all
                duration-200
                disabled:opacity-60
                disabled:cursor-not-allowed
              "
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Help */}
          <p
            className={`
              mt-6 text-center text-xs
              ${
                isDark
                  ? "text-white/45"
                  : "text-[#687272]"
              }
            `}
          >
            Trouble signing in? Contact your workspace admin.
          </p>
        </div>
      </div>
    </div>
  )
}