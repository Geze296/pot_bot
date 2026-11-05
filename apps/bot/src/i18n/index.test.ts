import { describe, expect, it } from "vitest";
import am from "../../../../locales/am.json" with { type: "json" };
import en from "../../../../locales/en.json" with { type: "json" };
import { createTranslator, t, toLanguage } from "./index.js";

describe("translator", () => {
  const translate = createTranslator({ hello: "Hello {name}", bye: "Bye" }, { am: { hello: "ሰላም {name}" } });

  it("uses the translation when there is one", () => {
    expect(translate("am", "hello", { name: "Abel" })).toBe("ሰላም Abel");
  });

  it("falls back to English per key", () => {
    expect(translate("am", "bye")).toBe("Bye");
  });

  it("throws on an unknown key", () => {
    expect(() => translate("en", "nope")).toThrow("Unknown message key: nope");
  });

  it("fills the shipped messages", () => {
    expect(t("en", "start.welcome", { name: "Abel" })).toContain("Hi Abel!");
  });
});

describe("locale files", () => {
  it("am.json has no keys that en.json lacks", () => {
    expect(Object.keys(am).filter((key) => !(key in en))).toEqual([]);
  });
});

describe("toLanguage", () => {
  it("keeps Amharic and defaults everything else to English", () => {
    expect(toLanguage("am")).toBe("am");
    expect(toLanguage("fr")).toBe("en");
    expect(toLanguage(undefined)).toBe("en");
  });
});
