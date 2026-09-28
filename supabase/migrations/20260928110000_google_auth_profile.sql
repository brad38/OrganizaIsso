create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  new_display_name text;
  terms_at timestamptz;
  privacy_at timestamptz;
  reminder_opt_in boolean := false;
begin
  new_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email,''), '@', 1),
    'Usuário'
  );

  begin
    terms_at := nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz;
  exception when others then
    terms_at := null;
  end;

  begin
    privacy_at := nullif(new.raw_user_meta_data ->> 'privacy_acknowledged_at', '')::timestamptz;
  exception when others then
    privacy_at := null;
  end;

  begin
    reminder_opt_in := coalesce((new.raw_user_meta_data ->> 'email_reminders_opt_in')::boolean, false);
  exception when others then
    reminder_opt_in := false;
  end;

  insert into public.profiles (
    id,
    display_name,
    email,
    terms_accepted_at,
    privacy_acknowledged_at,
    terms_version,
    privacy_version
  )
  values (
    new.id,
    new_display_name,
    new.email,
    terms_at,
    privacy_at,
    new.raw_user_meta_data ->> 'terms_version',
    new.raw_user_meta_data ->> 'privacy_version'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    terms_accepted_at = coalesce(public.profiles.terms_accepted_at, excluded.terms_accepted_at),
    privacy_acknowledged_at = coalesce(public.profiles.privacy_acknowledged_at, excluded.privacy_acknowledged_at),
    terms_version = coalesce(public.profiles.terms_version, excluded.terms_version),
    privacy_version = coalesce(public.profiles.privacy_version, excluded.privacy_version);

  insert into public.user_directory (user_id, display_name)
  values (new.id, new_display_name)
  on conflict (user_id) do update
  set display_name = excluded.display_name;

  insert into public.notification_preferences (user_id, email_enabled)
  values (new.id, reminder_opt_in)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

create or replace function public.accept_current_legal_terms(
  p_terms_version text,
  p_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
  set
    terms_accepted_at = coalesce(terms_accepted_at, now()),
    privacy_acknowledged_at = coalesce(privacy_acknowledged_at, now()),
    terms_version = coalesce(terms_version, p_terms_version),
    privacy_version = coalesce(privacy_version, p_privacy_version)
  where id = auth.uid();
end;
$$;

revoke all on function public.accept_current_legal_terms(text, text) from public, anon;
grant execute on function public.accept_current_legal_terms(text, text) to authenticated;
