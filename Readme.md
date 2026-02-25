# LedgerPay: Production-Grade Digital Wallet

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

LedgerPay is a high-performance FinTech backend designed to handle digital wallet transactions securely. Instead of storing fragile "balance" columns that are prone to race conditions, it calculates balances dynamically using a true **Double-Entry Accounting Ledger**. This mirrors the architecture used by financial platforms that rely on strong financial invariants and auditability.

## Tech Stack

- Runtime: Node.js (TypeScript)
- API: Express + Swagger (OpenAPI)
- Data: PostgreSQL + Prisma ORM
- Cache: Redis
- Testing: Jest

## Core Engineering Features

* **Double-Entry Transfers:** Balances are never stored directly. Transfers create two immutable `LedgerEntry` rows (a Debit and a Credit). Deposits and withdrawals create a single signed entry.
* **Concurrency Control (Row-Level Locking):** Uses PostgreSQL `SELECT ... FOR UPDATE` to lock wallet rows for transfers and withdrawals. Deadlocks are avoided by sorting account IDs lexicographically before locking.
* **Idempotency Engine:** Integrates a Redis caching middleware layer. It checks `Idempotency-Key` headers on state-changing routes to ensure retries do not duplicate processing.
* **Financial Immutability:** Transactions are never deleted. Refunds are handled by creating a new transaction with inverse ledger entries and marking the original transaction as reversed.
* **ACID Compliance:** All money movements are wrapped in `prisma.$transaction`. If a process fails mid-execution, the entire operation safely rolls back.

## System Architecture & Transaction Flow (Transfer)

![System Architecture & Transaction Flow](./Ledger%20Pay%20transfer%20flow%20architecture.png)

This diagram illustrates LedgerPay's transfer workflow.

A database transaction is initiated before debiting the sender wallet.
Both debit and credit occur atomically using double-entry accounting.

If any step fails, the entire transaction is rolled back to preserve balance consistency.

## System Design Notes

1. **Ledger Invariant:** Transfers create equal and opposite entries that net to zero. Deposits and withdrawals use a single signed entry.
2. **Idempotency Guarantee:** State-changing endpoints (add money, transfer, withdraw, refund) require an `Idempotency-Key`, and successful responses are cached in Redis for 24 hours.
3. **Consistency Model:** All writes happen inside a single database transaction; transfers and withdrawals use row-level locking to prevent double-spend races.

## Data Model (Conceptual)

- `LedgerAccount`: wallet owner/account reference
- `Transaction`: immutable record representing a money movement
- `LedgerEntry`: debit/credit row linked to a `Transaction` and `LedgerAccount`

Balance is derived as: $\text{balance} = \sum \text{credits} - \sum \text{debits}$
Balance is derived as: $\text{balance} = \sum \text{amount}$

## Prerequisites

Before you begin, ensure you have the following installed:
* [Node.js](https://nodejs.org/) (v18 or higher)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL and Redis containers)

## Environment Variables

Create a `.env` file in the root directory and configure the following:

```env
# Database Connections
DATABASE_URL="postgresql://postgres:password@localhost:5433/wallet_db?schema=public"
REDIS_URL="redis://localhost:6379"

# Application Config
PORT=3000
```

## Getting Started

**1. Clone the repository & install dependencies:**
```bash
git clone [https://github.com/yourusername/ledgerpay.git](https://github.com/yourusername/ledgerpay.git)
cd ledgerpay
npm install
```

**2. Start the infrastructure (PostgreSQL & Redis):**
```bash
docker-compose up -d
```

**3. Set up the database schema:**
```bash
npx prisma db push
npx prisma generate
```

**4. Start the development server:**
```bash
npm run dev
```

**5. Explore the API:**
Navigate to the interactive Swagger UI to test endpoints directly from your browser:  
`http://localhost:3000/api-docs`

## Testing

1. Start Postgres and Redis: `docker-compose up -d`
2. Run tests: `npm test`

## Test Strategy

1. **Validation tests**: ensure invalid inputs are rejected early (Zod + middleware).
2. **Integration tests**: run against real Postgres + Redis to verify transactions and idempotency.
3. **Critical paths**: create wallet, add money, transfer, refund.

## API Endpoints Reference

| Method | Endpoint | Description | Idempotency Required? |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/wallets/create` | Initializes a new user wallet. | No |
| `GET` | `/api/wallets/:accountId/balance` | Calculates the real-time balance dynamically. | No |
| `POST` | `/api/wallets/add-money` | Mints money into a wallet (Credit). | Yes |
| `POST` | `/api/wallets/transfer` | Safely moves money between two accounts. | Yes |
| `POST` | `/api/wallets/withdraw` | Debits a user account simulating a cash-out. | Yes |
| `POST` | `/api/wallets/refund` | Inverts a previous transaction securely. | Yes |

*Note: State-mutating routes (add money, transfer, withdraw, refund) require an `Idempotency-Key` header to prevent duplicate processing.*

## Architecture & Folder Structure 

LedgerPay follows Clean Architecture principles, ensuring a strict separation of concerns:

```text
src/
├── config/             # Database and Redis client singletons
├── controllers/        # Express route handlers
├── middlewares/        # Idempotency logic and error handling
├── routes/             # API routing definitions
├── services/           # Core financial business logic and Prisma transactions
├── app.ts              # Express application setup and Swagger configuration
└── server.ts           # Application entry point
```

## Operational Considerations

- **Immutability by design:** corrections use reversal transactions instead of edits.
- **Failure safety:** any step failure in a money movement rolls back the full unit of work.
- **Deterministic locking:** account IDs are sorted before locking to minimize deadlocks.

## Scripts

- `npm run dev` - start development server
- `npm test` - run test suite
