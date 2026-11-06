import { useState } from "react";
import { request, type Members, type Role } from "../api.js";
import { text, textOr } from "../text.js";
import { ActionNotices, Badge, Card, Loading, useAction, useLoad } from "../ui.js";

type Member = Members["members"][number];

function AddFact({ busy, onAdd }: { busy: boolean; onAdd: (fact: string) => Promise<boolean> }) {
  const [fact, setFact] = useState("");
  return (
    <div className="inline-form">
      <input
        aria-label={text("web.members.addFact")}
        placeholder={text("web.members.addFact")}
        maxLength={300}
        value={fact}
        onChange={(event) => setFact(event.target.value)}
      />
      <button
        className="secondary"
        disabled={busy || fact.trim() === ""}
        onClick={() => void onAdd(fact).then((ok) => ok && setFact(""))}
      >
        {text("web.members.add")}
      </button>
    </div>
  );
}

export function MembersScreen({ leagueId, role }: { leagueId: number; role: Role }) {
  const { data, error, reload } = useLoad<Members>(`/leagues/${leagueId}/members`);
  const action = useAction(reload);
  if (!data) return <Loading error={error} />;

  const base = (member: Member) => `/leagues/${leagueId}/members/${member.id}`;
  const statusTone = (status: string) => (status === "active" ? "good" : status === "paused" ? "warn" : "bad");

  return (
    <>
      <ActionNotices error={action.error} done={action.done} />
      <p className="muted hint">{text("web.members.linkHint")}</p>
      {data.members.map((member) => {
        const isCoordinator = member.userId !== null && member.userId === data.coordinatorUserId;
        return (
          <Card key={member.id}>
            <div className="row">
              <div>
                <p className="strong">{member.manager}</p>
                <p className="muted">
                  {member.team} · {text("web.members.teamId", { id: member.entry })}
                </p>
              </div>
              <Badge tone={statusTone(member.status)}>
                {textOr(`web.members.status.${member.status}`, member.status)}
              </Badge>
            </div>

            <p className="small">
              {member.claimedBy
                ? text("web.members.claimedBy", {
                    name: member.username ? `${member.claimedBy} (@${member.username})` : member.claimedBy,
                  })
                : text("web.members.unclaimed")}
              {isCoordinator && <> · {text("web.members.coordinator")}</>}
              {member.roastOptOut && <> · {text("web.members.optedOut")}</>}
            </p>

            <details className="form-section">
              <summary>{text("web.members.facts", { count: member.facts.length })}</summary>
              {member.facts.length > 0 && (
                <ul className="facts">
                  {member.facts.map((fact) => (
                    <li key={fact.id}>
                      <span>{fact.fact}</span>
                      <button
                        className="link danger"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(() => request("DELETE", `${base(member)}/facts/${fact.id}`), {
                            confirm: text("web.members.confirmDeleteFact"),
                          })
                        }
                      >
                        {text("web.members.delete")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!member.roastOptOut && member.status !== "left" && (
                <AddFact
                  busy={action.busy}
                  onAdd={(fact) =>
                    action.run(() => request("POST", `${base(member)}/facts`, { fact }), {
                      done: text("web.members.factSaved", { name: member.manager }),
                    })
                  }
                />
              )}
            </details>

            <div className="buttons">
              {member.status !== "left" && (
                <button
                  className="link"
                  disabled={action.busy}
                  onClick={() => {
                    const status = member.status === "paused" ? "active" : "paused";
                    void action.run(() => request("POST", `${base(member)}/status`, { status }), {
                      confirm: text(status === "paused" ? "web.members.confirmPause" : "web.members.confirmResume", {
                        name: member.manager,
                      }),
                    });
                  }}
                >
                  {text(member.status === "paused" ? "web.members.resume" : "web.members.pause")}
                </button>
              )}
              {member.userId !== null && (
                <button
                  className="link danger"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(() => request("POST", `${base(member)}/unlink`), {
                      confirm: text("web.members.confirmUnlink", { team: member.team }),
                    })
                  }
                >
                  {text("web.members.unlink")}
                </button>
              )}
              {role === "owner" && member.userId !== null && !isCoordinator && (
                <button
                  className="link"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => request("POST", `/leagues/${leagueId}/coordinator`, { memberId: member.id }),
                      { confirm: text("web.members.confirmCoordinator", { name: member.claimedBy ?? member.manager }) },
                    )
                  }
                >
                  {text("web.members.makeCoordinator")}
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </>
  );
}
