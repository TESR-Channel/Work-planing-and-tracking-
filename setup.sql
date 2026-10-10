-- TESR Board setup — รันใน Supabase project "TESR Time Clock" (SQL Editor → Run)
-- สร้างเฉพาะตาราง tb_* แยกจากข้อมูลลงเวลา (ไม่แตะ tc_rows) + ฟังก์ชันอ่านรายชื่อพนักงานแบบปลอดภัย (ไม่ส่งเบอร์/รหัสผ่านออกไป)

create table if not exists tb_members (
  id text primary key, name text not null, email text default '', role text default '', dept text default '',
  color text, active boolean default true, board_role text default 'member', created_at timestamptz default now());
create table if not exists tb_boards (
  id text primary key, name text not null, color text, pos double precision default 0, created_at timestamptz default now());
create table if not exists tb_lists (
  id text primary key, board_id text references tb_boards(id) on delete cascade, name text not null,
  pos double precision default 0, is_done boolean default false);
create table if not exists tb_cards (
  id text primary key, board_id text references tb_boards(id) on delete cascade, list_id text references tb_lists(id) on delete cascade,
  title text not null, description text default '', assignees jsonb default '[]'::jsonb, labels jsonb default '[]'::jsonb,
  priority text default 'normal', due date, pos double precision default 0, checklists jsonb default '[]'::jsonb,
  links jsonb default '[]'::jsonb, attachments jsonb default '[]'::jsonb, comments jsonb default '[]'::jsonb,
  created_by text, created_at timestamptz default now(), started_at timestamptz, done_at timestamptz, updated_at timestamptz default now());
create index if not exists tb_cards_list_idx on tb_cards(list_id);
create index if not exists tb_cards_board_idx on tb_cards(board_id);
create table if not exists tb_activity (
  id text primary key, card_id text, board_id text, member text, action text, at timestamptz default now());
create index if not exists tb_activity_at_idx on tb_activity(at desc);

do $$ declare t text; begin
  foreach t in array array['tb_members','tb_boards','tb_lists','tb_cards','tb_activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "tb_all" on %I', t);
    execute format('create policy "tb_all" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$ begin
  alter publication supabase_realtime add table tb_members, tb_boards, tb_lists, tb_cards, tb_activity;
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public) values ('tb-attachments','tb-attachments',true) on conflict (id) do nothing;
drop policy if exists "tb_attach_read" on storage.objects;
drop policy if exists "tb_attach_insert" on storage.objects;
drop policy if exists "tb_attach_delete" on storage.objects;
create policy "tb_attach_read" on storage.objects for select to anon, authenticated using (bucket_id='tb-attachments');
create policy "tb_attach_insert" on storage.objects for insert to anon, authenticated with check (bucket_id='tb-attachments');
create policy "tb_attach_delete" on storage.objects for delete to anon, authenticated using (bucket_id='tb-attachments');

create or replace function public.tb_norm_phone(p text) returns text language sql immutable as $$
  select case when d ~ '^66[0-9]{9}$' then '0'||substr(d,3) else d end
  from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') d) s $$;

-- รายชื่อพนักงาน (เฉพาะ id, รหัส, ชื่อ, ตำแหน่ง, อีเมล)
create or replace function public.tb_staff() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',data->>'id','code',data->>'code','name',data->>'name','position',data->>'position',
    'email',lower(coalesce(data->>'email','')),'active',coalesce(upper(data->>'active'),'TRUE')<>'FALSE')
    order by data->>'code'),'[]'::jsonb)
  from tc_rows where tbl='Employees' $$;

-- ล็อกอิน: พนักงาน = อีเมล + เบอร์โทร / Admin = บัญชี admin ของระบบลงเวลา
create or replace function public.tb_login(p_user text, p_pass text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u text := lower(trim(coalesce(p_user,''))); au text; ah text; salt text; hx text; e jsonb; r text;
begin
  if u = '' or coalesce(p_pass,'') = '' then return null; end if;
  select data->>'v' into au from tc_rows where tbl='Settings' and key='adminUser';
  select data->>'v' into ah from tc_rows where tbl='Settings' and key='adminHash';
  if au is not null and lower(au) = u and ah like '%$%' then
    salt := split_part(ah,'$',1); hx := split_part(ah,'$',2);
    if hx in (encode(sha256(convert_to(salt||p_pass,'UTF8')),'hex'),
              encode(sha256(convert_to(p_pass||salt,'UTF8')),'hex'),
              encode(sha256(convert_to(salt||':'||p_pass,'UTF8')),'hex')) then
      return jsonb_build_object('id','admin','name',coalesce((select name from tb_members where id='admin'),'Admin'),
                                'email',u,'position','Admin','role','admin');
    end if;
  end if;
  select data into e from tc_rows
   where tbl='Employees'
     and (lower(data->>'email') = u or lower(coalesce(data->>'username','')) = u)
     and coalesce(upper(data->>'active'),'TRUE') <> 'FALSE'
     and tb_norm_phone(data->>'phone') <> ''
     and tb_norm_phone(data->>'phone') = tb_norm_phone(p_pass)
   limit 1;
  if e is null then return null; end if;
  select board_role into r from tb_members where id = e->>'id';
  return jsonb_build_object('id',e->>'id','code',e->>'code','name',e->>'name','position',e->>'position',
                            'email',lower(e->>'email'),'role',coalesce(r,'member'));
end $$;

revoke all on function public.tb_login(text,text) from public;
revoke all on function public.tb_staff() from public;
grant execute on function public.tb_login(text,text) to anon, authenticated;
grant execute on function public.tb_staff() to anon, authenticated;
