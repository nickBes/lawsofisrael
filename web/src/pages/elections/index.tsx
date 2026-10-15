import { Link } from "react-router"
import { LandmarkIcon } from "lucide-react"

import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

// Placeholder until the elections dataset arrives (phase 4). Also used as the 404 page.
export function ElectionsPage({ notFound = false }: { notFound?: boolean }) {
  return (
    <BlurFade inView>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LandmarkIcon />
          </EmptyMedia>
          <EmptyTitle>{notFound ? "הדף לא נמצא" : "הבחירות הקרובות: בקרוב"}</EmptyTitle>
          <EmptyDescription>
            {notFound
              ? "ייתכן שהקישור שגוי."
              : "כאן יוצגו הרשימות המתמודדות, המועמדים שכבר כיהנו בכנסת ורקורד ההצבעות שלהם, אחרי שיתווספו נתוני הבחירות."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/mks">לחברי הכנסת</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </BlurFade>
  )
}
