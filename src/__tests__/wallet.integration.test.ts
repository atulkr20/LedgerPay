import request from 'supertest';
import { app } from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

jest.setTimeout(20000);

const createWallet = async (userId: string) => {
  const response = await request(app)
    .post('/api/wallets/create')
    .send({ userId });
  return response;
};

describe('wallet API Integration Tests', () => {
  beforeAll(async () => {
    // Ensure dependencies are reachable before running integration tests.
    try {
      await redis.ping();
      await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      throw new Error(
        `Integration test deps unavailable. Ensure Postgres and Redis are running. Original error: ${err?.message ?? err}`
      );
    }

    await redis.flushdb();
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.ledgerAccount.deleteMany();
    await prisma.wallet.deleteMany();
  });

  it('should create a wallet and return an account id', async () => {
    const response = await createWallet(`user-${Date.now()}`);
    expect(response.status).toBe(201);
    expect(response.body.data.accounts[0].id).toBeDefined();
  });

  it('should add money and update balance', async () => {
    const walletRes = await createWallet(`user-${Date.now()}`);
    const accountId = walletRes.body.data.accounts[0].id as string;

    const depositRes = await request(app)
      .post('/api/wallets/add-money')
      .set('Idempotency-Key', `deposit-${Date.now()}`)
      .send({ accountId, amount: 100 });
    expect(depositRes.status).toBe(200);

    const balanceRes = await request(app).get(`/api/wallets/${accountId}/balance`);
    expect(balanceRes.status).toBe(200);
    expect(Number(balanceRes.body.balance)).toBe(100);
  });

  it('should transfer funds between two accounts', async () => {
    const fromRes = await createWallet(`user-${Date.now()}-from`);
    const toRes = await createWallet(`user-${Date.now()}-to`);
    const fromAccountId = fromRes.body.data.accounts[0].id as string;
    const toAccountId = toRes.body.data.accounts[0].id as string;

    await request(app)
      .post('/api/wallets/add-money')
      .set('Idempotency-Key', `seed-${Date.now()}`)
      .send({ accountId: fromAccountId, amount: 100 });

    const transferRes = await request(app)
      .post('/api/wallets/transfer')
      .set('Idempotency-Key', `transfer-${Date.now()}`)
      .send({ fromAccountId, toAccountId, amount: 30 });
    expect(transferRes.status).toBe(200);

    const fromBalance = await request(app).get(`/api/wallets/${fromAccountId}/balance`);
    const toBalance = await request(app).get(`/api/wallets/${toAccountId}/balance`);
    expect(Number(fromBalance.body.balance)).toBe(70);
    expect(Number(toBalance.body.balance)).toBe(30);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
