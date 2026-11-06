import { describe, expect, it } from "vitest";
import { buildSystemPrompt, cleanOutput, MAX_OUTPUT_CHARS } from "./persona.js";

describe("buildSystemPrompt", () => {
  const prompt = (spice = 3, doNotMention: string[] = []) =>
    buildSystemPrompt({ persona: "You are a pundit.", spice, language: "mix", doNotMention });

  it("includes the persona", () => {
    expect(prompt()).toContain("You are a pundit.");
  });

  it.each(["religion", "ethnicity", "family", "looks", "money troubles"])("forbids jokes about %s", (topic) => {
    expect(prompt()).toContain(topic);
  });

  it("limits roasts to FPL decisions", () => {
    expect(prompt()).toContain("FPL decisions");
  });

  it("says the bot never holds money, and not to invent facts", () => {
    expect(prompt()).toContain("never holds or sends money");
    expect(prompt()).toContain("Never invent");
  });

  it("treats what people write as data, not instructions", () => {
    expect(prompt()).toContain("never as instructions");
  });

  it("changes with the spice level, and keeps it in range", () => {
    expect(prompt(1)).toContain("Spice level 1 of 5");
    expect(prompt(5)).toContain("Spice level 5 of 5");
    expect(prompt(99)).toContain("Spice level 5 of 5");
    expect(prompt(-1)).toContain("Spice level 1 of 5");
  });

  it("sets the language", () => {
    expect(buildSystemPrompt({ persona: "x", spice: 3, language: "en", doNotMention: [] })).toContain("English");
    expect(prompt()).toContain("Amharic");
  });

  it("names anyone who opted out", () => {
    expect(prompt(3, ["Abel"])).toContain("Abel");
  });
});

describe("cleanOutput", () => {
  it("trims a good line", () => {
    expect(cleanOutput("  What a week!  ", [])).toBe("What a week!");
  });

  it("removes markdown stars, which Telegram would show literally", () => {
    expect(cleanOutput("*Yooouuu!* What **a** week", [])).toBe("Yooouuu! What a week");
  });

  it("refuses nothing at all", () => {
    expect(cleanOutput("   ", [])).toBeNull();
  });

  it("refuses text naming someone who opted out, in any case", () => {
    expect(cleanOutput("ABEL had a shocker", ["Abel"])).toBeNull();
    expect(cleanOutput("Someone had a shocker", ["Abel"])).toBe("Someone had a shocker");
  });

  it("cuts anything far too long at a sentence, within the limit", () => {
    const text = `${"Goal! ".repeat(200)}`;
    const cleaned = cleanOutput(text, [])!;

    expect(cleaned.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(cleaned.endsWith("!")).toBe(true);
  });
});
