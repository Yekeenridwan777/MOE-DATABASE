
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const users = [
  {
    name: 'Hotel Owner',
    username: 'owner',
    role: 'owner',
    password: process.env.SEED_OWNER_PASSWORD
  },
  {
    name: 'Barman',
    username: 'barman',
    role: 'barman',
    password: process.env.SEED_BARMAN_PASSWORD
  },
  {
    name: 'Waitress',
    username: 'waitress',
    role: 'waitress',
    password: process.env.SEED_WAITRESS_PASSWORD
  }
];

try {
  for (const user of users) {
    if (!user.password || user.password.length < 12) {
      throw new Error(
        `Set a strong Render environment password for ${user.username} (at least 12 characters).`
      );
    }
  }

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 12);

    await pool.query(
      `INSERT INTO users(name, username, password_hash, role)
       VALUES($1, $2, $3, $4)
       ON CONFLICT(username) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         active = TRUE`,
      [user.name, user.username, hash, user.role]
    );
  }

  const ownerResult = await pool.query(
    "SELECT id FROM users WHERE username = 'owner'"
  );
  const ownerId = ownerResult.rows[0].id;

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
       VALUES($1, $2, $3, $4)
       ON CONFLICT(name) DO NOTHING
       RETURNING id, quantity`,
      [name, quantity, threshold, price]
    );

    if (result.rows[0] && quantity > 0) {
      await pool.query(
        `INSERT INTO stock_movements
          (product_id, movement_type, quantity_change,
           balance_after, reference, performed_by)
         VALUES($1, 'opening', $2, $3, 'Opening test stock', $4)`,
        [result.rows[0].id, quantity, result.rows[0].quantity, ownerId]
      );
    }
  }

  console.log('Database setup complete. Test accounts are configured.');
} catch (error) {
  console.error('Database seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
