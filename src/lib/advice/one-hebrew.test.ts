import { describe, expect, it } from "vitest";
import { hebrew, uiT } from "./he-ui";
import { tFor } from "@/lib/finance/scenarios/i18n";
import { HE as SCENARIOS_HE } from "@/lib/finance/scenarios/he";

// &all: &advice and Scenarios read ONE Hebrew dictionary.
describe("one Hebrew dictionary", () => {
  it("reads a Scenarios line from &advice's translator and the other way round", () => {
    expect(uiT("he")("New scenario")).toBe(SCENARIOS_HE["New scenario"]);
    expect(tFor("he")("Do now")).toBe(uiT("he")("Do now"));
  });

  it("gives the same answer on both tabs, &advice's line winning a clash", () => {
    expect(tFor("he")("Close")).toBe(uiT("he")("Close"));
    expect(hebrew("Close")).toBe("סגירה");
  });

  it("leaves English untouched", () => {
    expect(tFor("en")("Close")).toBe("Close");
    expect(uiT("en")("Do now")).toBe("Do now");
  });
});
