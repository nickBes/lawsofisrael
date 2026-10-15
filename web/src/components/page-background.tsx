import { DotPattern } from "@/components/ui/dot-pattern"

// Mount as the first child of an `isolate` container: -z-10 paints above its bg, below content.
// The sticky viewport-high layer keeps the SVG dot count bounded on long pages; static dots, so no motion to reduce.
export function PageBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-clip">
      <div className="sticky top-0 h-svh">
        <DotPattern
          width={22}
          height={22}
          className="text-foreground/25 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_0%,white,transparent)] dark:text-foreground/20"
        />
      </div>
    </div>
  )
}
