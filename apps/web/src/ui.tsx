import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, request } from "./api.js";
import { confirmAction } from "./telegram.js";
import { text, textOr } from "./text.js";

const DONE_NOTICE_MS = 5000;

export function errorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "server_error";
  return textOr(`web.error.${code}`, text("web.error.generic"));
}

/** Loads a screen's data and offers a reload for after an action. */
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await request<T>("GET", path));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  return { data, error, reload };
}

/** Runs a change: optional confirmation, then the request, then a reload. One at a time, so a double tap can't repeat. */
export function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), DONE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const run = useCallback(
    async (action: () => Promise<unknown>, options: { confirm?: string; done?: string } = {}) => {
      if (busy) return false;
      if (options.confirm && !(await confirmAction(options.confirm))) return false;
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        await action();
        await reload();
        setDone(options.done ?? null);
        return true;
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, reload],
  );

  return { busy, error, done, run };
}

export function Loading({ error }: { error: string | null }) {
  return error ? <Notice kind="error">{error}</Notice> : <p className="muted centered">{text("web.loading")}</p>;
}

export function Notice({ kind, children }: { kind: "error" | "done" | "info"; children: ReactNode }) {
  return (
    <p className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** Pinned to the bottom of the screen, because the button that was tapped may be far down a long page. */
export function ActionNotices({ error, done }: { error: string | null; done: string | null }) {
  if (!error && !done) return null;
  return (
    <div className="toast">
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="done">{done}</Notice>}
    </div>
  );
}

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "plain"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const FEE_TONES: Record<string, "good" | "warn" | "plain"> = { paid: "good", due: "warn", waived: "plain" };

export function FeeBadge({ status, reason }: { status: string; reason: string }) {
  const label = reason === "free_pass" ? text("web.fee.free_pass") : textOr(`web.fee.${status}`, status);
  return <Badge tone={reason === "free_pass" ? "good" : (FEE_TONES[status] ?? "plain")}>{label}</Badge>;
}
