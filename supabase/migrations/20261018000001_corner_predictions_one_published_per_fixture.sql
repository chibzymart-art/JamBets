-- Corners Specialist: permanent one-published-prediction-per-fixture guard.
--
-- Applied to production on 2026-10-18 together with a one-off cleanup that archived
-- (publication_status='archived', NOT deleted) the duplicate published rows, keeping the
-- settled row if any, otherwise the newest row per fixture.
--
-- The cleanup step below is idempotent: on a database that is already clean it changes nothing.
-- The immutability trigger is disabled only inside this transaction (archiving old settled
-- duplicates would otherwise raise "permanently immutable after 48 hours") and re-enabled
-- before commit.

begin;

alter table public.corner_predictions disable trigger trg_enforce_corner_immutability;

with ranked as (
  select id,
         row_number() over (
           partition by fixture_id
           order by (settlement_status in ('won', 'lost')) desc, created_at desc, id desc
         ) as rn
  from public.corner_predictions
  where publication_status = 'published'
    and settlement_status <> 'void'
)
update public.corner_predictions p
set publication_status = 'archived'
from ranked r
where p.id = r.id
  and r.rn > 1;

alter table public.corner_predictions enable trigger trg_enforce_corner_immutability;

create unique index if not exists corner_predictions_one_published_per_fixture
  on public.corner_predictions (fixture_id)
  where publication_status = 'published' and settlement_status <> 'void';

commit;
