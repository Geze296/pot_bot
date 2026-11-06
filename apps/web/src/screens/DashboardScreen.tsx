import { useEffect, useState } from "react";
import type { Dashboard } from "../api.js";
import { dateTime, timeLeft } from "../format.js";
import { text } from "../text.js";
import { Card, FeeBadge, Loading, useLoad } from "../ui.js";

function Countdown({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const left = timeLeft(deadlineAt, now);
  if (!left) return <p className="muted">{text("web.dashboard.closed")}</p>;
  return (
    <p className="countdown">
      {left.days > 0
        ? text("web.dashboard.leftDays", { days: left.days, hours: left.hours })
        : text("web.dashboard.leftHours", { hours: left.hours, minutes: left.minutes })}
    </p>
  );
}

function NameGroup({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="name-group">
      <h3>
        {label} <span className="muted">({names.length})</span>
      </h3>
      <p>{names.join(", ")}</p>
    </div>
  );
}

export function DashboardScreen({ leagueId }: { leagueId: number }) {
  const { data, error } = useLoad<Dashboard>(`/leagues/${leagueId}/dashboard`);
  if (!data) return <Loading error={error} />;

  const { gameweek } = data;
  if (!gameweek) return <Card>{text("web.dashboard.noGameweek")}</Card>;

  return (
    <>
      <Card>
        <p className="eyebrow">{text("web.dashboard.gameweek", { gw: gameweek.event })}</p>
        <p className="pot">{text("web.birr", { amount: data.pot })}</p>
        <p className="muted">{text("web.dashboard.potSoFar")}</p>
        <Countdown deadlineAt={gameweek.deadlineAt} />
        <p className="muted">
          {text("web.dashboard.deadline", { when: dateTime(gameweek.deadlineAt, data.timezone) })}
        </p>
      </Card>

      {data.team && (
        <Card>
          <div className="row">
            <div>
              <p className="eyebrow">{text("web.dashboard.yourTeam")}</p>
              <p className="strong">{data.team}</p>
            </div>
            {data.yourStatus && <FeeBadge status={data.yourStatus.status} reason={data.yourStatus.reason} />}
          </div>
        </Card>
      )}

      {data.lastResult && (
        <Card>
          <p className="eyebrow">{text("web.dashboard.lastWinner", { gw: data.lastResult.event })}</p>
          <p className="strong">{data.lastResult.winners.join(" & ") || text("web.dashboard.noWinner")}</p>
        </Card>
      )}

      <Card title={text("web.dashboard.whoStands")}>
        <NameGroup label={text("web.fee.paid")} names={data.paid} />
        <NameGroup label={text("web.fee.free_pass")} names={data.freePass} />
        <NameGroup label={text("web.fee.review")} names={data.inReview} />
        <NameGroup label={text("web.fee.due")} names={data.unpaid} />
        <NameGroup label={text("web.fee.waived")} names={data.out} />
      </Card>
    </>
  );
}
