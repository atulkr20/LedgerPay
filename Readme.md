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
- Authentication: JWT + bcryptjs
- Validation: Zod
- Testing: Jest

## Core Engineering Features

* **JWT Authentication:** Secure user authentication with bcrypt password hashing and JWT token-based authorization. Wallets are automatically created on signup.
* **Double-Entry Transfers:** Balances are never stored directly. Transfers create two immutable `LedgerEntry` rows (a Debit and a Credit). Deposits and withdrawals create a single signed entry.
* **Concurrency Control (Row-Level Locking):** Uses PostgreSQL `SELECT ... FOR UPDATE` to lock wallet rows for transfers and withdrawals. Deadlocks are avoided by sorting account IDs lexicographically before locking.
* **Idempotency Engine:** Integrates a Redis caching middleware layer. It checks `Idempotency-Key` headers on state-changing routes to ensure retries do not duplicate processing.
* **Financial Immutability:** Transactions are never deleted. Refunds are handled by creating a new transaction with inverse ledger entries and marking the original transaction as reversed.
* **ACID Compliance:** All money movements are wrapped in `prisma.$transaction`. If a process fails mid-execution, the entire operation safely rolls back.

## System Architecture

```mermaid
graph TB
    subgraph Client["Client / API Consumer"]
        API_REQ[HTTP Request]
    end

    subgraph Auth["Authentication Layer"]
        SIGNUP[POST /auth/signup]
        LOGIN[POST /auth/login]
        JWT_MW[JWT Middleware]
    end

    subgraph WalletOps["Wallet Operations Layer"]
        BALANCE[GET /balance]
        HISTORY[GET /history]
        ADD[POST /add-money 🔑]
        TRANSFER[POST /transfer 🔑]
        WITHDRAW[POST /withdraw 🔑]
        REFUND[POST /refund 🔑]
    end

    subgraph Idempotency["Idempotency Engine"]
        REDIS_CHECK{Redis Cache Check}
        LOCK[10s Processing Lock]
        CACHE[24h Result Cache]
    end

    subgraph BizLogic["Business Logic - LedgerService"]
        CREATE_WALLET[createWallet]
        GET_BALANCE[getBalance]
        ADD_MONEY[addMoney]
        TRANSFER_LOGIC[transfer - Row Lock]
        WITHDRAW_LOGIC[withdraw - Row Lock]
        REFUND_LOGIC[refund]
        GET_HISTORY[getTransactionHistory]
    end

    subgraph DB["Database - PostgreSQL"]
        TX_START[BEGIN TRANSACTION]
        LOCK_ACCOUNTS["SELECT...FOR UPDATE<br/>(Alphabetical ID Sort)"]
        LEDGER_WRITE[Insert LedgerEntry]
        TX_COMMIT[COMMIT]
    end

    subgraph DataModel["Data Model Hierarchy"]
        USER[User]
        WALLET[Wallet]
        ACCOUNT[Account]
        TRANSACTION[Transaction]
        LEDGER[LedgerEntry]
    end

    API_REQ --> SIGNUP
    API_REQ --> LOGIN
    SIGNUP --> CREATE_WALLET
    LOGIN --> JWT_MW

    JWT_MW --> BALANCE
    JWT_MW --> HISTORY
    JWT_MW --> ADD
    JWT_MW --> TRANSFER
    JWT_MW --> WITHDRAW
    JWT_MW --> REFUND

    ADD --> REDIS_CHECK
    TRANSFER --> REDIS_CHECK
    WITHDRAW --> REDIS_CHECK
    REFUND --> REDIS_CHECK

    REDIS_CHECK -->|Cache Miss| LOCK
    REDIS_CHECK -->|Cache Hit| CACHE
    LOCK --> ADD_MONEY
    LOCK --> TRANSFER_LOGIC
    LOCK --> WITHDRAW_LOGIC
    LOCK --> REFUND_LOGIC

    BALANCE --> GET_BALANCE
    HISTORY --> GET_HISTORY

    CREATE_WALLET --> TX_START
    ADD_MONEY --> TX_START
    TRANSFER_LOGIC --> TX_START
    WITHDRAW_LOGIC --> TX_START
    REFUND_LOGIC --> TX_START

    TX_START --> LOCK_ACCOUNTS
    LOCK_ACCOUNTS --> LEDGER_WRITE
    LEDGER_WRITE --> TX_COMMIT
    TX_COMMIT --> CACHE

    USER -->|1:1| WALLET
    WALLET -->|1:N| ACCOUNT
    ACCOUNT -->|1:N| LEDGER
    TRANSACTION -->|1:N| LEDGER

    style Auth fill:#e1f5ff
    style Idempotency fill:#fff4e1
    style BizLogic fill:#e8f5e9
    style DB fill:#fce4ec
    style DataModel fill:#f3e5f5
```

**Key Components:**

1. **Authentication Layer:** JWT-based auth with auto-wallet creation on signup
2. **Idempotency Engine:** Redis caching prevents duplicate transactions (24h TTL)
3. **Business Logic:** LedgerService handles double-entry accounting with row-level locking
4. **Database:** PostgreSQL ACID transactions with deadlock prevention (alphabetical sorting)
5. **Data Model:** User → Wallet → Account → Transaction → LedgerEntry hierarchy

## System Design Notes

1. **Authentication:** Users sign up with email/password (hashed with bcrypt). Login returns a JWT token valid for 24 hours. All wallet operations require Bearer token authentication.
2. **Account Auto-Creation:** Signup automatically creates a Wallet with one AVAILABLE account. Users receive their accountId on login for immediate use.
3. **Ledger Invariant:** Transfers create equal and opposite entries that net to zero. Deposits and withdrawals use a single signed entry.
4. **Idempotency Guarantee:** State-changing endpoints (add money, transfer, withdraw, refund) require an `Idempotency-Key`, and successful responses are cached in Redis for 24 hours.
5. **Consistency Model:** All writes happen inside a single database transaction; transfers and withdrawals use row-level locking to prevent double-spend races.

## Data Model (Conceptual)

**Hierarchy:**
```
User (1:1) → Wallet (1:many) → Accounts → Ledger Entries
```

- `User`: Authentication entity with email/password
- `Wallet`: Container for all user accounts (auto-created on signup)
- `Account`: Individual ledger accounts (e.g., AVAILABLE, PENDING, RESERVED)
- `Transaction`: Immutable record representing a money movement
- `LedgerEntry`: Debit/credit row linked to a `Transaction` and `Account`

**Authentication Flow:**
1. User signs up → Creates User + Wallet + Account (AVAILABLE type)
2. Login returns: `{ token, userId, accountId, accountType }`
3. Use `accountId` for all wallet operations
4. Include JWT `token` in Authorization header

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

# Security
JWT_SECRET="your-secret-key-here"
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

## Quick Start Testing

**1. Create an account via Swagger UI:**
- Navigate to `http://localhost:3000/api-docs`
- Use `POST /api/auth/signup` with:
  ```json
  {
    "email": "test@example.com",
    "password": "securepass123",
    "name": "Test User"
  }
  ```

**2. Login to get your credentials:**
- Use `POST /api/auth/login` with your email/password
- Response includes:
  ```json
  {
    "token": "eyJhbGci...",
    "userId": "uuid",
    "accountId": "uuid",  // Use this for all wallet operations
    "accountType": "AVAILABLE"
  }
  ```

**3. Authorize in Swagger:**
- Click the "Authorize" button (🔒 icon)
- Enter: `Bearer <your-token>`
- Now you can test all authenticated endpoints

**4. Test wallet operations:**
- Add money: `POST /api/wallets/{accountId}/add-money`
- Check balance: `GET /api/wallets/{accountId}/balance`
- Transfer: `POST /api/wallets/{accountId}/transfer`

**Demo Credentials** (if you want to use existing test account):
```
Email: user-710490248@test.com
Password: pass123
Account ID: 27229a05-71a4-4a7b-8179-e09f241826d0
```

## Testing

1. Start Postgres and Redis: `docker-compose up -d`
2. Run tests: `npm test`

## Test Strategy

1. **Validation tests**: ensure invalid inputs are rejected early (Zod + middleware).
2. **Integration tests**: run against real Postgres + Redis to verify transactions and idempotency.
3. **Critical paths**: create wallet, add money, transfer, refund.

## API Endpoints Reference

### Authentication
| Method | Endpoint | Description | Auth Required? |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/auth/signup` | Register new user (auto-creates wallet + AVAILABLE account) | No |
| `POST` | `/api/auth/login` | Login and receive JWT token + accountId | No |

### Wallet Operations
| Method | Endpoint | Description | Auth Required? | Idempotency Required? |
| :--- | :--- | :--- | :---: | :---: |
| `GET` | `/api/wallets/:accountId/balance` | Get real-time balance | Yes | No |
| `GET` | `/api/wallets/:accountId/history` | Get transaction history (paginated) | Yes | No |
| `POST` | `/api/wallets/:accountId/add-money` | Add money to account (Credit) | Yes | Yes |
| `POST` | `/api/wallets/:accountId/transfer` | Transfer money between accounts | Yes | Yes |
| `POST` | `/api/wallets/:accountId/withdraw` | Withdraw money (Debit) | Yes | Yes |
| `POST` | `/api/wallets/refund/:transactionId` | Reverse a transaction | Yes | Yes |

**Authentication:** All wallet endpoints require a valid JWT token in the `Authorization: Bearer <token>` header.

**Idempotency:** State-mutating routes require an `Idempotency-Key` header to prevent duplicate processing.

## Architecture & Folder Structure 

LedgerPay follows Clean Architecture principles, ensuring a strict separation of concerns:

```text
src/
├── config/             # Database and Redis client singletons
├── controllers/        # Express route handlers
│   ├── auth.controllers.ts    # Signup and login handlers
│   └── wallet.controller.ts   # Wallet operation handlers
├── middlewares/        # Authentication, idempotency, and error handling
│   ├── auth.middleware.ts     # JWT verification
│   └── idempotency.ts         # Duplicate request prevention
├── routes/             # API routing definitions
│   ├── auth.routes.ts         # Authentication endpoints
│   └── wallet.routes.ts       # Wallet operation endpoints
├── services/           # Core financial business logic and Prisma transactions
│   └── ledger.service.ts      # Double-entry accounting logic
├── dtos/               # Request validation schemas (Zod)
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
