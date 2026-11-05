// Only the FPL fields Pot Bot uses. FPL's names are kept so these match the saved fixtures.

export interface FplEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  data_checked: boolean;
  is_current: boolean;
  is_next: boolean;
}

export interface FplBootstrap {
  events: FplEvent[];
  teams: { id: number; name: string; short_name: string }[];
  elements: { id: number; web_name: string; team: number }[];
}

export interface FplEventStatus {
  status: { bonus_added: boolean; date: string; event: number; points: string }[];
  leagues: string;
}

export interface FplLeagueInfo {
  id: number;
  name: string;
  start_event: number;
  scoring: string;
}

export interface FplStandingRow {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  total: number;
  /** Before transfer hits: subtract event_transfers_cost for the net score. */
  event_total: number;
}

export interface FplNewEntryRow {
  entry: number;
  entry_name: string;
  player_first_name: string;
  player_last_name: string;
}

export interface FplStandingsPage {
  league: FplLeagueInfo;
  standings: { has_next: boolean; results: FplStandingRow[] };
  new_entries: { has_next: boolean; results: FplNewEntryRow[] };
}

export interface LeagueManager {
  entry: number;
  teamName: string;
  managerName: string;
}

export interface LeagueStandings {
  league: FplLeagueInfo;
  managers: LeagueManager[];
}

export interface FplHistoryEvent {
  event: number;
  /** Before transfer hits. */
  points: number;
  /** After transfer hits. */
  total_points: number;
  event_transfers_cost: number;
  points_on_bench: number;
}

export interface FplEntryHistory {
  current: FplHistoryEvent[];
}

export interface FplPicks {
  active_chip: string | null;
  entry_history: FplHistoryEvent;
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[];
}

export interface FplEventLive {
  elements: { id: number; stats: { total_points: number; minutes: number } }[];
}
