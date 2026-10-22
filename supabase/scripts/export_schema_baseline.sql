-- Generates a schema-only baseline of the live database as SQL text, one statement per row.
-- Run in the SQL editor, then export the result (Export > Download CSV) and convert with
-- scripts/csv_to_baseline.py. Read-only. Covers the public and private schemas: extensions,
-- sequences, tables (columns, defaults, constraints), indexes, views (with security_invoker), functions,
-- triggers, row level security, policies and grants. No data.
with
sch as (select unnest(array['public','private']) as s),
ext as (
  select 10 as ord, e.extname as obj, format('create extension if not exists %I with schema %I;', e.extname, n.nspname) as ddl
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
),
schemas as (
  select 15, s, format('create schema if not exists %I;', s) from sch
  where exists (select 1 from pg_namespace where nspname = s)
),
seqs as (
  select 20, c.relname, format('create sequence if not exists %I.%I;', n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'S' and n.nspname in (select s from sch)
),
tbls as (
  select 30, c.relname,
    format(E'create table if not exists %I.%I (\n%s\n);', n.nspname, c.relname,
      string_agg(format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
        case when a.attidentity in ('a','d') then ' generated ' || case a.attidentity when 'a' then 'always' else 'by default' end || ' as identity' else '' end,
        coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') || case when a.attnotnull then ' not null' else '' end),
        E',\n' order by a.attnum))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where c.relkind in ('r','p') and n.nspname in (select s from sch)
  group by n.nspname, c.relname
),
cons as (
  select case when con.contype = 'f' then 45 else 40 end, rel.relname || '.' || con.conname,
    format('alter table %I.%I add constraint %I %s;', n.nspname, rel.relname, con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname in (select s from sch) and con.contype in ('p','u','f','c','x')
),
idx as (
  select 50, ic.relname, pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace n on n.oid = tc.relnamespace
  where n.nspname in (select s from sch)
    and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
),
fns as (
  select 60, p.oid::regprocedure::text, pg_get_functiondef(p.oid) || ';'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select s from sch) and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
),
vws as (
  select 70, c.relname,
    format(E'create or replace view %I.%I%s as\n%s', n.nspname, c.relname,
      coalesce(' with (' || array_to_string(c.reloptions, ', ') || ')', ''), pg_get_viewdef(c.oid, true))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname in (select s from sch)
),
mvs as (
  select 72, c.relname,
    format(E'create materialized view if not exists %I.%I as\n%s', n.nspname, c.relname, pg_get_viewdef(c.oid, true))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'm' and n.nspname in (select s from sch)
),
trg as (
  select 80, t.tgname, pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in (select s from sch)
),
rls as (
  select 90, c.relname,
    format('alter table %I.%I enable row level security;', n.nspname, c.relname)
      || case when c.relforcerowsecurity then format(' alter table %I.%I force row level security;', n.nspname, c.relname) else '' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity and n.nspname in (select s from sch)
),
pol as (
  select 95, p.tablename || '.' || p.policyname,
    format('create policy %I on %I.%I as %s for %s to %s%s%s;', p.policyname, p.schemaname, p.tablename,
      lower(p.permissive), lower(p.cmd), array_to_string(p.roles, ', '),
      coalesce(' using (' || p.qual || ')', ''), coalesce(' with check (' || p.with_check || ')', ''))
  from pg_policies p where p.schemaname in (select s from sch)
),
trevokes as (
  select 99, c.relname, format('revoke all on table %I.%I from anon, authenticated;', n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p','v','m') and n.nspname in (select s from sch)
),
tgrants as (
  select 100, g.table_name || '.' || g.grantee,
    format('grant %s on %I.%I to %I;', string_agg(lower(g.privilege_type), ', ' order by g.privilege_type), g.table_schema, g.table_name, g.grantee)
  from information_schema.role_table_grants g
  where g.table_schema in (select s from sch) and g.grantee in ('anon','authenticated','service_role')
  group by g.table_schema, g.table_name, g.grantee
),
fgrants as (
  select 110, p.oid::regprocedure::text || '.' || r.rolname,
    format('grant execute on function %s to %I;', p.oid::regprocedure, r.rolname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
  where n.nspname in (select s from sch) and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
    and has_function_privilege(r.rolname, p.oid, 'execute')
),
frevokes as (
  select 105, p.oid::regprocedure::text,
    format('revoke all on function %s from public, anon, authenticated;', p.oid::regprocedure)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select s from sch) and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
),
allrows(ord, obj, ddl) as (
  select * from ext union all select * from schemas union all select * from seqs union all select * from tbls
  union all select * from cons union all select * from idx union all select * from fns union all select * from vws
  union all select * from mvs union all select * from trg union all select * from rls union all select * from pol
  union all select * from trevokes union all select * from frevokes union all select * from tgrants union all select * from fgrants
)
select ord, obj, ddl from allrows order by ord, obj;
