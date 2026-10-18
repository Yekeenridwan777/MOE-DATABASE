# Bar Stock & Paper Docket MVP

A starter React + Express + PostgreSQL application for bar inventory, paper docket recording, stock movements, and owner reporting.

## Requirements
- Node.js 20+
- PostgreSQL 15+
- npm

## 1. Database
Create a PostgreSQL database named `bar_stock`.
From the `backend` folder, copy `.env.example` to `.env` and set your database connection string and JWT secret.
Then run:
```bash
npm install
npm run db:init
npm run seed
npm run dev
```

The seed command creates demo users:
- owner / `ChangeMe123!`
- barman / `ChangeMe123!`
- waitress / `ChangeMe123!`

Change these passwords before real use. Demo users and sample stock are for testing only.

## 2. Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Visit the URL printed by Vite (usually http://localhost:5173).

## MVP workflow
1. Sign in.
2. Owner can add stock and products.
3. Waitress can create a paper-docket record (docket number + requested drinks).
4. Barman can issue a pending docket. Stock is deducted in a database transaction.
5. Duplicate docket numbers are rejected. Reissuing an already-issued docket is rejected.
6. Owner can view stock, movement history, and a daily report.

## Important limitations
This is a starter MVP, not yet a fully audited production system. Test on sample data first. Before real use, add HTTPS deployment, secure secret management, backups, rate limiting, stronger password policy, and review access policies. The sample seed accounts/passwords must never be used in production. The app records issuance; it does not prove that a customer paid. Do not store real customer sensitive data.
