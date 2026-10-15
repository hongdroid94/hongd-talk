-- 홍드 TALK — AI 캐릭터 채팅 스키마
--
-- characters  : AI 인물. persona 가 Gemini 로 넘어가는 시스템 프롬프트다.
-- chat_rooms  : (사용자 × 캐릭터) 1개. 홈에서 인물을 누르면 없을 때만 생긴다.
-- messages    : 대화 기록. Gemini 에 직전 맥락으로 다시 넣는다.
--
-- persona/greeting 은 공개 데이터가 아니다. 클라이언트에 내려가면 프롬프트가
-- 그대로 노출되므로 characters 의 select 는 공개 컬럼만 보는 뷰로 막는다.

create extension if not exists pgcrypto;

-- ── characters ──────────────────────────────────────────────────────────
create table public.characters (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  avatar      text not null,          -- 프론트 assets/ 경로
  tagline     text not null,          -- 홈·목록에 쓰는 한 줄 소개
  persona     text not null,          -- Gemini system instruction
  greeting    text not null,          -- 방 생성 시 넣는 첫 인사 메시지(원문)
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.characters enable row level security;

-- 캐릭터 목록은 로그인한 사용자만 읽는다. persona/greeting 은 아래 뷰에서 제외된다.
create view public.characters_public
with (security_invoker = true) as
  select id, slug, name, avatar, tagline, sort_order
  from public.characters;

create policy "characters readable by authenticated"
  on public.characters for select
  to authenticated
  using (true);

-- ── chat_rooms ──────────────────────────────────────────────────────────
create table public.chat_rooms (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  character_id    uuid not null references public.characters(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_id, character_id)
);

create index chat_rooms_user_recent_idx
  on public.chat_rooms (user_id, last_message_at desc);

alter table public.chat_rooms enable row level security;

create policy "own rooms readable"  on public.chat_rooms for select
  to authenticated using (auth.uid() = user_id);
create policy "own rooms insertable" on public.chat_rooms for insert
  to authenticated with check (auth.uid() = user_id);
create policy "own rooms deletable" on public.chat_rooms for delete
  to authenticated using (auth.uid() = user_id);

-- ── messages ────────────────────────────────────────────────────────────
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index messages_room_time_idx on public.messages (room_id, created_at);

alter table public.messages enable row level security;

-- 메시지는 자기 방의 것만. 쓰기는 Edge Function(service_role)이 하므로
-- 클라이언트에는 읽기만 연다. 그래야 assistant 메시지를 위조할 수 없다.
create policy "own messages readable" on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.chat_rooms r
    where r.id = messages.room_id and r.user_id = auth.uid()
  ));

-- 방의 마지막 활동 시각을 갱신해 목록 정렬에 쓴다.
create function public.touch_room_last_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_rooms
     set last_message_at = new.created_at
   where id = new.room_id;
  return new;
end;
$$;

create trigger messages_touch_room
  after insert on public.messages
  for each row execute function public.touch_room_last_message();
