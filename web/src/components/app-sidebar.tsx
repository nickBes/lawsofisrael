import * as React from "react"
import { Link, useLocation, useSearchParams } from "react-router"
import {
  BookOpenIcon,
  FlagIcon,
  HouseIcon,
  LandmarkIcon,
  LightbulbIcon,
  MessageSquarePlusIcon,
  ScaleIcon,
  UsersIcon,
  VoteIcon,
  type LucideIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { LINKS } from "@/lib/links"

// lucide-react 1.x dropped brand icons, so the GitHub mark is inlined.
export function GithubIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

type NavItem = { to: string; match: string; label: string; icon: LucideIcon }
// `match` is the path prefix shared by the list and its detail pages.
const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "סקירה",
    items: [
      { to: "/", match: "/", label: "ראשי", icon: HouseIcon },
      { to: "/votes", match: "/vote", label: "הצבעות", icon: VoteIcon },
      { to: "/concepts", match: "/concept", label: "מושגים", icon: LightbulbIcon },
      { to: "/laws", match: "/laws", label: "חוקים לאורך זמן", icon: ScaleIcon },
    ],
  },
  {
    label: "נבחרים",
    items: [
      { to: "/parties", match: "/part", label: "מפלגות", icon: FlagIcon },
      { to: "/mks", match: "/mk", label: "חברי כנסת", icon: UsersIcon },
      { to: "/elections", match: "/elections", label: "בחירות", icon: LandmarkIcon },
    ],
  },
  { label: "מידע", items: [{ to: "/about", match: "/about", label: "אודות", icon: BookOpenIcon }] },
]

export function AppSidebar() {
  const { pathname } = useLocation()
  const [sp] = useSearchParams()
  const k = sp.get("k")
  const { setOpenMobile } = useSidebar()

  // Close the mobile sheet after navigating.
  React.useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])

  return (
    <Sidebar side="right">
      <SidebarHeader className="pt-[max(0.5rem,env(safe-area-inset-top))]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/">
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LandmarkIcon />
                </span>
                <span className="font-heading text-lg font-medium">הכנסת בהצבעות</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ to, match, label, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      asChild
                      className="max-md:h-10"
                      isActive={match === "/" ? pathname === "/" : pathname.startsWith(match)}
                    >
                      <Link to={{ pathname: to, search: k ? `?k=${k}` : "" }}>
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="max-md:h-10">
              <a href={LINKS.newIssue} target="_blank" rel="noreferrer">
                <MessageSquarePlusIcon aria-hidden="true" />
                <span>דווחו על בעיה / הציעו שיפור</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="max-md:h-10">
              <a href={LINKS.repo} target="_blank" rel="noreferrer">
                <GithubIcon />
                <span>קוד המקור ב-GitHub</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
