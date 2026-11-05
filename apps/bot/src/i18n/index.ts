import am from "../../../../locales/am.json" with { type: "json" };
import en from "../../../../locales/en.json" with { type: "json" };

export type MessageKey = keyof typeof en;
export type Language = "en" | "am";

type Dictionary = Partial<Record<string, string>>;
type Vars = Record<string, string | number>;

/** Missing keys fall back to `base`, so a partial translation never shows a blank message. */
export function createTranslator(base: Dictionary, translations: Partial<Record<Language, Dictionary>>) {
  return (language: Language, key: string, vars: Vars = {}): string => {
    const template = translations[language]?.[key] ?? base[key];
    if (template === undefined) throw new Error(`Unknown message key: ${key}`);
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(vars[name] ?? placeholder));
  };
}

const translate = createTranslator(en, { en, am });

export function t(language: Language, key: MessageKey, vars?: Vars): string {
  return translate(language, key, vars);
}

/** Telegram's language_code, narrowed to the languages we ship. */
export function toLanguage(code: string | undefined): Language {
  return code === "am" ? "am" : "en";
}
