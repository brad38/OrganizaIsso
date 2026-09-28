create table if not exists public.activity_topic_links (
  activity_id uuid not null references public.activities(id) on delete cascade,
  topic_id uuid not null references public.topic_items(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (activity_id, topic_id)
);

create index if not exists activity_topic_links_topic_id_idx
  on public.activity_topic_links(topic_id);

alter table public.activity_topic_links enable row level security;

drop policy if exists activity_topic_links_public_read
  on public.activity_topic_links;
create policy activity_topic_links_public_read
  on public.activity_topic_links
  for select
  using (true);

drop policy if exists activity_topic_links_staff_insert
  on public.activity_topic_links;
create policy activity_topic_links_staff_insert
  on public.activity_topic_links
  for insert
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('owner', 'admin', 'editor')
    )
  );

drop policy if exists activity_topic_links_staff_delete
  on public.activity_topic_links;
create policy activity_topic_links_staff_delete
  on public.activity_topic_links
  for delete
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('owner', 'admin', 'editor')
    )
  );

grant select on table public.activity_topic_links to anon, authenticated;
grant insert, delete on table public.activity_topic_links to authenticated;

insert into public.activity_topic_links (
  activity_id,
  topic_id,
  created_by
)
select
  ti.activity_id,
  ti.id,
  ti.created_by
from public.topic_items ti
where ti.activity_id is not null
on conflict (activity_id, topic_id) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'activity_topic_links'
  ) then
    alter publication supabase_realtime
      add table public.activity_topic_links;
  end if;
end;
$$;

create or replace function public.save_activity_with_topic_links(
  p_activity_id uuid,
  p_title text,
  p_subject text,
  p_type text,
  p_modality text,
  p_due_at timestamptz,
  p_additional_due_dates timestamptz[],
  p_points numeric,
  p_description text,
  p_topic_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity_id uuid;
  v_role text;
  v_topic_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select role
  into v_role
  from public.profiles
  where id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin', 'editor') then
    raise exception 'staff permission required';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'activity title is required';
  end if;

  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'activity subject is required';
  end if;

  select coalesce(array_agg(distinct topic_id), '{}'::uuid[])
  into v_topic_ids
  from unnest(coalesce(p_topic_ids, '{}'::uuid[])) as topic_id;

  if exists (
    select 1
    from unnest(v_topic_ids) selected_topic_id
    left join public.topic_items ti on ti.id = selected_topic_id
    where ti.id is null
  ) then
    raise exception 'one or more linked articles do not exist';
  end if;

  if exists (
    select 1
    from public.topic_items ti
    where ti.id = any(v_topic_ids)
      and ti.subject is distinct from p_subject
  ) then
    raise exception 'linked article must belong to the same subject';
  end if;

  if p_activity_id is null then
    insert into public.activities (
      title,
      subject,
      type,
      modality,
      due_at,
      additional_due_dates,
      points,
      description,
      created_by
    )
    values (
      btrim(p_title),
      btrim(p_subject),
      p_type,
      p_modality,
      p_due_at,
      coalesce(p_additional_due_dates, '{}'::timestamptz[]),
      p_points,
      nullif(btrim(coalesce(p_description, '')), ''),
      auth.uid()
    )
    returning id into v_activity_id;
  else
    if not exists (
      select 1
      from public.activities
      where id = p_activity_id
    ) then
      raise exception 'activity not found';
    end if;

    update public.activities
    set
      title = btrim(p_title),
      subject = btrim(p_subject),
      type = p_type,
      modality = p_modality,
      due_at = p_due_at,
      additional_due_dates = coalesce(p_additional_due_dates, '{}'::timestamptz[]),
      points = p_points,
      description = nullif(btrim(coalesce(p_description, '')), '')
    where id = p_activity_id;

    v_activity_id := p_activity_id;
  end if;

  delete from public.activity_topic_links
  where activity_id = v_activity_id;

  if cardinality(v_topic_ids) > 0 then
    insert into public.activity_topic_links (
      activity_id,
      topic_id,
      created_by
    )
    select
      v_activity_id,
      selected_topic_id,
      auth.uid()
    from unnest(v_topic_ids) selected_topic_id
    on conflict (activity_id, topic_id) do nothing;
  end if;

  return v_activity_id;
end;
$$;

revoke all on function public.save_activity_with_topic_links(
  uuid, text, text, text, text, timestamptz, timestamptz[], numeric, text, uuid[]
) from public, anon;

grant execute on function public.save_activity_with_topic_links(
  uuid, text, text, text, text, timestamptz, timestamptz[], numeric, text, uuid[]
) to authenticated;
