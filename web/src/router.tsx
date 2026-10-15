import { createHashRouter } from "react-router"

import { AppShell, type Crumb } from "@/components/app-shell"
import { AboutPage } from "@/pages/about"
import { ConceptPage } from "@/pages/concept"
import { ConceptsPage } from "@/pages/concepts"
import { ElectionsPage } from "@/pages/elections"
import { HomePage } from "@/pages/home"
import { LawsPage } from "@/pages/laws"
import { MkPage } from "@/pages/mk"
import { MksPage } from "@/pages/mks"
import { PartiesPage } from "@/pages/parties"
import { PartyPage } from "@/pages/party"
import { VotePage } from "@/pages/vote"
import { VotesPage } from "@/pages/votes"

const h = (crumb: string, parent?: Crumb["parent"]): Crumb => ({ crumb, parent })

export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage />, handle: h("ראשי") },
      { path: "/votes", element: <VotesPage />, handle: h("הצבעות") },
      { path: "/vote/:id", element: <VotePage />, handle: h("הצבעה", { label: "הצבעות", to: "/votes" }) },
      { path: "/parties", element: <PartiesPage />, handle: h("מפלגות") },
      { path: "/party/:id", element: <PartyPage />, handle: h("מפלגה", { label: "מפלגות", to: "/parties" }) },
      { path: "/mks", element: <MksPage />, handle: h("חברי כנסת") },
      { path: "/mk/:id", element: <MkPage />, handle: h("חבר כנסת", { label: "חברי כנסת", to: "/mks" }) },
      { path: "/laws", element: <LawsPage />, handle: h("חוקים לאורך זמן") },
      { path: "/concepts", element: <ConceptsPage />, handle: h("מושגים") },
      { path: "/concept/:id", element: <ConceptPage />, handle: h("מושג", { label: "מושגים", to: "/concepts" }) },
      { path: "/elections", element: <ElectionsPage />, handle: h("בחירות") },
      { path: "/about", element: <AboutPage />, handle: h("אודות") },
      { path: "*", element: <ElectionsPage notFound />, handle: h("לא נמצא") },
    ],
  },
])
