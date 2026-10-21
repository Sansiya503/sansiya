-- 산시야 사진 앨범과 북마크. 본인 것만 읽고 쓸 수 있어요.
-- 사진 파일은 기존 photos 저장소(Storage)에 "<내 아이디>/…" 경로로 올라가고, 여기엔 경로·날짜·설명만 저장해요.
create table if not exists public.photos (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path        text not null,
  thumb       text not null default '',
  date        date not null default current_date,
  caption     text not null default '',
  width       integer,
  height      integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists photos_user_date_idx on public.photos (user_id, date desc);

-- kind = 'link'  : 웹 링크 (url, title, memo, tags)
-- kind = 'entry' | 'stock' | 'photo' : 앱 안 즐겨찾기 (ref = 기록·종목·사진의 id)
create table if not exists public.bookmarks (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'link' check (kind in ('link','entry','stock','photo')),
  ref         text not null default '',
  url         text not null default '',
  title       text not null default '',
  memo        text not null default '',
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

alter table public.photos    enable row level security;
alter table public.bookmarks enable row level security;
revoke all on public.photos    from anon;
revoke all on public.bookmarks from anon;
grant select, insert, update, delete on public.photos    to authenticated;
grant select, insert, update, delete on public.bookmarks to authenticated;

drop policy if exists "photos: own rows" on public.photos;
create policy "photos: own rows" on public.photos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "bookmarks: own rows" on public.bookmarks;
create policy "bookmarks: own rows" on public.bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 사진 주제 (여행·음식·디자인·건축·조경·인테리어). 한 사진에 여러 개를 붙일 수 있어요.
alter table public.photos add column if not exists topics text[] not null default '{}';
