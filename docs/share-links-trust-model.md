# Share links — trust model (Reports & Exports Stage 2, 2026-08-30)

For the LIA and for whoever changes `/r/<token>` next.

**What a link is.** `verbatimintel.com/r/<token>` → the app host. A read-only
page, no account, rendered from ONE `report_snapshots` row of kind `report`
(a build of a Studio report). The page's only reads: the `share_links` row by
token, the snapshot row, and the quote texts the snapshot's refs resolve to
(`insight_evidence`, `comments` for a comment as posted, `language_samples`
for a customer phrase, `run_summary.brand_voice` for a creator's words about
the brand, and the hero-quote columns — every one by an id the snapshot
holds). No tenant table is
read live; a viewer cannot reach a page, a tile, a loader or a model.

**Who can open it.** Anyone holding the link (Heinrich's default, re-confirmed
2026-08-29): the alternative — account-gated viewing — removes the reason a
link exists. Mitigations, in the order they act:
1. **Token**: 32 random bytes, base64url (43 chars, no dot). Unguessable;
   never listed anywhere a viewer can see. Withheld from the workspace's own
   RLS reads (`grant select (…)` without `token`) so a teammate cannot lift a
   colleague's link from the database; the Reports page shows links through
   the service role, server-side, scoped to the tenant.
2. **Expiry**: 30 days by default (7 / 30 / 90 / none offered). Expired →
   "This link has expired".
3. **Revoke**: one click on the Reports page; the next open says
   "This link was withdrawn".
4. **Password** (optional): scrypt (`node:crypto`, salt:hash). A correct
   password sets an HttpOnly, SameSite=Lax cookie scoped to that link's path,
   holding a signature over the link id + password hash (never the password);
   changing the password or `RENDER_TOKEN_SECRET` invalidates every cookie.
   No attempt limiter yet — nothing in the product rate-limits; noted for the
   self-serve motion.
5. **noindex**: `metadata.robots` on the page and `X-Robots-Tag: noindex,
   nofollow, noarchive` on `/r/*`.

**What is logged.** One `share_views` row per open: time, a keyed hash of the
address (16 chars, not reversible), the user agent truncated to 160 chars.
The link carries a count and a last-viewed time. Nothing names a viewer.

**Third parties' words.** The snapshot stores refs, never quote text, so an
erased comment stops resolving on the next open — a link is *better* than a
PDF here (a downloaded file is out of reach, as the LIA already says). The
cover prose is model-written from figures and the executive brief's validated
prose; no comment text reaches the cover prompt (`lib/reports/cover-model.ts`).
The operator's framing lines are the operator's own words.

**Branding.** Client-led: "Prepared by {company} · for {audience}" leads;
"with Verbatim" is the provenance line and the one link at the foot.

**Known limits.** Links travel (any holder can forward one); the page says
so on the Reports page before a link is made. No per-viewer identity, by
design. Deleting a snapshot cascades its links; deleting a report keeps its
builds and links working.
