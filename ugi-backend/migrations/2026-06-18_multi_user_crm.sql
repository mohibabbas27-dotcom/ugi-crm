create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  name text,
  created_at timestamptz default now()
);

alter table app_users enable row level security;

alter table contacts
  add column if not exists user_id uuid references app_users(id) on delete cascade;

do $$
declare
  constraint_to_drop text;
begin
  for constraint_to_drop in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'contacts'::regclass
      and c.contype = 'u'
      and a.attname = 'mobile'
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table contacts drop constraint %I', constraint_to_drop);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'contacts'::regclass
      and conname = 'contacts_user_id_mobile_key'
  ) then
    alter table contacts
      add constraint contacts_user_id_mobile_key unique (user_id, mobile);
  end if;
end $$;

create index if not exists contacts_user_id_idx on contacts(user_id);
create index if not exists contacts_user_id_unit_idx on contacts(user_id, unit);
create index if not exists contacts_user_id_type_idx on contacts(user_id, type);

alter table contacts enable row level security;
