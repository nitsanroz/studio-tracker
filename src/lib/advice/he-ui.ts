// &advice's FIXED interface text in Hebrew — buttons, headings, the lines the
// pane and the /advice page write themselves. The cards' own sentences come
// from the rules and are translated on the server (hebrew.ts); this is only
// what the interface says around them.
//
// English is the source, as in Scenarios (lib/finance/scenarios/i18n.ts): every
// string is written in English in the code and looked up here by that exact
// text; {name} marks are filled in. A string missing here shows in English.
// Client-safe: no figure of the studio's.

export type AdviceLang = "en" | "he";
export type Vars = Record<string, string | number>;

const HE: Record<string, string> = {
  // kinds and filters
  "Do now": "לטיפול עכשיו",
  "Heads-up": "לתשומת לב",
  "Heads-ups": "לתשומת לב",
  Idea: "רעיון",
  Ideas: "רעיונות",
  "All {n}": "הכול {n}",
  "· got worse": "· החמיר",
  // the pane's opening line
  "{n} thing needs": "דבר אחד מחכה",
  "{n} things need": "{n} דברים מחכים",
  "you today.": "לך היום.",
  "Nothing urgent today.": "אין היום שום דבר דחוף.",
  // a card's actions
  "Snooze until": "להזכיר שוב",
  Cancel: "ביטול",
  Tomorrow: "מחר",
  "Next week": "בשבוע הבא",
  "In 2 weeks": "בעוד שבועיים",
  "Mark done": "סימון כבוצע",
  Snooze: "להזכיר מאוחר יותר",
  Dismiss: "להסיר",
  "Dismiss — it comes back only if it gets worse": "להסיר — יחזור רק אם המצב יחמיר",
  "Show fewer": "להציג פחות",
  "Show all {n}": "להציג את כל ה־{n}",
  "Saving…": "שומר…",
  "Bring back": "להחזיר",
  // toasts
  "Snoozed until {day}": "יוזכר שוב ב־{day}",
  Dismissed: "הוסר",
  "Done — {title}": "בוצע — {title}",
  "Brought back": "הוחזר",
  "Couldn't save that — try again": "השמירה נכשלה — כדאי לנסות שוב",
  "Couldn't undo that — try again": "הביטול נכשל — כדאי לנסות שוב",
  // header and footer
  "Check again": "לבדוק שוב",
  Close: "סגירה",
  "Open the full page": "לפתוח את העמוד המלא",
  "Checked {time}": "נבדק ב־{time}",
  "worded {time}": "נוסח ב־{time}",
  "Wording today's advice…": "מנסח את העצות של היום…",
  "Reading billing mail…": "קורא את מיילי החיוב…",
  "Translating…": "מתרגם…",
  "Claude words it; the amounts are the app's own": "Claude מנסח; הסכומים הם של המערכת עצמה",
  "Plain wording — no Claude API key": "ניסוח רגיל — אין מפתח API של Claude",
  "Plain wording — the last Claude run failed": "ניסוח רגיל — הריצה האחרונה של Claude נכשלה",
  "{n} snoozed or dismissed": "{n} נדחו או הוסרו",
  "Hebrew needs a Claude API key": "לעברית דרוש מפתח API של Claude",
  "Some of it couldn't be translated — try again": "חלק מהטקסט לא תורגם — כדאי לנסות שוב",
  // empty states
  "No ideas today.": "אין היום רעיונות.",
  "All clear.": "הכול נקי.",
  "Nothing about this page today.": "אין היום שום דבר על העמוד הזה.",
  "Here · {label}": "כאן · {label}",
  "Elsewhere · {n}": "במקומות אחרים · {n}",
  // the reviews
  "Review the business": "סקירת העסק",
  "Claude reads the last three months the way a business consultant would — price, team size, which clients are worth the hours, costs, tax timing — and says what it would do. It sees shares, percentages and hours, never an amount.":
    "Claude קורא את שלושת החודשים האחרונים כמו יועץ עסקי — מחיר, גודל הצוות, אילו לקוחות שווים את השעות, עלויות, תזמון מס — ואומר מה היה עושה. הוא רואה חלקים יחסיים, אחוזים ושעות, ואף פעם לא סכום.",
  "Review the studio's tools": "סקירת הכלים של הסטודיו",
  "Claude looks over every live subscription and says what to cancel, merge, switch or downgrade. It sees names and plans, never an amount.":
    "Claude עובר על כל מנוי פעיל ואומר מה לבטל, לאחד, להחליף או להוריד בדרגה. הוא רואה שמות ותוכניות, ואף פעם לא סכום.",
  "Review now": "לסקור עכשיו",
  "Review again": "לסקור שוב",
  "Reviewing…": "סוקר…",
  "Needs a Claude API key": "דרוש מפתח API של Claude",
  "The last three months aren't booked yet": "שלושת החודשים האחרונים עוד לא רשומים בספרים",
  "about a minute": "בערך דקה",
  "Last review {day}": "סקירה אחרונה: {day}",
  "Last try failed {day}": "הניסיון האחרון נכשל: {day}",
  // the floating note
  "Back to &advice": "חזרה ל־&advice",
  "Highlighted on the page": "מסומן בעמוד",
  "{at} of {n}": "{at} מתוך {n}",
  "Couldn't find it on the page — a hidden row, or another year?": "לא נמצא בעמוד — שורה מוסתרת, או שנה אחרת?",
  // the /advice page
  "The studio at a glance: what needs you, how the last three months read, and what was found and closed.": "הסטודיו במבט אחד: מה מחכה לך, איך נראים שלושת החודשים האחרונים, ומה נמצא ונסגר.",
  Today: "היום",
  "Snoozed or dismissed": "נדחו או הוסרו",
  "Closed in 30 days": "נסגרו ב־30 יום",
  "The consultant's read": "המבט של היועץ",
  "Questions only you can answer": "שאלות שרק לך יש תשובה עליהן",
  "No review yet. One click reads the last three months as a consultant would.": "עוד אין סקירה. לחיצה אחת קוראת את שלושת החודשים האחרונים כמו יועץ.",
  "The studio in numbers": "הסטודיו במספרים",
  "The last three complete months": "שלושת החודשים המלאים האחרונים",
  "These charts need the last three months in the books.": "הגרפים צריכים את שלושת החודשים האחרונים רשומים בספרים.",
  "Profit margin": "שולי רווח",
  Target: "יעד",
  "A year ago": "לפני שנה",
  "Now": "עכשיו",
  "Where the income goes": "לאן הולכת ההכנסה",
  Salaries: "שכר",
  Freelancers: "פרילנסרים",
  Rent: "שכירות",
  Tools: "כלים",
  Other: "אחר",
  "Left over": "נשאר",
  "An hour": "שעה אחת",
  "Sold for": "נמכרת ב־",
  "Costs the studio": "עולה לסטודיו",
  "A year ago it cost": "לפני שנה עלתה",
  "{pct}% of income is sold by the hour": "{pct}% מההכנסה נמכרת לפי שעה",
  Team: "צוות",
  "of a full day billed": "מיום עבודה מלא חויבו",
  "Healthy range {low}–{high}% — a rule of thumb": "טווח בריא {low}–{high}% — כלל אצבע",
  "{n} salaried designers": "{n} מעצבים שכירים",
  "You bill {pct}% of the hours": "{pct}% מהשעות מחויבות על ידך",
  "Freelancers, hours a month": "פרילנסרים, שעות בחודש",
  Clients: "לקוחות",
  "Share of billable hours": "חלק מהשעות לחיוב",
  "left after its people": "נשאר אחרי עלות האנשים",
  "rate unchanged {n} months": "התעריף לא השתנה {n} חודשים",
  "{n} more clients": "עוד {n} לקוחות",
  "Top three together {pct}%": "שלושת הגדולים יחד {pct}%",
  "Amber at {amber}%, red at {red}% — a rule of thumb": "אזהרה ב־{amber}%, סיכון ב־{red}% — כלל אצבע",
  "Closing the gap to the target": "סגירת הפער ליעד",
  "Any one of these would do it": "כל אחד מאלה מספיק לבדו",
  "Raise rates": "העלאת תעריפים",
  "Bill more hours a month": "עוד שעות לחיוב בחודש",
  "Cut costs": "קיצוץ בעלויות",
  "The target is met.": "היעד מושג.",
  Pipeline: "צנרת מכירות",
  "Open leads": "לידים פתוחים",
  "Waiting on us": "מחכים לנו",
  "Active candidates": "מועמדים פעילים",
  "Findings, week by week": "ממצאים, שבוע אחר שבוע",
  Opened: "נפתחו",
  "Closed": "נסגרו",
  "The pages' own figures": "המספרים של העמודים עצמם",
  "Everything found": "כל מה שנמצא",
  "By urgency": "לפי דחיפות",
  "By subject": "לפי נושא",
  "Nothing here.": "אין כאן כלום.",
  "Follow-up": "מעקב",
  "Snoozed and dismissed": "נדחו והוסרו",
  "back {day}": "חוזר ב־{day}",
  dismissed: "הוסר",
  "Nothing is snoozed or dismissed.": "שום דבר לא נדחה ולא הוסר.",
  "Closed lately": "נסגרו לאחרונה",
  "A check closes a finding by itself once it is no longer true.": "בדיקה סוגרת ממצא בעצמה ברגע שהוא כבר לא נכון.",
  "Nothing closed in the last 30 days.": "שום דבר לא נסגר ב־30 הימים האחרונים.",
  "since {day}": "מאז {day}",
  "closed {day}": "נסגר ב־{day}",
  "Couldn't reach the tracker.": "אין חיבור לטראקר.",
  "Something went wrong.": "משהו השתבש.",
  Language: "שפה",
  // the business review's horizons
  "this month": "החודש",
  "this quarter": "הרבעון",
  "this year": "השנה",
};

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

export interface UiT {
  (s: string, v?: Vars): string;
  lang: AdviceLang;
  /** "he-IL" or "en-GB", for dates */
  locale: string;
}

/** The interface's translator for a language. */
export function uiT(lang: AdviceLang): UiT {
  const t = ((s: string, v?: Vars) => fill(lang === "he" ? (HE[s] ?? s) : s, v)) as UiT;
  t.lang = lang;
  t.locale = lang === "he" ? "he-IL" : "en-GB";
  return t;
}

/** The fixed Hebrew for a string, if there is one — card text falls back to it before the server's. */
export const fixedHebrew = (s: string): string | undefined => HE[s];
