import { request, type Ledger } from "../api.js";
import { signed } from "../format.js";
import { text } from "../text.js";
import { ActionNotices, Card, FeeBadge, Loading, useAction, useLoad } from "../ui.js";

export function LedgerScreen({ leagueId }: { leagueId: number }) {
  const { data, error, reload } = useLoad<Ledger>(`/leagues/${leagueId}/ledger`);
  const action = useAction(reload);
  if (!data) return <Loading error={error} />;

  return (
    <>
      <ActionNotices error={action.error} done={action.done} />
      <Card title={text("web.ledger.title")}>
        <p className="muted">{text("web.ledger.note")}</p>
        {data.members.map((member) => {
          const weeks = data.weeks.filter((week) => week.memberId === member.memberId);
          return (
            <details className="ledger-row" key={member.memberId}>
              <summary>
                <span>
                  <span className="strong">{member.manager}</span>
                  <span className="muted small">
                    {" "}
                    {text("web.ledger.summary", { paid: member.paidIn, won: member.won })}
                  </span>
                </span>
                <span className={`num strong ${member.net > 0 ? "gain" : member.net < 0 ? "loss" : ""}`}>
                  {signed(member.net)}
                </span>
              </summary>
              {member.won > 0 && (
                <p className="muted small">{text("web.ledger.received", { amount: member.received })}</p>
              )}
              {weeks.length === 0 && <p className="muted small">{text("web.ledger.noWeeks")}</p>}
              {weeks.map((week) => (
                <div className="week-line" key={week.gameweek}>
                  <span>{text("web.dashboard.gameweek", { gw: week.gameweek })}</span>
                  {week.reason && <FeeBadge status={week.status} reason={week.reason} />}
                  <span className="num small">{text("web.ledger.weekLine", { paid: week.paid, won: week.won })}</span>
                </div>
              ))}
            </details>
          );
        })}
      </Card>

      {data.canExport && (
        <button
          className="wide"
          disabled={action.busy}
          onClick={() =>
            void action.run(() => request("POST", `/leagues/${leagueId}/ledger/send`), {
              done: text("web.ledger.sent"),
            })
          }
        >
          {text("web.ledger.send")}
        </button>
      )}
    </>
  );
}
