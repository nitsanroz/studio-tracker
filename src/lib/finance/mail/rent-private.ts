// ⚠️ SERVER ONLY — a personal detail. Never import this from client code:
// finance-leak-guard.test.ts fails if a browser bundle reaches it.
//
// The owner's home building pays its building fee through one of the senders
// the studio's Rent bills come from (2026-11-09), so its confirmations must not
// be read as the studio's. The pattern names that building, which is why it
// lives here and not in rent.ts: rent.ts is imported by the Expenses page, and
// a JavaScript file a page imports can be downloaded by anyone signed in.
//
// Server callers hand it to `rentLineOf` (rent.ts) and to `suggestions`
// (receipts.ts, as `known.notStudio`).

export const NOT_STUDIO = /ניצנה\s*20/;
