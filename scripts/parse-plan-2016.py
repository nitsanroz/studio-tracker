#!/usr/bin/env python3
"""
Parse PLAN_more_2016.xlsx into the shapes finance_client_monthly and
finance_pnl_monthly already use, and write data/finance-2016.json.

    python3 scripts/parse-plan-2016.py

2016 was missing from the finance database entirely — the seed and the later
granular import both started at 2017, because no 2016 workbook was on disk. Nitsan
supplied it 2026-07-29 after spotting that Quadream 2016 read 345h in the tracker
against 332h in his sheet.

TWO THINGS THAT MAKE 2016 DIFFERENT FROM EVERY OTHER YEAR:
  - it is a PARTIAL year. The studio started trading in May, so the grid runs
    D=may … K=december and there are no Jan-Apr columns at all. Writing zeros for
    those months would say "we billed nothing in January", which is a different
    claim from "we did not exist yet".
  - per-client revenue is not in the sheet. Only hours (the grid) and an hourly
    rate (col C). The sheet's own "before discount" row is hours x rate, and
    "Revenues" is after a discount applied at studio level, not per client. So
    revenue_gross = hours x rate, matching how 2017-2026 were imported, and the
    discount survives only in the P&L rows.

No openpyxl on this machine, so the xlsx is read as raw XML — same approach as the
original feeder import (see finance-admin memory, scratchpad/parse_exp.py pattern).
"""
import json
import os
import re
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SRC = os.path.expanduser(
    "~/Documents/Claud cowork/financial sheets/PLAN_more_2016.xlsx"
)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "finance-2016.json")

# Column -> calendar month. The studio's first month of trading was May 2016.
MONTHS = {"D": 5, "E": 6, "F": 7, "G": 8, "H": 9, "I": 10, "J": 11, "K": 12}

# Sheet row label -> the line_item vocabulary already in finance_pnl_monthly.
# Taken from the live table, not invented: accounting, before_discount, expenses_other,
# lawyer, min_hours_to_be, profit, rent, salaries, total_expenses, total_hours,
# total_revenues, accumulated.
PNL_ROWS = {
    "total hours": "total_hours",
    "before discount": "before_discount",
    "revenues": "total_revenues",
    "rent": "rent",
    "salaries": "salaries",
    "expenses": "expenses_other",
    "accounting": "accounting",
    "lawyer": "lawyer",
    "total expenses": "total_expenses",
    "min hours to be": "min_hours_to_be",
    "profit": "profit",
    "accumilated": "accumulated",  # the sheet's spelling; the DB uses "accumulated"
}


def load_sheet(path, wanted):
    z = zipfile.ZipFile(path)
    wb = z.read("xl/workbook.xml").decode("utf8")
    names = re.findall(r'<sheet[^>]*?name="([^"]*)"[^>]*?r:id="(rId\d+)"', wb)
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf8")
    rmap = dict(re.findall(r'Id="(rId\d+)"[^>]*?Target="([^"]+)"', rels))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    target = dict(names)[wanted]
    root = ET.fromstring(z.read("xl/" + rmap[target].lstrip("/").replace("xl/", "")))
    rows = {}
    for row in root.iter(NS + "row"):
        r = int(row.get("r"))
        cells = {}
        for c in row.iter(NS + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find(NS + "v")
            if v is None or v.text is None:
                continue
            cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
        if cells:
            rows[r] = cells
    return rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


rows = load_sheet(SRC, "future plan")

client_monthly = []
pnl = []
seen_labels = []

for r in sorted(rows):
    cells = rows[r]
    label = str(cells.get("A", "")).strip()
    if not label:
        continue
    key = label.lower()
    seen_labels.append(label)

    if key in PNL_ROWS:
        item = PNL_ROWS[key]
        for col, month in MONTHS.items():
            v = num(cells.get(col))
            if v is None:
                continue
            pnl.append(
                {"year": 2016, "month": month, "line_item": item, "value": round(v, 2)}
            )
        continue

    # Skip the structural rows that are not clients and not P&L lines.
    if key in ("hourly rate", "billable hours", "expenses", "accumilated"):
        continue

    rate = num(cells.get("C"))
    monthly = {m: num(cells.get(col)) for col, m in MONTHS.items()}
    if not any(v for v in monthly.values() if v):
        continue  # a client row with no hours in any month carries no information

    for month, hours in monthly.items():
        if hours is None:
            continue  # month not present in the sheet — not the same as zero
        client_monthly.append(
            {
                "year": 2016,
                "month": month,
                "client_canon": label,
                "discipline": "core",
                "sub_account": "",
                "hours": round(hours, 2),
                "rate": rate,
                # Matches 2017-2026: the sheet's "before discount" figure.
                "revenue_gross": round(hours * rate, 2) if rate is not None else 0,
                "state": "final",
            }
        )

payload = {"client_monthly": client_monthly, "pnl_monthly": pnl}
with open(OUT, "w", encoding="utf8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

hours = sum(r["hours"] for r in client_monthly)
clients = sorted({r["client_canon"] for r in client_monthly})
print(f"clients        {len(clients)}")
print(f"client rows    {len(client_monthly)}  (months {min(MONTHS.values())}-{max(MONTHS.values())} only)")
print(f"hours          {hours:.2f}")
print(f"revenue_gross  {sum(r['revenue_gross'] for r in client_monthly):,.0f}")
print(f"pnl rows       {len(pnl)}  ({len({p['line_item'] for p in pnl})} line items)")
print(f"\nper client:")
for c in clients:
    h = sum(r["hours"] for r in client_monthly if r["client_canon"] == c)
    print(f"   {c[:24]:<26}{h:>8.2f}h")
unmapped = [l for l in seen_labels if l.lower() not in PNL_ROWS and l.lower() not in
            ("hourly rate", "billable hours", "expenses", "accumilated")
            and l not in clients]
if unmapped:
    print(f"\n! rows neither client nor P&L (ignored): {unmapped}")
print(f"\n-> {os.path.relpath(OUT)}")
