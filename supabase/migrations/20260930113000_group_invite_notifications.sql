create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  message text not null,
  event_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
  on public.user_notifications
  for select
  using (user_id = (select auth.uid()));

drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own
  on public.user_notifications
  for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, update on public.user_notifications to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end;
$$;

create or replace function public.notify_topic_team_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient uuid;
  v_name text;
begin
  if old.status = 'pending' and new.status = 'accepted' then
    select coalesce(new.invited_by, t.owner_id)
    into v_recipient
    from public.topic_teams t
    where t.id = new.team_id;

    select coalesce(d.display_name, 'Usuário')
    into v_name
    from public.user_directory d
    where d.user_id = new.user_id;

    v_name := coalesce(v_name, 'Usuário');

    if v_recipient is not null and v_recipient <> new.user_id then
      insert into public.user_notifications(
        user_id, kind, message, event_key, metadata
      )
      values (
        v_recipient,
        'invite_accepted',
        format('Convite de %s para participar do seu grupo aceito!', v_name),
        format('topic-invite-accepted:%s:%s', new.team_id, new.user_id),
        jsonb_build_object(
          'team_id', new.team_id,
          'member_id', new.user_id
        )
      )
      on conflict (user_id, event_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_topic_team_invite_accepted on public.topic_team_members;
create trigger trg_topic_team_invite_accepted
after update of status on public.topic_team_members
for each row
when (old.status is distinct from new.status)
execute function public.notify_topic_team_invite_accepted();

create or replace function public.notify_group_activity_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient uuid;
  v_actor_name text;
  v_activity_title text;
  v_event_key text;
begin
  select coalesce(d.display_name, 'Usuário')
  into v_actor_name
  from public.user_directory d
  where d.user_id = new.assigned_by;

  select coalesce(a.title, 'atividade')
  into v_activity_title
  from public.activities a
  where a.id = new.activity_id;

  v_actor_name := coalesce(v_actor_name, 'Usuário');
  v_activity_title := coalesce(v_activity_title, 'atividade');
  v_event_key := format(
    'group-completion:%s:%s:%s',
    new.activity_id,
    new.team_id,
    extract(epoch from coalesce(new.created_at, now()))::bigint
  );

  foreach v_recipient in array coalesce(new.snapshot_member_ids, '{}'::uuid[])
  loop
    if v_recipient is not null and v_recipient <> new.assigned_by then
      insert into public.user_notifications(
        user_id, kind, message, event_key, metadata
      )
      values (
        v_recipient,
        'group_activity_completed',
        format('%s do seu grupo marcou a atividade %s como concluída!', v_actor_name, v_activity_title),
        v_event_key,
        jsonb_build_object(
          'activity_id', new.activity_id,
          'team_id', new.team_id,
          'actor_id', new.assigned_by
        )
      )
      on conflict (user_id, event_key) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_group_activity_completed on public.activity_group_assignments;
create trigger trg_group_activity_completed
after insert on public.activity_group_assignments
for each row
execute function public.notify_group_activity_completed();

create or replace function public.cancel_topic_team_invite(
  p_team_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.topic_teams t
    where t.id = p_team_id
      and t.owner_id = v_uid
  ) then
    raise exception 'only the team owner can cancel invites';
  end if;

  delete from public.topic_team_members m
  where m.team_id = p_team_id
    and m.user_id = p_user_id
    and m.status = 'pending';

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.cancel_topic_team_invite(uuid, uuid) from public, anon;
grant execute on function public.cancel_topic_team_invite(uuid, uuid) to authenticated;
