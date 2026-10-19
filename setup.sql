-- 산시야 Supabase 설정
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 안전해요.

-- 1) 기록 테이블
create table if not exists public.entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null default 'scrap' check (type in ('scrap','taste')),
  cat         text not null default 'ETC',
  seq         integer not null default 0,
  title       text not null,
  date        date not null default current_date,
  url         text not null default '',
  body        text not null default '',
  tags        text[] not null default '{}',
  rating      smallint not null default 0 check (rating between 0 and 5),
  status      text not null default '',
  photos      text[] not null default '{}',
  example     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists entries_user_date_idx on public.entries (user_id, date desc);

-- 2) 설정 테이블 (분야 목록)
create table if not exists public.settings (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  categories  jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 3) 본인 기록만 읽고 쓰기 (Row Level Security)
alter table public.entries  enable row level security;
alter table public.settings enable row level security;

revoke all on public.entries  from anon;
revoke all on public.settings from anon;
grant select, insert, update, delete on public.entries  to authenticated;
grant select, insert, update, delete on public.settings to authenticated;

drop policy if exists "entries: own rows" on public.entries;
create policy "entries: own rows" on public.entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "settings: own row" on public.settings;
create policy "settings: own row" on public.settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4) 사진 저장 공간 (비공개, 사진 한 장 20MB까지)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 사진은 photos/<내 사용자 ID>/파일 경로에만 올리고, 본인 것만 볼 수 있어요.
drop policy if exists "photos: read own"   on storage.objects;
drop policy if exists "photos: upload own" on storage.objects;
drop policy if exists "photos: update own" on storage.objects;
drop policy if exists "photos: delete own" on storage.objects;

create policy "photos: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "photos: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "photos: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
