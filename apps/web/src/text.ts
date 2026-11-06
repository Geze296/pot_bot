import en from "../../../locales/en.json";

export type TextKey = keyof typeof en;

type Vars = Record<string, string | number>;

function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(vars[name] ?? placeholder));
}

/** Every word on screen comes from the locale file (hard rule 9). */
export function text(key: TextKey, vars: Vars = {}): string {
  return fill(en[key], vars);
}

/** For keys built from data, like a rule's name. Unknown ones show the fallback rather than breaking the screen. */
export function textOr(key: string, fallback: string): string {
  return (en as Record<string, string>)[key] ?? fallback;
}
