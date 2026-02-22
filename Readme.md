# LedgerPay: Production-Grade Digital Wallet

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

LedgerPay is a high-performance FinTech backend designed to handle digital wallet transactions securely. Instead of storing fragile "balance" columns that are prone to race conditions, it calculates balances dynamically using a true **Double-Entry Accounting Ledger**. This mirrors the architecture used by financial giants like Stripe and Square.

## Core Engineering Features

* **Double-Entry Accounting:** Balances are never stored directly. Every transaction creates two immutable `LedgerEntry` records (a Debit and a Credit) that must always net to zero.
* **Concurrency Control (Row-Level Locking):** Uses PostgreSQL `SELECT ... FOR UPDATE` to lock wallet rows during transactions. This strictly prevents "Double-Spend" race conditions if a user fires multiple rapid requests. Deadlocks are avoided by sorting account IDs lexicographically before locking.
* **Idempotency Engine:** Integrates a Redis caching middleware layer. It checks `Idempotency-Key` headers to ensure network retries do not result in duplicate financial charges.
* **Financial Immutability:** Transactions are never deleted or updated. Refunds are handled by creating a completely new transaction that generates inverse ledger entries (turning previous Debits into Credits).
* **ACID Compliance:** All money movements are wrapped in `prisma.$transaction`. If a process fails mid-execution, the entire operation safely rolls back.

## System Architecture & Transaction Flow

The following diagram illustrates the lifecycle of a secure money transfer within LedgerPay, highlighting the idempotency layer and database locking mechanisms.

```mermaid
flowchart LR
  A[Client] -->|POST /api/wallets/transfer| B[Express Router]
  B --> C[Idempotency Middleware]
  C -->|Check Idempotency-Key| D{Redis Cache}
  D -->|Hit| E[Return Saved Response]
  D -->|Miss| F[LedgerService.transfer]
  F -->|BEGIN TX| G[(PostgreSQL)]
  G -->|SELECT ... FOR UPDATE| H[Lock Accounts]
  G -->|SUM LedgerEntry| I[Balance Check]
  I -->|Sufficient| J[Create Transaction]
  J --> K[Create Debit/Credit Entries]
  K -->|COMMIT| L[DB Commit]
  L --> M[Save Response in Redis]
  M --> N[Return Response]
  I -->|Insufficient| O[Throw Error]
  O --> P[Rollback TX]
  P --> N
```

**Step-by-Step Flow:**
1. The HTTP Request hits the Express router.
2. **Redis Middleware** checks the `Idempotency-Key` to ensure this exact transfer hasn't already been processed today.
3. The **Service Layer** locks both the Sender and Receiver database rows in alphabetical order (`FOR UPDATE`).
4. The system calculates the Sender's balance dynamically via `SUM()`. If funds are sufficient, a Transaction record is generated.
5. Two `LedgerEntry` records are created: a **Debit** to the Sender, and a **Credit** to the Receiver.
6. The database transaction commits, rows are automatically unlocked, and Redis saves the successful receipt.

## System Design Notes

1. **Ledger Invariant:** Every money movement creates equal and opposite entries. The sum of all `LedgerEntry` rows for a single transaction should net to zero.
2. **Idempotency Guarantee:** Write endpoints require an `Idempotency-Key`, and a successful response is cached in Redis for 24 hours to prevent duplicates.
3. **Consistency Model:** All writes happen inside a single database transaction, with row-level locking to prevent double-spend races.

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

## API Endpoints Reference

| Method | Endpoint | Description | Idempotency Required? |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/wallets/create` | Initializes a new user wallet. | No |
| `GET` | `/api/wallets/:accountId/balance` | Calculates the real-time balance dynamically. | No |
| `POST` | `/api/wallets/add-money` | Mints money into a wallet (Credit). | Yes |
| `POST` | `/api/wallets/transfer` | Safely moves money between two accounts. | Yes |
| `POST` | `/api/wallets/withdraw` | Debits a user account simulating a cash-out. | Yes |
| `POST` | `/api/wallets/refund` | Inverts a previous transaction securely. | Yes |

*Note: All state-mutating financial routes require an `Idempotency-Key` header to prevent duplicate processing.*

## Architecture & Folder Structure 

LedgerPay follows Clean Architecture principles, ensuring a strict separation of concerns:

```text
src/
├── config/             # Database and Redis client singletons
├── controllers/        # Express route handlers
├── middleware/         # Idempotency logic and error handling
├── routes/             # API routing definitions
├── services/           # Core financial business logic and Prisma transactions
├── app.ts              # Express application setup and Swagger configuration
└── server.ts           # Application entry point
```
