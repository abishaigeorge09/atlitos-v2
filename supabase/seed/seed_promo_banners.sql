-- ATLITOS v2 — seed_promo_banners.sql
-- Seed rows for the Home promo carousel (0071_promo_banners.sql). Owed to the
-- integrator alongside the migration: `image_path` values below assume banner
-- images are uploaded to the `product-media` bucket at those paths first, the
-- carousel falls back to hidden per card art (title/CTA chip still render)
-- until then, never a broken image box.
insert into public.promo_banners (title, body, cta_label, cta_route, image_path, sort, active)
values
  (
    'Gear up for the season',
    'Fresh kit and training essentials, all in one place.',
    'Shop gear',
    '/shop/category/all',
    'promo/banner-gear.png',
    0,
    true
  ),
  (
    'Fund an athlete''s journey',
    'Back a verified athlete''s gear or fees through Empower.',
    'Explore Empower',
    '/home/empower',
    'promo/banner-empower.png',
    1,
    true
  ),
  (
    'Post your highlight',
    'Share your best plays and training clips on Clutch.',
    'Open Clutch',
    '/(tabs)/clutch',
    'promo/banner-clutch.png',
    2,
    true
  );
