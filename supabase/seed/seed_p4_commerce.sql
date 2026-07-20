-- ATLITOS v2 — seed_p4_commerce.sql
-- Phase 4 commerce catalog: realistic sports gear products, variants with
-- varied stock levels, and specific test cases for gate verification.
--
-- Test cases included:
-- 1. At least one variant with stock = 1 (oversell probe, gate clause 4)
-- 2. At least one variant with stock = 0 (out-of-stock UI state)
-- 3. Products priced so cart total lands EXACTLY on a multiple of 10
--    (zero-roundup edge case, per D-053's decision on donation roundup)
-- 4. At least one product that does NOT land on multiple of 10
--
-- Roundup math: cart total = subtotal + delivery (40) + GST (10% of subtotal)
-- For multiple-of-10 landing: subtotal 100 gives 100 + 40 + 10 = 150
-- For non-multiple: subtotal 150 gives 150 + 40 + 15 = 205 (rounds to 210)
--
-- Idempotent: uses fixed literal ids with on conflict do nothing. Safe to re-run.

do $$
begin
  -- ==========================================================================
  -- Categories (sports)
  -- ==========================================================================

  insert into public.categories (id, name, slug)
  values
    ('10000000-0000-0000-0000-000000000001', 'Cricket', 'cricket'),
    ('10000000-0000-0000-0000-000000000002', 'Badminton', 'badminton'),
    ('10000000-0000-0000-0000-000000000003', 'Tennis', 'tennis'),
    ('10000000-0000-0000-0000-000000000004', 'Football', 'football')
  on conflict (id) do nothing;

  -- ==========================================================================
  -- Products (14 total across sports, varied base prices)
  -- ==========================================================================

  insert into public.products (id, title, description, category_id, sport, base_price, active, recommended_rank)
  values
    -- Cricket (5 products)
    ('20000000-0000-0000-0000-000000000001', 'Professional Cricket Bat',
     'Hand crafted willow cricket bat with natural toe guard. Suitable for all formats of play.',
     '10000000-0000-0000-0000-000000000001', 'cricket', 1500.00, true, 1),

    ('20000000-0000-0000-0000-000000000002', 'Leather Cricket Gloves',
     'Protective batting gloves with padding on palm and back. Available in small, medium, and large sizes.',
     '10000000-0000-0000-0000-000000000001', 'cricket', 350.00, true, 2),

    ('20000000-0000-0000-0000-000000000003', 'Cricket Helmet with Grill',
     'Safety certified helmet with stainless steel grill. Lightweight and comfortable for extended wear.',
     '10000000-0000-0000-0000-000000000001', 'cricket', 800.00, true, 3),

    ('20000000-0000-0000-0000-000000000004', 'Pack of Cricket Balls',
     'Set of 6 leather cricket balls for practice and match play. Professional grade stitching.',
     '10000000-0000-0000-0000-000000000001', 'cricket', 600.00, true, 4),

    ('20000000-0000-0000-0000-000000000005', 'Cricket Legguards',
     'Protective legguards with adjustable straps. Covers knee and shin area.',
     '10000000-0000-0000-0000-000000000001', 'cricket', 450.00, true, 5),

    -- Badminton (4 products)
    ('20000000-0000-0000-0000-000000000006', 'Badminton Racket Pro Series',
     'Carbon fiber badminton racket with precision head design. Ideal for competitive play.',
     '10000000-0000-0000-0000-000000000002', 'badminton', 950.00, true, 1),

    ('20000000-0000-0000-0000-000000000007', 'Badminton Shuttlecocks Pack',
     'Pack of 12 feather shuttles with consistent flight. Perfect for practice and tournament play.',
     '10000000-0000-0000-0000-000000000002', 'badminton', 350.00, true, 2),

    ('20000000-0000-0000-0000-000000000008', 'Sports Socks Pack',
     'Pack of 3 pairs of cushioned sports socks. Moisture wicking and breathable fabric.',
     '10000000-0000-0000-0000-000000000002', 'badminton', 100.00, true, 3),

    ('20000000-0000-0000-0000-000000000009', 'Badminton Court Shoes',
     'Professional badminton shoes with ankle support and lateral stability. Non-marking rubber sole.',
     '10000000-0000-0000-0000-000000000002', 'badminton', 1200.00, true, 4),

    -- Tennis (3 products)
    ('20000000-0000-0000-0000-000000000010', 'Tennis Racket Carbon Series',
     'Lightweight carbon composite racket with enhanced control. Recommended for intermediate players.',
     '10000000-0000-0000-0000-000000000003', 'tennis', 2500.00, true, 1),

    ('20000000-0000-0000-0000-000000000011', 'Tennis Ball Canister',
     'Can of 3 pressurized tennis balls with felt coating. Championship quality.',
     '10000000-0000-0000-0000-000000000003', 'tennis', 200.00, true, 2),

    ('20000000-0000-0000-0000-000000000012', 'Tennis Wristband',
     'Sweat absorbing wristband with elastic strap. Available in multiple colors.',
     '10000000-0000-0000-0000-000000000003', 'tennis', 150.00, true, 3),

    -- Football (2 products)
    ('20000000-0000-0000-0000-000000000013', 'Professional Football',
     'Regulation size 5 football with synthetic leather. Designed for matches and practice.',
     '10000000-0000-0000-0000-000000000004', 'football', 850.00, true, 1),

    ('20000000-0000-0000-0000-000000000014', 'Football Training Cones',
     'Pack of 6 colorful agility cones for drills and field marking.',
     '10000000-0000-0000-0000-000000000004', 'football', 250.00, true, 2)
  on conflict (id) do nothing;

  -- ==========================================================================
  -- Product variants with stock levels including test cases
  --
  -- Key test variants:
  -- - Cricket Gloves (20000000-0000-0000-0000-000000000002): size M has stock = 1 (oversell)
  -- - Cricket Gloves (20000000-0000-0000-0000-000000000002): size L has stock = 0 (out-of-stock)
  -- - Sports Socks (20000000-0000-0000-0000-000000000008): stock landing multiple of 10
  -- ==========================================================================

  insert into public.product_variants (id, product_id, size, color, sku, price_override, stock)
  values
    -- Professional Cricket Bat (base 1500)
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Medium', 'Natural', 'BAT-PRO-M', null, 8),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Large', 'Natural', 'BAT-PRO-L', null, 6),

    -- Leather Cricket Gloves (base 350) — CRITICAL TEST VARIANTS
    ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Small', 'Black', 'GLOVE-CRI-S', null, 12),
    ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'Medium', 'Black', 'GLOVE-CRI-M', null, 1),      -- TEST: stock = 1 for oversell probe
    ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', 'Large', 'Black', 'GLOVE-CRI-L', null, 0),      -- TEST: stock = 0 for out-of-stock UI

    -- Cricket Helmet with Grill (base 800)
    ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', 'Medium', 'White', 'HELM-CRI-M', null, 10),
    ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000003', 'Large', 'White', 'HELM-CRI-L', null, 7),

    -- Pack of Cricket Balls (base 600)
    ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000004', 'Pack of 6', 'Red', 'BALL-CRI-6', null, 15),
    ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000004', 'Pack of 12', 'Red', 'BALL-CRI-12', 1050.00, 9),

    -- Cricket Legguards (base 450)
    ('30000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000005', 'Medium', 'White', 'LEG-CRI-M', null, 11),
    ('30000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000005', 'Large', 'White', 'LEG-CRI-L', null, 8),

    -- Badminton Racket Pro Series (base 950)
    ('30000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000006', 'Standard', 'Blue', 'RACKET-BAD-S', null, 14),
    ('30000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000006', 'Oversize', 'Blue', 'RACKET-BAD-O', null, 6),

    -- Badminton Shuttlecocks Pack (base 350)
    ('30000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000007', 'Pack of 12', 'White', 'SHUTTLE-12', null, 20),
    ('30000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000007', 'Pack of 24', 'White', 'SHUTTLE-24', 650.00, 5),

    -- Sports Socks Pack (base 100) — TEST: lands exactly on multiple of 10
    ('30000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000008', 'Pair Pack of 3', 'Black', 'SOCKS-3', null, 25),
    ('30000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000008', 'Pair Pack of 6', 'Black', 'SOCKS-6', 180.00, 10),

    -- Badminton Court Shoes (base 1200)
    ('30000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000009', 'Size 6', 'White', 'SHOE-BAD-6', null, 16),
    ('30000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000009', 'Size 8', 'White', 'SHOE-BAD-8', null, 13),
    ('30000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000009', 'Size 10', 'White', 'SHOE-BAD-10', null, 9),

    -- Tennis Racket Carbon Series (base 2500)
    ('30000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000010', 'Standard', 'Black', 'RACKET-TEN-S', null, 7),
    ('30000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000010', 'Oversized Head', 'Black', 'RACKET-TEN-O', null, 5),

    -- Tennis Ball Canister (base 200)
    ('30000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000011', 'Can of 3', 'Yellow', 'BALL-TEN-3', null, 30),

    -- Tennis Wristband (base 150)
    ('30000000-0000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000012', 'One Size', 'White', 'WRIST-TEN-W', null, 18),
    ('30000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000012', 'One Size', 'Black', 'WRIST-TEN-B', null, 12),

    -- Professional Football (base 850)
    ('30000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000013', 'Size 5', 'White', 'FOOT-PRO-5', null, 11),

    -- Football Training Cones (base 250)
    ('30000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000014', 'Pack of 6', 'Multi-color', 'CONE-6', null, 22)
  on conflict (id) do nothing;

end $$;
