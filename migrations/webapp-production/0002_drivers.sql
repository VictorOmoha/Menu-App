-- Courier (driver) tables — powers the Dasher-style app at /driver
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  phone TEXT,
  city TEXT NOT NULL DEFAULT 'Lagos',
  vehicle_type TEXT NOT NULL DEFAULT 'motorcycle', -- car, motorcycle, scooter, ebike, bicycle
  status TEXT NOT NULL DEFAULT 'active',
  rating_avg REAL NOT NULL DEFAULT 5.0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  offers_received INTEGER NOT NULL DEFAULT 0,
  offers_accepted INTEGER NOT NULL DEFAULT 0,
  lifetime_deliveries INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS driver_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active, ended
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME,
  ended_at DATETIME,
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);
CREATE INDEX IF NOT EXISTS idx_driver_shifts_driver_id ON driver_shifts(driver_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER UNIQUE NOT NULL,
  driver_id INTEGER NOT NULL,
  shift_id INTEGER,
  status TEXT NOT NULL DEFAULT 'accepted', -- accepted, arrived_store, picked_up, arrived_customer, delivered
  base_pay INTEGER NOT NULL DEFAULT 0, -- kobo
  tip INTEGER NOT NULL DEFAULT 0,
  total_pay INTEGER NOT NULL DEFAULT 0,
  distance_km REAL NOT NULL DEFAULT 0,
  dropoff_address TEXT,
  customer_rating INTEGER,
  accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  picked_up_at DATETIME,
  delivered_at DATETIME,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver_id ON deliveries(driver_id);

ALTER TABLE orders ADD COLUMN driver_id INTEGER;
ALTER TABLE orders ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
