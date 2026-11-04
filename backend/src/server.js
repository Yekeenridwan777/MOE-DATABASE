import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from './db.js';
import { requireAuth, allowRoles } from './auth.js';

dotenv.config();
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '200kb' }));

app.use('/api/auth/login', rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  limit: 30,
  validate: { xForwardedForHeader: false, trustProxy: false }
}));

async function ensureDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','barman','waitress','chef','cashier'));

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
        waitress_id INTEGER REFERENCES users(id),
        created_by INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','cancelled')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled_by INTEGER REFERENCES users(id);
      ALTER TABLE dockets ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS docket_items (
        id SERIAL PRIMARY KEY,
        docket_id INTEGER NOT NULL REFERENCES dockets(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS food_menu (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        serving_option TEXT NOT NULL DEFAULT 'Regular',
        price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name, serving_option)
      );

      CREATE TABLE IF NOT EXISTS food_dockets (
        id SERIAL PRIMARY KEY,
        docket_number TEXT UNIQUE NOT NULL,
        waitress_id INTEGER REFERENCES users(id),
        created_by INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('pending','issued','cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE food_dockets ADD COLUMN IF NOT EXISTS settled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE food_dockets ADD COLUMN IF NOT EXISTS settled_by INTEGER REFERENCES users(id);
      ALTER TABLE food_dockets ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS food_docket_items (
        id SERIAL PRIMARY KEY,
        food_docket_id INTEGER NOT NULL REFERENCES food_dockets(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL REFERENCES food_menu(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
      );

      -- PERFORMANCE INDEXES TO ELIMINATE SLOW LOADING / LAG
      CREATE INDEX IF NOT EXISTS idx_dockets_waitress_settled ON dockets(waitress_id, settled);
      CREATE INDEX IF NOT EXISTS idx_food_dockets_waitress_settled ON food_dockets(waitress_id, settled);
      CREATE INDEX IF NOT EXISTS idx_docket_items_docket_id ON docket_items(docket_id);
      CREATE INDEX IF NOT EXISTS idx_food_docket_items_docket_id ON food_docket_items(food_docket_id);
    `);

    await pool.query("DELETE FROM users WHERE username IN ('blessing', 'mary')");

    const ownerPass = process.env.SEED_OWNER_PASSWORD || 'password123';
    const barmanPass = process.env.SEED_BARMAN_PASSWORD || 'barman123';
    const chefPass = process.env.SEED_CHEF_PASSWORD || 'chef123';
    const waitressPass = process.env.SEED_WAITRESS_PASSWORD || 'waitress123';
    const cashierPass = process.env.SEED_CASHIER_PASSWORD || 'cashier123';

    const usersToSeed = [
      { name: 'Bar Owner', username: 'owner', role: 'owner', pass: ownerPass },
      { name: 'Barman Staff', username: 'barman', role: 'barman', pass: barmanPass },
      { name: 'Head Chef', username: 'chef', role: 'chef', pass: chefPass },
      { name: 'Cashier Staff', username: 'cashier', role: 'cashier', pass: cashierPass },
      { name: 'Waitress 1', username: 'waitress1', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 2', username: 'waitress2', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 3', username: 'waitress3', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 4', username: 'waitress4', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 5', username: 'waitress5', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 6', username: 'waitress6', role: 'waitress', pass: waitressPass },
      { name: 'Waitress 7', username: 'waitress7', role: 'waitress', pass: waitressPass }
    ];

    for (const u of usersToSeed) {
      const hashed = await bcrypt.hash(u.pass, 10);
      const check = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
      if (check.rows.length === 0) {
        await pool.query('INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)', [u.name, u.username, hashed, u.role]);
      } else {
        await pool.query('UPDATE users SET password_hash = $1, role = $3, name = $4 WHERE username = $2', [hashed, u.username, u.role, u.name]);
      }
    }

    console.log('Database tables and role accounts synchronized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }
}

await ensureDatabase();

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  try {
    const result = await pool.query('SELECT id,name,username,password_hash,role,active FROM users WHERE username=$1', [String(username).trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '10h' });
    res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.use('/api', requireAuth);
app.get('/api/me', (req, res) => res.json({ user: req.user }));

app.get('/api/waitresses', allowRoles('owner','barman','chef','cashier'), async (_req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM users WHERE role='waitress' AND active=TRUE ORDER BY name");
    res.json({ waitresses: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load waitresses.' }); }
});

app.get('/api/products', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id,name,unit,quantity,low_stock_threshold,selling_price,active FROM products WHERE active=TRUE ORDER BY name');
    res.json({ products: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load products.' }); }
});

app.post('/api/products', allowRoles('owner'), async (req, res) => {
  const { name, unit = 'bottle', openingQuantity = 0, lowStockThreshold = 10, sellingPrice = 0 } = req.body || {};
  const qty = Number(openingQuantity), threshold = Number(lowStockThreshold), price = Number(sellingPrice);
  if (!String(name || '').trim() || !Number.isInteger(qty) || qty < 0 || !Number.isInteger(threshold) || threshold < 0 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'Enter valid product details.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      'INSERT INTO products(name,unit,quantity,low_stock_threshold,selling_price) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [String(name).trim(), String(unit).trim() || 'bottle', qty, threshold, price]
    );
    const p = inserted.rows[0];
    if (qty > 0) await client.query(
      `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reference,performed_by)
       VALUES($1,'opening',$2,$3,'Opening stock', $4)`,
      [p.id, qty, qty, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ product: p });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'A product with that name already exists.' });
    console.error(e); res.status(500).json({ error: 'Could not create product.' });
  } finally { client.release(); }
});

app.put('/api/products/:id', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.params.id);
  const { sellingPrice, lowStockThreshold } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      'UPDATE products SET selling_price = COALESCE($1, selling_price), low_stock_threshold = COALESCE($2, low_stock_threshold) WHERE id=$3 RETURNING *',
      [sellingPrice !== undefined ? Number(sellingPrice) : null, lowStockThreshold !== undefined ? Number(lowStockThreshold) : null, productId]
    );
    await client.query('COMMIT');
    res.json({ product: updated.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Could not update product.' });
  } finally { client.release(); }
});

app.delete('/api/products/:id', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE products SET active=FALSE WHERE id=$1', [productId]);
    await client.query('COMMIT');
    res.json({ message: 'Drink removed.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Could not delete product.' });
  } finally { client.release(); }
});

app.post('/api/stock/receive', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.body?.productId), qty = Number(req.body?.quantity);
  const reference = String(req.body?.reference || '').trim();
  if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Valid product and quantity are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
    const p = pr.rows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    const balance = p.quantity + qty;
    await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, productId]);
    await client.query(
      `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reference,performed_by) VALUES($1,'received',$2,$3,$4,$5)`,
      [productId, qty, balance, reference || 'Stock received', req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Stock received successfully.', balance });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Could not receive stock.' });
  } finally { client.release(); }
});

app.post('/api/stock/adjust', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.body?.productId), delta = Number(req.body?.quantityChange);
  const reason = String(req.body?.reason || '').trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
    const p = pr.rows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    const balance = p.quantity + delta;
    if (balance < 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Stock cannot be negative.' }); }
    await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, productId]);
    await client.query(
      `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reason,performed_by) VALUES($1,'adjustment',$2,$3,$4,$5)`,
      [productId, delta, balance, reason, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Stock adjusted.', balance });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Could not adjust stock.' });
  } finally { client.release(); }
});

app.get('/api/food/menu', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id,name,serving_option,price,active FROM food_menu WHERE active=TRUE ORDER BY name, serving_option');
    res.json({ menu: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load food menu.' }); }
});

app.post('/api/food/menu', allowRoles('owner'), async (req, res) => {
  const { name, servingOption = 'Regular', price = 0 } = req.body || {};
  const p = Number(price);
  if (!String(name || '').trim() || !Number.isFinite(p) || p < 0) {
    return res.status(400).json({ error: 'Valid food item name and price are required.' });
  }
  try {
    const inserted = await pool.query(
      'INSERT INTO food_menu(name, serving_option, price) VALUES($1, $2, $3) RETURNING *',
      [String(name).trim(), String(servingOption).trim() || 'Regular', p]
    );
    res.status(201).json({ item: inserted.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That food item with this serving option already exists.' });
    console.error(e); res.status(500).json({ error: 'Could not add food item.' });
  }
});

app.put('/api/food/menu/:id', allowRoles('owner'), async (req, res) => {
  const menuId = Number(req.params.id);
  const { price, active } = req.body || {};
  try {
    const updated = await pool.query(
      'UPDATE food_menu SET price = COALESCE($1, price), active = COALESCE($2, active) WHERE id=$3 RETURNING *',
      [price !== undefined ? Number(price) : null, active !== undefined ? Boolean(active) : null, menuId]
    );
    res.json({ item: updated.rows[0] });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not update menu item.' });
  }
});

app.get('/api/dockets', async (req, res) => {
  const search = String(req.query.search || '').trim();
  try {
    const result = await pool.query(
      `SELECT d.id,d.docket_number,d.status,d.settled,d.settled_at,d.notes,d.created_at,
              c.name AS created_by_name, w.name AS waitress_name, w.id AS waitress_id,
              COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS total_amount,
              COALESCE(json_agg(json_build_object('productId',p.id,'productName',p.name,'quantity',di.quantity,'unitPrice',di.unit_price))
                FILTER (WHERE di.id IS NOT NULL),'[]') AS items
       FROM dockets d
       JOIN users c ON c.id=d.created_by
       LEFT JOIN users w ON w.id=d.waitress_id
       LEFT JOIN docket_items di ON di.docket_id=d.id
       LEFT JOIN products p ON p.id=di.product_id
       WHERE ($1='' OR d.docket_number ILIKE '%' || $1 || '%')
       GROUP BY d.id,c.name,w.name,w.id
       ORDER BY d.created_at DESC LIMIT 200`,
      [search]
    );
    res.json({ dockets: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load dockets.' }); }
});

app.post('/api/dockets/barman', allowRoles('owner','barman'), async (req, res) => {
  const docketNumber = String(req.body?.docketNumber || '').trim();
  const waitressId = req.body?.waitressId ? Number(req.body?.waitressId) : null;
  const items = req.body?.items;
  
  if (!docketNumber || !Array.isArray(items) || items.length < 1) {
    return res.status(400).json({ error: 'Docket number and items are required.' });
  }
  const cleanItems = items.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity) }));
  if (cleanItems.some(i => !Number.isInteger(i.productId) || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
    return res.status(400).json({ error: 'Invalid item quantities.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query(
      `INSERT INTO dockets(docket_number, created_by, status, waitress_id, settled)
       VALUES($1, $2, 'issued', $3, FALSE) RETURNING id, docket_number, status, created_at`,
      [docketNumber, req.user.id, waitressId]
    );
    const docketId = d.rows[0].id;

    for (const item of cleanItems) {
      const pr = await client.query('SELECT id, name, quantity, selling_price, active FROM products WHERE id=$1 FOR UPDATE', [item.productId]);
      const p = pr.rows[0];
      if (!p || !p.active) throw new Error('One selected product is unavailable.');
      if (p.quantity < item.quantity) throw new Error(`Insufficient stock for ${p.name}. Available: ${p.quantity}, requested: ${item.quantity}.`);
      
      const balance = p.quantity - item.quantity;
      await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, p.id]);
      await client.query('INSERT INTO docket_items(docket_id, product_id, quantity, unit_price) VALUES($1, $2, $3, $4)', [docketId, item.productId, item.quantity, p.selling_price]);
      await client.query(
        `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, performed_by)
         VALUES($1, 'issued', $2, $3, $4, $5)`,
        [p.id, -item.quantity, balance, docketId, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Docket saved.', docket: d.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'That docket number already exists.' });
    if (e.message.startsWith('Insufficient stock') || e.message === 'One selected product is unavailable.') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e); res.status(500).json({ error: 'Could not record docket.' });
  } finally { client.release(); }
});

app.put('/api/dockets/:id/edit', allowRoles('owner','barman'), async (req, res) => {
  const docketId = Number(req.params.id);
  const newDocketNumber = String(req.body?.newDocketNumber || '').trim();
  const waitressId = req.body?.waitressId ? Number(req.body?.waitressId) : null;
  const items = req.body?.items;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dResult = await client.query('SELECT * FROM dockets WHERE id=$1 FOR UPDATE', [docketId]);
    const docket = dResult.rows[0];
    if (!docket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Docket not found.' }); }
    if (docket.settled) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot edit settled dockets.' }); }

    const targetDocketNum = newDocketNumber || docket.docket_number;
    const targetWaitress = waitressId !== undefined ? waitressId : docket.waitress_id;

    const oldItems = await client.query('SELECT * FROM docket_items WHERE docket_id=$1', [docketId]);
    for (const oldItem of oldItems.rows) {
      const pr = await client.query('SELECT id, quantity FROM products WHERE id=$1 FOR UPDATE', [oldItem.product_id]);
      if (pr.rows[0]) {
        const restoredBalance = pr.rows[0].quantity + oldItem.quantity;
        await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [restoredBalance, oldItem.product_id]);
        await client.query(
          `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, reason, performed_by)
           VALUES($1, 'void_reversal', $2, $3, $4, 'Docket edit reversal', $5)`,
          [oldItem.product_id, oldItem.quantity, restoredBalance, docketId, req.user.id]
        );
      }
    }
    await client.query('DELETE FROM docket_items WHERE docket_id=$1', [docketId]);
    await client.query('UPDATE dockets SET docket_number=$1, waitress_id=$2 WHERE id=$3', [targetDocketNum, targetWaitress, docketId]);

    for (const item of (items || [])) {
      const qty = Number(item.quantity);
      if (qty <= 0) continue;
      const pr = await client.query('SELECT id, name, quantity, selling_price, active FROM products WHERE id=$1 FOR UPDATE', [Number(item.productId)]);
      const p = pr.rows[0];
      if (!p || !p.active) throw new Error('Product unavailable.');
      if (p.quantity < qty) throw new Error(`Insufficient stock for ${p.name}.`);
      
      const balance = p.quantity - qty;
      await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, p.id]);
      await client.query('INSERT INTO docket_items(docket_id, product_id, quantity, unit_price) VALUES($1, $2, $3, $4)', [docketId, p.id, qty, p.selling_price]);
      await client.query(
        `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, reason, performed_by)
         VALUES($1, 'issued', $2, $3, $4, 'Docket edited', $5)`,
        [p.id, -qty, balance, docketId, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Docket updated successfully.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(400).json({ error: e.message || 'Could not update docket.' });
  } finally { client.release(); }
});

app.delete('/api/dockets/:id', allowRoles('owner'), async (req, res) => {
  const docketId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM dockets WHERE id=$1 FOR UPDATE', [docketId]);
    const docket = dRes.rows[0];
    if (!docket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Docket not found.' }); }
    if (docket.settled) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot delete settled dockets.' }); }

    const oldItems = await client.query('SELECT * FROM docket_items WHERE docket_id=$1', [docketId]);
    for (const oldItem of oldItems.rows) {
      const pr = await client.query('SELECT id, quantity FROM products WHERE id=$1 FOR UPDATE', [oldItem.product_id]);
      if (pr.rows[0]) {
        const restoredBalance = pr.rows[0].quantity + oldItem.quantity;
        await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [restoredBalance, oldItem.product_id]);
        await client.query(
          `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, reason, performed_by)
           VALUES($1, 'void_reversal', $2, $3, $4, 'Docket deletion reversal', $5)`,
          [oldItem.product_id, oldItem.quantity, restoredBalance, docketId, req.user.id]
        );
      }
    }
    await client.query('DELETE FROM docket_items WHERE docket_id=$1', [docketId]);
    await client.query('DELETE FROM dockets WHERE id=$1', [docketId]);
    await client.query('COMMIT');
    res.json({ message: 'Docket deleted and stock restored.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Could not delete docket.' });
  } finally { client.release(); }
});

app.get('/api/food/dockets', async (req, res) => {
  const search = String(req.query.search || '').trim();
  try {
    const result = await pool.query(
      `SELECT d.id,d.docket_number,d.status,d.settled,d.settled_at,d.created_at,
              c.name AS created_by_name, w.name AS waitress_name, w.id AS waitress_id,
              COALESCE(SUM(fdi.quantity * fdi.unit_price),0)::numeric(12,2) AS total_amount,
              COALESCE(json_agg(json_build_object('menuItemId',m.id,'itemName',m.name,'servingOption',m.serving_option,'quantity',fdi.quantity,'unitPrice',fdi.unit_price))
                FILTER (WHERE fdi.id IS NOT NULL),'[]') AS items
       FROM food_dockets d
       JOIN users c ON c.id=d.created_by
       LEFT JOIN users w ON w.id=d.waitress_id
       LEFT JOIN food_docket_items fdi ON fdi.food_docket_id=d.id
       LEFT JOIN food_menu m ON m.id=fdi.menu_item_id
       WHERE ($1='' OR d.docket_number ILIKE '%' || $1 || '%')
       GROUP BY d.id,c.name,w.name,w.id
       ORDER BY d.created_at DESC LIMIT 200`,
      [search]
    );
    res.json({ dockets: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load food dockets.' }); }
});

app.post('/api/food/dockets', allowRoles('owner','chef'), async (req, res) => {
  const docketNumber = String(req.body?.docketNumber || '').trim();
  const waitressId = req.body?.waitressId ? Number(req.body?.waitressId) : null;
  const items = req.body?.items;

  if (!docketNumber || !Array.isArray(items) || items.length < 1) {
    return res.status(400).json({ error: 'Docket number and items are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query(
      `INSERT INTO food_dockets(docket_number, created_by, status, waitress_id, settled)
       VALUES($1, $2, 'issued', $3, FALSE) RETURNING id, docket_number, status, created_at`,
      [docketNumber, req.user.id, waitressId]
    );
    const docketId = d.rows[0].id;

    for (const item of items) {
      const menuItemId = Number(item.menuItemId);
      const qty = Number(item.quantity);
      if (!Number.isInteger(menuItemId) || !Number.isInteger(qty) || qty <= 0) throw new Error('Invalid item or quantity.');

      const menuRes = await client.query('SELECT price, active FROM food_menu WHERE id=$1', [menuItemId]);
      const m = menuRes.rows[0];
      if (!m || !m.active) throw new Error('Selected food item is unavailable.');

      await client.query(
        'INSERT INTO food_docket_items(food_docket_id, menu_item_id, quantity, unit_price) VALUES($1, $2, $3, $4)',
        [docketId, menuItemId, qty, m.price]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Food docket recorded.', docket: d.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'That food docket number already exists.' });
    console.error(e); res.status(400).json({ error: e.message || 'Could not record food docket.' });
  } finally { client.release(); }
});

app.put('/api/food/dockets/:id/edit', allowRoles('owner','chef'), async (req, res) => {
  const docketId = Number(req.params.id);
  const newDocketNumber = String(req.body?.newDocketNumber || '').trim();
  const waitressId = req.body?.waitressId !== undefined ? (req.body.waitressId ? Number(req.body.waitressId) : null) : undefined;
  const items = req.body?.items;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM food_dockets WHERE id=$1 FOR UPDATE', [docketId]);
    const docket = dRes.rows[0];
    if (!docket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Food docket not found.' }); }
    if (docket.settled) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot edit settled food dockets.' }); }

    const targetNum = newDocketNumber || docket.docket_number;
    const targetWaitress = waitressId !== undefined ? waitressId : docket.waitress_id;

    await client.query('DELETE FROM food_docket_items WHERE food_docket_id=$1', [docketId]);
    await client.query('UPDATE food_dockets SET docket_number=$1, waitress_id=$2 WHERE id=$3', [targetNum, targetWaitress, docketId]);

    for (const item of (items || [])) {
      const menuItemId = Number(item.menuItemId);
      const qty = Number(item.quantity);
      if (qty <= 0) continue;
      const menuRes = await client.query('SELECT price, active FROM food_menu WHERE id=$1', [menuItemId]);
      const m = menuRes.rows[0];
      if (!m || !m.active) throw new Error('Menu item unavailable.');

      await client.query(
        'INSERT INTO food_docket_items(food_docket_id, menu_item_id, quantity, unit_price) VALUES($1, $2, $3, $4)',
        [docketId, menuItemId, qty, m.price]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Food docket updated successfully.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(400).json({ error: e.message || 'Could not update food docket.' });
  } finally { client.release(); }
});

app.delete('/api/food/dockets/:id', allowRoles('owner'), async (req, res) => {
  const docketId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM food_dockets WHERE id=$1 FOR UPDATE', [docketId]);
    const docket = dRes.rows[0];
    if (!docket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Food docket not found.' }); }
    if (docket.settled) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot delete settled food dockets.' }); }

    await client.query('DELETE FROM food_docket_items WHERE food_docket_id=$1', [docketId]);
    await client.query('DELETE FROM food_dockets WHERE id=$1', [docketId]);
    await client.query('COMMIT');
    res.json({ message: 'Food docket deleted.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Could not delete food docket.' });
  } finally { client.release(); }
});

app.get('/api/waitress/my-accounting', allowRoles('waitress'), async (req, res) => {
  try {
    const waitressId = req.user.id;
    const [drinkRes, foodRes, docketsList, foodDocketsList] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS total
         FROM dockets d JOIN docket_items di ON di.docket_id=d.id
         WHERE d.waitress_id=$1 AND d.settled=FALSE`,
        [waitressId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(fdi.quantity * fdi.unit_price),0)::numeric(12,2) AS total
         FROM food_dockets fd JOIN food_docket_items fdi ON fdi.food_docket_id=fd.id
         WHERE fd.waitress_id=$1 AND fd.settled=FALSE`,
        [waitressId]
      ),
      pool.query(
        `SELECT d.id, d.docket_number, d.settled, d.settled_at, d.created_at,
                COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS total_amount
         FROM dockets d LEFT JOIN docket_items di ON di.docket_id=d.id
         WHERE d.waitress_id=$1 GROUP BY d.id ORDER BY d.created_at DESC LIMIT 100`,
        [waitressId]
      ),
      pool.query(
        `SELECT fd.id, fd.docket_number, fd.settled, fd.settled_at, fd.created_at,
                COALESCE(SUM(fdi.quantity * fdi.unit_price),0)::numeric(12,2) AS total_amount
         FROM food_dockets fd LEFT JOIN food_docket_items fdi ON fdi.food_docket_id=fd.id
         WHERE fd.waitress_id=$1 GROUP BY fd.id ORDER BY fd.created_at DESC LIMIT 100`,
        [waitressId]
      )
    ]);

    const drinkTotal = Number(drinkRes.rows[0].total);
    const foodTotal = Number(foodRes.rows[0].total);
    const combinedTotal = drinkTotal + foodTotal;

    res.json({
      name: req.user.name,
      drinkTotal,
      foodTotal,
      combinedTotal,
      docketsCount: docketsList.rows.filter(d => !d.settled).length + foodDocketsList.rows.filter(d => !d.settled).length,
      drinkDockets: docketsList.rows,
      foodDockets: foodDocketsList.rows
    });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not load waitress accounting.' });
  }
});

app.get('/api/owner/waitress-accounting', allowRoles('owner','cashier'), async (_req, res) => {
  try {
    const waitresses = await pool.query("SELECT id, name, username FROM users WHERE role='waitress' AND active=TRUE ORDER BY name");
    
    const summary = await Promise.all(waitresses.rows.map(async w => {
      const [drinkRes, foodRes, drinkDockets, foodDockets] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS total
           FROM dockets d JOIN docket_items di ON di.docket_id=d.id
           WHERE d.waitress_id=$1 AND d.settled=FALSE`,
          [w.id]
        ),
        pool.query(
          `SELECT COALESCE(SUM(fdi.quantity * fdi.unit_price),0)::numeric(12,2) AS total
           FROM food_dockets fd JOIN food_docket_items fdi ON fdi.food_docket_id=fd.id
           WHERE fd.waitress_id=$1 AND fd.settled=FALSE`,
          [w.id]
        ),
        pool.query(
          `SELECT d.id, d.docket_number, d.settled, d.settled_at, d.created_at,
                  COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS total_amount,
                  COALESCE(json_agg(json_build_object('productName',p.name,'quantity',di.quantity,'unitPrice',di.unit_price))
                    FILTER (WHERE di.id IS NOT NULL),'[]') AS items
           FROM dockets d LEFT JOIN docket_items di ON di.docket_id=d.id LEFT JOIN products p ON p.id=di.product_id
           WHERE d.waitress_id=$1 GROUP BY d.id ORDER BY d.created_at DESC`,
          [w.id]
        ),
        pool.query(
          `SELECT fd.id, fd.docket_number, fd.settled, fd.settled_at, fd.created_at,
                  COALESCE(json_agg(json_build_object('itemName',m.name,'servingOption',m.serving_option,'quantity',fdi.quantity,'unitPrice',fdi.unit_price))
                    FILTER (WHERE fdi.id IS NOT NULL),'[]') AS items
           FROM food_dockets fd LEFT JOIN food_docket_items fdi ON fdi.food_docket_id=fd.id LEFT JOIN food_menu m ON m.id=fdi.menu_item_id
           WHERE fd.waitress_id=$1 GROUP BY fd.id ORDER BY fd.created_at DESC`,
          [w.id]
        )
      ]);

      const drinkTotal = Number(drinkRes.rows[0].total);
      const foodTotal = Number(foodRes.rows[0].total);
      const combinedTotal = drinkTotal + foodTotal;
      const allDockets = [...drinkDockets.rows, ...foodDockets.rows];
      const allBalancedOrEmpty = allDockets.length === 0 || allDockets.every(d => d.settled);

      return {
        id: w.id,
        name: w.name,
        username: w.username,
        drinkTotal,
        foodTotal,
        combinedTotal,
        status: (combinedTotal === 0 && allBalancedOrEmpty) ? 'Balanced' : 'Awaiting settlement',
        drinkDockets: drinkDockets.rows,
        foodDockets: foodDockets.rows
      };
    }));

    res.json({ waitresses: summary });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Could not load waitress accounting reports.' });
  }
});

app.post('/api/owner/settle-waitress/:id', allowRoles('owner','cashier'), async (req, res) => {
  const waitressId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    
    await client.query(
      `UPDATE dockets SET settled = TRUE, settled_by = $1, settled_at = $2 WHERE waitress_id = $3 AND settled = FALSE`,
      [req.user.id, now, waitressId]
    );
    await client.query(
      `UPDATE food_dockets SET settled = TRUE, settled_by = $1, settled_at = $2 WHERE waitress_id = $3 AND settled = FALSE`,
      [req.user.id, now, waitressId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Waitress accounting marked as balanced and dockets locked.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Could not settle accounting.' });
  } finally { client.release(); }
});

app.get('/api/reports/summary', allowRoles('owner','cashier'), async (_req, res) => {
  try {
    const [stock, issuedDrinks, issuedFood, movements] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS product_count, COALESCE(SUM(quantity),0)::int AS total_units, COALESCE(SUM(quantity * selling_price),0)::numeric(12,2) AS total_stock_value FROM products WHERE active=TRUE AND quantity > 0`),
      pool.query(`SELECT COUNT(DISTINCT d.id)::int AS dockets_issued, COALESCE(SUM(di.quantity),0)::int AS units_issued, COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS recorded_value FROM dockets d JOIN docket_items di ON di.docket_id=d.id`),
      pool.query(`SELECT COUNT(DISTINCT fd.id)::int AS dockets_issued, COALESCE(SUM(fdi.quantity * fdi.unit_price),0)::numeric(12,2) AS recorded_value FROM food_dockets fd JOIN food_docket_items fdi ON fdi.food_docket_id=fd.id`),
      pool.query(`SELECT sm.id,sm.movement_type,sm.quantity_change,sm.balance_after,sm.reference,sm.reason,sm.created_at, p.name AS product_name,u.name AS staff_name,d.docket_number FROM stock_movements sm JOIN products p ON p.id=sm.product_id JOIN users u ON u.id=sm.performed_by LEFT JOIN dockets d ON d.id=sm.docket_id ORDER BY sm.created_at DESC LIMIT 50`)
    ]);

    res.json({
      stock: stock.rows[0],
      drinkSalesToday: issuedDrinks.rows[0],
      foodSalesToday: issuedFood.rows[0],
      recentMovements: movements.rows
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load reports.' }); }
});

app.get('/', (_req, res) => {
  res.json({ status: 'online', message: 'Minista of Enjoyment Bar Stock API is running' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Minista of Enjoyment API running on http://localhost:${port}`));