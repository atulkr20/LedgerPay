/*
 * LedgerPay Benchmark Suite
 *
 * Measures throughput & latency of core operations against
 * a real PostgreSQL + Redis stack.
 *
 * Usage:
 *   docker-compose up -d
 *   npx ts-node benchmarks/benchmark.ts
 *
 * Tests:
 *   1. Deposit throughput        - single-account ACID writes
 *   2. Transfer throughput       - double-entry + row-level locking
 *   3. Concurrent transfers      - parallel transfers (deadlock prevention)
 *   4. Balance query latency     - aggregate over growing ledger entries
 *   5. Idempotency cache hit     - Redis fast-path
 *   6. Idempotency DB fallback   - Postgres fallback when Redis misses
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';
import dotenv from 'dotenv';

dotenv.config({ quiet: true } as any);

// Configuration

const CONFIG = {
  DEPOSIT_ITERATIONS: 500,
  TRANSFER_ITERATIONS: 200,
  CONCURRENT_TRANSFERS: 50,
  BALANCE_QUERY_ITERATIONS: 100,
  IDEMPOTENCY_ITERATIONS: 300,
};

// Helpers

interface BenchmarkResult {
  name: string;
  totalOps: number;
  totalTimeMs: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSecond: number;
}

function percentile(sortedArr: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function formatResult(r: BenchmarkResult): string {
  return [
    `  ${r.name}`,
    `    Total ops     : ${r.totalOps}`,
    `    Total time    : ${r.totalTimeMs.toFixed(1)} ms`,
    `    Avg latency   : ${r.avgLatencyMs.toFixed(2)} ms`,
    `    P50           : ${r.p50Ms.toFixed(2)} ms`,
    `    P95           : ${r.p95Ms.toFixed(2)} ms`,
    `    P99           : ${r.p99Ms.toFixed(2)} ms`,
    `    Throughput    : ${r.opsPerSecond.toFixed(1)} ops/sec`,
    '',
  ].join('\n');
}

function summarize(name: string, latencies: number[]): BenchmarkResult {
  const sorted = [...latencies].sort((a, b) => a - b);
  const totalTime = sorted.reduce((a, b) => a + b, 0);
  return {
    name,
    totalOps: sorted.length,
    totalTimeMs: totalTime,
    avgLatencyMs: totalTime / sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    opsPerSecond: (sorted.length / totalTime) * 1000,
  };
}

// Database setup

let prisma: PrismaClient;
let redis: Redis;
let pool: Pool;

async function setup() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) throw new Error('DATABASE_URL not set');

  pool = new Pool({ connectionString: connStr });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // Wait for connections
  await prisma.$executeRaw`SELECT 1`;
  await redis.ping();

  console.log('  PostgreSQL connected');
  console.log('  Redis connected\n');
}

async function teardown() {
  await prisma.$disconnect();
  redis.disconnect();
  await pool.end();
}

// Seed helpers

async function createBenchmarkUser(suffix: string) {
  const userId = uuid();
  await prisma.user.create({
    data: {
      id: userId,
      email: `bench-${suffix}-${Date.now()}@test.com`,
      passwordHash: 'benchmark-hash',
      name: `Bench User ${suffix}`,
    },
  });

  const wallet = await prisma.wallet.create({
    data: {
      userId,
      accounts: {
        create: [{ type: 'AVAILABLE' }],
      },
    },
    include: { accounts: true },
  });

  return { userId, walletId: wallet.id, accountId: wallet.accounts[0].id };
}

async function seedDeposit(accountId: string, amount: number) {
  const refId = uuid();
  await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: { referenceId: refId, type: 'DEPOSIT', status: 'SUCCESS', amount: new Prisma.Decimal(amount) },
    });
    await tx.ledgerEntry.create({
      data: {
        transactionId: txn.id,
        ledgerAccountId: accountId,
        entryType: 'CREDIT',
        amount: new Prisma.Decimal(amount),
      },
    });
  });
}

// Benchmark: Deposits

async function benchDeposits(): Promise<BenchmarkResult> {
  const { accountId } = await createBenchmarkUser('deposit');
  const latencies: number[] = [];

  for (let i = 0; i < CONFIG.DEPOSIT_ITERATIONS; i++) {
    const refId = uuid();
    const amount = new Prisma.Decimal(10);

    const start = performance.now();
    await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: { referenceId: refId, type: 'DEPOSIT', status: 'SUCCESS', amount },
      });
      await tx.ledgerEntry.create({
        data: {
          transactionId: txn.id,
          ledgerAccountId: accountId,
          entryType: 'CREDIT',
          amount,
        },
      });
      await tx.idempotencyKey.create({
        data: { key: refId, responseStatus: 200, responseBody: { success: true } },
      });
    });
    latencies.push(performance.now() - start);
  }

  return summarize('Deposit (ACID + idempotency)', latencies);
}

// Benchmark: Transfers

async function benchTransfers(): Promise<BenchmarkResult> {
  const sender = await createBenchmarkUser('transfer-sender');
  const receiver = await createBenchmarkUser('transfer-receiver');

  // Seed sender with enough balance
  await seedDeposit(sender.accountId, CONFIG.TRANSFER_ITERATIONS * 100);

  const latencies: number[] = [];

  for (let i = 0; i < CONFIG.TRANSFER_ITERATIONS; i++) {
    const refId = uuid();
    const safeAmount = new Prisma.Decimal(1);
    const accountIds = [sender.accountId, receiver.accountId].sort();

    const start = performance.now();
    await prisma.$transaction(async (tx) => {
      // Row-level lock (sorted to prevent deadlocks)
      await tx.$executeRaw`
        SELECT id FROM "LedgerAccount"
        WHERE id IN (${Prisma.join(accountIds)})
        FOR UPDATE
      `;

      // Balance check
      const balanceCheck = await tx.ledgerEntry.aggregate({
        where: { ledgerAccountId: sender.accountId },
        _sum: { amount: true },
      });
      const currentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);
      if (currentBalance.lessThan(safeAmount)) throw new Error('INSUFFICIENT_FUNDS');

      const txn = await tx.transaction.create({
        data: { referenceId: refId, type: 'TRANSFER', status: 'SUCCESS', amount: safeAmount },
      });

      await tx.ledgerEntry.createMany({
        data: [
          { transactionId: txn.id, ledgerAccountId: sender.accountId, entryType: 'DEBIT', amount: safeAmount.negated() },
          { transactionId: txn.id, ledgerAccountId: receiver.accountId, entryType: 'CREDIT', amount: safeAmount },
        ],
      });

      await tx.idempotencyKey.create({
        data: { key: refId, responseStatus: 200, responseBody: { success: true } },
      });
    });
    latencies.push(performance.now() - start);
  }

  return summarize('Transfer (double-entry + row lock)', latencies);
}

// Benchmark: Concurrent Transfers

async function benchConcurrentTransfers(): Promise<BenchmarkResult> {
  const userA = await createBenchmarkUser('concurrent-a');
  const userB = await createBenchmarkUser('concurrent-b');

  // Seed both accounts
  await seedDeposit(userA.accountId, CONFIG.CONCURRENT_TRANSFERS * 100);
  await seedDeposit(userB.accountId, CONFIG.CONCURRENT_TRANSFERS * 100);

  const doTransfer = async (from: string, to: string): Promise<number> => {
    const refId = uuid();
    const amount = new Prisma.Decimal(1);
    const accountIds = [from, to].sort();

    const start = performance.now();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM "LedgerAccount"
        WHERE id IN (${Prisma.join(accountIds)})
        FOR UPDATE
      `;

      const balanceCheck = await tx.ledgerEntry.aggregate({
        where: { ledgerAccountId: from },
        _sum: { amount: true },
      });
      const currentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);
      if (currentBalance.lessThan(amount)) throw new Error('INSUFFICIENT_FUNDS');

      const txn = await tx.transaction.create({
        data: { referenceId: refId, type: 'TRANSFER', status: 'SUCCESS', amount },
      });
      await tx.ledgerEntry.createMany({
        data: [
          { transactionId: txn.id, ledgerAccountId: from, entryType: 'DEBIT', amount: amount.negated() },
          { transactionId: txn.id, ledgerAccountId: to, entryType: 'CREDIT', amount },
        ],
      });
      await tx.idempotencyKey.create({
        data: { key: refId, responseStatus: 200, responseBody: { success: true } },
      });
    });
    return performance.now() - start;
  };

  // Fire concurrent transfers in BOTH directions (A→B and B→A) to stress deadlock prevention
  const promises: Promise<number>[] = [];
  for (let i = 0; i < CONFIG.CONCURRENT_TRANSFERS; i++) {
    if (i % 2 === 0) {
      promises.push(doTransfer(userA.accountId, userB.accountId));
    } else {
      promises.push(doTransfer(userB.accountId, userA.accountId));
    }
  }

  const latencies = await Promise.all(promises);
  return summarize('Concurrent Transfers (bidirectional)', latencies);
}

// Benchmark: Balance Query

async function benchBalanceQuery(): Promise<BenchmarkResult> {
  const { accountId } = await createBenchmarkUser('balance');

  // Seed with many entries so aggregate has real work to do
  for (let i = 0; i < 200; i++) {
    await seedDeposit(accountId, 5);
  }

  const latencies: number[] = [];
  for (let i = 0; i < CONFIG.BALANCE_QUERY_ITERATIONS; i++) {
    const start = performance.now();
    await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: accountId },
      _sum: { amount: true },
    });
    latencies.push(performance.now() - start);
  }

  return summarize('Balance Query (SUM over 200 entries)', latencies);
}

// Benchmark: Idempotency - Redis cache hit

async function benchIdempotencyRedisHit(): Promise<BenchmarkResult> {
  // Pre-populate Redis with cached responses
  const keys: string[] = [];
  for (let i = 0; i < CONFIG.IDEMPOTENCY_ITERATIONS; i++) {
    const key = `idempotency:bench-${uuid()}`;
    await redis.set(key, JSON.stringify({ success: true, cached: true }), 'EX', 300);
    keys.push(key);
  }

  const latencies: number[] = [];
  for (const key of keys) {
    const start = performance.now();
    const cached = await redis.get(key);
    if (cached) JSON.parse(cached);
    latencies.push(performance.now() - start);
  }

  return summarize('Idempotency (Redis hit)', latencies);
}

// Benchmark: Idempotency - DB fallback

async function benchIdempotencyDbFallback(): Promise<BenchmarkResult> {
  // Seed idempotency keys directly in Postgres (simulating Redis miss)
  const keys: string[] = [];
  for (let i = 0; i < CONFIG.IDEMPOTENCY_ITERATIONS; i++) {
    const key = `bench-db-${uuid()}`;
    await prisma.idempotencyKey.create({
      data: { key, responseStatus: 200, responseBody: { success: true, fromDb: true } },
    });
    keys.push(key);
  }

  const latencies: number[] = [];
  for (const key of keys) {
    const start = performance.now();
    // Simulate: Redis miss -> DB lookup
    const redisResult = await redis.get(`idempotency:${key}`);
    if (!redisResult) {
      const dbRecord = await prisma.idempotencyKey.findUnique({ where: { key } });
      if (dbRecord) {
        await redis.set(`idempotency:${key}`, JSON.stringify(dbRecord.responseBody), 'EX', 300);
      }
    }
    latencies.push(performance.now() - start);
  }

  return summarize('Idempotency (DB fallback)', latencies);
}

// Cleanup

async function cleanupBenchmarkData() {
  // Truncate in one shot to avoid FK ordering headaches
  await prisma.$executeRaw`TRUNCATE "IdempotencyKey", "LedgerEntry", "Transaction", "LedgerAccount", "Wallet", "User" CASCADE`;

  // Clean Redis benchmark keys
  const redisKeys = await redis.keys('idempotency:bench-*');
  if (redisKeys.length > 0) {
    await redis.del(...redisKeys);
  }
}

// Main

async function main() {
  console.log('');
  console.log('  LedgerPay Benchmark Suite');
  console.log('  -------------------------');
  console.log('');

  await setup();

  const results: BenchmarkResult[] = [];

  console.log('  Running benchmarks...\n');

  // 1. Deposits
  process.stdout.write('  [1/6] Deposit throughput...');
  results.push(await benchDeposits());
  console.log(' done');

  // 2. Transfers
  process.stdout.write('  [2/6] Transfer throughput...');
  results.push(await benchTransfers());
  console.log(' done');

  // 3. Concurrent transfers
  process.stdout.write('  [3/6] Concurrent transfer stress test...');
  results.push(await benchConcurrentTransfers());
  console.log(' done');

  // 4. Balance query
  process.stdout.write('  [4/6] Balance query latency...');
  results.push(await benchBalanceQuery());
  console.log(' done');

  // 5. Idempotency Redis hit
  process.stdout.write('  [5/6] Idempotency Redis cache hit...');
  results.push(await benchIdempotencyRedisHit());
  console.log(' done');

  // 6. Idempotency DB fallback
  process.stdout.write('  [6/6] Idempotency DB fallback...');
  results.push(await benchIdempotencyDbFallback());
  console.log(' done');

  // Results

  console.log('\n');
  console.log('  Results');
  console.log('  -------\n');

  for (const r of results) {
    console.log(formatResult(r));
  }

  // Summary table

  const COL_NAME = 40;
  const header = '  ' + 'Benchmark'.padEnd(COL_NAME) + 'Avg (ms)   P95 (ms)   ops/s';
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));
  for (const r of results) {
    const name = r.name.padEnd(COL_NAME).slice(0, COL_NAME);
    const avg = r.avgLatencyMs.toFixed(2).padStart(9);
    const p95 = r.p95Ms.toFixed(2).padStart(10);
    const ops = r.opsPerSecond.toFixed(0).padStart(8);
    console.log(`  ${name}${avg}${p95}${ops}`);
  }

  console.log('');

  console.log('\n  Cleaning up benchmark data...');
  await cleanupBenchmarkData();
  console.log('  Cleanup complete');

  await teardown();
  console.log('\n  Done.\n');
}

main().catch((err) => {
  console.error('\n  Benchmark failed:', err);
  process.exit(1);
});
