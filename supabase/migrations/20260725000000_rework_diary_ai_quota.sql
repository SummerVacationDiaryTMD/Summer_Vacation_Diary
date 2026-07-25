-- Reworks the diary-ai quota from one shared device budget into per-action
-- device limits, a shared IP budget, and a service-wide daily circuit breaker.
-- Accounting moves to reserve-then-refund: the Edge Function consumes before
-- calling OpenAI and gives the request back only when the failure was not the
-- user's fault.
--
-- Self-contained and idempotent: pasting this whole file into the Supabase
-- Dashboard SQL Editor works both on the live project and on a fresh one.

-- A function's identity is its name PLUS its argument type list, so
-- `create or replace` with a changed parameter list would create an overload
-- instead of replacing anything — the old function would survive with its
-- service_role grant intact, and redeploying an older index.ts would silently
-- enforce the old limits. Dropping the table does not help either: functions
-- are independent database objects. Drop every signature explicitly.
drop function if exists public.consume_diary_ai_quota(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer
);
drop function if exists public.consume_diary_ai_quota(
  text, text, text, timestamptz, timestamptz, integer, integer, integer, integer
);
drop function if exists public.refund_diary_ai_quota(
  text, text, text, timestamptz, timestamptz
);
drop function if exists public.read_diary_ai_quota(
  text, text, timestamptz, timestamptz
);

-- The table holds only counters that expire within two days, so there is
-- nothing worth preserving. Recreating is simpler and safer than rebuilding a
-- composite primary key in place.
drop table if exists public.diary_ai_rate_limits;

create table public.diary_ai_rate_limits (
  scope text not null check (scope in ('user', 'ip', 'service')),
  -- Device and IP identifiers arrive already salted and SHA-256 hashed by the
  -- Edge Function; the service scope uses the literal 'global'.
  identifier_hash text not null,
  -- Deliberately no default: a caller written before this migration must fail
  -- loudly on the not-null violation rather than quietly writing rows that no
  -- limit check will ever read.
  action text not null check (action in ('sketch', 'analyze', 'all')),
  window_kind text not null check (window_kind in ('short', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  -- 'all' is a sentinel rather than NULL because primary key columns cannot be
  -- null, and the IP counters deliberately span both actions.
  primary key (scope, identifier_hash, action, window_kind, window_start)
);

alter table public.diary_ai_rate_limits enable row level security;

-- Exactly four counter rows exist per request:
--   ('user',    hash(device), 'sketch'|'analyze', 'day',   ...)
--   ('ip',      hash(ip),     'all',              'short', ...)
--   ('ip',      hash(ip),     'all',              'day',   ...)
--   ('service', 'global',     'sketch'|'analyze', 'day',   ...)


-- Atomically checks every limit and, only if all pass, increments all four
-- counters. Limits stay in the Edge Function so they can change without a
-- migration; this function just enforces whatever it is handed.
create function public.consume_diary_ai_quota(
  p_action text,
  p_user_hash text,
  p_ip_hash text,
  p_short_window_start timestamptz,
  p_day_window_start timestamptz,
  p_user_daily_limit integer,
  p_ip_short_limit integer,
  p_ip_daily_limit integer,
  p_service_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_sketch integer;
  v_user_analyze integer;
  v_ip_short integer;
  v_ip_day integer;
  v_service_sketch integer;
  v_service_analyze integer;
  v_user_current integer;
  v_service_current integer;
  v_decision text := 'allowed';
begin
  if p_action not in ('sketch', 'analyze') then
    raise exception 'action must be sketch or analyze, got %', p_action;
  end if;
  if p_user_hash = '' or p_ip_hash = '' then
    raise exception 'identifier hashes must not be empty';
  end if;

  -- Fixed lock order for every caller: user, then ip, then the per-action
  -- service key. Each transaction takes at most one lock per class in this
  -- order, so no cycle can form. These locks are what makes the check below
  -- and the increment further down a single indivisible step — without them
  -- concurrent requests would all read the same pre-increment count and pass.
  perform pg_advisory_xact_lock(
    hashtextextended('diary-ai:user:' || p_user_hash, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('diary-ai:ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('diary-ai:service:' || p_action, 0));

  select
    coalesce(max(request_count) filter (
      where scope = 'user' and identifier_hash = p_user_hash
        and action = 'sketch' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'user' and identifier_hash = p_user_hash
        and action = 'analyze' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'ip' and identifier_hash = p_ip_hash
        and action = 'all' and window_kind = 'short'
        and window_start = p_short_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'ip' and identifier_hash = p_ip_hash
        and action = 'all' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'service' and identifier_hash = 'global'
        and action = 'sketch' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'service' and identifier_hash = 'global'
        and action = 'analyze' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0)
  into
    v_user_sketch, v_user_analyze, v_ip_short, v_ip_day,
    v_service_sketch, v_service_analyze
  from public.diary_ai_rate_limits
  where (scope = 'user' and identifier_hash = p_user_hash)
     or (scope = 'ip' and identifier_hash = p_ip_hash)
     or (scope = 'service' and identifier_hash = 'global');

  if p_action = 'sketch' then
    v_user_current := v_user_sketch;
    v_service_current := v_service_sketch;
  else
    v_user_current := v_user_analyze;
    v_service_current := v_service_analyze;
  end if;

  -- Order is deliberate and must stay stable: the user's own budget first
  -- (the only one they can act on), then shared-IP abuse signals, then the
  -- service-wide breaker last so it only ever fires as a genuine last resort.
  if v_user_current >= p_user_daily_limit then
    v_decision := 'device-daily';
  elsif v_ip_short >= p_ip_short_limit then
    v_decision := 'ip-short';
  elsif v_ip_day >= p_ip_daily_limit then
    v_decision := 'ip-daily';
  elsif v_service_current >= p_service_daily_limit then
    v_decision := 'service-daily';
  end if;

  if v_decision = 'allowed' then
    insert into public.diary_ai_rate_limits (
      scope, identifier_hash, action, window_kind, window_start, request_count
    ) values
      ('user', p_user_hash, p_action, 'day', p_day_window_start, 1),
      ('ip', p_ip_hash, 'all', 'short', p_short_window_start, 1),
      ('ip', p_ip_hash, 'all', 'day', p_day_window_start, 1),
      ('service', 'global', p_action, 'day', p_day_window_start, 1)
    on conflict (scope, identifier_hash, action, window_kind, window_start)
    do update set
      request_count = diary_ai_rate_limits.request_count + 1,
      updated_at = now();

    -- Mirror the increment into the returned snapshot so the caller can render
    -- post-request numbers without a second round trip.
    if p_action = 'sketch' then
      v_user_sketch := v_user_sketch + 1;
      v_service_sketch := v_service_sketch + 1;
    else
      v_user_analyze := v_user_analyze + 1;
      v_service_analyze := v_service_analyze + 1;
    end if;
    v_ip_short := v_ip_short + 1;
    v_ip_day := v_ip_day + 1;

    -- Only rows this transaction already holds a lock for are touched, keeping
    -- the common path cheap while bounding history per visitor. The service
    -- rows are filtered to p_action on purpose: deleting the other action's
    -- global rows would take row locks outside this transaction's advisory
    -- lock and could deadlock against a concurrent request for that action.
    delete from public.diary_ai_rate_limits
    where updated_at < now() - interval '2 days'
      and ((scope = 'user' and identifier_hash = p_user_hash)
        or (scope = 'ip' and identifier_hash = p_ip_hash)
        or (scope = 'service' and identifier_hash = 'global'
            and action = p_action));
  end if;

  return jsonb_build_object(
    'decision', v_decision,
    'userSketch', v_user_sketch,
    'userAnalyze', v_user_analyze,
    'ipShort', v_ip_short,
    'ipDay', v_ip_day,
    'serviceSketch', v_service_sketch,
    'serviceAnalyze', v_service_analyze
  );
end;
$$;


-- Read-only snapshot for the quota-status action. Creates no rows and takes no
-- locks, so it can be called on every app start without touching the hot path.
-- Defined before refund because refund reuses it to build its return value.
create function public.read_diary_ai_quota(
  p_user_hash text,
  p_ip_hash text,
  p_short_window_start timestamptz,
  p_day_window_start timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- Aggregates with no GROUP BY always return exactly one row, so a device
  -- that has never made a request still gets a full snapshot of zeroes.
  select jsonb_build_object(
    'userSketch', coalesce(max(request_count) filter (
      where scope = 'user' and identifier_hash = p_user_hash
        and action = 'sketch' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    'userAnalyze', coalesce(max(request_count) filter (
      where scope = 'user' and identifier_hash = p_user_hash
        and action = 'analyze' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    'ipShort', coalesce(max(request_count) filter (
      where scope = 'ip' and identifier_hash = p_ip_hash
        and action = 'all' and window_kind = 'short'
        and window_start = p_short_window_start
    ), 0),
    'ipDay', coalesce(max(request_count) filter (
      where scope = 'ip' and identifier_hash = p_ip_hash
        and action = 'all' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    'serviceSketch', coalesce(max(request_count) filter (
      where scope = 'service' and identifier_hash = 'global'
        and action = 'sketch' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    'serviceAnalyze', coalesce(max(request_count) filter (
      where scope = 'service' and identifier_hash = 'global'
        and action = 'analyze' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0)
  )
  from public.diary_ai_rate_limits
  where (scope = 'user' and identifier_hash = p_user_hash)
     or (scope = 'ip' and identifier_hash = p_ip_hash)
     or (scope = 'service' and identifier_hash = 'global');
$$;


-- Gives back one previously consumed request. The window boundaries are passed
-- back in rather than recomputed: a request consumed at 23:59 UTC that fails at
-- 00:01 must decrement yesterday's row (a harmless no-op, since that budget has
-- already reset) instead of handing back a free credit for today.
create function public.refund_diary_ai_quota(
  p_action text,
  p_user_hash text,
  p_ip_hash text,
  p_short_window_start timestamptz,
  p_day_window_start timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  if p_action not in ('sketch', 'analyze') then
    raise exception 'action must be sketch or analyze, got %', p_action;
  end if;

  -- No advisory lock here on purpose. Unlike consume this is a pure conditional
  -- decrement with no check-then-act, so row locks are sufficient, and keeping
  -- refunds off the shared service lock halves contention on it. The four
  -- updates run in the same order consume inserts its four rows, so a refund
  -- can never deadlock against a concurrent consume or another refund.
  --
  -- greatest(..., 0) is required, not defensive: `check (request_count >= 0)`
  -- would abort the whole transaction on an already-zero row, which would turn
  -- the original API error into a 500 and hide it from the client.
  update public.diary_ai_rate_limits
  set request_count = greatest(request_count - 1, 0), updated_at = now()
  where scope = 'user' and identifier_hash = p_user_hash
    and action = p_action and window_kind = 'day'
    and window_start = p_day_window_start;

  update public.diary_ai_rate_limits
  set request_count = greatest(request_count - 1, 0), updated_at = now()
  where scope = 'ip' and identifier_hash = p_ip_hash
    and action = 'all' and window_kind = 'short'
    and window_start = p_short_window_start;

  update public.diary_ai_rate_limits
  set request_count = greatest(request_count - 1, 0), updated_at = now()
  where scope = 'ip' and identifier_hash = p_ip_hash
    and action = 'all' and window_kind = 'day'
    and window_start = p_day_window_start;

  update public.diary_ai_rate_limits
  set request_count = greatest(request_count - 1, 0), updated_at = now()
  where scope = 'service' and identifier_hash = 'global'
    and action = p_action and window_kind = 'day'
    and window_start = p_day_window_start;

  select public.read_diary_ai_quota(
    p_user_hash, p_ip_hash, p_short_window_start, p_day_window_start
  ) into v_snapshot;

  return v_snapshot;
end;
$$;


-- Privileges are never inherited from a dropped function, and a newly created
-- function defaults to PUBLIC EXECUTE — so each one needs its own revoke.
revoke all on function public.consume_diary_ai_quota(
  text, text, text, timestamptz, timestamptz, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.consume_diary_ai_quota(
  text, text, text, timestamptz, timestamptz, integer, integer, integer, integer
) to service_role;

revoke all on function public.refund_diary_ai_quota(
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.refund_diary_ai_quota(
  text, text, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.read_diary_ai_quota(
  text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.read_diary_ai_quota(
  text, text, timestamptz, timestamptz
) to service_role;

-- Verify after pasting:
--   select proname, pronargs from pg_proc where proname like '%diary_ai_quota%';
-- Expect exactly three rows (consume 9, refund 5, read 4). A fourth row means
-- an old overload survived and must be dropped by its exact signature.
