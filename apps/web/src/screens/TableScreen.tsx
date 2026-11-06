import type { LiveTable, TableRow } from "../api.js";
import { text } from "../text.js";
import { Badge, Card, Loading, useLoad } from "../ui.js";

function Rows({ rows, yourTeam }: { rows: TableRow[]; yourTeam: string | null }) {
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.team} className={row.team === yourTeam ? "you" : undefined}>
            <td className="rank">{row.rank}</td>
            <td>{row.team}</td>
            <td className="num strong">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TableScreen({ leagueId }: { leagueId: number }) {
  const { data, error } = useLoad<LiveTable>(`/leagues/${leagueId}/table`);
  if (!data) return <Loading error={error} />;
  if (!data.table) return <Card>{text("web.table.none")}</Card>;

  const { table, yourTeam } = data;
  return (
    <>
      <Card
        title={
          <span className="title-row">
            {text("web.dashboard.gameweek", { gw: table.event })}
            <Badge tone={table.finished ? "plain" : "good"}>
              {text(table.finished ? "web.table.final" : "web.table.live")}
            </Badge>
          </span>
        }
      >
        <p className="muted small">{text("web.table.afterHits")}</p>
        <Rows rows={table.gameweek} yourTeam={yourTeam} />
      </Card>
      <Card title={text("web.table.overall")}>
        <Rows rows={table.overall} yourTeam={yourTeam} />
      </Card>
    </>
  );
}
