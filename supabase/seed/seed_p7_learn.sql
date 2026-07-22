-- ATLITOS v2 — seed_p7_learn.sql
-- Domain: learn. Epic AT-9 (Learn and XP), story AT-137 (Track D: fixtures).
-- Seed realistic Learn content for P7 verification.
--
-- Contains:
--   - drills across cricket, tennis, badminton (varied difficulty, xp_value)
--   - One inactive drill to prove the catalog filter hides it
--   - roadmap_stages per sport with ascending xp_threshold
--   - milestones with both xp_threshold and drill_count criteria
--   - drill_completions for one demo player to populate roadmap/milestones
--
-- House style: no emoji, no hyphen/em-dash, concise benefit-led copy.
-- Every seed row carries explicit owner id. Isolation uses two ids asserted to DIFFER.

-- ============================================================================
-- Demo player IDs for isolation testing
-- ============================================================================

-- Player A: Gets completed drills and XP progression for roadmap/milestone render
insert into public.users (id, email, phone, created_at)
  values (
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    'player_a@test.local',
    '+919876543210',
    now()
  )
  on conflict do nothing;

-- Player B: Exists for isolation test (never gets Player A's data)
insert into public.users (id, email, phone, created_at)
  values (
    '550e8400-e29b-41d4-a716-446655440002'::uuid,
    'player_b@test.local',
    '+919876543211',
    now()
  )
  on conflict do nothing;

-- Set both as players (not coaches)
update public.users
  set has_role_player = true
  where id in (
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440002'::uuid
  );

-- ============================================================================
-- DRILLS: Cricket, Tennis, Badminton. Mostly active; one inactive to prove filter.
-- Authentic coaching copy: benefit-led, no emoji, no hyphen/em-dash.
-- ============================================================================

-- Cricket drills
insert into public.drills (id, title, description, sport, skill_category, difficulty, xp_value, active)
  values
    (
      '660e8400-e29b-41d4-a716-446655440001'::uuid,
      'Front foot defense',
      'Build a solid front foot stride against fast bowling. Focus on head position and bat alignment.',
      'cricket'::public.sport,
      'batting',
      'beginner'::public.drill_difficulty,
      50,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440002'::uuid,
      'Backfoot pull shot',
      'Master the pull against short deliveries. Improve timing and footwork for boundaries.',
      'cricket'::public.sport,
      'batting',
      'intermediate'::public.drill_difficulty,
      100,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440003'::uuid,
      'Yorker delivery practice',
      'Perfect your yorker length and line. Develop consistency under pressure.',
      'cricket'::public.sport,
      'bowling',
      'advanced'::public.drill_difficulty,
      150,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440004'::uuid,
      'Slip fielding basics',
      'Position yourself correctly in the slip. Learn hand movement and catch technique.',
      'cricket'::public.sport,
      'fielding',
      'beginner'::public.drill_difficulty,
      40,
      false -- Inactive to prove catalog filter
    ),
    (
      '660e8400-e29b-41d4-a716-446655440005'::uuid,
      'Reverse sweep',
      'Execute the reverse sweep against spinners. Improve hand placement and ball control.',
      'cricket'::public.sport,
      'batting',
      'advanced'::public.drill_difficulty,
      120,
      true
    );

-- Tennis drills
insert into public.drills (id, title, description, sport, skill_category, difficulty, xp_value, active)
  values
    (
      '660e8400-e29b-41d4-a716-446655440006'::uuid,
      'Forehand grip and stroke',
      'Master the eastern grip and smooth forehand mechanics. Build consistency from the baseline.',
      'tennis'::public.sport,
      'groundstroke',
      'beginner'::public.drill_difficulty,
      60,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440007'::uuid,
      'Backhand slice',
      'Develop a sharp backhand slice for court coverage. Use slice for transition and defense.',
      'tennis'::public.sport,
      'groundstroke',
      'intermediate'::public.drill_difficulty,
      90,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440008'::uuid,
      'Serve and volley',
      'Integrate serve and volley into your game. Master approach and finishing at the net.',
      'tennis'::public.sport,
      'serve',
      'advanced'::public.drill_difficulty,
      140,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440009'::uuid,
      'Footwork and court positioning',
      'Build explosive footwork and court awareness. Move efficiently to every ball.',
      'tennis'::public.sport,
      'movement',
      'beginner'::public.drill_difficulty,
      45,
      true
    );

-- Badminton drills
insert into public.drills (id, title, description, sport, skill_category, difficulty, xp_value, active)
  values
    (
      '660e8400-e29b-41d4-a716-446655440010'::uuid,
      'Overhead clear',
      'Execute a deep overhead clear to send your opponent to the back. Develop power and accuracy.',
      'badminton'::public.sport,
      'stroke',
      'beginner'::public.drill_difficulty,
      55,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440011'::uuid,
      'Drop shot precision',
      'Place the drop shot in the net zone to pull your opponent forward. Learn angle and control.',
      'badminton'::public.sport,
      'stroke',
      'intermediate'::public.drill_difficulty,
      95,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440012'::uuid,
      'Smash finishing',
      'Finish rallies with a well timed smash. Build racket speed and placement on weak returns.',
      'badminton'::public.sport,
      'stroke',
      'advanced'::public.drill_difficulty,
      130,
      true
    ),
    (
      '660e8400-e29b-41d4-a716-446655440013'::uuid,
      'Lateral footwork and lunges',
      'Move side to side with explosive lunges. Cover the court and reach difficult shots.',
      'badminton'::public.sport,
      'movement',
      'beginner'::public.drill_difficulty,
      50,
      true
    );

-- ============================================================================
-- ROADMAP_STAGES: Per sport with ascending xp_threshold. Names benefit-led.
-- ============================================================================

-- Cricket roadmap
insert into public.roadmap_stages (sport, stage_order, name, xp_threshold)
  values
    ('cricket'::public.sport, 1, 'Finding your stance', 0),
    ('cricket'::public.sport, 2, 'Building consistency', 100),
    ('cricket'::public.sport, 3, 'Expanding your game', 300),
    ('cricket'::public.sport, 4, 'Match ready', 600),
    ('cricket'::public.sport, 5, 'Elite athlete', 1000);

-- Tennis roadmap
insert into public.roadmap_stages (sport, stage_order, name, xp_threshold)
  values
    ('tennis'::public.sport, 1, 'Grip and basics', 0),
    ('tennis'::public.sport, 2, 'Baseline confidence', 120),
    ('tennis'::public.sport, 3, 'Net game emerging', 320),
    ('tennis'::public.sport, 4, 'Tournament player', 650),
    ('tennis'::public.sport, 5, 'Advanced competitor', 1100);

-- Badminton roadmap
insert into public.roadmap_stages (sport, stage_order, name, xp_threshold)
  values
    ('badminton'::public.sport, 1, 'Racket ready', 0),
    ('badminton'::public.sport, 2, 'Stroke control', 110),
    ('badminton'::public.sport, 3, 'Rally master', 310),
    ('badminton'::public.sport, 4, 'Competitive player', 620),
    ('badminton'::public.sport, 5, 'Champion mindset', 1050);

-- ============================================================================
-- MILESTONES: Seed-authored, both xp_threshold and drill_count criteria.
-- lucide icon names only (no emoji). Concise, benefit-led descriptions.
-- ============================================================================

insert into public.milestones (key, name, description, icon_name, criteria)
  values
    ('first_drill_complete', 'First drill completed', 'Mark your first drill complete and start your journey.', 'flag', '{"type":"drill_count","value":1}'::jsonb),
    ('ten_drills', 'Ten drills mastered', 'Complete ten drills. Consistency builds skill.', 'target', '{"type":"drill_count","value":10}'::jsonb),
    ('fifty_xp', 'Fifty XP earned', 'Earn 50 XP through focused practice.', 'zap', '{"type":"xp_threshold","value":50}'::jsonb),
    ('hundred_xp', 'Hundred XP milestone', 'Cross 100 XP and enter intermediate territory.', 'rocket', '{"type":"xp_threshold","value":100}'::jsonb),
    ('intermediate_trained', 'Intermediate drills completed', 'Master five intermediate level drills.', 'star', '{"type":"drill_count","value":5}'::jsonb),
    ('three_hundred_xp', '300 XP achievement', 'Reach 300 XP. You are building real skill now.', 'flame', '{"type":"xp_threshold","value":300}'::jsonb),
    ('half_thousand_xp', 'Five hundred XP reached', 'Cross 500 XP. The work is showing results.', 'heart', '{"type":"xp_threshold","value":500}'::jsonb),
    ('thousand_xp', 'Thousand XP legend', 'Achieve 1000 XP. Elite level training unlocked.', 'crown', '{"type":"xp_threshold","value":1000}'::jsonb);

-- ============================================================================
-- DRILL_COMPLETIONS: Player A completes several drills to populate roadmap/milestones.
-- Player B gets none (isolation test).
-- ============================================================================

insert into public.drill_completions (user_id, drill_id, completed_at)
  values
    (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '660e8400-e29b-41d4-a716-446655440001'::uuid,
      now() - interval '5 days'
    ),
    (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '660e8400-e29b-41d4-a716-446655440002'::uuid,
      now() - interval '4 days'
    ),
    (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '660e8400-e29b-41d4-a716-446655440005'::uuid,
      now() - interval '3 days'
    ),
    (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '660e8400-e29b-41d4-a716-446655440006'::uuid,
      now() - interval '2 days'
    ),
    (
      '550e8400-e29b-41d4-a716-446655440001'::uuid,
      '660e8400-e29b-41d4-a716-446655440008'::uuid,
      now() - interval '1 day'
    );
