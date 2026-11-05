/** League settings, stored as JSON on the league. The remaining rule options arrive in Milestone M2. */
export interface LeagueRules {
  entryFee: number;
}

export const DEFAULT_RULES: LeagueRules = { entryFee: 100 };
