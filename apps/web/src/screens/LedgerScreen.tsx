import { request, type Ledger } from "../api.js";
import { leaders, namesOrCount, signed } from "../format.js";
import { text, type TextKey } from "../text.js";
import { ActionNotices, Card, FeeBadge, Loading, useAction, useLoad } from "../ui.js";

function HallOfFame({ stats }: { stats: Ledger["stats"] }) {
  const records: {
    label: TextKey;
    value: (row: Ledger["stats"][number]) => number;
    one: TextKey;
    many: TextKey;
  }[] = [
    { label: "web.fame.wins", value: (row) => row.wins, one: "web.fame.oneWin", many: "web.fame.manyWins" },
    { label: "web.fame.biggest", value: (row) => row.biggestWin, one: "web.birr", many: "web.birr" },
    { label: "web.fame.runnerUps", value: (row) => row.runnerUps, one: "web.fame.oneTime", many: "web.fame.manyTimes" },
    {
      label: "web.fame.winless",
      value: (row) => row.longestWinless,
      one: "web.fame.oneWeek",
      many: "web.fame.manyWeeks",
    },
  ];
  const held = records.flatMap((record) => {
    const top = leaders(stats, record.value);
    return top ? [{ ...record, top }] : [];
  });
  if (held.length === 0) return null;

  return (
    <Card title={text("web.fame.title")}>
      {held.map(({ label, one, many, top }) => {
        const names = namesOrCount(top.rows.map((row) => row.manager));
        return (
          <div className="item" key={label}>
            <p className="muted small">{text(label)}</p>
            <div className="row">
              <span className="strong">
                {typeof names === "number" ? text("web.fame.tied", { count: names }) : names}
              </span>
              <span className="num">{text(top.value === 1 ? one : many, { value: top.value, amount: top.value })}</span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export function LedgerScreen({ leagueId }: { leagueId: number }) {
  const { data, error, reload } = useLoad<Ledger>(`/leagues/${leagueId}/ledger`);
  const action = useAction(reload);
  if (!data) return <Loading error={error} />;

  return (
    <>
      <ActionNotices error={action.error} done={action.done} />
      <HallOfFame stats={data.stats} />
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
