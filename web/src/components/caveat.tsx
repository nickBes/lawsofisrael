import type * as React from "react"
import { Link } from "react-router"
import { InfoIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <Alert>
      <InfoIcon />
      <AlertDescription>
        <p>
          {children} <Link to="/about" className="underline underline-offset-4">עוד על מגבלות הנתונים</Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}
