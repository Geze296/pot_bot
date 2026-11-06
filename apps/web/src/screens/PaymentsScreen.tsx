import { request, type Payments } from "../api.js";
import { dateTime } from "../format.js";
import { text, textOr } from "../text.js";
import { ActionNotices, Card, FeeBadge, Loading, useAction, useLoad } from "../ui.js";

export function PaymentsScreen({ leagueId }: { leagueId: number }) {
  const { data, error, reload } = useLoad<Payments>(`/leagues/${leagueId}/payments`);
  const action = useAction(reload);
  if (!data) return <Loading error={error} />;

  const decide = (id: number, approve: boolean, manager: string) =>
    action.run(() => request("POST", `/leagues/${leagueId}/payments/${id}/decide`, { approve }), {
      confirm: text(approve ? "web.payments.confirmApprove" : "web.payments.confirmReject", { name: manager }),
      done: text(approve ? "web.payments.approved" : "web.payments.rejected", { name: manager }),
    });
  const mark = (memberId: number, gameweek: number, paid: boolean, manager: string) =>
    action.run(() => request("POST", `/leagues/${leagueId}/payments/mark`, { memberId, gameweek, paid }), {
      confirm: text(paid ? "web.payments.confirmMark" : "web.payments.confirmUnmark", { name: manager, gw: gameweek }),
      done: text(paid ? "web.payments.marked" : "web.payments.unmarked", { name: manager, gw: gameweek }),
    });

  return (
    <>
      <ActionNotices error={action.error} done={action.done} />

      <Card title={text("web.payments.reviewTitle", { count: data.reviews.length })}>
        {data.reviews.length === 0 && <p className="muted">{text("web.payments.noReviews")}</p>}
        {data.reviews.map((review) => (
          <article className="item" key={review.id}>
            <p className="strong">
              {review.manager} <span className="muted">· {review.team}</span>
            </p>
            <p className="muted">{text("web.dashboard.gameweek", { gw: review.gameweek })}</p>
            <p>{textOr(`review.reason.${review.reason}`, review.reason ?? "")}</p>
            <dl className="details">
              <dt>{text("web.payments.txn")}</dt>
              <dd>{review.txnId ?? text("review.unknown")}</dd>
              <dt>{text("web.payments.time")}</dt>
              <dd>{review.paidAt ? dateTime(review.paidAt, data.timezone) : text("review.unknown")}</dd>
            </dl>
            {review.hasScreenshot && (
              <button
                className="link"
                disabled={action.busy}
                onClick={() =>
                  void action.run(() => request("POST", `/leagues/${leagueId}/payments/${review.id}/screenshot`), {
                    done: text("web.payments.screenshotSent"),
                  })
                }
              >
                {text("web.payments.sendScreenshot")}
              </button>
            )}
            <div className="buttons">
              <button disabled={action.busy} onClick={() => void decide(review.id, true, review.manager)}>
                {text("review.approveButton")}
              </button>
              <button
                className="secondary"
                disabled={action.busy}
                onClick={() => void decide(review.id, false, review.manager)}
              >
                {text("review.rejectButton")}
              </button>
            </div>
          </article>
        ))}
      </Card>

      {data.gameweek && (
        <Card title={text("web.payments.feesTitle", { gw: data.gameweek.event })}>
          {data.members.map((member) => {
            const isFreePass = member.reason === "free_pass";
            return (
              <article className="item row" key={member.memberId}>
                <div>
                  <p className="strong">{member.manager}</p>
                  <p className="muted">{member.team}</p>
                </div>
                <div className="end">
                  <FeeBadge status={member.status} reason={member.reason} />
                  {member.isCollector && <span className="muted small">{text("web.payments.collector")}</span>}
                  {!isFreePass && !member.isCollector && (
                    <button
                      className="link"
                      disabled={action.busy}
                      onClick={() =>
                        void mark(member.memberId, data.gameweek!.event, member.status !== "paid", member.manager)
                      }
                    >
                      {text(member.status === "paid" ? "web.payments.undo" : "web.payments.markPaid")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </Card>
      )}
    </>
  );
}
