import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Adapted from https://ui.shadcn.com/docs/dark-mode/vite
export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" className="max-md:size-10">
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
          <span className="sr-only">ערכת צבעים</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
          <DropdownMenuRadioItem value="light">
            <SunIcon aria-hidden />
            בהיר
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon aria-hidden />
            כהה
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon aria-hidden />
            לפי המערכת
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
