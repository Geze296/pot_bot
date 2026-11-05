import { diffMembers } from "@potbot/core";
import type { League } from "@potbot/db";
import { t } from "../i18n/index.js";
import { SETUP_STATE } from "./league-setup.js";
import type { SettlementDeps } from "./settlement.js";

export interface SyncDeps extends SettlementDeps {
  botUsername: string;
}

/**
 * Applies FPL's member list to one league (PRD L4). A leaver is flagged, never deleted, and any fee they haven't paid
 * is cancelled so they stop being chased. A fee they already paid stands, and the coordinator can /markunpaid it.
 */
export async function syncLeague(deps: SyncDeps, league: League): Promise<void> {
  const { db, fpl, send } = deps;
  const { managers } = await fpl.getLeagueStandings(league.fplLeagueId);
  const members = await db.member.findMany({ where: { leagueId: league.id } });
  const diff = diffMembers(members, managers);

  await db.$transaction(async (tx) => {
    if (diff.joined.length > 0) {
      await tx.member.createMany({
        data: diff.joined.map((manager) => ({
          leagueId: league.id,
          fplEntryId: manager.entry,
          fplTeamName: manager.teamName,
          fplManagerName: manager.managerName,
        })),
      });
    }
    for (const { id, teamName, managerName } of diff.renamed) {
      await tx.member.update({ where: { id }, data: { fplTeamName: teamName, fplManagerName: managerName } });
    }
    for (const { id } of diff.rejoined) {
      await tx.member.update({ where: { id }, data: { status: "active" } });
    }
    const leaverIds = diff.left.map((member) => member.id);
    await tx.member.updateMany({ where: { id: { in: leaverIds } }, data: { status: "left" } });
    await tx.obligation.updateMany({
      where: { memberId: { in: leaverIds }, status: "due", gameweek: { status: { not: "settled" } } },
      data: { status: "waived" },
    });
  });

  const lines = [
    ...diff.joined.map((manager) =>
      t("en", "sync.joined", {
        team: manager.teamName,
        manager: manager.managerName,
        link: `https://t.me/${deps.botUsername}?start=join_${league.joinToken}`,
      }),
    ),
    ...diff.rejoined.map((member) =>
      t("en", "sync.rejoined", { team: member.fplTeamName, manager: member.fplManagerName }),
    ),
    ...diff.left.map((member) => t("en", "sync.left", { team: member.fplTeamName, manager: member.fplManagerName })),
  ];
  if (lines.length > 0) await send(league.telegramChatId, lines.join("\n"));
}

export async function syncAllLeagues(deps: SyncDeps): Promise<void> {
  const leagues = await deps.db.league.findMany({ where: { setupState: SETUP_STATE.active } });
  for (const league of leagues) {
    try {
      await syncLeague(deps, league);
    } catch (error) {
      // A failure changes nothing, and the next hourly run tries again.
      console.error(`League ${league.id} sync failed:`, error);
    }
  }
}
