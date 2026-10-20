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
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '200kb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

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
    return res.status(400).json({ error: 'Enter a product name and valid non-negative quantities/prices.' });
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

// Update product price or low-stock threshold (Owner only)
app.put('/api/products/:id', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.params.id);
  const { sellingPrice, lowStockThreshold } = req.body || {};
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    
    const updated = await client.query(
      'UPDATE products SET selling_price = COALESCE($1, selling_price), low_stock_threshold = COALESCE($2, low_stock_threshold) WHERE id=$3 RETURNING *',
      [sellingPrice !== undefined ? Number(sellingPrice) : null, lowStockThreshold !== undefined ? Number(lowStockThreshold) : null, productId]
    );
    await client.query('COMMIT');
    res.json({ product: updated.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not update product.' });
  } finally { client.release(); }
});

// Delete / Soft-delete a drink (Owner only)
app.delete('/api/products/:id', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    await client.query('UPDATE products SET active=FALSE WHERE id=$1', [productId]);
    await client.query('COMMIT');
    res.json({ message: 'Drink removed successfully.' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not delete product.' });
  } finally { client.release(); }
});

app.post('/api/stock/receive', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.body?.productId), quantity = Number(req.body?.quantity);
  const reference = String(req.body?.reference || '').trim();
  if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: 'Choose a product and enter a positive whole quantity.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE', [productId]);
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    const p = result.rows[0], balance = p.quantity + quantity;
    await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, productId]);
    await client.query(
      `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reference,performed_by)
       VALUES($1,'received',$2,$3,$4,$5)`,
      [productId, quantity, balance, reference || null, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Stock received.', balance });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Could not receive stock.' }); }
  finally { client.release(); }
});

app.get('/api/staff', allowRoles('owner'), async (_req, res) => {
  try {
    const result = await pool.query('SELECT id,name,username,role,active,created_at FROM users ORDER BY role,name');
    res.json({ staff: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load staff.' }); }
});

// Load all dockets
app.get('/api/dockets', async (req, res) => {
  const search = String(req.query.search || '').trim();
  try {
    const result = await pool.query(
      `SELECT d.id,d.docket_number,d.status,d.notes,d.created_at,d.issued_at,
              c.name AS created_by_name, b.name AS barman_name,
              COALESCE(json_agg(json_build_object('productId',p.id,'productName',p.name,'quantity',di.quantity,'unitPrice',di.unit_price))
                FILTER (WHERE di.id IS NOT NULL),'[]') AS items
       FROM dockets d
       JOIN users c ON c.id=d.created_by
       LEFT JOIN users b ON b.id=d.issued_by
       LEFT JOIN docket_items di ON di.docket_id=d.id
       LEFT JOIN products p ON p.id=di.product_id
       WHERE ($1='' OR d.docket_number ILIKE '%' || $1 || '%')
       GROUP BY d.id,c.name,b.name
       ORDER BY d.created_at DESC LIMIT 100`,
      [search]
    );
    res.json({ dockets: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load dockets.' }); }
});

// Barman-entered paper docket
app.post('/api/dockets/barman', allowRoles('owner','barman'), async (req, res) => {
  const docketNumber = String(req.body?.docketNumber || '').trim();
  const items = req.body?.items;
  
  if (!docketNumber || docketNumber.length > 80 || !Array.isArray(items) || items.length < 1) {
    return res.status(400).json({ error: 'Docket number and at least one item are required.' });
  }
  const cleanItems = items.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity) }));
  if (cleanItems.some(i => !Number.isInteger(i.productId) || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
    return res.status(400).json({ error: 'Each item must have a product and positive whole quantity.' });
  }
  if (new Set(cleanItems.map(i => i.productId)).size !== cleanItems.length) {
    return res.status(400).json({ error: 'Choose each product only once per docket; combine its quantity.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query(
      `INSERT INTO dockets(docket_number, created_by, status, issued_by, issued_at)
       VALUES($1, $2, 'issued', $3, NOW()) RETURNING id, docket_number, status, created_at`,
      [docketNumber, req.user.id, req.user.id]
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
    res.status(201).json({ message: 'Docket saved and stock deducted successfully.', docket: d.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'That docket number already exists.' });
    if (e.message.startsWith('Insufficient stock') || e.message === 'One selected product is unavailable.') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'Could not record docket.' });
  } finally { client.release(); }
});

// Barman edit / return route supporting docket number changes
app.put('/api/dockets/:id/edit', allowRoles('owner','barman'), async (req, res) => {
  const docketId = Number(req.params.id);
  const newDocketNumber = String(req.body?.newDocketNumber || '').trim();
  const items = req.body?.items;

  if (!Number.isInteger(docketId) || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid request data.' });
  }
  const cleanItems = items.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity) }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dResult = await client.query('SELECT * FROM dockets WHERE id=$1 FOR UPDATE', [docketId]);
    const docket = dResult.rows[0];
    if (!docket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Docket not found.' }); }

    const targetDocketNum = newDocketNumber || docket.docket_number;
    if (targetDocketNum !== docket.docket_number) {
      const dup = await client.query('SELECT id FROM dockets WHERE docket_number=$1 AND id<>$2', [targetDocketNum, docketId]);
      if (dup.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That docket number already exists.' }); }
    }

    // 1. Revert previous stock movements for this docket
    const oldItems = await client.query('SELECT * FROM docket_items WHERE docket_id=$1', [docketId]);
    for (const oldItem of oldItems.rows) {
      const pr = await client.query('SELECT id, quantity FROM products WHERE id=$1 FOR UPDATE', [oldItem.product_id]);
      if (pr.rows[0]) {
        const restoredBalance = pr.rows[0].quantity + oldItem.quantity;
        await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [restoredBalance, oldItem.product_id]);
        await client.query(
          `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, reason, performed_by)
           VALUES($1, 'void_reversal', $2, $3, $4, 'Docket edit/return reversal', $5)`,
          [oldItem.product_id, oldItem.quantity, restoredBalance, docketId, req.user.id]
        );
      }
    }
    await client.query('DELETE FROM docket_items WHERE docket_id=$1', [docketId]);

    // 2. Update docket metadata
    await client.query('UPDATE dockets SET docket_number=$1 WHERE id=$2', [targetDocketNum, docketId]);

    // 3. Apply new items and deduct stock
    for (const item of cleanItems) {
      if (item.quantity <= 0) continue;
      const pr = await client.query('SELECT id, name, quantity, selling_price, active FROM products WHERE id=$1 FOR UPDATE', [item.productId]);
      const p = pr.rows[0];
      if (!p || !p.active) throw new Error('One selected product is unavailable.');
      if (p.quantity < item.quantity) throw new Error(`Insufficient stock for ${p.name}. Available: ${p.quantity}, requested: ${item.quantity}.`);
      
      const balance = p.quantity - item.quantity;
      await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, p.id]);
      await client.query('INSERT INTO docket_items(docket_id, product_id, quantity, unit_price) VALUES($1, $2, $3, $4)', [docketId, item.productId, item.quantity, p.selling_price]);
      await client.query(
        `INSERT INTO stock_movements(product_id, movement_type, quantity_change, balance_after, docket_id, reason, performed_by)
         VALUES($1, 'issued', $2, $3, $4, 'Docket edited', $5)`,
        [p.id, -item.quantity, balance, docketId, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Docket updated successfully and inventory adjusted.' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.message.startsWith('Insufficient stock') || e.message === 'One selected product is unavailable.') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'Could not update docket.' });
  } finally { client.release(); }
});

app.get('/api/reports/summary', allowRoles('owner'), async (_req, res) => {
  try {
    const [stock, issued, movements] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS product_count, 
                         COALESCE(SUM(quantity),0)::int AS total_units,
                         COALESCE(SUM(quantity * selling_price),0)::numeric(12,2) AS total_stock_value,
                         COUNT(*) FILTER (WHERE quantity <= low_stock_threshold)::int AS low_stock_count
                  FROM products WHERE active=TRUE AND quantity > 0`),
      
      pool.query(`SELECT COUNT(DISTINCT d.id)::int AS dockets_issued_today,
                         COALESCE(SUM(di.quantity),0)::int AS units_issued_today,
                         COALESCE(SUM(di.quantity * di.unit_price),0)::numeric(12,2) AS recorded_value_today
                  FROM dockets d JOIN docket_items di ON di.docket_id=d.id
                  WHERE d.status='issued' 
                  AND d.issued_at >= (CURRENT_TIMESTAMP::date + INTERVAL '6 hours' - INTERVAL '1 day')
                  AND d.issued_at < (CURRENT_TIMESTAMP::date + INTERVAL '6 hours')`),
      
      pool.query(`SELECT sm.id,sm.movement_type,sm.quantity_change,sm.balance_after,sm.reference,sm.reason,sm.created_at,
                         p.name AS product_name,u.name AS staff_name,d.docket_number
                  FROM stock_movements sm JOIN products p ON p.id=sm.product_id
                  JOIN users u ON u.id=sm.performed_by LEFT JOIN dockets d ON d.id=sm.docket_id
                  ORDER BY sm.created_at DESC LIMIT 30`)
    ]);
    res.json({ stock: stock.rows[0], issuedToday: issued.rows[0], recentMovements: movements.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load report.' }); }
});

app.post('/api/stock/adjust', allowRoles('owner'), async (req, res) => {
  const productId = Number(req.body?.productId), delta = Number(req.body?.quantityChange);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(productId) || !Number.isInteger(delta) || delta === 0 || !reason) return res.status(400).json({ error: 'Product, non-zero quantity change and reason are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE', [productId]);
    const p = result.rows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }); }
    const balance = p.quantity + delta;
    if (balance < 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Adjustment cannot make stock negative.' }); }
    await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [balance, productId]);
    await client.query(
      `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reason,performed_by)
       VALUES($1,'adjustment',$2,$3,$4,$5)`,
      [productId,delta,balance,reason,req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Adjustment recorded.', balance });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Could not adjust stock.' }); }
  finally { client.release(); }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Bar stock API running on http://localhost:${port}`));