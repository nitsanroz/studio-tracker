import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("savePrivacy", () => {
  it("doesn't throw when storage is blocked, and the setting holds for the visit", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    });
    const { loadPrivacy, savePrivacy, PRIVACY_EVENT } = await import("@/lib/finance/privacy");
    let heard = 0;
    window.addEventListener(PRIVACY_EVENT, () => heard++);
    expect(() => savePrivacy({ enabled: false, seconds: 9 })).not.toThrow();
    expect(heard).toBe(1);
    expect(loadPrivacy()).toEqual({ enabled: false, seconds: 9 });
  });
});

describe("saveHold", () => {
  it("round-trips, and holds for the visit when storage is blocked", async () => {
    vi.stubGlobal("window", new EventTarget());
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const { loadHold, saveHold, PRIVACY_EVENT } = await import("@/lib/finance/privacy");
    let heard = 0;
    window.addEventListener(PRIVACY_EVENT, () => heard++);
    expect(loadHold()).toBe(false);
    saveHold(true);
    expect(loadHold()).toBe(true);
    saveHold(false);
    expect(loadHold()).toBe(false);
    expect(heard).toBe(2);
  });

  it("doesn't throw when storage is blocked", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    const { loadHold, saveHold } = await import("@/lib/finance/privacy");
    expect(() => saveHold(true)).not.toThrow();
    expect(loadHold()).toBe(true);
  });
});

describe("isMoneyText", () => {
  it("is an amount only with a currency sign and a digit", async () => {
    const { isMoneyText } = await import("@/lib/finance/privacy");
    expect(isMoneyText("₪12.4K")).toBe(true);
    expect(isMoneyText("Staff · ₪15.4K לחודש · 4 ש׳")).toBe(true);
    expect(isMoneyText("$20 + $12.50 for the 3rd seat")).toBe(true);
    expect(isMoneyText("Nov 2026")).toBe(false);
    expect(isMoneyText("120h")).toBe(false);
    expect(isMoneyText("34%")).toBe(false);
    expect(isMoneyText("₪")).toBe(false);
  });
});

describe("moneyHostOf", () => {
  // A tiny stand-in for a DOM element: textContent + parentElement.
  const el = (text: string, parent: Element | null = null) =>
    ({ textContent: text, parentElement: parent }) as unknown as Element;

  it("marks the text's own element when it holds a currency sign", async () => {
    const { moneyHostOf } = await import("@/lib/finance/privacy");
    const p = el("Staff · ₪15.4K לחודש");
    expect(moneyHostOf("Staff · ₪15.4K לחודש", p)).toBe(p);
  });

  it("climbs to a parent that is one amount split across spans", async () => {
    const { moneyHostOf } = await import("@/lib/finance/privacy");
    const amount = el("₪1,234");
    expect(moneyHostOf("1,234", el("1,234", amount))).toBe(amount);
  });

  it("leaves a year or a margin beside an amount in the same row", async () => {
    const { moneyHostOf } = await import("@/lib/finance/privacy");
    const row = el("2024₪1.2M12.5%");
    expect(moneyHostOf("2024", el("2024", row))).toBeNull();
    expect(moneyHostOf("12.5%", el("12.5%", row))).toBeNull();
  });
});

describe("moneyHostOf — split text", () => {
  it("marks a number whose sign sits in the text node before it (₪{rate}/h)", async () => {
    const { moneyHostOf } = await import("@/lib/finance/privacy");
    const td = { textContent: "₪300/hWeb work", parentElement: null } as unknown as Element;
    expect(moneyHostOf("300", td, "₪")).toBe(td);
    expect(moneyHostOf("300", td, "Since ")).toBeNull();
  });
});
