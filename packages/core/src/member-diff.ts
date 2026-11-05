export interface KnownMember {
  id: number;
  fplEntryId: number;
  fplTeamName: string;
  fplManagerName: string;
  status: "active" | "paused" | "left";
}

export interface FplManager {
  entry: number;
  teamName: string;
  managerName: string;
}

export interface MemberDiff {
  joined: FplManager[];
  left: KnownMember[];
  rejoined: KnownMember[];
  renamed: { id: number; teamName: string; managerName: string }[];
}

/** What changed in the FPL league. Empty data from FPL never means everyone left. */
export function diffMembers(members: KnownMember[], managers: FplManager[]): MemberDiff {
  if (managers.length === 0) return { joined: [], left: [], rejoined: [], renamed: [] };

  const inLeague = (member: KnownMember) => managers.some((manager) => manager.entry === member.fplEntryId);
  return {
    joined: managers.filter((manager) => !members.some((member) => member.fplEntryId === manager.entry)),
    left: members.filter((member) => member.status !== "left" && !inLeague(member)),
    rejoined: members.filter((member) => member.status === "left" && inLeague(member)),
    renamed: members.flatMap((member) => {
      const manager = managers.find((item) => item.entry === member.fplEntryId);
      if (!manager) return [];
      if (manager.teamName === member.fplTeamName && manager.managerName === member.fplManagerName) return [];
      return [{ id: member.id, teamName: manager.teamName, managerName: manager.managerName }];
    }),
  };
}
