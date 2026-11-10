/** One gameweek's "who wins?" poll: who won the pot, and who each voter picked. */
export interface PredictionWeek {
  winnerIds: number[];
  votes: { voterId: number; pickedId: number }[];
}

export interface PredictionStats {
  memberId: number;
  /** Weeks they voted in that had a winner. */
  predicted: number;
  right: number;
}

/** Who picked a winner that week. With a tie, any tied winner counts. */
export function rightPredictors(week: PredictionWeek): number[] {
  return week.votes.filter((vote) => week.winnerIds.includes(vote.pickedId)).map((vote) => vote.voterId);
}

/**
 * Season prediction accuracy, for bragging rights only. A week with no winner had nothing to predict, so it doesn't
 * count. Most right first, then the fewest tries.
 */
export function predictionStats(weeks: PredictionWeek[]): PredictionStats[] {
  const rows = new Map<number, PredictionStats>();
  for (const week of weeks) {
    if (week.winnerIds.length === 0) continue;
    for (const vote of week.votes) {
      const row = rows.get(vote.voterId) ?? { memberId: vote.voterId, predicted: 0, right: 0 };
      row.predicted += 1;
      if (week.winnerIds.includes(vote.pickedId)) row.right += 1;
      rows.set(vote.voterId, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.right - a.right || a.predicted - b.predicted || a.memberId - b.memberId);
}
