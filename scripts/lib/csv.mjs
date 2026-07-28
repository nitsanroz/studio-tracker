/**
 * Minimal CSV read/write for the review round-trip.
 *
 * The review files are opened and edited in Excel / Google Sheets, so:
 *  - writes lead with a UTF-8 BOM, without which Excel mangles the Hebrew task
 *    names into mojibake;
 *  - writes CRLF, which is what both apps emit when they save back;
 *  - the reader accepts either line ending and handles quoted fields containing
 *    commas, quotes and newlines, because task titles contain all three.
 */

const needsQuote = (s) => /[",\r\n]/.test(s);

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** @returns {Record<string,string>[]} one object per row, keyed by header. */
export function fromCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip blank trailing lines rather than emitting an all-empty record.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "" → null, "12.5" → 12.5. Throws on a value the reviewer mistyped. */
export function numOrNull(v, label) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`${label}: "${v}" is not a number`);
  return n;
}
