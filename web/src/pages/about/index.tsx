import { PageHeader } from "@/components/app-shell"
import { QueryState } from "@/components/query-state"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { BugIcon, GitPullRequestIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LINKS } from "@/lib/links"
import { BlurFade } from "@/components/ui/blur-fade"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtDate, fmtNum, SMALL_KNESSETS } from "@/lib/labels"
import { useCoverage } from "./queries"

const DEFINITIONS = [
  ["השתתפות", "מספר ההצבעות שחבר הכנסת השתתף בהן (בעד, נגד, נמנע או נוכח), מתוך ההצבעות האלקטרוניות והשמיות שהתקיימו בין ההצבעה הראשונה לאחרונה שלו באותה כנסת."],
  ["לכידות", "מדד רייס: ההפרש בין מצביעי בעד לנגד במפלגה, חלקי סך המצביעים. 100% פירושו שכל חברי המפלגה שהצביעו הצביעו באותו כיוון."],
  ["הצבעה נגד המפלגה", "חבר הכנסת הצביע בעד או נגד, הפוך מרוב חברי מפלגתו שהצביעו, כשלפחות שני חברים נוספים מהמפלגה הצביעו."],
  ["הצבעת גוש מול גוש", "הצבעה שבה רוב הקואליציה ורוב האופוזיציה הצביעו הפוך, וכל מפלגה הצביעה עם הגוש שלה."],
  ["מפלגה", "סיעות שונות לאורך השנים מאוחדות למפלגה אחת (למשל כל גלגולי הליכוד). רשימה משותפת משויכת למפלגה המובילה בה."],
]

const CAVEATS = [
  ["הקריאה לא תמיד ידועה", "בכ-20 אלף הצבעות נוסח ההחלטה לא מציין קריאה. במקרים כאלה מוצג הנוסח המקורי."],
  ["קריאה טרומית וקריאה ראשונה", "במקור הנתונים שתיהן מסומנות כקריאה ראשונה. כאן הן מופרדות לפי נוסח ההחלטה."],
  ["הצבעות על הסתייגויות", "כ-8,500 הצבעות \"לדחות את ההצעה\" נערכו ביום הקריאה השנייה של אותה הצעה. אלה כמעט בוודאות הצבעות על הסתייגויות, שבהן \"בעד\" פירושו תמיכה בתיקון ולא בחוק. הן מסומנות כהסתייגות ולא נכללות בחישובי \"הצבעה בעד החוק\"."],
  ["\"לדחות\" הוא התוצאה, לא ההצעה", "\"בעד\" תמיד פירושו תמיכה בהצעה שהועמדה להצבעה, גם כשהתוצאה הרשמית היא דחייה."],
  ["תוצאה מול ספירה", "ב-226 הצבעות התוצאה הרשמית אינה תואמת את הספירה, כנראה בגלל דרישת רוב מיוחד. מוצגות שתיהן."],
  ["נעדרים", "בנתונים אין שורה לחבר כנסת שלא הצביע. היעדרות מחושבת מול רשימת המכהנים, ואינה הצבעה נגד."],
  ["אין תאריכי סיום כהונה", "תקופת הכהונה מוסקת מההצבעה הראשונה והאחרונה. חברי כנסת שהתפטרו וחזרו (החוק הנורווגי) עשויים להיראות נעדרים בתקופה שלא כיהנו."],
  ["הצבעות בלי פירוט אישי", "בהצבעות בהרמת יד או חשאיות פורסמו רק סיכומים."],
  ["קואליציה ואופוזיציה", "השיוך לקואליציה נלקח מטבלה שהוכנה ידנית לפי ההיסטוריה הידועה ונבדקה מול רשימות השרים. בתקופות מעבר ובמפלגות שתמכו מבחוץ ייתכנו אי-דיוקים."],
  ["רשימות משותפות", "חברי רשימה משותפת נספרים במפלגה המובילה עד הפיצול (למשל חברי ישראל ביתנו ברשימת הליכוד-ישראל ביתנו בכנסת ה-19)."],
  ["כנסות קטנות", "בכנסות ה-21 וה-22 התקיימו רק 16 ו-86 הצבעות. השוואות שלהן לכנסות אחרות אינן אמינות."],
  ["הצעות חוק", "נכללות רק הצעות שהגיעו להצבעה במליאה. רוב ההצעות הפרטיות לא מגיעות לשם, ולכן זה אינו מספר ההצעות שהוגשו."],
  [
    "מושגים",
    "המושגים חולצו אוטומטית מנוסח הצעות החוק בעזרת מודל שפה. הם מתארים מה החוק עושה מבחינה משפטית, לא את הכוונה שמאחוריו. מושג שמופיע בהצעות חוק שהועברו לפחות ל-20% מהוועדות (ולפחות ל-3 ועדות) מסומן כמנגנון משפטי כללי, למשל עונשים, סמכות להתקין תקנות או מועד תחילה, ולא נכלל בניתוחים. ספירת ההצבעות על מושג כוללת את כל שלבי ההצעה.",
  ],
  ["תחום (לפי ועדה)", "משמש רק כמסנן ברשימת ההצבעות. התחום נקבע לפי הוועדה שאליה הועברה הצעת החוק. זה סיווג גס, וכ-2,400 הצעות שלא הועברו לוועדה נשארות בלי תחום."],
  ["משמעת קואליציונית", "רוב ההצבעות במליאה משקפות משמעת קואליציונית. הצבעה של מפלגה בזמן שהיא בממשלה עשויה להיות שונה מעמדותיה."],
]

export function AboutPage() {
  const coverage = useCoverage()
  return (
    <>
      <ScrollProgress />
      <BlurFade inView>
        <PageHeader title="אודות" description="מאיפה הנתונים, איך מחושבים המדדים, ומה הם לא אומרים." />
      </BlurFade>
      <BlurFade inView delay={0.05}>
        <Card>
          <CardHeader>
            <CardTitle>מקור הנתונים</CardTitle>
            <CardDescription>
              הצבעות המליאה, הצבעות חברי הכנסת, הצעות החוק, הסיעות והממשלות נאספו מה-API הרשמי של אתר הכנסת, מהכנסת ה-16 (2003) ואילך.
              תמונות חברי הכנסת מוצגות ישירות מאתר הכנסת. האתר לא ממליץ למי להצביע: הוא מציג את הנתונים כדי שכל אחד יוכל לבדוק בעצמו.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState query={coverage}>
              {(rows) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>כנסת</TableHead>
                      <TableHead>הצבעות</TableHead>
                      <TableHead className="max-lg:hidden">ימי הצבעה</TableHead>
                      <TableHead>קריאות שלישיות</TableHead>
                      <TableHead className="max-sm:hidden">תקופה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.knesset_num}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            {r.knesset_num}
                            {SMALL_KNESSETS.includes(r.knesset_num) && <Badge variant="outline">מדגם קטן</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{fmtNum(r.votes)}</TableCell>
                        <TableCell className="tabular-nums max-lg:hidden">{fmtNum(r.days)}</TableCell>
                        <TableCell className="tabular-nums">{fmtNum(r.finals)}</TableCell>
                        <TableCell className="tabular-nums max-sm:hidden max-lg:whitespace-normal">
                          {fmtDate(r.first_date)} – {fmtDate(r.last_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>הגדרות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {DEFINITIONS.map(([term, text], i) => (
              <div key={term} className="flex flex-col gap-4">
                {i > 0 && <Separator />}
                <div className="flex flex-col gap-1">
                  <h3 className="font-medium">{term}</h3>
                  <p className="text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>מגבלות הנתונים</CardTitle>
            <CardDescription>כדאי לקרוא לפני שמסיקים מסקנות.</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple">
              {CAVEATS.map(([title, text]) => (
                <AccordionItem key={title} value={title}>
                  <AccordionTrigger>{title}</AccordionTrigger>
                  <AccordionContent>{text}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade inView delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle>מצאתם טעות? יש לכם רעיון?</CardTitle>
            <CardDescription>
              הקוד והנתונים פתוחים ב-GitHub. אפשר לדווח על באג או על טעות בנתונים, להציע שיפור, או לשלוח Pull Request.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={LINKS.newIssue} target="_blank" rel="noreferrer">
                <BugIcon data-icon="inline-start" />
                פתיחת Issue
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={LINKS.repo} target="_blank" rel="noreferrer">
                <GitPullRequestIcon data-icon="inline-start" />
                הקוד ב-GitHub
              </a>
            </Button>
          </CardContent>
        </Card>
      </BlurFade>
    </>
  )
}
