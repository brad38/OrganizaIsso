create or replace function public.notify_group_activity_completion_updated()
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
  v_added_ids uuid[];
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

  select coalesce(array_agg(x.user_id), '{}'::uuid[])
  into v_added_ids
  from (
    select unnest(coalesce(new.snapshot_member_ids, '{}'::uuid[])) as user_id
    except
    select unnest(coalesce(old.snapshot_member_ids, '{}'::uuid[])) as user_id
  ) x;

  foreach v_recipient in array v_added_ids
  loop
    if v_recipient is not null and v_recipient <> new.assigned_by then
      v_event_key := format(
        'group-completion-participant-added:%s:%s:%s:%s',
        new.activity_id,
        new.team_id,
        v_recipient,
        extract(epoch from coalesce(new.updated_at, now()))::bigint
      );

      insert into public.user_notifications(
        user_id, kind, message, event_key, metadata
      )
      values (
        v_recipient,
        'group_activity_participant_added',
        format('%s adicionou você ao registro da atividade %s já concluída.', v_actor_name, v_activity_title),
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

drop trigger if exists trg_group_activity_completion_updated on public.activity_group_assignments;
create trigger trg_group_activity_completion_updated
after update of snapshot_member_ids on public.activity_group_assignments
for each row
when (old.snapshot_member_ids is distinct from new.snapshot_member_ids)
execute function public.notify_group_activity_completion_updated();

create or replace function public.get_visible_group_completion_notification_statuses()
returns table(
  activity_id uuid,
  team_id uuid,
  user_id uuid,
  display_name text,
  notice_status text,
  notified_at timestamptz,
  read_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with visible_assignments as (
    select a.*
    from public.activity_group_assignments a
    where
      a.assigned_by = auth.uid()
      or auth.uid() = any(coalesce(a.snapshot_member_ids, '{}'::uuid[]))
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'owner'
      )
  ),
  members as (
    select
      a.activity_id,
      a.team_id,
      a.assigned_by,
      m.user_id,
      m.ord,
      a.snapshot_member_names
    from visible_assignments a
    cross join lateral unnest(coalesce(a.snapshot_member_ids, '{}'::uuid[]))
      with ordinality as m(user_id, ord)
  )
  select
    m.activity_id,
    m.team_id,
    m.user_id,
    coalesce(d.display_name, m.snapshot_member_names[m.ord], 'Usuário') as display_name,
    case
      when m.user_id = m.assigned_by then 'registered'
      when n.id is null then 'not_recorded'
      when n.read_at is not null then 'read'
      else 'delivered'
    end as notice_status,
    n.created_at as notified_at,
    n.read_at
  from members m
  left join public.user_directory d
    on d.user_id = m.user_id
  left join lateral (
    select n.id, n.created_at, n.read_at
    from public.user_notifications n
    where n.user_id = m.user_id
      and n.kind in ('group_activity_completed', 'group_activity_participant_added')
      and n.metadata->>'activity_id' = m.activity_id::text
      and n.metadata->>'team_id' = m.team_id::text
    order by n.created_at desc
    limit 1
  ) n on true
  order by m.activity_id, m.team_id, m.ord;
$$;

revoke all on function public.get_visible_group_completion_notification_statuses() from public, anon;
grant execute on function public.get_visible_group_completion_notification_statuses() to authenticated;
