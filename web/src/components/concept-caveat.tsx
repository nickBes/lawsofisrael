import { Caveat } from "@/components/caveat"

export function ConceptCaveat() {
  return (
    <Caveat>
      המושגים חולצו אוטומטית מנוסח הצעות החוק בעזרת מודל שפה. הם מתארים מה החוק עושה מבחינה משפטית, לא את הכוונה שמאחוריו. מנגנונים
      משפטיים כלליים (עונשים, סמכות להתקין תקנות וכד׳) לא נכללים בניתוחים.
    </Caveat>
  )
}

// Bullets are LLM summaries of bill sections, never quotes: every place that shows one says so
export const EVIDENCE_LABEL = "תקציר אוטומטי של סעיף בהצעת החוק"
export function EvidenceLabel() {
  return <span className="text-xs text-muted-foreground">📝 {EVIDENCE_LABEL}</span>
}

// Empty-state copy shared by every concept widget
export const CONCEPT_EMPTY = { empty: "💡 עדיין אין מושגים כאן", description: "המושגים זמינים כרגע רק לחלק מהחוקים, ויתווספו בהמשך." }
