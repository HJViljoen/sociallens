-- Correction to 20260820170000, same day.
--
-- `revoke select (token) on invitations from authenticated` was a NO-OP:
-- `authenticated` holds a TABLE-level SELECT grant, and Postgres cannot carve a
-- single column out of one. Verified after applying that migration that the
-- token was still readable — the fix had to be checked, not assumed, because a
-- silent no-op looks exactly like a successful revoke.
--
-- (The UPDATE revokes in 20260820120000 and 20260820150000 did bite, because
-- those revoke the whole privilege first and then grant back a column list.
-- Same pattern applied here.)
--
-- Why it matters: the not-signed-in invite-accept path creates the account for
-- the invited address with a caller-chosen password, so a readable OWNER token
-- is an admin-to-owner takeover needing no access to the invited mailbox.
-- Nothing in the app reads token through the session client: the Team page
-- reads it through the service role scoped to the invites you sent, and both
-- inviteMember (INSERT) and revokeInvitation (UPDATE status) are unaffected.
revoke select on public.invitations from authenticated;
grant select (id, client_id, email, role, invited_by, status, created_at, expires_at, accepted_at)
  on public.invitations to authenticated;
