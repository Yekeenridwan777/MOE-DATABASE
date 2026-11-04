-- Food Menu & Pricing Options configured by Owner
CREATE TABLE IF NOT EXISTS food_menu (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  serving_option TEXT NOT NULL DEFAULT 'Regular',
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, serving_option)
);

-- Food Dockets entered by Chef
CREATE TABLE IF NOT EXISTS food_dockets (
  id SERIAL PRIMARY KEY,
  docket_number TEXT UNIQUE NOT NULL,
  waitress_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('pending','issued','cancelled')),
  settled BOOLEAN NOT NULL DEFAULT FALSE,
  settled_by INTEGER REFERENCES users(id),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Food Docket Items
CREATE TABLE IF NOT EXISTS food_docket_items (
  id SERIAL PRIMARY KEY,
  food_docket_id INTEGER NOT NULL REFERENCES food_dockets(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES food_menu(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
);

-- Add settlement tracking columns to drink dockets table if not already present
ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled_by INTEGER REFERENCES users(id);
ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- Waitress Settlements table to log owner approvals
CREATE TABLE IF NOT EXISTS waitress_settlements (
  id SERIAL PRIMARY KEY,
  waitress_id INTEGER NOT NULL REFERENCES users(id),
  business_date DATE NOT NULL,
  drink_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  food_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  combined_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  settled_by INTEGER NOT NULL REFERENCES users(id),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(waitress_id, business_date)
);