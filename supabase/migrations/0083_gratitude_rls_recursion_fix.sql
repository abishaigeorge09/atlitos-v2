-- 0083: fix infinite recursion in gratitude_posts INSERT policy.
--
-- QA audit (verify-rls-matrix.mjs) found gratitude_posts_insert_own (0049)
-- broken for EVERY applicant, not just adversarially: its WITH CHECK contains
--   not exists (select 1 from public.gratitude_posts g where g.wishlist_item_id = ...)
-- a subquery on gratitude_posts inside gratitude_posts' own policy. Postgres
-- rejects this as 42P17 (infinite recursion in policy), so every client insert
-- 500s -- PRD-05 FR-19 (gratitude posting) is fully non-functional. Reproduced
-- on a real owner posting on their own funded, unposted wishlist item.
--
-- Fix, same shape 0078/0081 already use for this exact class of problem: move
-- the self-referential existence check into a SECURITY DEFINER helper so the
-- policy never subqueries its own table. Only the one-gratitude-per-item guard
-- moves out; the ownership and funded-item checks stay inline (they reference
-- OTHER tables and are fine).

create or replace function public.gratitude_post_exists_for_item(
  p_wishlist_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gratitude_posts g
    where g.wishlist_item_id = p_wishlist_item_id
  );
$$;

revoke all on function public.gratitude_post_exists_for_item(uuid) from public;
revoke execute on function public.gratitude_post_exists_for_item(uuid) from anon;
grant execute on function public.gratitude_post_exists_for_item(uuid) to authenticated;

drop policy if exists gratitude_posts_insert_own on public.gratitude_posts;

create policy gratitude_posts_insert_own on public.gratitude_posts
  for insert to authenticated
  with check (
    status = 'published'
    and exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.applicant_user_id = auth.uid()
    )
    and exists (
      select 1 from public.upa_wishlist_items i
      where i.id = gratitude_posts.wishlist_item_id
        and i.upa_id = gratitude_posts.upa_id
        and i.status in ('funded', 'delivered')
    )
    and not public.gratitude_post_exists_for_item(gratitude_posts.wishlist_item_id)
  );
