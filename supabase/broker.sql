-- 산시야 · 토스증권 보유 종목 연동 (조회 전용)
-- 컴퓨터의 연결 프로그램이 토스에서 읽은 보유 종목을 broker_sync() 로 보내면
-- 내 주식(stocks)의 수량·평균 단가를 맞춰요. 토스 키는 여기로 오지 않아요.
-- 연결 코드(앱 설정에서 만든 값)의 SHA-256 해시만 저장해요.

alter table public.stocks add column if not exists broker text;
alter table public.stocks add column if not exists broker_synced_at timestamptz;

create table if not exists public.broker_links (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  broker         text not null default 'toss',
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  last_sync_at   timestamptz,
  last_status    text,
  last_error     text,
  last_ip        text,
  holdings_count integer,
  account_tail   text
);
alter table public.broker_links enable row level security;
revoke all on public.broker_links from anon;
grant select, insert, update, delete on public.broker_links to authenticated;
drop policy if exists "broker_links: own row" on public.broker_links;
create policy "broker_links: own row" on public.broker_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- p_payload:
--   { "status": "ok", "account": "1234",
--     "holdings": [ { "symbol": "TSLA", "name": "테슬라", "country": "US", "exchange": "NASDAQ",
--                     "currency": "USD", "quantity": "3.5", "avgPrice": "251.2" }, ... ] }
--   or { "status": "error", "error": "ip-not-allowed", "ip": "1.2.3.4" }
create or replace function public.broker_sync(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid;
  v_now     timestamptz := now();
  v_status  text := coalesce(p_payload->>'status', 'ok');
  v_items   jsonb := coalesce(p_payload->'holdings', '[]'::jsonb);
  v_seen    text[] := '{}';
  v_sort    integer;
  v_added   integer := 0;
  v_updated integer := 0;
  v_cleared integer := 0;
  h         jsonb;
  v_sym     text;
  v_code    text;
  v_country text;
  v_qty     numeric;
  v_avg     numeric;
  r         record;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    raise exception 'invalid link' using errcode = '28000';
  end if;
  select user_id into v_uid from broker_links
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_uid is null then
    raise exception 'invalid link' using errcode = '28000';
  end if;

  if v_status <> 'ok' then
    update broker_links
       set last_status = 'error',
           last_error  = left(coalesce(p_payload->>'error', 'unknown'), 300),
           last_ip     = left(p_payload->>'ip', 64),
           last_sync_at = v_now
     where user_id = v_uid;
    return jsonb_build_object('ok', true, 'recorded', 'error');
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 500 then
    raise exception 'bad holdings' using errcode = '22023';
  end if;

  select coalesce(max(sort), 0) into v_sort from stocks where user_id = v_uid;

  for h in select * from jsonb_array_elements(v_items) loop
    v_code    := upper(trim(coalesce(h->>'symbol', '')));
    v_country := upper(coalesce(h->>'country', ''));
    continue when v_code !~ '^[A-Z0-9.\-]{1,15}$' or v_country not in ('KR', 'US');
    v_qty := nullif(h->>'quantity', '')::numeric;
    v_avg := coalesce(nullif(h->>'avgPrice', '')::numeric, 0);
    continue when v_qty is null or v_qty <= 0;
    -- app symbols follow Yahoo Finance: 005930.KS / 035720.KQ / BRK-B
    v_sym := case when v_country = 'KR'
                  then v_code || case when upper(coalesce(h->>'exchange', '')) = 'KOSDAQ' then '.KQ' else '.KS' end
                  else replace(v_code, '.', '-') end;
    -- a KR stock we already track under the other suffix keeps its symbol
    if v_country = 'KR' then
      select symbol into r from stocks where user_id = v_uid and symbol in (v_code || '.KS', v_code || '.KQ') limit 1;
      if found then v_sym := r.symbol; end if;
    end if;
    v_seen := v_seen || v_sym;

    update stocks
       set qty = v_qty, avg_price = greatest(v_avg, 0), broker = 'toss', broker_synced_at = v_now, updated_at = v_now
     where user_id = v_uid and symbol = v_sym;
    if found then
      v_updated := v_updated + 1;
    else
      v_sort := v_sort + 1;
      insert into stocks (id, user_id, symbol, market, name, currency, watch, qty, avg_price, memo, notes, sort,
                          broker, broker_synced_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid, v_sym, v_country,
              left(coalesce(nullif(trim(h->>'name'), ''), v_code), 100),
              case when upper(coalesce(h->>'currency', '')) in ('KRW', 'USD') then upper(h->>'currency')
                   when v_country = 'KR' then 'KRW' else 'USD' end,
              false, v_qty, greatest(v_avg, 0), '', '[]'::jsonb, v_sort, 'toss', v_now, v_now, v_now);
      v_added := v_added + 1;
    end if;
  end loop;

  -- sold out at Toss: keep the stock if it is watched or has notes, otherwise remove it
  for r in select id, watch, memo, notes from stocks
            where user_id = v_uid and broker = 'toss' and not (symbol = any (v_seen)) loop
    if r.watch or coalesce(r.memo, '') <> '' or jsonb_array_length(coalesce(r.notes, '[]'::jsonb)) > 0 then
      update stocks set qty = 0, avg_price = 0, broker = null, broker_synced_at = v_now, updated_at = v_now where id = r.id;
    else
      delete from stocks where id = r.id;
    end if;
    v_cleared := v_cleared + 1;
  end loop;

  update broker_links
     set last_status = 'ok', last_error = null, last_ip = left(p_payload->>'ip', 64), last_sync_at = v_now,
         holdings_count = coalesce(array_length(v_seen, 1), 0),
         account_tail = left(p_payload->>'account', 8)
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'added', v_added, 'updated', v_updated, 'cleared', v_cleared,
                            'holdings', coalesce(array_length(v_seen, 1), 0));
end;
$$;

revoke all on function public.broker_sync(text, jsonb) from public;
grant execute on function public.broker_sync(text, jsonb) to anon, authenticated;
