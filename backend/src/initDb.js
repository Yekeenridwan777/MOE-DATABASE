import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','barman','waitress')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  unit TEXT NOT NULL DEFAULT 'bottle',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0),
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dockets (
  id SERIAL PRIMARY KEY,
  docket_number TEXT UNIQUE NOT NULL,
  waitress_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by INTEGER REFERENCES users(id),
  issued_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS docket_items (
  id SERIAL PRIMARY KEY,
  docket_id INTEGER NOT NULL REFERENCES dockets(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','received','issued','adjustment','breakage','void_reversal')),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  docket_id INTEGER REFERENCES dockets(id),
  reference TEXT,
  reason TEXT,
  performed_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dockets_created_at ON dockets(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date ON stock_movements(product_id, created_at DESC);
`;

try {
  await pool.query(sql);
  console.log('Database tables checked/created successfully.');

  // Always upsert or ensure default users exist with password: password123
  const hashedOwner = await bcrypt.hash('password123', 10);
  const hashedBarman = await bcrypt.hash('password123', 10);

  await pool.query(`
    INSERT INTO users (name, username, password_hash, role)
    VALUES 
      ('Bar Owner', 'owner', $1, 'owner'),
      ('Barman Staff', 'barman', $2, 'barman')
    ON CONFLICT (username) 
    DO UPDATE SET password_hash = EXCLUDED.password_hash;
  `, [hashedOwner, hashedBarman]);

  console.log('Default users (owner / barman) synchronized successfully.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}