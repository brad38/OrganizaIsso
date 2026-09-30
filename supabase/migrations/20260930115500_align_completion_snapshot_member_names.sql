create or replace function public.edit_activity_group_completion_record(
  p_activity_id uuid,
  p_original_team_id uuid,
  p_team_id uuid,
  p_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_is_owner boolean := false;
  v_is_team_owner boolean := false;
  v_assigned_by uuid;
  v_created_at timestamptz;
  v_old_member_ids uuid[];
  v_new_team_name text;
  v_allowed_ids uuid[];
  v_member_names text[];
  v_normalized_member_ids uuid[];
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  select exists(
    select 1 from public.profiles p
    where p.id = v_user and p.role = 'owner'
  ) into v_is_owner;

  select exists(
    select 1
    from public.topic_teams t
    where t.id = p_original_team_id
      and t.owner_id = v_user
  ) into v_is_team_owner;

  select a.assigned_by, a.created_at, a.snapshot_member_ids
  into v_assigned_by, v_created_at, v_old_member_ids
  from public.activity_group_assignments a
  where a.activity_id = p_activity_id
    and a.team_id = p_original_team_id;

  if not found then
    raise exception 'completion record not found';
  end if;

  if v_assigned_by <> v_user and not v_is_owner and not v_is_team_owner then
    raise exception 'only record creator, team owner or owner can edit this completion record';
  end if;

  if not exists (
    select 1 from public.activities a
    where a.id = p_activity_id
      and a.modality = 'Em grupo'
  ) then
    raise exception 'activity is not group modality';
  end if;

  select t.name into v_new_team_name
  from public.topic_teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'group not found';
  end if;

  if p_team_id <> p_original_team_id
     and not v_is_owner
     and not exists (
       select 1
       from public.topic_teams t
       where t.id = p_team_id
         and (
           t.owner_id = v_user
           or exists (
             select 1
             from public.topic_team_members tm
             where tm.team_id = t.id
               and tm.user_id = v_user
               and tm.status = 'accepted'
           )
         )
     )
  then
    raise exception 'user does not belong to selected group';
  end if;

  select coalesce(array_agg(distinct x.member_id), '{}'::uuid[])
  into v_allowed_ids
  from (
    select t.owner_id as member_id
    from public.topic_teams t
    where t.id = p_team_id

    union

    select tm.user_id
    from public.topic_team_members tm
    where tm.team_id = p_team_id
      and tm.status = 'accepted'

    union

    select unnest(coalesce(v_old_member_ids, '{}'::uuid[]))
    where p_team_id = p_original_team_id
  ) x
  where x.member_id is not null;

  select
    coalesce(
      array_agg(m.member_id order by coalesce(d.display_name, ''), m.member_id),
      '{}'::uuid[]
    ),
    coalesce(
      array_agg(coalesce(d.display_name, 'Usuário') order by coalesce(d.display_name, ''), m.member_id),
      '{}'::text[]
    )
  into v_normalized_member_ids, v_member_names
  from (
    select distinct member_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id
    where member_id is not null
  ) m
  left join public.user_directory d on d.user_id = m.member_id;

  if cardinality(v_normalized_member_ids) = 0 then
    raise exception 'completion record needs at least one member';
  end if;

  if exists (
    select 1
    from unnest(v_normalized_member_ids) as member_id
    where not (member_id = any(v_allowed_ids))
  ) then
    raise exception 'one or more selected members are not allowed for this record';
  end if;

  if p_team_id = p_original_team_id then
    update public.activity_group_assignments
    set snapshot_member_ids = v_normalized_member_ids,
        snapshot_member_names = v_member_names,
        snapshot_member_count = cardinality(v_normalized_member_ids),
        updated_at = now()
    where activity_id = p_activity_id
      and team_id = p_original_team_id;
  else
    if exists (
      select 1
      from public.activity_group_assignments a
      where a.activity_id = p_activity_id
        and a.team_id = p_team_id
    ) then
      raise exception 'selected group already has a completion record for this activity';
    end if;

    delete from public.activity_group_assignments
    where activity_id = p_activity_id
      and team_id = p_original_team_id;

    insert into public.activity_group_assignments(
      activity_id, team_id, assigned_by, created_at,
      snapshot_team_name, snapshot_member_ids, snapshot_member_names,
      snapshot_member_count, updated_at
    )
    values (
      p_activity_id, p_team_id, v_assigned_by, v_created_at,
      v_new_team_name, v_normalized_member_ids, v_member_names,
      cardinality(v_normalized_member_ids), now()
    );
  end if;

  insert into public.activity_completions(user_id, activity_id)
  select member_id, p_activity_id
  from unnest(v_normalized_member_ids) as member_id
  on conflict (user_id, activity_id) do nothing;

  delete from public.activity_completions c
  where c.activity_id = p_activity_id
    and c.user_id = any(coalesce(v_old_member_ids, '{}'::uuid[]))
    and not (c.user_id = any(v_normalized_member_ids))
    and not exists (
      select 1
      from public.activity_group_assignments aga
      where aga.activity_id = p_activity_id
        and c.user_id = any(aga.snapshot_member_ids)
    )
    and not exists (
      select 1
      from public.activity_pair_assignments apa
      where apa.activity_id = p_activity_id
        and c.user_id in (apa.member_a, apa.member_b)
    );
end;
$$;

revoke all on function public.edit_activity_group_completion_record(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.edit_activity_group_completion_record(uuid, uuid, uuid, uuid[]) to authenticated;
