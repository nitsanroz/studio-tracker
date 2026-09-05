import { describe, expect, it } from "vitest";
import {
  EMPTY_STORE,
  SIGNATURE_CAP,
  THROTTLE_MS,
  blockedKey,
  keepViolation,
  mergeReports,
  parseReports,
  signature,
  type Violation,
} from "./csp-reports";

const OURS = ["https://tracker.studionmore.com"];
const v = (over: Partial<Violation> = {}): Violation => ({
  directive: "img-src",
  blocked: "https://d36887svjhykt4.cloudfront.net/avatar/1.jpg",
  documentUri: "https://tracker.studionmore.com/team",
  ...over,
});

describe("parseReports", () => {
  it("reads the legacy hyphenated shape Firefox and Safari send", () => {
    // ⚠️ Safari is most of the studio and it uses `report-uri` with THIS shape.
    // Dropping it would leave us hearing from Chrome only.
    const out = parseReports({
      "csp-report": {
        "effective-directive": "img-src",
        "blocked-uri": "https://cdn.example.com/a.png",
        "document-uri": "https://tracker.studionmore.com/team",
      },
    });
    expect(out).toEqual([
      {
        directive: "img-src",
        blocked: "https://cdn.example.com/a.png",
        documentUri: "https://tracker.studionmore.com/team",
      },
    ]);
  });

  it("falls back to violated-directive when effective-directive is absent", () => {
    const out = parseReports({
      "csp-report": { "violated-directive": "script-src 'self'", "blocked-uri": "inline" },
    });
    expect(out[0]?.directive).toBe("script-src 'self'");
  });

  it("reads the Reporting API array Chrome sends", () => {
    const out = parseReports([
      {
        type: "csp-violation",
        body: {
          effectiveDirective: "connect-src",
          blockedURL: "https://api.other.com/x",
          documentURL: "https://tracker.studionmore.com/",
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].directive).toBe("connect-src");
    expect(out[0].blocked).toBe("https://api.other.com/x");
  });

  it("ignores non-CSP reports arriving on the same channel", () => {
    // A reporting endpoint also receives deprecation and intervention reports.
    const out = parseReports([
      { type: "deprecation", body: { effectiveDirective: "img-src" } },
      { type: "csp-violation", body: { effectiveDirective: "img-src", documentURL: "x" } },
    ]);
    expect(out).toHaveLength(1);
  });

  it("returns nothing for junk rather than throwing", () => {
    // The endpoint is unauthenticated; anything can be posted to it.
    for (const junk of [null, undefined, 42, "hello", {}, [], { "csp-report": {} }]) {
      expect(parseReports(junk)).toEqual([]);
    }
  });

  it("drops entries with no directive, which carry no information", () => {
    expect(parseReports([{ type: "csp-violation", body: { blockedURL: "x" } }])).toEqual([]);
  });
});

describe("blockedKey", () => {
  it("reduces a URL to its origin so one CDN is one problem", () => {
    // The 17 blocked Everhour avatars were one dependency, not 17 findings.
    expect(blockedKey("https://cdn.example.com/a/b/c.png?x=1")).toBe("https://cdn.example.com");
  });

  it("passes spec keywords through untouched", () => {
    for (const k of ["inline", "eval", "self", "data"]) expect(blockedKey(k)).toBe(k);
  });

  it("keeps an unparseable value rather than losing it", () => {
    expect(blockedKey("::::")).toBe("::::");
  });
});

describe("keepViolation", () => {
  it("keeps a real violation from our own page", () => {
    expect(keepViolation(v(), OURS)).toBe(true);
  });

  it("drops browser-extension noise", () => {
    // ⚠️ Ad blockers, password managers and translators all inject into the page
    // and every injection violates a strict policy. This is the bulk of real
    // traffic to a report endpoint, and it would bury anything that matters.
    expect(keepViolation(v({ blocked: "chrome-extension://abc/inject.js" }), OURS)).toBe(false);
    expect(keepViolation(v({ blocked: "moz-extension://abc/inject.js" }), OURS)).toBe(false);
    expect(keepViolation(v({ documentUri: "safari-web-extension://x/page.html" }), OURS)).toBe(
      false,
    );
  });

  it("drops reports attributed to a page that is not ours", () => {
    // The route is open: without this anyone could fill the store with invented
    // violations on someone else's site and push ours past the cap.
    expect(keepViolation(v({ documentUri: "https://evil.example.com/x" }), OURS)).toBe(false);
  });

  it("drops a missing or unparseable document URI", () => {
    expect(keepViolation(v({ documentUri: "" }), OURS)).toBe(false);
    expect(keepViolation(v({ documentUri: "not a url" }), OURS)).toBe(false);
  });

  it("accepts localhost when it is passed as allowed, for dev", () => {
    const dev = ["http://localhost:3000"];
    expect(keepViolation(v({ documentUri: "http://localhost:3000/plan" }), dev)).toBe(true);
  });
});

describe("mergeReports", () => {
  const t0 = new Date("2026-08-27T10:00:00.000Z");

  it("records a new signature and marks the store changed", () => {
    const { store, changed } = mergeReports(EMPTY_STORE, [v()], t0);
    expect(changed).toBe(true);
    expect(store.items).toHaveLength(1);
    expect(store.items[0].count).toBe(1);
    expect(store.items[0].blocked).toBe("https://d36887svjhykt4.cloudfront.net");
    expect(store.updatedAt).toBe(t0.toISOString());
  });

  it("groups different paths on one host into a single entry", () => {
    const many = [1, 2, 3].map((n) => v({ blocked: `https://cdn.example.com/${n}.png` }));
    const { store } = mergeReports(EMPTY_STORE, many, t0);
    expect(store.items).toHaveLength(1);
    expect(store.items[0].count).toBe(3);
  });

  it("does NOT earn a write for a repeat inside the throttle window", () => {
    // ⚠️ This is what stops an unauthenticated endpoint driving one DB write per
    // request. Egress is the project's tightest constraint.
    const first = mergeReports(EMPTY_STORE, [v()], t0);
    const soon = new Date(t0.getTime() + THROTTLE_MS - 1000);
    const second = mergeReports(first.store, [v()], soon);
    expect(second.changed).toBe(false);
    /**
     * ⚠️⚠️ AND IT RETURNS THE STORE IT WAS GIVEN, BYTE FOR BYTE. This used to hand
     * back an incremented `count` that the route then discarded, because the route
     * only persists when `changed` — so the returned object described a state that
     * never reached the database and this test agreed with the fiction. The
     * collapsed count is the deliberate trade; a returned store that lies is not.
     */
    expect(second.store).toBe(first.store);
    expect(second.store.items[0].count).toBe(1);
  });

  it("earns a write once the throttle window has passed", () => {
    const first = mergeReports(EMPTY_STORE, [v()], t0);
    const later = new Date(t0.getTime() + THROTTLE_MS + 1000);
    const second = mergeReports(first.store, [v()], later);
    expect(second.changed).toBe(true);
    expect(second.store.items[0].lastSeen).toBe(later.toISOString());
  });

  it("compares age BEFORE overwriting lastSeen", () => {
    // Overwriting first would make every age zero and the throttle would never
    // fire — the bug this asserts against.
    let store = EMPTY_STORE;
    let writes = 0;
    for (let i = 0; i < 20; i++) {
      const at = new Date(t0.getTime() + i * 1000); // 20 reports over 20 seconds
      const r = mergeReports(store, [v()], at);
      store = r.store;
      if (r.changed) writes++;
    }
    expect(writes).toBe(1); // only the very first one
    /**
     * ⚠️ AND `count` IS 1, NOT 20 — this is the honest reading of the throttle and
     * the reason `countIsFloor` exists. 19 of those reports were collapsed, so the
     * figure is a FLOOR on how often this happened, never a tally. The viewer says
     * so rather than presenting a sampled number as a count.
     */
    /**
     * ⚠️ AND THE STORE CANNOT TELL YOU IT COLLAPSED ANYTHING — this entry is now
     * indistinguishable from a single sighting, which is exactly why the caveat is
     * a footnote on the whole table rather than a per-row marker. Do not add one:
     * there is no field that could drive it honestly.
     */
    expect(store.items[0].count).toBe(1);
    expect(store.items[0].lastSeen).toBe(store.items[0].firstSeen);
  });

  it("advances the count once the throttle window has passed", () => {
    // The floor still climbs — a violation that keeps happening keeps counting,
    // one per window, so it can be told apart from a one-off.
    let store = EMPTY_STORE;
    for (let i = 0; i < 4; i++) {
      store = mergeReports(store, [v()], new Date(t0.getTime() + i * (THROTTLE_MS + 1000))).store;
    }
    expect(store.items[0].count).toBe(4);
  });

  it("still counts every report inside ONE request", () => {
    // ⚠️ The collapsing is across requests, not within one. A batch carrying the
    // same violation five times is one write and must record all five, or a noisy
    // page would read the same as a single stray report.
    const { store, changed } = mergeReports(EMPTY_STORE, [v(), v(), v(), v(), v()], t0);
    expect(changed).toBe(true);
    expect(store.items[0].count).toBe(5);
  });


  it("caps distinct signatures and COUNTS what it dropped", () => {
    // ⚠️ A full store that silently discarded new signatures would read as "no
    // new violations" — the one thing this must never claim falsely.
    const lots = Array.from({ length: SIGNATURE_CAP + 5 }, (_, i) =>
      v({ blocked: `https://cdn${i}.example.com/a.png` }),
    );
    const { store } = mergeReports(EMPTY_STORE, lots, t0);
    expect(store.items).toHaveLength(SIGNATURE_CAP);
    expect(store.dropped).toBe(5);
  });

  it("still counts repeats of known signatures once the cap is full", () => {
    const lots = Array.from({ length: SIGNATURE_CAP }, (_, i) =>
      v({ blocked: `https://cdn${i}.example.com/a.png` }),
    );
    const full = mergeReports(EMPTY_STORE, lots, t0);
    const later = new Date(t0.getTime() + THROTTLE_MS + 1000);
    const again = mergeReports(full.store, [v({ blocked: "https://cdn0.example.com/b.png" })], later);
    expect(again.store.dropped).toBe(0);
    expect(again.store.items.find((i) => i.blocked === "https://cdn0.example.com")?.count).toBe(2);
  });

  it("orders most-recently-seen first", () => {
    const a = mergeReports(EMPTY_STORE, [v({ blocked: "https://a.example.com/x" })], t0);
    const later = new Date(t0.getTime() + 60_000);
    const b = mergeReports(a.store, [v({ blocked: "https://b.example.com/x" })], later);
    expect(b.store.items[0].blocked).toBe("https://b.example.com");
  });

  it("does not mutate the store it was given", () => {
    const before = mergeReports(EMPTY_STORE, [v()], t0).store;
    const snapshot = JSON.stringify(before);
    mergeReports(before, [v()], new Date(t0.getTime() + THROTTLE_MS + 1));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("signature is directive + blocked origin", () => {
    expect(signature(v({ directive: "img-src", blocked: "https://x.com/a" }))).toBe(
      "img-src|https://x.com",
    );
  });
});

describe("field length caps", () => {
  // The endpoint is unauthenticated and the store is ONE jsonb row that every
  // subsequent POST reads. Uncapped, a caller could put most of the 16KB body
  // limit into a documentUri that still passes keepViolation — its origin only
  // has to be ours — and repeat it under 50 distinct signatures, turning each
  // later request into a ~750KB read. These cases pin the bound.
  const long = "x".repeat(5000);

  it("truncates an over-long documentUri", () => {
    const [v] = parseReports({
      "csp-report": {
        "effective-directive": "img-src",
        "blocked-uri": "https://cdn.example.com/a.png",
        "document-uri": `https://tracker.studionmore.com/${long}`,
      },
    });
    expect(v.documentUri.length).toBeLessThanOrEqual(200);
    expect(v.documentUri.startsWith("https://tracker.studionmore.com/")).toBe(true);
  });

  it("truncates an over-long directive and blocked value", () => {
    const [v] = parseReports({
      "csp-report": {
        "effective-directive": long,
        "blocked-uri": long,
        "document-uri": "https://tracker.studionmore.com/plan",
      },
    });
    expect(v.directive.length).toBeLessThanOrEqual(200);
    expect(v.blocked.length).toBeLessThanOrEqual(200);
  });

  it("bounds the whole store, not just one field", () => {
    // 50 distinct signatures, every field at its cap, is the worst case the
    // signature cap allows. Well under the ~750KB an uncapped row could reach.
    let store = EMPTY_STORE;
    for (let i = 0; i < 80; i++) {
      const [v] = parseReports({
        "csp-report": {
          "effective-directive": `d${i}-${long}`,
          "blocked-uri": `https://h${i}.example.com/${long}`,
          "document-uri": `https://tracker.studionmore.com/${long}`,
        },
      });
      store = mergeReports(store, [v], new Date()).store;
    }
    expect(store.items.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(store).length).toBeLessThan(80_000);
  });

  it("leaves an ordinary report untouched", () => {
    const [v] = parseReports({
      "csp-report": {
        "effective-directive": "font-src",
        "blocked-uri": "https://fonts.gstatic.com/s/rubik.woff2",
        "document-uri": "https://tracker.studionmore.com/plan",
      },
    });
    expect(v.directive).toBe("font-src");
    expect(v.documentUri).toBe("https://tracker.studionmore.com/plan");
  });
});
