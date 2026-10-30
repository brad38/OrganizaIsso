-- Allow existing activity metadata to be changed through approved MCP proposals.
alter table public.mcp_pending_actions
  drop constraint mcp_pending_actions_action_type_check;
alter table public.mcp_pending_actions
  add constraint mcp_pending_actions_action_type_check
  check (action_type in ('create_activity', 'complete_activity', 'edit_activity'));

create or replace function public.execute_mcp_edit_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action public.mcp_pending_actions%rowtype;
  v_title text;
  v_description text;
  v_new_title text;
  v_new_description text;
  v_id uuid;
  v_role text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner','admin','editor') then
    raise exception 'staff permission required to edit activities';
  end if;

  select * into v_action from public.mcp_pending_actions
    where id = p_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'proposal not found for your account'; end if;
  if v_action.action_type <> 'edit_activity' then raise exception 'proposal is not an edit'; end if;
  if v_action.consumed_at is not null then raise exception 'proposal already executed'; end if;
  if v_action.expires_at <= now() then raise exception 'proposal expired'; end if;
  if v_action.approved_at is null then raise exception 'proposal must be approved in Organiza Isso first'; end if;

  v_id := (v_action.payload->>'atividade_id')::uuid;
  v_new_title := btrim(coalesce(v_action.payload->>'novo_titulo',''));
  v_new_description := nullif(btrim(coalesce(v_action.payload->>'nova_descricao','')),'');
  if v_new_title = '' or char_length(v_new_title) > 180 then
    raise exception 'invalid activity title';
  end if;
  if char_length(coalesce(v_new_description,'')) > 4000 then
    raise exception 'activity description too long';
  end if;

  select title, description into v_title, v_description
    from public.activities where id = v_id for update;
  if not found then raise exception 'activity not found'; end if;
  if v_title is distinct from (v_action.payload->>'titulo_anterior') or
     v_description is distinct from (v_action.payload->>'descricao_anterior') then
    raise exception 'activity changed since proposal was prepared; review and prepare again';
  end if;
  if v_title is not distinct from v_new_title and
     v_description is not distinct from v_new_description then
    raise exception 'no changes requested';
  end if;

  update public.activities
    set title = v_new_title, description = v_new_description, updated_at = now()
    where id = v_id;
  update public.mcp_pending_actions set consumed_at = now() where id = p_id;
  return jsonb_build_object('sucesso',true,'tipo','edicao_atividade',
    'atividade_id',v_id,'titulo',v_new_title,'descricao',v_new_description);
end;
$function$;
revoke all on function public.execute_mcp_edit_action(uuid) from public,anon,authenticated;
grant execute on function public.execute_mcp_edit_action(uuid) to authenticated;
