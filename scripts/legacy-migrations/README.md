# Legacy migrations — preserved, NOT auto-run

`20240321000000-create-default-schedules.js` is a one-off **data backfill** from
March 2024: it inserts a default one-month schedule for every vehicle with a
NULL `hostId`.

It was written for `sequelize-cli`, **no runner was ever wired**, and it has
never executed anywhere.

It is kept out of `migrations/` deliberately. Adopting migrations must not
silently apply a two-year-old data change to production as a side effect —
and it would have: umzug sorts by filename, so `20240321…` runs *before* the
2026 baseline, against tables that do not exist yet on a fresh database (it
failed exactly that way when first tried).

If the backfill is still wanted, run it deliberately after reviewing whether the
condition it targets still exists:

```sql
SELECT COUNT(*) FROM vehicles WHERE hostId IS NULL;
```

If that is zero, the migration is a no-op and can be deleted.
