-- 산시야 주식 메뉴: 종목(관심·보유)과 배당 기록. 본인 것만 읽고 쓸 수 있어요.
create table if not exists public.stocks (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol       text not null,
  market       text not null check (market in ('KR','US')),
  name         text not null,
  currency     text not null default 'KRW',
  watch        boolean not null default true,
  qty          numeric not null default 0 check (qty >= 0),
  avg_price    numeric not null default 0 check (avg_price >= 0),
  target_price numeric,
  memo         text not null default '',
  notes        jsonb not null default '[]'::jsonb,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists stocks_user_symbol_idx on public.stocks (user_id, symbol);

create table if not exists public.dividends (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stock_id    uuid references public.stocks(id) on delete set null,
  symbol      text not null default '',
  name        text not null default '',
  date        date not null default current_date,
  amount      numeric not null check (amount >= 0),
  currency    text not null default 'KRW',
  krw_amount  numeric,
  memo        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dividends_user_date_idx on public.dividends (user_id, date desc);

alter table public.stocks    enable row level security;
alter table public.dividends enable row level security;
revoke all on public.stocks    from anon;
revoke all on public.dividends from anon;
grant select, insert, update, delete on public.stocks    to authenticated;
grant select, insert, update, delete on public.dividends to authenticated;

drop policy if exists "stocks: own rows" on public.stocks;
create policy "stocks: own rows" on public.stocks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "dividends: own rows" on public.dividends;
create policy "dividends: own rows" on public.dividends
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
