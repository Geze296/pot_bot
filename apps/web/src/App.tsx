import { useState, type ReactNode } from "react";
import type { LeagueRef, Me } from "./api.js";
import { AuditScreen } from "./screens/AuditScreen.js";
import { DashboardScreen } from "./screens/DashboardScreen.js";
import { LedgerScreen } from "./screens/LedgerScreen.js";
import { MembersScreen } from "./screens/MembersScreen.js";
import { PaymentsScreen } from "./screens/PaymentsScreen.js";
import { ResultsScreen } from "./screens/ResultsScreen.js";
import { RulesScreen } from "./screens/RulesScreen.js";
import { initData } from "./telegram.js";
import { text, type TextKey } from "./text.js";
import { Card, Loading, useLoad } from "./ui.js";

type Tab = { key: string; label: TextKey; screen: () => ReactNode };

function tabsFor(league: LeagueRef): Tab[] {
  const leagueId = league.id;
  const canManage = league.role !== "member";
  const forEveryone: Tab[] = [
    { key: "dashboard", label: "web.tab.dashboard", screen: () => <DashboardScreen leagueId={leagueId} /> },
    {
      key: "results",
      label: "web.tab.results",
      screen: () => <ResultsScreen leagueId={leagueId} canManage={canManage} />,
    },
    { key: "ledger", label: "web.tab.ledger", screen: () => <LedgerScreen leagueId={leagueId} /> },
  ];
  if (!canManage) return forEveryone;

  // What a member can't open isn't offered. The server refuses it anyway.
  return [
    forEveryone[0]!,
    { key: "payments", label: "web.tab.payments", screen: () => <PaymentsScreen leagueId={leagueId} /> },
    forEveryone[1]!,
    forEveryone[2]!,
    {
      key: "members",
      label: "web.tab.members",
      screen: () => <MembersScreen leagueId={leagueId} role={league.role} />,
    },
    { key: "rules", label: "web.tab.rules", screen: () => <RulesScreen leagueId={leagueId} /> },
    { key: "audit", label: "web.tab.audit", screen: () => <AuditScreen leagueId={leagueId} /> },
  ];
}

function LeagueView({
  league,
  leagues,
  onPick,
}: {
  league: LeagueRef;
  leagues: LeagueRef[];
  onPick: (id: number) => void;
}) {
  const [tabKey, setTabKey] = useState("dashboard");
  const tabs = tabsFor(league);
  const tab = tabs.find((item) => item.key === tabKey) ?? tabs[0]!;

  return (
    <>
      <header className="app-header">
        {leagues.length > 1 ? (
          <select
            aria-label={text("web.pickLeague")}
            value={league.id}
            onChange={(event) => {
              setTabKey("dashboard");
              onPick(Number(event.target.value));
            }}
          >
            {leagues.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <h1>{league.name}</h1>
        )}
        <nav className="tabs" aria-label={text("web.tabs")}>
          {tabs.map((item) => (
            <button
              key={item.key}
              className={item.key === tab.key ? "tab active" : "tab"}
              aria-current={item.key === tab.key ? "page" : undefined}
              onClick={() => {
                setTabKey(item.key);
                window.scrollTo(0, 0);
              }}
            >
              {text(item.label)}
            </button>
          ))}
        </nav>
      </header>
      {/* The key resets a screen's state when the league or tab changes. */}
      <main key={`${league.id}:${tab.key}`}>{tab.screen()}</main>
    </>
  );
}

function SignedIn() {
  const { data, error } = useLoad<Me>("/me");
  const [leagueId, setLeagueId] = useState<number | null>(null);

  if (!data) {
    return (
      <main>
        <Loading error={error} />
      </main>
    );
  }
  if (data.leagues.length === 0) {
    return (
      <main>
        <Card title={text("web.noLeague.title", { name: data.name })}>
          <p>{text("web.noLeague.body")}</p>
        </Card>
      </main>
    );
  }
  const league = data.leagues.find((item) => item.id === leagueId) ?? data.leagues[0]!;
  return <LeagueView league={league} leagues={data.leagues} onPick={setLeagueId} />;
}

export function App() {
  if (!initData()) {
    return (
      <main>
        <Card title={text("web.outside.title")}>
          <p>{text("web.outside.body")}</p>
        </Card>
      </main>
    );
  }
  return <SignedIn />;
}
