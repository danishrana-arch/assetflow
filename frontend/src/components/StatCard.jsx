import {
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"

export default function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "blue",
  trend,
}) {
  const tones = {
    blue: {
      iconBg: "#DCE7FF",
      iconColor: "#0058BE",
    },

    purple: {
      iconBg: "#EEE5FF",
      iconColor: "#7047C8",
    },

    cyan: {
      iconBg: "#DDF5F4",
      iconColor: "#147F7A",
    },

    green: {
      iconBg: "#DFF5E7",
      iconColor: "#24804B",
    },

    orange: {
      iconBg: "#FFF0D7",
      iconColor: "#C77B00",
    },
  }

  const currentTone =
    tones[tone] || tones.blue

  const isDown =
    trend?.direction === "down"

  return (
    <div
      className="
        relative
        min-w-0
        h-[148px]
        overflow-hidden
        rounded-[22px]
        border
        border-black/[0.035]
        bg-white
        px-5
        py-5
        shadow-[0_8px_28px_rgba(30,50,40,0.055)]
        transition-all
        duration-200
        hover:-translate-y-[1px]
        hover:shadow-[0_12px_34px_rgba(30,50,40,0.08)]
        sm:h-[154px]
        sm:px-5
        sm:py-5
        lg:h-[158px]
        lg:px-6
      "
    >

      {/* ==================================================
          BOTTOM DECORATIVE WAVE
      ================================================== */}

      <div
        className="
          pointer-events-none
          absolute
          inset-x-0
          bottom-0
          z-0
          h-[52px]
          overflow-hidden
        "
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 600 90"
          preserveAspectRatio="none"
          className="
            absolute
            bottom-0
            h-full
            w-full
          "
        >
          <path
            d="
              M0 62
              C75 42 130 72 210 58
              C285 44 315 18 385 35
              C455 52 520 47 600 29
              L600 90
              L0 90
              Z
            "
            fill="#F1F0EC"
            opacity="0.8"
          />

          <path
            d="
              M0 73
              C80 53 140 80 220 68
              C300 56 325 36 395 47
              C470 59 520 55 600 40
              L600 90
              L0 90
              Z
            "
            fill="#E8E7E2"
            opacity="0.42"
          />
        </svg>
      </div>


      {/* ==================================================
          CONTENT
      ================================================== */}

      <div className="relative z-10 flex h-full flex-col">

        {/* TOP ROW */}
        <div className="flex items-start justify-between gap-3">

          <p
            className="
              min-w-0
              truncate
              pt-0.5
              text-[12px]
              font-medium
              leading-5
              text-[#454B4A]
              sm:text-[13px]
            "
          >
            {label}
          </p>


          {/* ICON */}
          <div
            className="
              flex
              h-11
              w-11
              shrink-0
              items-center
              justify-center
              rounded-full
            "
            style={{
              backgroundColor:
                currentTone.iconBg,
            }}
          >
            {Icon && (
              <Icon
                size={20}
                strokeWidth={1.8}
                style={{
                  color:
                    currentTone.iconColor,
                }}
              />
            )}
          </div>

        </div>


        {/* VALUE + TREND */}
        <div
          className="
            mt-auto
            flex
            items-baseline
            gap-2
            pb-0
          "
        >

          <span
            className="
              text-[30px]
              font-semibold
              leading-none
              tracking-[-0.035em]
              text-[#202322]
              sm:text-[32px]
            "
          >
            {value}
          </span>


          {trend && (
            <span
              className={`
                inline-flex
                items-center
                gap-0.5
                text-[11px]
                font-semibold
                leading-none
                ${
                  isDown
                    ? "text-[#E5484D]"
                    : "text-[#237A43]"
                }
              `}
            >
              {isDown ? (
                <ArrowDownRight
                  size={12}
                  strokeWidth={2.2}
                />
              ) : (
                <ArrowUpRight
                  size={12}
                  strokeWidth={2.2}
                />
              )}

              {trend.value}
            </span>
          )}

        </div>


        {/* SUBLABEL */}
        <p
          className="
            relative
            z-10
            mt-2
            truncate
            text-[11px]
            leading-4
            text-[#6B7370]
            sm:text-xs
          "
        >
          {sublabel}
        </p>

      </div>

    </div>
  )
}