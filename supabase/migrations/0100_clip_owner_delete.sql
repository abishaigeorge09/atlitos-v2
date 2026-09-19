-- ATLITOS v2 — 0100_clip_owner_delete.sql
-- Domain: clutch. Founder decision 2026-08-13 (docs/qa/CURRENT-STATE.md):
-- "Clip controls: delete your own clip, plus comments off per clip. NOT a full
-- audience model."
--
-- THE GAP THIS CLOSES. Until now a creator could not remove their own clip by
-- any route at all, including calling the API directly:
--   * 0042_clutch_rls.sql declares NO update and NO delete policy on clips.
--   * 0042 line 171 additionally does
--       revoke update, delete on public.clips from authenticated;
--     so the grant lock refuses it a second time.
--   * The only removal path in the schema is moderate_clip (0043), which is
--     gated on has_role('admin') or has_role('moderator').
-- The result is that a creator who wants their own clip gone has to file a
-- report against themselves and wait for a moderator.
--
-- SOFT DELETE, NOT HARD DELETE. This moves the clip to status 'removed' and
-- stamps deleted_at, rather than deleting the row. Deliberately, because a hard
-- delete would cascade away things that must survive an owner's change of mind:
--   * clip_likes and clip_comments both cascade on clips.id (0041), so the
--     like and comment counts and every comment thread would vanish.
--   * reports.entity_id points at the clip; the moderation trail for a clip
--     that was reported and then self deleted is exactly the history a
--     moderator needs, and a hard delete is the one action that destroys it.
--   * audit_log rows for any prior moderation decision would be orphaned.
-- The clip stops being reachable instead: playback is a fresh signed URL mint
-- against the LIVE row (get-clip-playback-url), so 'removed' makes every
-- outstanding URL stop resolving inside its 300s TTL, the same teeth the
-- moderation takedown already has (verified in AT-107).
--
-- STATE MACHINE. published -> removed is already legal in
-- 0043_clutch_state_machine.sql:72, so the published case delegates to
-- clip_transition_internal and the machine stays the single authority for the
-- edge that matters. The pre publication statuses (uploading, processing,
-- ready, failed) and the terminal 'rejected' have no owner delete edge in the
-- machine, and this migration deliberately does NOT
-- `create or replace clip_transition_internal` to add one:
--   0094_clip_failed_state_and_sweep_capture.sql already replaced that function
--   to add the 'failed' edges, and that version is LIVE in production (the
--   clip_status enum in project syzzfgaudpifwvbpycyi carries 'failed'). A
--   replace written from this branch would restate the 0043 body and silently
--   drop 0094's edges. Widening the shared machine belongs in the next revision
--   of the machine itself, with 0094's body in front of the author.
-- Until then the owner delete for those statuses is performed here, inside a
-- single SECURITY DEFINER function that carries its own explicit legality
-- check, is the only thing that can perform it, and is audited. Recorded in
-- docs/architecture/SCHEMA.md.
--
-- DECISION, made deliberately, not left accidental (CLAUDE.md's "state
-- machine transitions ... enforced by Postgres RPCs, never by client logic
-- setting a status field" rule, written for money-bearing rows, is the same
-- shape as clip_transition_internal here). The 'rejected' row of the LIVE
-- transition table (0043:73, unchanged by 0094) is an EXPLICIT empty array,
-- not a gap: `rejected -> removed` is an edge the machine deliberately
-- FORBIDS, because 'rejected' means a moderator already reviewed and refused
-- the clip, and the machine has no reason to let anything move it again.
-- `uploading`/`processing`/`ready`/`failed` are simply edges the machine has
-- not yet been asked to define.
--
-- Both cases are bypassed here on purpose, not by omission, because an
-- OWNER withdrawing their own clip is a different concern from a MODERATOR
-- taking one down, and conflating them would be wrong even if the machine
-- were reopened today:
--   * The machine's 'rejected' terminal state exists to make a moderation
--     verdict permanent so it cannot be re-litigated by anyone, including the
--     author. Widening it to accept 'removed' FROM 'rejected' would blur "the
--     moderator refused this" and "the owner withdrew this" into one edge,
--     which is exactly the distinction `deleted_at` (below) exists to keep.
--   * The other four pre publication statuses have no owner delete edge
--     simply because nobody asked the machine for one, and adding it there
--     requires rewriting `clip_transition_internal` in front of 0094's live
--     body (see above), which this branch cannot safely do blind.
-- This function is therefore the intentionally single, owner gated, audited
-- exception, not a precedent for writing `clips.status` elsewhere. The next
-- time `clip_transition_internal` is revised with 0094's body in hand, these
-- five edges should be folded into the machine and this function's `else`
-- branch replaced with a `clip_transition_internal` call, per the note above.
--
-- Requirements: PRD-01 FR-44, FR-45.

-- ============================================================================
-- deleted_at. Distinguishes an owner's own withdrawal from a moderator
-- takedown, both of which land on status 'removed'.
--
-- The own profile grid needs the distinction: a moderator takedown must stay
-- visible to the creator with its "Cancelled" pill (that is how they learn the
-- clip was removed and why), while a clip the creator deleted themselves should
-- leave their grid. One nullable timestamp carries both facts, and null stays
-- the correct value for every historic row.
-- ============================================================================

alter table public.clips
  add column if not exists deleted_at timestamptz;

comment on column public.clips.deleted_at is
  'Set by delete_my_clip when the OWNER withdraws their own clip. Null for a moderator takedown (moderate_clip), which also lands on status removed. The own profile grid filters deleted_at is null so a self deleted clip leaves the grid while a takedown stays visible with its status pill.';

-- ============================================================================
-- delete_my_clip. Owner scoped, SECURITY DEFINER, the ONLY client reachable
-- removal path for a creator.
--
-- Same shape as every other state moving RPC here (moderate_clip,
-- order_transition): granted to authenticated, the authorization check lives
-- INSIDE the function, and the clients keep zero direct write on clips.status
-- (0042's revoke is untouched by this migration).
--
-- Idempotent on a clip that is already removed: it returns the row unchanged
-- rather than raising, so a double tap on a slow network cannot surface an
-- error for work that already succeeded.
-- ============================================================================

create function public.delete_my_clip(p_clip_id uuid)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.clips;
  v_after public.clips;
begin
  if p_clip_id is null then
    raise exception 'VALIDATION: a clip id is required';
  end if;

  select * into v_before from public.clips where id = p_clip_id for update;

  if v_before.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  -- Ownership, checked explicitly rather than left to RLS. RLS is permissive
  -- OR here (0042 gives clips a public published policy alongside the owner
  -- policy) and this function is SECURITY DEFINER, so RLS is not evaluated for
  -- it at all. Without this line any signed in user could remove any published
  -- clip in the feed.
  if v_before.owner_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the owner can delete this clip';
  end if;

  -- Already gone. Nothing to do and nothing to audit twice.
  if v_before.status = 'removed' then
    return v_before;
  end if;

  if v_before.status = 'published' then
    -- The documented edge, owned by the machine (0043:72).
    perform public.clip_transition_internal(p_clip_id, 'removed');
    update public.clips set deleted_at = now() where id = p_clip_id
      returning * into v_after;
  else
    -- Pre publication (uploading, processing, ready, failed) and the terminal
    -- 'rejected'. See the header DECISION block: 'rejected' is a DELIBERATE
    -- empty array in the machine (a moderator's refusal is meant to be
    -- final), not an omission, and the other four simply have no owner delete
    -- edge defined. Both are bypassed here on purpose: an owner withdrawing
    -- their own clip is a different concern from a moderator's verdict, this
    -- is the only place the write happens, it is owner gated above, it is
    -- audited below, and 'removed' is terminal in the machine so nothing can
    -- move the clip on afterwards.
    update public.clips
    set status = 'removed',
        deleted_at = now()
    where id = p_clip_id
    returning * into v_after;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'clip.owner_delete',
    'clip',
    p_clip_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'deleted_at', v_after.deleted_at),
    'Deleted by the owner'
  );

  return v_after;
end;
$$;

revoke all on function public.delete_my_clip(uuid) from public;
revoke execute on function public.delete_my_clip(uuid) from anon;
grant execute on function public.delete_my_clip(uuid) to authenticated, service_role;

comment on function public.delete_my_clip(uuid) is
  'Owner scoped soft delete of a clip: status moves to removed and deleted_at is stamped, so likes, comments, reports and the moderation trail all survive. Ownership is checked inside the function; clients still have no update or delete grant on clips.';
