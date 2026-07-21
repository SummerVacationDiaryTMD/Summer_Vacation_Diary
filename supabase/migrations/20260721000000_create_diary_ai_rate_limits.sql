create table if not exists public.diary_ai_rate_limits (
  scope text not null check (scope in ('user', 'ip')),
  identifier_hash text not null,
  window_kind text not null check (window_kind in ('short', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash, window_kind, window_start)
);

alter table public.diary_ai_rate_limits enable row level security;

-- Atomically checks all four limits before incrementing any counter. Advisory
-- locks serialize requests for the same identifiers, so parallel calls cannot
-- slip through between the check and update.
create or replace function public.consume_diary_ai_quota(
  p_user_hash text,
  p_ip_hash text,
  p_short_window_start timestamptz,
  p_day_window_start timestamptz,
  p_user_short_limit integer,
  p_ip_short_limit integer,
  p_user_daily_limit integer,
  p_ip_daily_limit integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_short integer;
  v_ip_short integer;
  v_user_daily integer;
  v_ip_daily integer;
begin
  if p_user_hash = '' or p_ip_hash = '' then
    raise exception 'identifier hashes must not be empty';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('user:' || p_user_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('ip:' || p_ip_hash, 0));

  select
    coalesce(max(request_count) filter (
      where scope = 'user' and window_kind = 'short'
        and window_start = p_short_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'ip' and window_kind = 'short'
        and window_start = p_short_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'user' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0),
    coalesce(max(request_count) filter (
      where scope = 'ip' and window_kind = 'day'
        and window_start = p_day_window_start
    ), 0)
  into v_user_short, v_ip_short, v_user_daily, v_ip_daily
  from public.diary_ai_rate_limits
  where (scope = 'user' and identifier_hash = p_user_hash)
     or (scope = 'ip' and identifier_hash = p_ip_hash);

  if v_user_short >= p_user_short_limit then return 'user-short'; end if;
  if v_ip_short >= p_ip_short_limit then return 'ip-short'; end if;
  if v_user_daily >= p_user_daily_limit then return 'user-daily'; end if;
  if v_ip_daily >= p_ip_daily_limit then return 'ip-daily'; end if;

  insert into public.diary_ai_rate_limits (
    scope, identifier_hash, window_kind, window_start, request_count
  ) values
    ('user', p_user_hash, 'short', p_short_window_start, 1),
    ('ip', p_ip_hash, 'short', p_short_window_start, 1),
    ('user', p_user_hash, 'day', p_day_window_start, 1),
    ('ip', p_ip_hash, 'day', p_day_window_start, 1)
  on conflict (scope, identifier_hash, window_kind, window_start)
  do update set
    request_count = diary_ai_rate_limits.request_count + 1,
    updated_at = now();

  -- Only old rows for the two active identifiers are touched, keeping normal
  -- requests cheap while preventing unlimited historical rows per visitor.
  delete from public.diary_ai_rate_limits
  where updated_at < now() - interval '2 days'
    and ((scope = 'user' and identifier_hash = p_user_hash)
      or (scope = 'ip' and identifier_hash = p_ip_hash));

  return 'allowed';
end;
$$;

revoke all on function public.consume_diary_ai_quota(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.consume_diary_ai_quota(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer
) to service_role;
