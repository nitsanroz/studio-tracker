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
  // the page's hover boxes
  "Things that cost money or a client if they wait.": "דברים שעולים כסף או לקוח אם מחכים איתם.",
  "Worth knowing this week. Nothing breaks today.": "כדאי לדעת השבוע. שום דבר לא נשבר היום.",
  "Ways to run the studio better, read from the last three months as a whole. No deadline.": "דרכים לנהל את הסטודיו טוב יותר, מתוך שלושת החודשים האחרונים כמכלול. בלי תאריך יעד.",
  "Findings you put aside. A snoozed one returns on its day; a dismissed one only if it gets worse.": "ממצאים ששמת בצד. ממצא שנדחה חוזר בתאריך שלו; ממצא שהוסר חוזר רק אם המצב מחמיר.",
  "Findings that stopped being true. A check closes them by itself; there is nothing to do.": "ממצאים שכבר לא נכונים. הבדיקה סוגרת אותם לבד; אין מה לעשות.",
  "Other subjects": "נושאים אחרים",
  "Snoozed, back on a date": "נדחו, חוזרים בתאריך",
  "Dismissed, back if worse": "הוסרו, חוזרים אם יחמיר",
  "One Claude call per click, about a minute. It reads the last three months as shares, percentages, hours and rates as an index. No amount in ₪ is sent.":
    "קריאה אחת ל־Claude בכל לחיצה, כדקה. הוא קורא את שלושת החודשים האחרונים כחלקים יחסיים, אחוזים, שעות ותעריפים כמדד. שום סכום בשקלים לא נשלח.",
  "What the figures alone could not settle. They are for you to think over; nothing is sent back.": "מה שהמספרים לבדם לא הכריעו. הן בשבילך, למחשבה; שום דבר לא נשלח חזרה.",
  "The last three complete months together, so one odd month doesn't decide. \"A year ago\" is the same three months last year.":
    "שלושת החודשים המלאים האחרונים יחד, כדי שחודש חריג אחד לא יכריע. ״לפני שנה״ הם אותם שלושה חודשים בשנה שעברה.",
  "The same figures the pages themselves show, each with its last weeks. Hover one for how it is counted.": "אותם מדדים שהעמודים עצמם מציגים, כל אחד עם השבועות האחרונים שלו. ריחוף על מדד מסביר איך הוא נספר.",
  "Every open finding. Snooze hides one until a date; dismiss hides it until it gets worse; a check closes it by itself once it is no longer true.":
    "כל הממצאים הפתוחים. דחייה מסתירה ממצא עד תאריך; הסרה מסתירה אותו עד שהמצב מחמיר; הבדיקה סוגרת אותו לבד כשהוא כבר לא נכון.",
  "What you put aside and what closed by itself, so nothing disappears without a trace.": "מה ששמת בצד ומה שנסגר לבד, כדי ששום דבר לא ייעלם בלי עקבות.",
  "First found on this day, and true at every check since.": "נמצא לראשונה ביום הזה, ונכון בכל בדיקה מאז.",
  "What is left of the income after every cost, as a share of the income.": "מה שנשאר מההכנסה אחרי כל ההוצאות, כחלק מההכנסה.",
  "Short of the target": "חסר ליעד",
  "Above the target": "מעל היעד",
  "{n} points": "{n} נקודות אחוז",
  "The margin the studio aims for: the same target the hours goal on Home is built on.": "שולי הרווח שהסטודיו מכוון אליהם: אותו יעד שעליו בנוי יעד השעות בעמוד הבית.",
  "The same three months, last year.": "אותם שלושה חודשים, בשנה שעברה.",
  "Each cost as a share of the income. What no cost took is left over: the profit margin.": "כל הוצאה כחלק מההכנסה. מה שאף הוצאה לא לקחה נשאר: שולי הרווח.",
  "The salaried team, with what the employer pays on top.": "הצוות השכיר, כולל מה שהמעסיק משלם מעבר לשכר.",
  "What freelancers were paid.": "מה ששולם לפרילנסרים.",
  "Rent and the bills of the place.": "שכירות והחשבונות של המקום.",
  "Everything on the Expenses page: monthly, yearly and one-off.": "כל מה שבעמוד Expenses: חודשי, שנתי וחד־פעמי.",
  "Every other cost in the books.": "כל הוצאה אחרת שבספרים.",
  "Income that no cost took: the profit margin. A loss shows as none.": "הכנסה שאף הוצאה לא לקחה: שולי הרווח. הפסד מוצג כאפס.",
  "The average hour of the three months: what it is sold for, and what it has to bring in to cover every cost.": "השעה הממוצעת בשלושת החודשים: בכמה היא נמכרת, וכמה היא צריכה להכניס כדי לכסות את כל ההוצאות.",
  "Income from hourly work ÷ billable hours.": "ההכנסה מעבודה שעתית ÷ השעות לחיוב.",
  "All costs ÷ billable hours: what an hour must bring in to break even.": "כל ההוצאות ÷ השעות לחיוב: כמה שעה צריכה להכניס כדי להגיע לאיזון.",
  "Left on each hour": "נשאר מכל שעה",
  "Missing on each hour": "חסר בכל שעה",
  "The same sum for the same three months, last year.": "אותו חישוב לאותם שלושה חודשים, בשנה שעברה.",
  "The rest is fixed-price projects.": "השאר הוא פרויקטים במחיר קבוע.",
  "How much of the salaried team's time is billed, and who else the hours lean on.": "כמה מהזמן של הצוות השכיר מחויב, ועל מי עוד השעות נשענות.",
  "The salaried team's billable hours ÷ the hours of full working days, 8 a day.": "השעות לחיוב של הצוות השכיר ÷ השעות של ימי עבודה מלאים, 8 ביום.",
  "Under the range people sit idle; over it there is no room for anything but client work.": "מתחת לטווח יש אנשים פנויים; מעליו אין מקום לשום דבר חוץ מעבודת לקוחות.",
  "Salaried people who logged real hours, averaged over the three months.": "שכירים שרשמו שעות בפועל, בממוצע על שלושת החודשים.",
  "Your own hours out of all billable hours. The higher it is, the more the studio depends on you.": "השעות שלך מתוך כל השעות לחיוב. ככל שהחלק גבוה יותר, הסטודיו תלוי בך יותר.",
  "The hours each freelancer logged, a month on average.": "השעות שכל פרילנסר רשם, בממוצע לחודש.",
  "Each client's part of the billable hours. One client too large is a risk: if it leaves, that part of the work leaves with it.":
    "החלק של כל לקוח בשעות לחיוב. לקוח גדול מדי הוא סיכון: אם הוא עוזב, החלק הזה מהעבודה הולך איתו.",
  "Hours in the three months": "שעות בשלושת החודשים",
  "Left after its people": "נשאר אחרי עלות האנשים",
  "not known": "לא ידוע",
  "Rate unchanged": "התעריף לא השתנה",
  "{n} months": "{n} חודשים",
  "Left after its people: its hours at its rate, less the cost of the hours people put in.": "נשאר אחרי עלות האנשים: השעות של הלקוח בתעריף שלו, פחות עלות השעות שאנשים השקיעו בו.",
  "The two thin lines on each bar. Past the first, one client carries a large part of the work; past the second, losing it would be hard to absorb.":
    "שני הקווים הדקים על כל פס. מעבר לראשון, לקוח אחד נושא חלק גדול מהעבודה; מעבר לשני, יהיה קשה לספוג את העזיבה שלו.",
  "How far the three months fell short of the target margin, and three ways to close it. Each alone would do it; in practice, a little of each.":
    "כמה חסר לשלושת החודשים כדי להגיע ליעד הרווח, ושלוש דרכים לסגור את הפער. כל אחת לבדה מספיקה; בפועל, קצת מכל אחת.",
  "Every hourly rate up by this much, for the same hours.": "כל תעריף שעתי עולה בשיעור הזה, באותן שעות.",
  "This many more billable hours every month, at today's average rate.": "כך וכך שעות לחיוב נוספות בכל חודש, בתעריף הממוצע של היום.",
  "All costs down by this much, for the same income.": "כל ההוצאות יורדות בשיעור הזה, באותה הכנסה.",
  "Where the next work and the next people would come from.": "מאיפה יגיעו העבודה הבאה והאנשים הבאים.",
  "Leads that are neither won nor lost.": "לידים שלא נסגרו ולא אבדו.",
  "Open leads that are owed a reply, or have a next step with a date.": "לידים פתוחים שמחכים לתשובה מאיתנו, או שיש להם צעד הבא עם תאריך.",
  "Candidates still in the hiring process.": "מועמדים שעדיין בתהליך הגיוס.",
  "How many findings a check opened each week, and how many it closed. More closed than opened: the list is getting shorter.":
    "כמה ממצאים הבדיקה פתחה בכל שבוע, וכמה סגרה. יותר סגורים מפתוחים: הרשימה מתקצרת.",
  "Week of {day}": "השבוע של {day}",
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
