/** League settings, stored as JSON on the league. See docs/SPEC.md, "League rules". */
export interface LeagueRules {
  /** Whole birr per gameweek. */
  entryFee: number;
  /** Percent of the pot for each finishing place. Must add up to 100. */
  prizeShares: number[];
  runnerUpPerk: "skip_next" | "half_price" | "off";
  whoCanWin: "paid_only" | "everyone";
  scoreMode: "net" | "gross";
  tieFirst: "split" | "tie_break";
  tieSecond: "all" | "tie_break";
  lateRule: "not_eligible" | "late_fee" | "lose_free_pass";
  /** Whole birr. Used only with lateRule "late_fee". */
  lateFee: number;
}

export const DEFAULT_RULES: LeagueRules = {
  entryFee: 100,
  prizeShares: [100],
  runnerUpPerk: "skip_next",
  whoCanWin: "paid_only",
  scoreMode: "net",
  tieFirst: "split",
  tieSecond: "all",
  lateRule: "not_eligible",
  lateFee: 120,
};

export class RuleError extends Error {}

/** Reads rules stored on a league. Anything missing gets its default. */
export function parseRules(stored: unknown): LeagueRules {
  return { ...DEFAULT_RULES, ...(stored as Partial<LeagueRules>) };
}

function parseBirr(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new RuleError(`"${value}" isn't a whole number of birr.`);
  return Number(value);
}

function parseShares(value: string): number[] {
  const shares = value.split(",").map((part) => part.trim());
  if (!shares.every((share) => /^[1-9]\d*$/.test(share))) throw new RuleError("Shares must be whole percentages.");
  const numbers = shares.map(Number);
  if (numbers.reduce((sum, share) => sum + share, 0) !== 100) throw new RuleError("Shares must add up to 100.");
  return numbers;
}

function oneOf<T extends string>(value: string, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new RuleError(`Choose one of: ${options.join(", ")}.`);
  return value as T;
}

/** Returns new rules with one setting changed, or throws RuleError. Values arrive as typed in Telegram. */
export function setRule(rules: LeagueRules, key: string, value: string): LeagueRules {
  switch (key) {
    case "entryFee":
      return { ...rules, entryFee: parseBirr(value) };
    case "lateFee":
      return { ...rules, lateFee: parseBirr(value) };
    case "prizeShares":
      return { ...rules, prizeShares: parseShares(value) };
    case "runnerUpPerk":
      return { ...rules, runnerUpPerk: oneOf(value, ["skip_next", "half_price", "off"]) };
    case "whoCanWin":
      return { ...rules, whoCanWin: oneOf(value, ["paid_only", "everyone"]) };
    case "scoreMode":
      return { ...rules, scoreMode: oneOf(value, ["net", "gross"]) };
    case "tieFirst":
      return { ...rules, tieFirst: oneOf(value, ["split", "tie_break"]) };
    case "tieSecond":
      return { ...rules, tieSecond: oneOf(value, ["all", "tie_break"]) };
    case "lateRule":
      return { ...rules, lateRule: oneOf(value, ["not_eligible", "late_fee", "lose_free_pass"]) };
    default:
      throw new RuleError(`There's no rule called "${key}".`);
  }
}
