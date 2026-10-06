// Status icons from the design sheet (Material Symbols, outlined, 960-unit
// grid). Transparent background, drawn in `currentColor`, so they take the
// tile's colour in light and dark mode. Same props as lucide icons (size,
// className); strokeWidth is accepted and ignored so they drop into places
// that pass it.
//
// "Present" / "Absent" use the person body with the thinner check / cross of
// the sheet; "On leave" is the sheet's square-dotted "!"; "Active projects"
// is a folder with three bars (no Material icon has that shape).

const PERSON =
  "M252-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42ZM40-160v-94q0-35 17.5-63.5T108-360q75-33 133.5-46.5T360-420q60 0 118 13.5T611-360q33 15 51 43t18 63v94H40Zm60-60h520v-34q0-16-9-30.5T587-306q-71-33-120-43.5T360-360q-58 0-107.5 10.5T132-306q-15 7-23.5 21.5T100-254v34Zm324.5-346.5Q450-592 450-631t-25.5-64.5Q399-721 360-721t-64.5 25.5Q270-670 270-631t25.5 64.5Q321-541 360-541t64.5-25.5Z"

function makeIcon(name, children) {
  function Icon({ size = 24, className = "", strokeWidth: _strokeWidth, ...rest }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 -960 960 960"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...rest}
      >
        {children}
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}

const thin = { fill: "none", stroke: "currentColor", strokeWidth: 38, strokeLinecap: "square" }

export const OnLeaveIcon = makeIcon("OnLeaveIcon", (
  <>
    <rect x="444" y="-800" width="72" height="420" />
    <rect x="444" y="-276" width="72" height="72" />
  </>
))

export const LostIcon = makeIcon("LostIcon", (
  <path d="m40-120 440-760 440 760H40Zm104-60h672L480-760 144-180Zm361.5-65.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68ZM454-348h60v-224h-60v224Z" />
))

export const RepairIcon = makeIcon("RepairIcon", (
  <path d="M705-128 447-388q-23 8-46 13t-47 5q-97.08 0-165.04-67.67Q121-505.33 121-602q0-31 8.16-60.39T152-718l145 145 92-86-149-149q25.91-15.16 54.96-23.58Q324-840 354-840q99.17 0 168.58 69.42Q592-701.17 592-602q0 24-5 47t-13 46l259 258q11 10.96 11 26.48T833-198l-76 70q-10.7 11-25.85 11Q716-117 705-128Zm28-57 40-40-273-273q16-21 24-49.5t8-54.5q0-75-55.5-127T350-782l102 104q9 9 8.5 21.5T451-635L318-510q-9.27 8-21.64 8-12.36 0-20.36-8l-98-97q3 77 54.67 127T354-430q25 0 53-8t49-24l277 277Z" />
))

export const NotMarkedIcon = makeIcon("NotMarkedIcon", (
  <>
    <path d={PERSON} />
    <path d="M648-542v-60h232v60H648Z" />
  </>
))

export const PresentIcon = makeIcon("PresentIcon", (
  <>
    <path d={PERSON} />
    <path d="M572-532 642-462 800-620" {...thin} />
  </>
))

export const AbsentIcon = makeIcon("AbsentIcon", (
  <>
    <path d={PERSON} />
    <path d="M640-620 780-480M780-620 640-480" {...thin} />
  </>
))

export const ActiveProjectsIcon = makeIcon("ActiveProjectsIcon", (
  <>
    <path d="M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h281l60 60h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Zm0-60h680v-460H456l-60-60H140v520Z" />
    <rect x="296" y="-620" width="56" height="340" />
    <rect x="452" y="-620" width="56" height="340" />
    <rect x="608" y="-510" width="56" height="230" />
  </>
))

export const TotalEmployeesIcon = makeIcon("TotalEmployeesIcon", (
  <path d="M38-160v-94q0-35 18-63.5t50-42.5q73-32 131.5-46T358-420q62 0 120 14t131 46q32 14 50.5 42.5T678-254v94H38Zm700 0v-94q0-63-32-103.5T622-423q69 8 130 23.5t99 35.5q33 19 52 47t19 63v94H738ZM250-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42Zm426 0q-42 42-108 42-11 0-24.5-1.5T519-488q24-25 36.5-61.5T568-631q0-45-12.5-79.5T519-774q11-3 24.5-5t24.5-2q66 0 108 42t42 108q0 66-42 108ZM98-220h520v-34q0-16-9.5-31T585-306q-72-32-121-43t-106-11q-57 0-106.5 11T130-306q-14 6-23 21t-9 31v34Zm324.5-346.5Q448-592 448-631t-25.5-64.5Q397-721 358-721t-64.5 25.5Q268-670 268-631t25.5 64.5Q319-541 358-541t64.5-25.5Z" />
))

export const InUseIcon = makeIcon("InUseIcon", (
  <path d="m357-167-43-43 80-81q-136-15-225-66T80-486q0-79 116.5-134.5T480-676q168 0 284 55.5T880-486q0 59-64 104t-170 70v-65q80-20 127-52t47-57q0-32-83.5-81T480-616q-172 0-256 49t-84 81q0 45 57.5 77.5T397-349l-83-81 43-43 153 152-153 154Z" />
))

export const LateIcon = makeIcon("LateIcon", (
  <path d="m627-287 45-45-159-160v-201h-60v225l174 181ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-82 31.5-155t86-127.5Q252-817 325-848.5T480-880q82 0 155 31.5t127.5 86Q817-708 848.5-635T880-480q0 82-31.5 155t-86 127.5Q708-143 635-111.5T480-80Zm0-60q140 0 240-100t100-240q0-140-100-240T480-820q-140 0-240 100T140-480q0 140 100 240t240 100Z" />
))
