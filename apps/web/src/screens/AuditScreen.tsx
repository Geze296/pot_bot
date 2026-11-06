import type { Audit } from "../api.js";
import { changes, dateTime } from "../format.js";
import { text, textOr } from "../text.js";
import { Card, Loading, useLoad } from "../ui.js";

export function AuditScreen({ leagueId }: { leagueId: number }) {
  const { data, error } = useLoad<Audit>(`/leagues/${leagueId}/audit`);
  if (!data) return <Loading error={error} />;

  return (
    <Card title={text("web.audit.title")}>
      {data.entries.length === 0 && <p className="muted">{text("web.audit.none")}</p>}
      {data.entries.map((entry) => (
        <article className="item" key={entry.id}>
          <p className="strong">{textOr(`web.audit.action.${entry.action}`, entry.action)}</p>
          {entry.subject && <p>{entry.subject}</p>}
          <p className="muted small">
            {entry.actor} · {dateTime(entry.at, data.timezone)}
          </p>
          {changes(entry.before, entry.after, (key) =>
            textOr(`web.audit.field.${key}`, textOr(`web.rule.${key}`, key)),
          ).map((line) => (
            <p className="small change" key={line}>
              {line}
            </p>
          ))}
        </article>
      ))}
    </Card>
  );
}
