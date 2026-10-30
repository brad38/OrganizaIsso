-- Lembretes de prazos do Organiza Isso (America/Belem).
-- Reaproveita o gatilho em user_notifications para envio Web Push.
-- Somente usuarios com inscricao push recebem os lembretes.
-- Inclui datas adicionais e impede duplicatas por usuario, prazo e etapa.

create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.queue_activity_deadline_push(
  p_now timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inserted integer;
begin
  with due_dates as (
    select
      a.id as activity_id,
      a.title,
      a.subject,
      d.due_at,
      ((d.due_at at time zone 'America/Belem')::date
        - (p_now at time zone 'America/Belem')::date) as days_until_due
    from public.activities a
    cross join lateral unnest(
      array[a.due_at] || coalesce(a.additional_due_dates, '{}'::timestamptz[])
    ) as d(due_at)
    where d.due_at > p_now
  ),
  upcoming as (
    select *
    from due_dates
    where days_until_due in (0, 1, 2)
  ),
  recipients as (
    select distinct
      s.user_id,
      u.activity_id,
      u.title,
      u.subject,
      u.due_at,
      u.days_until_due
    from upcoming u
    join public.push_subscriptions s on true
    where not exists (
      select 1
      from public.activity_completions c
      where c.user_id = s.user_id
        and c.activity_id = u.activity_id
    )
  )
  insert into public.user_notifications
    (user_id, kind, message, event_key, metadata)
  select
    r.user_id,
    'deadline_reminder',
    case r.days_until_due
      when 0 then 'Hoje tem: '
      when 1 then 'Amanhã tem: '
      else 'Daqui a 2 dias: '
    end
      || r.title || ' (' || r.subject || '), às '
      || to_char(r.due_at at time zone 'America/Belem', 'HH24:MI') || '.',
    'deadline:' || r.activity_id::text || ':'
      || to_char(r.due_at at time zone 'UTC', 'YYYYMMDDHH24MISS')
      || ':' || r.days_until_due::text,
    jsonb_build_object(
      'activity_id', r.activity_id,
      'due_at', r.due_at,
      'days_until_due', r.days_until_due,
      'subject', r.subject
    )
  from recipients r
  on conflict (user_id, event_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$fn$;

revoke all on function app_private.queue_activity_deadline_push(timestamptz)
  from public, anon, authenticated;

-- Postgres cron usa UTC; 11:00-23:00 UTC = 08:00-20:00 em Belem.
-- Verifica a cada hora para incluir atividades novas sem reenviar lembretes.
select cron.schedule(
  'activity-deadline-webpush',
  '0 11-23 * * *',
  $cron$select app_private.queue_activity_deadline_push();$cron$
);
