import * as React from "react"
import { Link, Outlet, ScrollRestoration, useMatches } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { DatabaseIcon } from "lucide-react"

import { dbQuery } from "@/components/db-gate"
import { AppSidebar, GithubIcon } from "@/components/app-sidebar"
import { PageBackground } from "@/components/page-background"
import { LINKS } from "@/lib/links"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { SearchDialog } from "@/components/search-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

export type Crumb = { crumb: string; parent?: { label: string; to: string } }

export function AppShell() {
  const { data } = useQuery(dbQuery)
  const matches = useMatches()
  const handle = matches.at(-1)?.handle as Crumb | undefined

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="isolate min-w-0">
        <PageBackground />
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="max-md:size-10" />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="max-md:py-2.5">
                  <Link to="/">ראשי</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {handle?.parent && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild className="max-md:py-2.5">
                      <Link to={handle.parent.to}>{handle.parent.label}</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </>
              )}
              {handle && handle.crumb !== "ראשי" && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{handle.crumb}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <SearchDialog />
          {/* below md the sidebar footer has the same link; the header needs the room for the breadcrumb */}
          <Button variant="ghost" size="icon" asChild className="max-md:hidden">
            <a href={LINKS.repo} target="_blank" rel="noreferrer" aria-label="קוד המקור ב-GitHub">
              <GithubIcon />
            </a>
          </Button>
          <ModeToggle />
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
          {data?.persistent === false && (
            <Alert>
              <DatabaseIcon />
              <AlertDescription>הנתונים לא נשמרו בדפדפן, הם ייטענו שוב בביקור הבא.</AlertDescription>
            </Alert>
          )}
          <Outlet />
        </main>
      </SidebarInset>
      <ScrollRestoration />
    </SidebarProvider>
  )
}

// Page title + optional controls, used at the top of every page.
export function PageHeader({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}
