import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const users = [
  ['Hotel Owner', 'owner', 'owner'],
  ['Demo Barman', 'barman', 'barman'],
  ['Demo Waitress', 'waitress', 'waitress']
];

try {
  const hash = await bcrypt.hash('ChangeMe123!', 12);
  for (const [name, username, role] of users) {
    await pool.query(
      `INSERT INTO users(name, username, password_hash, role)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(username) DO NOTHING`,
      [name, username, hash, role]
    );
  }
  const products = [
    ['Trophy', 50, 10, 1200],
    ['Goldberg', 30, 8, 1500],
    ['Coca-Cola', 40, 12, 500],
    ['Maltina', 20, 8, 700],
    ['Best Drink', 30, 8, 600],
    ['Fizzy Drink', 12, 5, 500],
    ['NSC', 50, 10, 600]
  ];
  for (const [name, quantity, threshold, price] of products) {
    const result = await pool.query(
      `INSERT INTO products(name, quantity, low_stock_threshold, selling_price)
       VALUES($1,$2,$3,$4) ON CONFLICT(name) DO NOTHING RETURNING id, quantity`,
      [name, quantity, threshold, price]
    );
    if (result.rows[0] && quantity > 0) {
      await pool.query(
        `INSERT INTO stock_movements(product_id,movement_type,quantity_change,balance_after,reference,performed_by)
         VALUES($1,'opening',$2,$3,'Demo opening stock',1)`,
        [result.rows[0].id, quantity, result.rows[0].quantity]
      );
    }
  }
  console.log('Demo seed complete. Logins: owner / barman / waitress; password ChangeMe123!');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
