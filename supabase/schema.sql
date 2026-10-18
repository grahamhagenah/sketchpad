-- Bounce's cloud copy: each signed-in person's saved sketches, and the
-- recordings they use. Run once in the Supabase dashboard's SQL editor.
-- It can be run again safely: it only adds what isn't there yet.
--
-- Everyone sees and changes only their own: row-level security on the
-- table, and the same on the recordings' bucket, where each person's files
-- are in a folder named by their user id.

-- ---- Sketches ----------------------------------------------------------------

create table if not exists public.sketches (
  -- The sketch's id, as the browser made it (a UUID); one per owner.
  id text not null,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The song as Bounce saves it (songOf), and which recordings each section's
  -- tracks use (takeIdsBySection), as in the browser's own copy.
  song jsonb not null,
  lanes jsonb not null default '{}'::jsonb,
  -- When it was last saved, and when it was deleted (it waits in Recently
  -- deleted), in milliseconds, as the browser keeps them. The newest save wins.
  updated bigint not null,
  deleted bigint,
  primary key (owner, id)
);

-- Fetching what's changed since a device last looked.
create index if not exists sketches_owner_updated on public.sketches (owner, updated);

alter table public.sketches enable row level security;

drop policy if exists "Own sketches: read" on public.sketches;
create policy "Own sketches: read" on public.sketches
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "Own sketches: add" on public.sketches;
create policy "Own sketches: add" on public.sketches
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "Own sketches: change" on public.sketches;
create policy "Own sketches: change" on public.sketches
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "Own sketches: delete" on public.sketches;
create policy "Own sketches: delete" on public.sketches
  for delete to authenticated using (owner = (select auth.uid()));

-- ---- Recordings --------------------------------------------------------------

-- Private: a recording is only ever fetched by its owner, signed in.
insert into storage.buckets (id, name, public)
values ('takes', 'takes', false)
on conflict (id) do nothing;

drop policy if exists "Own takes: read" on storage.objects;
create policy "Own takes: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own takes: add" on storage.objects;
create policy "Own takes: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'takes' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own takes: change" on storage.objects;
create policy "Own takes: change" on storage.objects
  for update to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own takes: delete" on storage.objects;
create policy "Own takes: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = (select auth.uid())::text);
