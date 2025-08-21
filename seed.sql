-- Seed data for Menu App MVP
INSERT INTO users (email, phone, role) VALUES
  ('alice@example.com', '+15550000001', 'customer'),
  ('bob@example.com', '+15550000002', 'vendor'),
  ('admin@example.com', '+15550000003', 'admin');

-- Vendors
INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count)
VALUES
  ('Sunset Tacos', 'truck', 'basic', 1, 4.6, 213),
  ('Home Chef Nia', 'home_chef', 'basic', 1, 4.9, 87),
  ('Green Bowl', 'restaurant', 'premium', 1, 4.4, 512);

-- Locations
INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking)
VALUES
  (1, '123 5th Ave', 'Metropolis', 'CA', '94000', 'US', 37.7749, -122.4194, '{"mon":["10:00-20:00"],"tue":["10:00-20:00"]}', 1),
  (2, '12 Baker St', 'Metropolis', 'CA', '94000', 'US', 37.78, -122.41, '{"mon":["09:00-18:00"],"tue":["09:00-18:00"]}', 0),
  (3, '500 Market St', 'Metropolis', 'CA', '94000', 'US', 37.79, -122.42, '{"mon":["11:00-22:00"],"tue":["11:00-22:00"]}', 0);

-- Menus
INSERT INTO menus (vendor_id, title, is_active) VALUES
  (1, 'Everyday Menu', 1),
  (2, 'Weekly Specials', 1),
  (3, 'Healthy Bowls', 1);

-- Sections
INSERT INTO menu_sections (menu_id, name, sort_order) VALUES
  (1, 'Tacos', 1),
  (1, 'Sides', 2),
  (2, 'Home Meals', 1),
  (3, 'Bowls', 1);

-- Items
INSERT INTO menu_items (section_id, name, description, photo, base_price, is_available) VALUES
  (1, 'Al Pastor Taco', 'Marinated pork with pineapple', NULL, 450, 1),
  (1, 'Chicken Taco', 'Grilled chicken taco', NULL, 400, 1),
  (2, 'Chips & Salsa', 'Corn chips with salsa', NULL, 250, 1),
  (3, 'Jollof Bowl', 'West African rice bowl', NULL, 1200, 1),
  (4, 'Green Goddess', 'Kale, quinoa, avocado', NULL, 1300, 1);

-- Options
INSERT INTO option_groups (item_id, name, min, max, required) VALUES
  (1, 'Salsa', 0, 2, 0),
  (2, 'Salsa', 0, 2, 0),
  (5, 'Protein', 1, 1, 1);

INSERT INTO options (group_id, name, price_delta) VALUES
  (1, 'Mild', 0),
  (1, 'Hot', 0),
  (2, 'Mild', 0),
  (2, 'Hot', 0),
  (3, 'Tofu', 0),
  (3, 'Chicken', 200),
  (3, 'Salmon', 400);
