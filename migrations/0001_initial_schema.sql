-- Initial schema for Menu App MVP
-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer', -- guest (no row), customer, vendor, admin
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, -- random token (base64url)
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Vendors & Catalog
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_name TEXT NOT NULL,
  type TEXT NOT NULL, -- restaurant, truck, home_chef, street, baker, caterer
  tier TEXT NOT NULL DEFAULT 'basic',
  verified INTEGER NOT NULL DEFAULT 0, -- 0/1
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  payout_account_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  address TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  lat REAL,
  lng REAL,
  hours_json TEXT, -- JSON with weekly hours
  is_live_tracking INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_locations_vendor_id ON locations(vendor_id);

CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_menus_vendor_id ON menus(vendor_id);

CREATE TABLE IF NOT EXISTS menu_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);
CREATE INDEX IF NOT EXISTS idx_menu_sections_menu_id ON menu_sections(menu_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  photo TEXT,
  base_price INTEGER NOT NULL, -- store as cents
  is_available INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (section_id) REFERENCES menu_sections(id)
);
CREATE INDEX IF NOT EXISTS idx_menu_items_section_id ON menu_items(section_id);

CREATE TABLE IF NOT EXISTS option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  min INTEGER NOT NULL DEFAULT 0,
  max INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (item_id) REFERENCES menu_items(id)
);
CREATE INDEX IF NOT EXISTS idx_option_groups_item_id ON option_groups(item_id);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0, -- cents (+/-)
  FOREIGN KEY (group_id) REFERENCES option_groups(id)
);
CREATE INDEX IF NOT EXISTS idx_options_group_id ON options(group_id);

CREATE TABLE IF NOT EXISTS inventory (
  item_id INTEGER PRIMARY KEY,
  available_qty INTEGER,
  out_of_stock_until DATETIME,
  FOREIGN KEY (item_id) REFERENCES menu_items(id)
);

-- Orders & Payments
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  location_id INTEGER,
  type TEXT NOT NULL, -- pickup, delivery
  subtotal INTEGER NOT NULL,
  taxes INTEGER NOT NULL,
  fees INTEGER NOT NULL,
  tip INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Submitted', -- Draft, Submitted, Accepted, In-Prep, Ready, Out-for-Delivery, Completed, Canceled
  eta TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  selected_options_json TEXT, -- JSON array of option ids
  line_total INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (item_id) REFERENCES menu_items(id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'test',
  intent_id TEXT,
  status TEXT NOT NULL, -- created, authorized, captured, refunded, failed
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- published, flagged, removed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_vendor_id ON reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
