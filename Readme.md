# LedgerPay

A production-grade FinTech backend for digital wallet transactions. Instead of storing fragile balance columns prone to race conditions, LedgerPay calculates balances dynamically using a true **Double-Entry Accounting Ledger** — the same model used by real financial platforms.

---

## Architecture Diagram
```
                         Client Request
                              │
                              ▼
                   ┌──────────────────────┐
                   │   JWT Auth Middleware │  ← Verify Bearer token
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │ Idempotency Middleware│  ← Check Idempotency-Key in Redis
                   └──────────┬───────────┘
                              │
               ┌──────────────┴──────────────┐
               │ Cache Hit                   │ Cache Miss
               ▼                             ▼
      Return cached                 ┌─────────────────┐
      response (no DB hit)          │  LedgerService  │
                                    └────────┬────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                         addMoney()     transfer()     withdraw()
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │  PostgreSQL Transaction  │
                              │  (ACID)                  │
                              │                          │
                              │  SELECT ... FOR UPDATE   │  ← Row-level lock
                              │  (sort IDs to avoid      │    (deadlock prevention)
                              │   deadlocks)             │
                              │                          │
                              │  INSERT LedgerEntry      │  ← Debit + Credit rows
                              │  INSERT Transaction      │
                              │                          │
                              │  COMMIT                  │
                              └─────────────┬────────────┘
                                            │
                              ┌─────────────┴────────────┐
                              │                          │
                              ▼                          ▼
                     Cache response                Return response
                     in Redis (24h TTL)            to client
```

---

## What Problem It Solves

| Problem | How LedgerPay Solves It |
|---|---|
| Race conditions on balance column | No balance column — derived from ledger entries |
| Duplicate transactions on retry | Idempotency-Key checked in Redis before processing |
| Concurrent transfer conflicts | Row-level locking with sorted IDs to prevent deadlocks |
| Partial failure mid-transfer | Full ACID transaction — rolls back on any failure |
| No audit trail | Every money movement creates immutable ledger entries |

---

## Tech Stack

| Technology | Usage |
|---|---|
| Node.js + TypeScript | Core server, type-safe services |
| Express.js | HTTP server, middleware chain, REST API |
| PostgreSQL | Wallets, accounts, transactions, ledger entries |
| Prisma ORM | Type-safe DB access, transactions, migrations |
| Redis | Idempotency cache (24h TTL), 10s processing lock |
| JWT + bcryptjs | Auth — password hashing + token-based auth |
| Zod | Request validation |
| Jest | Integration + unit tests |
| Docker | Local PostgreSQL + Redis setup |

---

## Core Features

### Double-Entry Accounting
Balances are never stored directly. Every money movement creates immutable `LedgerEntry` rows:
- Transfer → 1 Debit entry + 1 Credit entry (net to zero)
- Deposit → 1 signed Credit entry
- Withdrawal → 1 signed Debit entry

Balance is always derived as:
```
balance = SUM(credits) - SUM(debits)
```

### Concurrency Control — Row-Level Locking
Uses PostgreSQL `SELECT ... FOR UPDATE` to lock wallet rows during transfers and withdrawals. Account IDs are sorted lexicographically before acquiring locks — this prevents deadlocks when two transfers happen simultaneously between the same accounts.

### Idempotency Engine
State-changing endpoints require an `Idempotency-Key` header. On every request:
1. Check Redis for the key
2. If found → return cached response (no DB hit)
3. If not found → set a 10s processing lock → execute → cache result for 24h

This prevents duplicate transactions on network retries.

### ACID Compliance
All money movements are wrapped in `prisma.$transaction`. If any step fails mid-execution, the entire operation rolls back — no partial transfers, no ghost debits.

### Financial Immutability
Transactions are never deleted or edited. Refunds create a new transaction with inverse ledger entries and mark the original as reversed.

---

## Data Model
```
User (1:1) → Wallet (1:many) → Accounts → LedgerEntries
                                    │
                                    └──→ Transactions
```

- `User` — authentication entity (email + hashed password)
- `Wallet` — container for all accounts, auto-created on signup
- `Account` — individual ledger account (AVAILABLE, PENDING, RESERVED)
- `Transaction` — immutable record of a money movement
- `LedgerEntry` — debit/credit row linked to a Transaction and Account

---

## API Endpoints

### Authentication
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/signup` | Register user — auto-creates wallet + AVAILABLE account | No |
| POST | `/api/auth/login` | Login — returns JWT + accountId | No |

### Wallet Operations
| Method | Endpoint | Description | Auth | Idempotency |
|---|---|---|---|---|
| GET | `/api/wallets/:accountId/balance` | Get real-time balance | Yes | No |
| GET | `/api/wallets/:accountId/history` | Get transaction history (paginated) | Yes | No |
| POST | `/api/wallets/:accountId/add-money` | Deposit money | Yes | Yes |
| POST | `/api/wallets/:accountId/transfer` | Transfer between accounts | Yes | Yes |
| POST | `/api/wallets/:accountId/withdraw` | Withdraw money | Yes | Yes |
| POST | `/api/wallets/refund/:transactionId` | Reverse a transaction | Yes | Yes |

---

## Folder Structure
```
src/
├── config/               # DB and Redis client singletons
├── controllers/
│   ├── auth.controllers.ts
│   └── wallet.controller.ts
├── middlewares/
│   ├── auth.middleware.ts       # JWT verification
│   └── idempotency.ts           # Duplicate request prevention
├── routes/
│   ├── auth.routes.ts
│   └── wallet.routes.ts
├── services/
│   └── ledger.service.ts        # Core double-entry logic
├── dtos/                        # Zod validation schemas
├── app.ts
└── server.ts
```

---

## Environment Variables
```env
DATABASE_URL="postgresql://postgres:password@localhost:5433/wallet_db?schema=public"
REDIS_URL="redis://localhost:6379"
PORT=3000
JWT_SECRET="your-secret-key-here"
```

---

## Running Locally
```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL + Redis
docker-compose up -d

# 3. Run migrations
npx prisma db push
npx prisma generate

# 4. Start the server
npm run dev

# 5. Open Swagger docs
http://localhost:3000/api-docs
```

---

## Testing
```bash
npm test
```

Test strategy:
- Validation tests — invalid inputs rejected early via Zod
- Integration tests — run against real PostgreSQL + Redis
- Critical paths — create wallet, add money, transfer, refund

---

