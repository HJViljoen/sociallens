-- Verbatim Agent (2026-08-22). A client arrives with a question, or with a
-- document from their own work, and gets an answer built from what their
-- customers actually said — answer first, proof attached, and an honest
-- "we don't have this" when the corpus cannot speak.
--
-- Three things here, all ADDITIVE. Safe to apply BEFORE the code deploy: every
-- object is new except `audience_insights.embedding`, which is a nullable
-- column no existing code reads or writes.
--
-- 1. pgvector, and an embedding on the insight population.
--    Retrieval today reaches only `themes` (~334 one-line headers per run),
--    compared by a hand-rolled cosine in Node over a jsonb column. Answering a
--    client's question off 334 headers repeats the "synthesis on headers"
--    defect the August cold review found in Pass C/D — and clients do not ask
--    in theme labels ("should we run a Black Friday promo" matches none of
--    them lexically). So retrieval drops one level, to the ~1,351 insights the
--    pipeline already extracted and verified.
--    Why a real vector type and not another jsonb: the Node path already parses
--    ~4 MB per Ask request for 334 themes; the insight population roughly
--    triples that, and the raw comment corpus (~18,440 rows) is flatly
--    impossible that way. This is the first use of pgvector in this product.
--
--    OPERATIONAL CONSEQUENCE, deliberate: the pipeline is NOT touched by this
--    change (the 2026-08-23 Össur run must stay a single-variable proof), so
--    nothing populates this column automatically. Insights created by a later
--    run land with embedding IS NULL until `scripts/embed-insights.ts` is run
--    again. The script is idempotent and skips rows already embedded. Folding
--    the embed into Pass A is the follow-up once the run has landed.
--
-- 2. `agent_threads` — a conversation or a document check, with its own URL.
--    A stored answer is an artefact somebody takes into a meeting, not a widget
--    on a page, so it is addressable.
--
-- 3. `agent_messages` — the turns. THE QUESTION LOG IS THIS TABLE WHERE
--    role = 'user'. There is no separate log: a question and the turn it
--    belongs to are the same fact, and duplicating it would let the two drift.
--    Every question asked is a demand signal — what clients want to know, in
--    their own words. Silent answers rank what the pipeline should extract
--    next; answered ones rank what to lead with.
--
-- THE INVARIANT — access is not authority. The agent may read every layer, from
-- raw comments up to the executive brief, but what it may DO with each differs:
--   quoting a raw comment            = citation, always allowed
--   concluding a pattern from raw    = JUDGEMENT, never evidence
--   text the pipeline never extracted
-- Enforced in code (lib/agent/enforce.ts), not in a prompt: a grounded point
-- must carry live insight ids or it is demoted to judgement — demoted, never
-- dropped, because over-restriction shows up as false silence and that is the
-- worse failure.
--
-- No quote TEXT is stored (same rule as consumer_profiles and plan_checks):
-- answers carry the ids they were grounded in and voices resolve live, so an
-- erased comment cannot survive inside a stored answer. `content` holds the
-- client's OWN words (their question) and the agent's own prose.
--
-- CORRECTION (2026-08-22, same day): for the first few hours this was FALSE of
-- the code that wrote to the table. The route stored GroundedPoint whole, and
-- GroundedPoint.quotes carried `text` — 78 real comment verbatims reached
-- production, invisible to erase-commenter, under a comment saying they could
-- not. A fresh-eyes review found it. The route now strips quote text before the
-- write, the reader resolves the words through insight_evidence, and those 78
-- were scrubbed out of the existing rows.

create extension if not exists vector;

-- ------------------------------------------------------------- retrieval ----

alter table public.audience_insights
  add column if not exists embedding vector(1536);

comment on column public.audience_insights.embedding is
  'text-embedding-3-small over "theme — description". Populated by scripts/embed-insights.ts, NOT by the pipeline — rows from a later run are NULL until that script is re-run. Used for insight-level retrieval by the Verbatim Agent.';

-- Partial index: only embedded rows are searchable, and the population turns
-- over as videos are re-analysed, so indexing the NULLs would be dead weight.
create index if not exists audience_insights_embedding_idx
  on public.audience_insights using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- THE VIEW MUST BE REPLACED, and this is not optional.
--
-- audience_insights_current is defined as `select ai.*`, and Postgres expands
-- `*` ONCE, at view-creation time — the view's column list was frozen on
-- 2026-08-18 and adding a column to the base table does not reach it. Without
-- this, match_insights() below fails to create ("column ai.embedding does not
-- exist") and scripts/embed-insights.ts fails the same way, because both read
-- the population through the view as AGENTS.md requires.
--
-- Safe as a REPLACE: create or replace view may only APPEND columns, and
-- `embedding` is the newest column on the base table, so every pre-existing
-- column keeps its name, type and position. Verified before writing this that
-- nothing was added to audience_insights between the view's creation and now,
-- so exactly one column is appended.
--
-- Nothing starts pulling vectors by accident: every reader of this view in the
-- codebase (pass-e, step-a2, engage, the prune counter) selects an explicit
-- column list, and none of them names `embedding`. That was checked, not
-- assumed — a `select('*')` reader would have started dragging 1,536 floats per
-- row into Node the moment the backfill ran.
--
-- security_invoker is restated because a replace does not inherit it.
create or replace view public.audience_insights_current
  with (security_invoker = true) as
  select ai.*
  from public.audience_insights ai
  join public.videos v on v.id = ai.source_video_id and ai.run_id = v.analyzed_run_id;

-- Similarity search lives in SQL because the PostgREST client cannot express
-- `<=>`, and because pulling the population into Node to compare it there is
-- the very thing this migration exists to stop.
--
-- Reads audience_insights_current, not the base table: the population question
-- is "what does this corpus say NOW", and the base table still holds rows a
-- later run superseded but prune-stale-analysis has not yet removed. Id-set
-- lookups elsewhere deliberately stay on the base table (AGENTS.md).
--
-- SECURITY INVOKER (the default, stated here because it matters): p_client_id
-- is an argument, so if this were ever reachable by a session client it must
-- not be the only thing standing between two tenants. In practice it is called
-- with the service role from a route handler that resolves the tenant from the
-- session and never from the request body.
create or replace function public.match_insights(
  p_client_id uuid,
  p_query vector(1536),
  p_limit int default 40,
  p_floor float default 0.35
)
returns table (id uuid, similarity float)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select ai.id, (1 - (ai.embedding <=> p_query))::float as similarity
  from public.audience_insights_current ai
  where ai.client_id = p_client_id
    and ai.embedding is not null
    and (1 - (ai.embedding <=> p_query)) >= p_floor
  order by ai.embedding <=> p_query
  limit greatest(p_limit, 0)
$function$;

comment on function public.match_insights is
  'Insight-level semantic retrieval for the Verbatim Agent. Cosine similarity over audience_insights_current. p_floor mirrors CITATION_RELEVANCE_FLOOR — raising it trades recall for precision, and the failure mode of raising it too far is FALSE SILENCE, which is worse than a weak match the register system would have labelled anyway.';

-- --------------------------------------------------------------- threads ----

create table if not exists public.agent_threads (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null,
  -- Generated from the first question; nullable so a thread can exist before
  -- it has been named.
  title text,
  -- A document thread wraps an existing plan_check rather than re-implementing
  -- it — document mode is the engine that already ships. Null for questions.
  plan_check_id uuid references public.plan_checks(id) on delete set null,
  -- auth.users id of the opener. No FK: a thread outlives a team member.
  created_by uuid,
  created_at timestamptz default now() not null,
  constraint agent_threads_kind_check check (kind in ('question', 'document'))
);

create index if not exists agent_threads_client_created_idx
  on public.agent_threads using btree (client_id, created_at desc);

-- -------------------------------------------------------------- messages ----

create table if not exists public.agent_messages (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  -- Denormalised deliberately. insight_evidence is the one table in the
  -- retrieval chain WITHOUT a client_id, and every read of it needs a join to
  -- prove tenancy. A table holding client-authored text does not repeat that.
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Which corpus answered. Nullable so a turn outlives its run.
  run_id uuid references public.pipeline_runs(id) on delete set null,
  role text not null,
  -- role='user': the client's question, verbatim — this is the demand signal.
  -- role='agent': the answer prose. Neither ever holds a third party's words;
  -- quotes live in `result` as ids and resolve at render time.
  content text not null,
  result jsonb,
  outcome text,
  cost_usd numeric(10, 6),
  created_at timestamptz default now() not null,
  constraint agent_messages_role_check check (role in ('user', 'agent')),
  constraint agent_messages_outcome_check
    check (outcome is null or outcome in ('answered', 'partial', 'silent'))
);

create index if not exists agent_messages_thread_created_idx
  on public.agent_messages using btree (thread_id, created_at);
-- The demand-signal query: every question this tenant ever asked, newest first.
create index if not exists agent_messages_client_role_created_idx
  on public.agent_messages using btree (client_id, role, created_at desc);

comment on column public.agent_messages.result is
  'AgentAnswer for role=''agent'': { answer, grounded[], judgement[], silent, nearest[] }. grounded[] carries insightIds + comment ids ONLY — never quote text (this was briefly untrue in the writing code on 2026-08-22 and was corrected; the reader resolves quote text live through insight_evidence, so an erased comment stops resolving everywhere at once). judgement[] carries basedOn refs into grounded[]. The two are separate keys, not a flag on one list, so a careless render cannot merge them.';
comment on column public.agent_messages.outcome is
  'answered | partial | silent. ''silent'' is a FIRST-CLASS result, not a failure — and the ranked list of silent questions is the roadmap for what the pipeline should extract next.';
comment on column public.agent_messages.content is
  'role=''user'': the question as the client typed it. role=''agent'': the agent''s own prose. Never a third party''s words.';

-- ------------------------------------------------------------------- RLS ----
-- Tenant reads its own; writes are service-role behind an authenticated route,
-- as everywhere else in this product. Note the deliberate asymmetry the app
-- adds on top: every member of the tenant can SEE the agent and its threads,
-- but only a platform admin may SEND — enforced in the route handler, because
-- a select policy is the wrong place for a write rule.

alter table public.agent_threads enable row level security;
drop policy if exists "Users see their own agent_threads" on public.agent_threads;
create policy "Users see their own agent_threads" on public.agent_threads
  for select using (client_id = get_my_client_id());

alter table public.agent_messages enable row level security;
drop policy if exists "Users see their own agent_messages" on public.agent_messages;
create policy "Users see their own agent_messages" on public.agent_messages
  for select using (client_id = get_my_client_id());

-- Post-apply check (run by hand):
--   select extname from pg_extension where extname = 'vector';          -- vector
--   -- the view must now expose the column, or match_insights is dead:
--   select column_name from information_schema.columns
--    where table_name = 'audience_insights_current' and column_name = 'embedding';
--   -- and the function must exist:
--   select proname from pg_proc where proname = 'match_insights';
--   select count(*) from public.agent_threads;                          -- 0
--   select count(*) from public.agent_messages;                         -- 0
--   select count(*) from public.audience_insights where embedding is not null;  -- 0 until the backfill
--   select tablename, policyname from pg_policies
--    where tablename in ('agent_threads', 'agent_messages');
