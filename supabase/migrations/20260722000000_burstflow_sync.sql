-- BurstFlow lite sync: bảng cách ly bf_docs, RLS deny-all + RPC (SECURITY DEFINER) gated bằng mã sync.
-- Anon key lộ trong client cũng KHÔNG dump được dữ liệu nếu không có mã.
create table if not exists public.bf_docs (
  sync_code   text        not null,
  entity      text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  primary key (sync_code, entity, id)
);

alter table public.bf_docs enable row level security;
-- Không policy cho anon/authenticated => cấm truy cập bảng trực tiếp. Chỉ vào qua RPC definer bên dưới.

create or replace function public.bf_pull(p_code text, p_since timestamptz)
returns setof public.bf_docs
language sql
security definer
set search_path = public
as $$
  select * from public.bf_docs
  where sync_code = p_code
    and updated_at > coalesce(p_since, 'epoch'::timestamptz);
$$;

create or replace function public.bf_push(p_code text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bf_docs (sync_code, entity, id, data, updated_at, deleted)
  select p_code,
         r->>'entity',
         r->>'id',
         (r->'data'),
         coalesce((r->>'updated_at')::timestamptz, now()),
         coalesce((r->>'deleted')::boolean, false)
  from jsonb_array_elements(p_rows) as r
  on conflict (sync_code, entity, id) do update
     set data       = excluded.data,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
   where excluded.updated_at >= public.bf_docs.updated_at;  -- last-write-wins
end;
$$;

revoke all on function public.bf_pull(text, timestamptz) from public;
revoke all on function public.bf_push(text, jsonb) from public;
grant execute on function public.bf_pull(text, timestamptz)  to anon, authenticated;
grant execute on function public.bf_push(text, jsonb)        to anon, authenticated;
