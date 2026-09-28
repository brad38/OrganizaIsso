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
  v_topic_ids uuid[] := coalesce(p_topic_ids, '{}'::uuid[]);
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

  if cardinality(v_topic_ids) > 0 and p_modality = 'Individual' then
    raise exception 'linked activity must be a team activity';
  end if;

  if exists (
    select 1
    from public.topic_items ti
    where ti.id = any(v_topic_ids)
      and ti.subject is distinct from p_subject
  ) then
    raise exception 'linked activity must belong to the same subject';
  end if;

  if p_activity_id is not null and exists (
    select 1
    from public.topic_items ti
    where ti.id = any(v_topic_ids)
      and ti.activity_id is not null
      and ti.activity_id <> p_activity_id
  ) then
    raise exception 'one or more articles are already linked to another activity';
  end if;

  if p_activity_id is null and exists (
    select 1
    from public.topic_items ti
    where ti.id = any(v_topic_ids)
      and ti.activity_id is not null
  ) then
    raise exception 'one or more articles are already linked to another activity';
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

    update public.topic_items
    set activity_id = null
    where activity_id = p_activity_id;

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

  if cardinality(v_topic_ids) > 0 then
    update public.topic_items
    set activity_id = v_activity_id
    where id = any(v_topic_ids);
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
