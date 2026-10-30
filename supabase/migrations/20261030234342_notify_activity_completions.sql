-- Notificações quando uma conclusão passa a existir (site ou MCP).
-- O registro da notificação também aciona o mecanismo push já existente.
create or replace function public.notify_activity_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_title text;
begin
  -- Sincronizações sem ator autenticado não devem enviar push como se
  -- fossem uma marcação voluntária do usuário.
  if v_actor_id is null then
    return new;
  end if;

  -- A conclusão em grupo já notifica os outros membros pelo gatilho
  -- trg_group_activity_completed. Evita dois pushes sobre o mesmo evento.
  if new.user_id <> v_actor_id and exists (
    select 1
      from public.activity_group_assignments g
     where g.activity_id = new.activity_id
       and g.assigned_by = v_actor_id
       and new.user_id = any(coalesce(g.snapshot_member_ids, '{}'::uuid[]))
  ) then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'Usuário')
    into v_actor_name
    from public.profiles p
   where p.id = v_actor_id;

  select a.title into v_title
    from public.activities a
   where a.id = new.activity_id;

  insert into public.user_notifications(
    user_id, kind, message, event_key, metadata
  ) values (
    new.user_id,
    'activity_completed',
    format('Atividade "%s" concluída por %s.',
      coalesce(v_title, 'atividade'), coalesce(v_actor_name, 'Usuário')),
    format('activity-completed:%s:%s:%s',
      new.activity_id, new.user_id,
      to_char(new.completed_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')),
    jsonb_build_object(
      'activity_id', new.activity_id,
      'actor_id', v_actor_id,
      'completed_user_id', new.user_id,
      'completed_at', new.completed_at
    )
  )
  on conflict (user_id, event_key) do nothing;

  return new;
end;
$fn$;

revoke all on function public.notify_activity_completion()
  from public, anon, authenticated;

drop trigger if exists trg_notify_activity_completion
  on public.activity_completions;

create trigger trg_notify_activity_completion
after insert on public.activity_completions
for each row execute function public.notify_activity_completion();
