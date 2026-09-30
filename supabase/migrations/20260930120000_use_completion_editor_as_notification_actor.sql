create or replace function public.notify_group_activity_completion_updated()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient uuid;
  v_actor_id uuid := coalesce(auth.uid(), new.assigned_by);
  v_actor_name text;
  v_activity_title text;
  v_event_key text;
  v_added_ids uuid[];
begin
  select coalesce(d.display_name, 'Usuário')
  into v_actor_name
  from public.user_directory d
  where d.user_id = v_actor_id;

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
    if v_recipient is not null and v_recipient <> v_actor_id then
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
          'actor_id', v_actor_id
        )
      )
      on conflict (user_id, event_key) do nothing;
    end if;
  end loop;

  return new;
end;
$$;
