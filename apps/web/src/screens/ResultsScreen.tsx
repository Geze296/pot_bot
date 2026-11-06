import { useState } from "react";
import { request, type Results } from "../api.js";
import { text } from "../text.js";
import { ActionNotices, Badge, Card, Loading, useAction, useLoad } from "../ui.js";

type Gameweek = Results["gameweeks"][number];

function CorrectScore({
  gameweek,
  members,
  busy,
  onSubmit,
}: {
  gameweek: Gameweek;
  members: Results["members"];
  busy: boolean;
  onSubmit: (memberId: number, points: number, transferCost: number) => Promise<boolean>;
}) {
  const [memberId, setMemberId] = useState(members[0]?.memberId ?? 0);
  const [points, setPoints] = useState("");
  const [cost, setCost] = useState("0");
  const valid = /^\d+$/.test(points) && /^\d+$/.test(cost);

  return (
    <details className="form-section">
      <summary>{text("web.results.correctScore")}</summary>
      <label>
        {text("web.results.manager")}
        <select value={memberId} onChange={(event) => setMemberId(Number(event.target.value))}>
          {members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.manager} ({member.team})
            </option>
          ))}
        </select>
      </label>
      <div className="field-pair">
        <label>
          {text("web.results.points")}
          <input inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value)} />
        </label>
        <label>
          {text("web.results.hitCost")}
          <input inputMode="numeric" value={cost} onChange={(event) => setCost(event.target.value)} />
        </label>
      </div>
      <button
        disabled={busy || !valid}
        onClick={() => void onSubmit(memberId, Number(points), Number(cost)).then((ok) => ok && setPoints(""))}
      >
        {text("web.results.saveScore", { gw: gameweek.event })}
      </button>
    </details>
  );
}

function NameWinner({
  members,
  busy,
  onSubmit,
}: {
  members: Results["members"];
  busy: boolean;
  onSubmit: (winnerIds: number[], runnerUpIds: number[]) => Promise<boolean>;
}) {
  const [winners, setWinners] = useState<number[]>([]);
  const [runners, setRunners] = useState<number[]>([]);
  const toggle = (list: number[], id: number) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  return (
    <details className="form-section">
      <summary>{text("web.results.nameWinner")}</summary>
      <table className="pick-table">
        <thead>
          <tr>
            <th>{text("web.results.manager")}</th>
            <th>{text("web.results.winner")}</th>
            <th>{text("web.results.runnerUp")}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.memberId}>
              <td>{member.manager}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${text("web.results.winner")}: ${member.manager}`}
                  checked={winners.includes(member.memberId)}
                  onChange={() => setWinners(toggle(winners, member.memberId))}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${text("web.results.runnerUp")}: ${member.manager}`}
                  checked={runners.includes(member.memberId)}
                  onChange={() => setRunners(toggle(runners, member.memberId))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={busy || winners.length === 0} onClick={() => void onSubmit(winners, runners)}>
        {text("web.results.saveWinner")}
      </button>
    </details>
  );
}

export function ResultsScreen({ leagueId, canManage }: { leagueId: number; canManage: boolean }) {
  const { data, error, reload } = useLoad<Results>(`/leagues/${leagueId}/results`);
  const action = useAction(reload);
  if (!data) return <Loading error={error} />;
  if (data.gameweeks.length === 0) return <Card>{text("web.results.none")}</Card>;

  const base = `/leagues/${leagueId}/results`;
  return (
    <>
      <ActionNotices error={action.error} done={action.done} />
      {data.gameweeks.map((gameweek, index) => {
        const { result } = gameweek;
        return (
          <details className="card week" key={gameweek.event} open={index === 0}>
            <summary>
              <span className="strong">{text("web.dashboard.gameweek", { gw: gameweek.event })}</span>
              <span className="muted">
                {result ? result.winners.join(" & ") || text("web.dashboard.noWinner") : text("web.results.waiting")}
              </span>
            </summary>

            {result && (
              <div className="result-summary">
                {result.source === "manual" && <Badge tone="warn">{text("web.results.manual")}</Badge>}
                <dl className="details">
                  <dt>{text("web.results.pot")}</dt>
                  <dd>{text("web.birr", { amount: gameweek.pot })}</dd>
                  <dt>{text("web.results.runnerUp")}</dt>
                  <dd>{result.runnersUp.join(" & ") || text("web.dashboard.noWinner")}</dd>
                  {result.carryOut > 0 && (
                    <>
                      <dt>{text("web.results.carry")}</dt>
                      <dd>{text("web.birr", { amount: result.carryOut })}</dd>
                    </>
                  )}
                </dl>

                {result.shares.map((share) => (
                  <div className="item row" key={share.memberId}>
                    <div>
                      <p className="strong">{share.manager}</p>
                      <p className="muted">{text("web.birr", { amount: share.amount })}</p>
                    </div>
                    {share.paid ? (
                      <Badge tone="good">{text("web.results.delivered")}</Badge>
                    ) : canManage ? (
                      <button
                        className="link"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            () => request("POST", `${base}/${gameweek.event}/payout`, { memberId: share.memberId }),
                            {
                              confirm: text("web.results.confirmPayout", {
                                name: share.manager,
                                amount: share.amount,
                              }),
                              done: text("web.results.payoutDone", { name: share.manager }),
                            },
                          )
                        }
                      >
                        {text("web.results.recordPayout")}
                      </button>
                    ) : (
                      <Badge tone="warn">{text("web.results.notDelivered")}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {gameweek.scores.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text("web.results.manager")}</th>
                      <th className="num">{text("web.results.hits")}</th>
                      <th className="num">{text("web.results.score")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameweek.scores.map((score) => (
                      <tr key={score.memberId}>
                        <td>
                          {score.manager}
                          {score.source === "manual" && <span className="muted"> {text("web.results.corrected")}</span>}
                        </td>
                        <td className="num">{score.transferCost > 0 ? `-${score.transferCost}` : ""}</td>
                        <td className="num strong">{score.net}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canManage && (
              <>
                <CorrectScore
                  gameweek={gameweek}
                  members={data.members}
                  busy={action.busy}
                  onSubmit={(memberId, points, transferCost) =>
                    action.run(
                      () => request("POST", `${base}/${gameweek.event}/score`, { memberId, points, transferCost }),
                      {
                        confirm: text("web.results.confirmScore", { gw: gameweek.event, points }),
                        done: text("web.results.scoreSaved"),
                      },
                    )
                  }
                />
                <NameWinner
                  members={data.members}
                  busy={action.busy}
                  onSubmit={(winnerIds, runnerUpIds) =>
                    action.run(() => request("POST", `${base}/${gameweek.event}/winner`, { winnerIds, runnerUpIds }), {
                      confirm: text("web.results.confirmWinner", { gw: gameweek.event }),
                      done: text("web.results.winnerSaved"),
                    })
                  }
                />
              </>
            )}
          </details>
        );
      })}
    </>
  );
}
