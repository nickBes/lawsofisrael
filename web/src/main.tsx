import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { RouterProvider } from "react-router"

import "./index.css"
import { router } from "./router"
import { DbGate } from "@/components/db-gate"
import { ThemeProvider } from "@/components/theme-provider"
import { DirectionProvider } from "@/components/ui/direction"
import { TooltipProvider } from "@/components/ui/tooltip"

// Data is immutable per deploy, so results never go stale.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <DirectionProvider dir="rtl">
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <DbGate>
                <RouterProvider router={router} />
              </DbGate>
            </TooltipProvider>
          </QueryClientProvider>
        </DirectionProvider>
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>
)
