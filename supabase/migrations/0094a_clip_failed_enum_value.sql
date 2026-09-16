-- 0094a: add the 'failed' clip_status enum value ALONE (must commit before any use in the same txn).
alter type public.clip_status add value if not exists 'failed';
