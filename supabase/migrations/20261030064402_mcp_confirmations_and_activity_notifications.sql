-- Fluxo MCP de confirmacao validada no site e aviso de novas atividades.
create table if not exists public.mcp_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('create_activity', 'complete_activity')),
  payload jsonb not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz
);

create index if not exists mcp_pending_actions_user_idx
  on public.mcp_pending_actions(user_id, created_at desc);

alter table public.mcp_pending_actions enable row level security;
revoke all on public.mcp_pending_actions from public, anon, authenticated;
grant select, insert on public.mcp_pending_actions to authenticated;

drop policy if exists mcp_pending_select_own on public.mcp_pending_actions;
create policy mcp_pending_select_own on public.mcp_pending_actions
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists mcp_pending_insert_own on public.mcp_pending_actions;
create policy mcp_pending_insert_own on public.mcp_pending_actions
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and approved_at is null and consumed_at is null
  and expires_at > now() and expires_at <= now() + interval '21 minutes'
);

create or replace function public.approve_mcp_pending_action(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  update public.mcp_pending_actions
  set approved_at = now()
  where id = p_id and user_id = auth.uid()
    and approved_at is null and consumed_at is null
    and expires_at > now();
  return found;
end;
$fn$;
revoke all on function public.approve_mcp_pending_action(uuid) from public, anon;
grant execute on function public.approve_mcp_pending_action(uuid) to authenticated;

create or replace function public.execute_mcp_pending_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action public.mcp_pending_actions%rowtype;
  v_id uuid;
  v_modality text;
  v_scope text;
  v_team_id uuid;
  v_partner_id uuid;
  v_description text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_action
    from public.mcp_pending_actions
    where id = p_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'proposal not found for your account'; end if;
  if v_action.consumed_at is not null then raise exception 'proposal already executed'; end if;
  if v_action.expires_at <= now() then raise exception 'proposal expired'; end if;
  if v_action.approved_at is null then raise exception 'proposal must be approved in Organiza Isso first'; end if;

  if v_action.action_type = 'create_activity' then
    v_id := public.save_activity_with_topic_links(
      null,
      v_action.payload->>'titulo',
      v_action.payload->>'disciplina',
      v_action.payload->>'tipo',
      v_action.payload->>'modalidade',
      (v_action.payload->>'prazo')::timestamptz,
      '{}'::timestamptz[],
      (v_action.payload->>'pontos')::numeric,
      v_action.payload->>'descricao',
      '{}'::uuid[]
    );
    update public.mcp_pending_actions set consumed_at = now() where id = p_id;
    return jsonb_build_object('sucesso',true,'tipo','atividade','atividade_id',v_id);
  elsif v_action.action_type = 'complete_activity' then
    v_id := (v_action.payload->>'atividade_id')::uuid;
    select modality into v_modality from public.activities where id = v_id;
    if not found then raise exception 'activity not found'; end if;
    v_scope := v_action.payload->>'modo';
    v_description := nullif(btrim(coalesce(v_action.payload->>'descricao_personalizada','')),'');
    if length(v_description) > 2000 then raise exception 'custom description too long'; end if;

    if v_scope = 'individual' then
      if v_modality <> 'Individual' then raise exception 'activity is not individual'; end if;
      insert into public.activity_completions(user_id,activity_id)
        values(auth.uid(),v_id) on conflict (user_id,activity_id) do nothing;
      if v_description is not null then
        perform public.save_private_activity_work(v_id,null,null,v_description);
      end if;
    elsif v_scope = 'pair' then
      if v_modality <> 'Em dupla' then raise exception 'activity is not pair modality'; end if;
      v_partner_id := (v_action.payload->>'parceiro_id')::uuid;
      perform public.complete_activity_with_partner(v_id,v_partner_id,true);
      if v_description is not null then
        perform public.save_private_activity_work(v_id,null,v_partner_id,v_description);
      end if;
    elsif v_scope = 'group' then
      if v_modality <> 'Em grupo' then raise exception 'activity is not group modality'; end if;
      v_team_id := (v_action.payload->>'grupo_id')::uuid;
      perform public.complete_activity_with_group(v_id,v_team_id,true);
      if v_description is not null then
        perform public.save_private_activity_work(v_id,v_team_id,null,v_description);
      end if;
    elsif v_scope = 'personal_only' then
      if v_modality not in ('Em dupla','Em grupo') then raise exception 'personal-only is reserved for pair/group activities'; end if;
      -- Nenhuma conclusao atribuida a colega sem conta. So marca o proprio usuario.
      insert into public.activity_completions(user_id,activity_id)
        values(auth.uid(),v_id) on conflict (user_id,activity_id) do nothing;
      insert into public.private_activity_works(activity_id,scope_type,user_id,custom_description,created_by)
        values(v_id,'individual',auth.uid(),v_description,auth.uid())
        on conflict (activity_id,user_id) where scope_type = 'individual'
        do update set custom_description = excluded.custom_description, updated_at = now();
    else
      raise exception 'invalid completion mode';
    end if;

    update public.mcp_pending_actions set consumed_at = now() where id = p_id;
    return jsonb_build_object('sucesso',true,'tipo','conclusao','atividade_id',v_id,'modo',v_scope);
  end if;
  raise exception 'invalid action type';
end;
$fn$;
revoke all on function public.execute_mcp_pending_action(uuid) from public, anon;
grant execute on function public.execute_mcp_pending_action(uuid) to authenticated;

create or replace function public.notify_new_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.user_notifications(user_id,kind,message,event_key,metadata)
  select
    p.id,
    'new_activity',
    format('Nova atividade: %s (%s). Prazo: %s.',
      new.title, new.subject,
      to_char(new.due_at at time zone 'America/Belem','DD/MM HH24:MI')),
    'new-activity:' || new.id::text,
    jsonb_build_object('activity_id',new.id,'created_by',new.created_by,'due_at',new.due_at)
  from public.profiles p
  on conflict (user_id,event_key) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_notify_new_activity on public.activities;
create trigger trg_notify_new_activity
after insert on public.activities
for each row execute function public.notify_new_activity();
revoke all on function public.notify_new_activity() from public,anon,authenticated;
