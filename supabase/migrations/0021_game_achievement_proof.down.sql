-- AYRA Trading — rollback of 0021 (Q4.7-B2). Restores 0020's achievement plan and catalog. Refuses while any achievement
-- was recorded under 0021's rules (q4.7): they are the users' achievements and a rollback deletes or rewrites nothing.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_achievements WHERE rules_version = 'q4.7' OR source = 'snapshot_record') THEN
    RAISE EXCEPTION 'game_rollback_achievements: achievements were recorded under the q4.7 rules — keep them; roll forward instead';
  END IF;
END $$;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

ALTER TABLE public.game_achievements ALTER COLUMN rules_version SET DEFAULT 'q4.6';
ALTER TABLE public.game_achievements DROP CONSTRAINT IF EXISTS game_achievements_source_check;
ALTER TABLE public.game_achievements ADD CONSTRAINT game_achievements_source_check
  CHECK (source IN ('reconciled_event', 'journal_record', 'confirmed_level', 'accepted_level', 'game_rule', 'device_flag'));

SET LOCAL ROLE game_economy_owner;
UPDATE public.game_achievement_catalog AS c SET proof = v.proof, rule = v.rule
FROM (VALUES
  ('stylist', 'game_rule', 'equipment with at least one slot (every new character has the starter outfit)'),
  ('firstTrade', 'event_or_journal', 'the trade quest completed, or a first trade'),
  ('firstNote', 'event_or_journal', 'a first note'),
  ('firstPlan', 'event_or_journal', 'a first day plan'),
  ('firstReview', 'journal', 'a day plan with its review completed'),
  ('plans7', 'journal', 'seven day plans'),
  ('firstPropRules', 'journal', 'prop account rules saved'),
  ('firstScreenshot', 'event', 'a first rewarded screenshot')
) AS v(id, proof, rule)
WHERE c.id = v.id;
RESET ROLE;
ALTER TABLE public.game_achievement_catalog DROP CONSTRAINT IF EXISTS game_achievement_catalog_proof_check;
ALTER TABLE public.game_achievement_catalog ADD CONSTRAINT game_achievement_catalog_proof_check
  CHECK (proof IN ('event', 'event_or_journal', 'journal', 'level', 'game_rule', 'device_only'));

-- 0020's plan, as it was
CREATE OR REPLACE FUNCTION public.game_mig_achievement_plan(p_user UUID, p_result JSONB, p_final_xp BIGINT)
RETURNS JSONB AS $$
DECLARE
  c_profile CONSTANT TEXT[] := ARRAY['firstQuest', 'stylist', 'streakDay', 'level3', 'author', 'firstTrade', 'consciousRefusal', 'firstPlan',
    'firstReview', 'firstNote', 'plans7', 'firstScreenshot', 'firstPropRules', 'propDisciplined5'];
  c_cats CONSTANT TEXT[] := ARRAY['discipline', 'physical', 'learning', 'psychology', 'trading', 'habits'];
  c_ranks CONSTANT TEXT[] := ARRAY['bronze', 'silver', 'gold'];
  s RECORD;
  c RECORD;
  k TEXT;
  x JSONB;
  v_events JSONB := COALESCE(p_result -> 'events', '[]'::jsonb);
  v_claims JSONB := '[]';
  v_unknown JSONB := '[]';
  v_items JSONB := '[]';
  v_status TEXT;
  v_source TEXT;
  v_evidence JSONB;
  v_detail JSONB;
  v_found TEXT;
  v_n BIGINT;
BEGIN
  FOR s IN SELECT snapshot_id::text AS id, content FROM public.game_imports
           WHERE user_id = p_user AND status = 'accepted' ORDER BY snapshot_id::text COLLATE "C" LOOP
    FOR k, x IN SELECT key, value FROM jsonb_each(public.game_mig_obj(s.content -> 'achievements')) LOOP
      IF x IS DISTINCT FROM 'true'::jsonb THEN
        CONTINUE;  -- not unlocked on this device
      END IF;
      IF k = ANY (c_profile) THEN
        v_claims := v_claims || jsonb_build_object('id', k, 'family', 'profile', 'snap', s.id, 'detail', '{}'::jsonb);
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'achievements', 'key', left(k, 80));
      END IF;
    END LOOP;
    FOR k, x IN SELECT key, value FROM jsonb_each(public.game_mig_obj(s.content -> 'personalAchievements')) LOOP
      IF k = ANY (c_cats) AND COALESCE(public.game_mig_str(x -> 'rank') = ANY (c_ranks), FALSE)
         AND COALESCE(public.game_mig_str(x -> 'runId') ~ '^[A-Za-z0-9_.-]{1,80}$', FALSE) AND public.game_mig_is_day(public.game_mig_str(x -> 'day')) THEN
        v_claims := v_claims || jsonb_build_object('id', 'category:' || k, 'family', 'category', 'snap', s.id,
          'detail', jsonb_build_object('rank', x ->> 'rank', 'runId', x ->> 'runId', 'day', x ->> 'day'));
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'personalAchievements', 'key', left(k, 80));
      END IF;
    END LOOP;
    FOR x IN SELECT value FROM jsonb_array_elements(public.game_mig_arr(s.content -> 'weekTrophies')) LOOP
      IF public.game_mig_is_day(public.game_mig_str(x -> 'week')) AND COALESCE(public.game_mig_str(x -> 'boss') ~ '^[A-Za-z0-9_.-]{1,40}$', FALSE) THEN
        v_claims := v_claims || jsonb_build_object('id', 'week:' || (x ->> 'week'), 'family', 'week', 'snap', s.id,
          'detail', jsonb_build_object('boss', x ->> 'boss'));
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'weekTrophies', 'key', left(COALESCE(x ->> 'week', '?'), 80));
      END IF;
    END LOOP;
  END LOOP;

  -- one item per stable id, however many devices had it
  FOR c IN SELECT * FROM (
             SELECT cl ->> 'id' AS id, min(cl ->> 'family') AS family,
                    jsonb_agg(DISTINCT cl ->> 'snap' ORDER BY cl ->> 'snap') AS snaps,
                    jsonb_agg(cl -> 'detail' ORDER BY cl ->> 'snap' COLLATE "C") AS details
             FROM jsonb_array_elements(v_claims) cl GROUP BY cl ->> 'id') g
           ORDER BY g.id COLLATE "C" LOOP
    v_status := 'pending_review';
    v_source := 'device_flag';
    v_evidence := '{}';
    v_detail := c.details -> 0;
    v_found := NULL;
    IF c.family = 'profile' THEN
      CASE c.id
        WHEN 'firstQuest' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'kind' = 'quest' ORDER BY e ->> 'key' COLLATE "C" LIMIT 1;
        WHEN 'streakDay' THEN
          SELECT q.day INTO v_found FROM (SELECT e ->> 'day' AS day FROM jsonb_array_elements(v_events) e WHERE e ->> 'kind' = 'quest'
                                           GROUP BY e ->> 'day' HAVING count(*) >= 3) q ORDER BY q.day COLLATE "C" LIMIT 1;
        WHEN 'firstTrade' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e
          WHERE e ->> 'key' = 'first:trade' OR e ->> 'key' ~ '^quest:[0-9]{4}-[0-9]{2}-[0-9]{2}:q_tradelog$' ORDER BY e ->> 'key' COLLATE "C" LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_trades WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_trades', 'records', v_n); END IF;
        WHEN 'consciousRefusal' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:noTrade' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_no_trades WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_no_trades', 'records', v_n); END IF;
        WHEN 'firstPlan' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:dayPlan' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'records', v_n); END IF;
        WHEN 'firstNote' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:note' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_notes WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_notes', 'records', v_n); END IF;
        WHEN 'firstReview' THEN
          SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user AND jsonb_typeof(data -> 'review' -> 'completedAt') = 'string';
          IF v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'reviewed', v_n); END IF;
        WHEN 'plans7' THEN
          SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user;
          IF v_n >= 7 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'records', v_n); END IF;
        WHEN 'firstPropRules' THEN
          SELECT count(*) INTO v_n FROM public.journal_accounts WHERE user_id = p_user AND jsonb_typeof(data -> 'propRules') = 'object';
          IF v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_accounts', 'withPropRules', v_n); END IF;
        WHEN 'firstScreenshot' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:screenshot' LIMIT 1;
        WHEN 'level3' THEN
          IF public.game_level_for_xp(COALESCE((p_result -> 'proposed' ->> 'confirmedXp')::BIGINT, 0)) >= 3 THEN
            v_status := 'verified'; v_source := 'confirmed_level';
            v_evidence := jsonb_build_object('confirmedXp', (p_result -> 'proposed' ->> 'confirmedXp')::BIGINT);
          ELSIF p_final_xp IS NOT NULL AND public.game_level_for_xp(p_final_xp) >= 3 THEN
            -- the level only with the remainder a person accepted: never shown as independently proven
            v_status := 'legacy_accepted'; v_source := 'accepted_level'; v_evidence := jsonb_build_object('finalXp', p_final_xp);
          END IF;
        WHEN 'stylist' THEN
          v_status := 'verified'; v_source := 'game_rule'; v_evidence := jsonb_build_object('rule', 'every character starts with an outfit (T3)');
        ELSE
          NULL;  -- author, propDisciplined5: the device's flag only
      END CASE;
      IF v_found IS NOT NULL THEN
        v_status := 'verified';
        v_source := 'reconciled_event';
        v_evidence := CASE WHEN c.id = 'streakDay' THEN jsonb_build_object('day', v_found) ELSE jsonb_build_object('key', v_found) END;
      END IF;
    ELSIF c.family = 'category' THEN
      -- proven when a claimed best run is a PAID personal quest of the reconciliation with this category and rank
      SELECT d INTO v_detail FROM jsonb_array_elements(c.details) d
      WHERE ('pq:' || (d ->> 'runId')) IN (SELECT e ->> 'key' FROM jsonb_array_elements(v_events) e)
        AND EXISTS (SELECT 1 FROM public.game_imports i, jsonb_array_elements(public.game_mig_arr(i.content -> 'personalLedger')) l
                    WHERE i.user_id = p_user AND i.status = 'accepted' AND l -> 'paid' = 'true'::jsonb AND l ->> 'runId' = d ->> 'runId'
                      AND l ->> 'category' = substr(c.id, 10) AND l ->> 'rank' = d ->> 'rank')
      ORDER BY array_position(c_ranks, d ->> 'rank') DESC LIMIT 1;
      IF v_detail IS NOT NULL THEN
        v_status := 'verified'; v_source := 'reconciled_event'; v_evidence := jsonb_build_object('key', 'pq:' || (v_detail ->> 'runId'));
      ELSE
        SELECT d INTO v_detail FROM jsonb_array_elements(c.details) d ORDER BY array_position(c_ranks, d ->> 'rank') DESC LIMIT 1;
      END IF;
      IF (SELECT count(DISTINCT d ->> 'rank') FROM jsonb_array_elements(c.details) d) > 1 THEN
        v_evidence := v_evidence || jsonb_build_object('ranksClaimed', (SELECT jsonb_agg(DISTINCT d ->> 'rank') FROM jsonb_array_elements(c.details) d));
      END IF;
    ELSE
      -- a week trophy: kept on the device only (the week's journal check ran there)
      IF (SELECT count(DISTINCT d ->> 'boss') FROM jsonb_array_elements(c.details) d) > 1 THEN
        v_evidence := jsonb_build_object('bossesClaimed', (SELECT jsonb_agg(DISTINCT d ->> 'boss') FROM jsonb_array_elements(c.details) d));
      END IF;
    END IF;
    v_items := v_items || jsonb_build_object('id', c.id, 'family', c.family, 'status', v_status, 'source', v_source,
      'detail', COALESCE(v_detail, '{}'::jsonb), 'evidence', v_evidence, 'claimedBy', c.snaps);
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'unknown', v_unknown,
    'counts', (SELECT jsonb_object_agg(st, n) FROM (SELECT i ->> 'status' AS st, count(*) AS n FROM jsonb_array_elements(v_items) i GROUP BY 1) q));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_mig_achievement_plan(UUID, JSONB, BIGINT) OWNER TO game_economy_owner;
REVOKE ALL ON FUNCTION public.game_mig_achievement_plan(UUID, JSONB, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_mig_achievement_plan(UUID, JSONB, BIGINT) TO game_migration_admin;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
