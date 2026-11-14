// Tel Aviv's arnona slip (v1.24.6, Nitsan 2026-11-09: "arnona Nov–Dec is
// 7,062.50 — you can see it in the 'open the bill' link yourself"). The email
// ("תלוש הארנונה שלך") only links to tel-aviv.digitalnow.co.il/?uuid=…, a page
// that loads the slip from the site's own API with that code: the total, the
// period and the voucher number as JSON, and the PDF. Read once, when the
// receipt's email is read; nothing but those figures and the PDF is kept.

export const TLV_SLIP_HOST = "tel-aviv.digitalnow.co.il";

/** The slip's code, when the link is a Tel Aviv arnona slip. */
export function slipCode(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host === TLV_SLIP_HOST ? u.searchParams.get("uuid") : null;
  } catch {
    return null;
  }
}

export interface Slip {
  /** the slip's total, ₪ (arnona carries no VAT) */
  amount: number;
  /** the months it covers, "YYYY-MM", oldest first */
  months: string[];
  /** the voucher number — the slip's own number */
  voucher: string | null;
  /** "charged to the card at the end of November" */
  byCard: boolean;
  pdfName: string | null;
}

const num = (s: unknown) => {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "31.12.26-01.11.26" (either order) → ["2026-11", "2026-12"]. */
export function slipMonths(period: string): string[] {
  const dates = [...period.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g)].map((m) => {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return y * 12 + Number(m[2]) - 1;
  });
  if (dates.length < 2) return [];
  const [a, b] = [Math.min(...dates), Math.max(...dates)];
  if (b - a > 11) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t++) out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  return out;
}

/** The figures of the site's `taiGetClientJson` answer, or null when it isn't one. */
export function slipFrom(json: unknown): Slip | null {
  const inv = (json as { invoices?: Record<string, unknown>[] } | null)?.invoices?.[0];
  if (!inv) return null;
  const pay = (inv.paymentDetails ?? {}) as { totalPaymentAmount?: unknown; paymentDate?: unknown; payments?: { paymentPeriod?: unknown }[] };
  const amount = num(pay.totalPaymentAmount);
  if (amount == null || amount <= 0) return null;
  const acc = (inv.accountingDetails ?? {}) as { voucherNumber?: unknown };
  return {
    amount,
    months: slipMonths(String(pay.payments?.[0]?.paymentPeriod ?? "")),
    voucher: acc.voucherNumber ? String(acc.voucherNumber) : null,
    byCard: /אשראי|כרטיס/.test(String(pay.paymentDate ?? "")),
    pdfName: typeof inv.pdfName === "string" ? inv.pdfName : null,
  };
}

const api = (path: string, body: object) =>
  fetch(`https://${TLV_SLIP_HOST}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });

/** The slip behind a link, and its PDF — null on any failure (the receipt then waits for the amount to be typed). */
export async function readSlip(url: string): Promise<(Slip & { pdf: Uint8Array | null }) | null> {
  const uuid = slipCode(url);
  if (!uuid) return null;
  try {
    const slip = slipFrom(await (await api("taiGetClientJson", { uuid })).json());
    if (!slip) return null;
    let pdf: Uint8Array | null = null;
    if (slip.pdfName) {
      const j = (await (await api("taiDownloadPdf", { uuid, pdfName: slip.pdfName })).json().catch(() => null)) as { pdf?: string } | null;
      const b64 = j?.pdf?.split(",")[1];
      if (b64) pdf = new Uint8Array(Buffer.from(b64, "base64"));
    }
    return { ...slip, pdf };
  } catch {
    return null;
  }
}
