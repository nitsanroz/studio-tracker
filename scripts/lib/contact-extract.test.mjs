import { test } from "node:test";
import assert from "node:assert/strict";
import { extract, stripLines } from "./contact-extract.mjs";

// ⚠️ EVERY VALUE HERE IS INVENTED. Nothing in this file is a real candidate's
// email, phone or profile — the shapes are copied, the details are not.

test("pulls an email, a phone and a LinkedIn out of a bare contact dump", () => {
  // The exact shape the Asana import produced: three lines, no prose.
  const text = [
    "https://www.linkedin.com/in/someonemade-up/",
    "+972501234567",
    "made.up8@example.com",
  ].join("\n");
  const r = extract(text);
  assert.deepEqual(r.emails, ["made.up8@example.com"]);
  assert.deepEqual(r.phones, ["+972501234567"]);
  assert.deepEqual(r.urls, ["https://www.linkedin.com/in/someonemade-up/"]);
});

test("accepts the local 05x form as well as +972", () => {
  assert.deepEqual(extract("050-123-4567").phones, ["050-123-4567"]);
  assert.deepEqual(extract("0501234567").phones, ["0501234567"]);
  assert.deepEqual(extract("+972-50-123-4567").phones, ["+972-50-123-4567"]);
});

/**
 * ⚠️ THE ONE THAT MATTERS MOST. These paragraphs are full of digit runs that
 * are not phone numbers, and a phone field quietly holding a date is worse than
 * an empty one — somebody rings it.
 */
test("does not read a date, a year or an hour count as a phone number", () => {
  assert.deepEqual(extract("Applied 21/06/2026").phones, []);
  assert.deepEqual(extract("graduated in 2019, 3 years of experience").phones, []);
  assert.deepEqual(extract("budget was 12000").phones, []);
  assert.deepEqual(extract("ID 123456789").phones, []);
});

test("keeps a URL out of the trailing punctuation of a sentence", () => {
  const r = extract("See my work at https://example-portfolio.com/work, it's recent.");
  assert.deepEqual(r.urls, ["https://example-portfolio.com/work"]);
});

test("finds a bare host somebody pasted without https", () => {
  assert.deepEqual(extract("behance.net/madeupname").urls, ["behance.net/madeupname"]);
});

test("does not mistake an email for a URL, or vice versa", () => {
  const r = extract("write to a.person@example.co.il or see example.com/folio");
  assert.deepEqual(r.emails, ["a.person@example.co.il"]);
  assert.deepEqual(r.urls, ["example.com/folio"]);
});

test("returns nothing at all for ordinary prose", () => {
  const r = extract("Two years out of Shenkar, mostly brand work, keen on type.");
  assert.deepEqual(r, { emails: [], phones: [], urls: [] });
});

// ── stripLines ────────────────────────────────────────────────────────────

test("removes a line that was only a contact detail", () => {
  const text = ["https://www.linkedin.com/in/x/", "+972501234567", "a@example.com"].join("\n");
  assert.equal(stripLines(text, extract(text)), "");
});

test("removes a labelled line, label and all", () => {
  const text = "Phone: +972501234567\nEmail: a@example.com";
  assert.equal(stripLines(text, extract(text)), "");
});

/**
 * ⚠️ THE GUARD ON THE WHOLE IDEA. A covering letter is what the candidate
 * actually wrote, and deleting a sentence out of it because it happens to name
 * an address would be rewriting the record rather than tidying it.
 */
test("keeps a sentence that merely mentions a phone or an address", () => {
  const text = "You can reach me on +972501234567 after six.";
  assert.equal(stripLines(text, extract(text)), text);
});

test("keeps the prose and drops only the bare lines around it", () => {
  const text = [
    "Two years out of Shenkar, mostly brand work.",
    "+972501234567",
    "I'd love to talk about the Maccabi pitch.",
  ].join("\n");
  const out = stripLines(text, extract(text));
  assert.equal(out, "Two years out of Shenkar, mostly brand work.\nI'd love to talk about the Maccabi pitch.");
});

test("leaves text with nothing to extract exactly as it was", () => {
  const text = "Nothing to see here.";
  assert.equal(stripLines(text, extract(text)), text);
});
