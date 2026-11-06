import { useEffect, useState } from "react";
import { request, type Rules } from "../api.js";
import { text, textOr } from "../text.js";
import { ActionNotices, Card, Loading, useAction, useLoad } from "../ui.js";

const RULE_ORDER = [
  "entryFee",
  "prizeShares",
  "winnerPerk",
  "runnerUpPerk",
  "whoCanWin",
  "scoreMode",
  "tieFirst",
  "tieSecond",
  "lateRule",
  "lateFee",
];

const asInput = (value: string | number | number[] | undefined) =>
  Array.isArray(value) ? value.join(",") : String(value ?? "");

function RuleField({
  name,
  value,
  options,
  canEdit,
  busy,
  onSave,
}: {
  name: string;
  value: string;
  options: string[] | undefined;
  canEdit: boolean;
  busy: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const label = textOr(`web.rule.${name}`, name);
  const optionLabel = (option: string) => textOr(`web.rule.${name}.${option}`, option);

  if (!canEdit) {
    return (
      <div className="item row">
        <span>{label}</span>
        <span className="strong">{options ? optionLabel(value) : value}</span>
      </div>
    );
  }
  return (
    <label className="item">
      {label}
      <div className="inline-form">
        {options ? (
          <select value={draft} onChange={(event) => setDraft(event.target.value)}>
            {options.map((option) => (
              <option key={option} value={option}>
                {optionLabel(option)}
              </option>
            ))}
          </select>
        ) : (
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        )}
        <button className="secondary" disabled={busy || draft === value} onClick={() => onSave(draft)}>
          {text("web.save")}
        </button>
      </div>
    </label>
  );
}

export function RulesScreen({ leagueId }: { leagueId: number }) {
  const { data, error, reload } = useLoad<Rules>(`/leagues/${leagueId}/rules`);
  const action = useAction(reload);
  const [telebirr, setTelebirr] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState<string | null>(null);
  const [spice, setSpice] = useState<number | null>(null);
  if (!data) return <Loading error={error} />;

  const canEdit = data.role === "owner";
  const base = `/leagues/${leagueId}`;
  const telebirrValue = telebirr ?? data.telebirrName ?? "";
  const chosenPersona = personaName ?? data.persona.name;
  const chosenSpice = spice ?? data.persona.spice;
  const personaChanged = chosenPersona !== data.persona.name || chosenSpice !== data.persona.spice;

  return (
    <>
      <ActionNotices error={action.error} done={action.done} />

      <Card title={text("web.rules.payments")}>
        <label className="item">
          {text("web.rules.telebirr")}
          <div className="inline-form">
            <input value={telebirrValue} onChange={(event) => setTelebirr(event.target.value)} />
            <button
              className="secondary"
              disabled={action.busy || telebirrValue.trim() === "" || telebirrValue === data.telebirrName}
              onClick={() =>
                void action.run(() => request("POST", `${base}/telebirr`, { name: telebirrValue }), {
                  done: text("web.rules.saved"),
                })
              }
            >
              {text("web.save")}
            </button>
          </div>
        </label>
      </Card>

      <Card title={text("web.rules.title")}>
        {!canEdit && <p className="muted">{text("web.rules.ownerOnly")}</p>}
        {canEdit && <p className="muted">{text("web.rules.futureOnly")}</p>}
        {RULE_ORDER.map((name) => (
          <RuleField
            key={name}
            name={name}
            value={asInput(data.rules[name])}
            options={data.options[name]}
            canEdit={canEdit}
            busy={action.busy}
            onSave={(value) =>
              void action.run(() => request("POST", `${base}/rules`, { key: name, value }), {
                confirm: text("web.rules.confirm", { name: textOr(`web.rule.${name}`, name) }),
                done: text("web.rules.saved"),
              })
            }
          />
        ))}
      </Card>

      <Card title={text("web.rules.persona")}>
        {canEdit ? (
          <>
            <label className="item">
              {text("web.rules.personaName")}
              <select value={chosenPersona} onChange={(event) => setPersonaName(event.target.value)}>
                {data.personas.map((name) => (
                  <option key={name} value={name}>
                    {textOr(`web.persona.${name}`, name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="item">
              {text("web.rules.spice", { spice: chosenSpice })}
              <input
                type="range"
                min={1}
                max={5}
                value={chosenSpice}
                onChange={(event) => setSpice(Number(event.target.value))}
              />
            </label>
            <button
              disabled={action.busy || !personaChanged}
              onClick={() =>
                void action.run(() => request("POST", `${base}/persona`, { name: chosenPersona, spice: chosenSpice }), {
                  done: text("web.rules.saved"),
                })
              }
            >
              {text("web.save")}
            </button>
          </>
        ) : (
          <div className="item row">
            <span>{textOr(`web.persona.${data.persona.name}`, data.persona.name)}</span>
            <span className="strong">{text("web.rules.spice", { spice: data.persona.spice })}</span>
          </div>
        )}
      </Card>
    </>
  );
}
