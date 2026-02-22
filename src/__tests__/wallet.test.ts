import request from 'supertest';
import { app } from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
describe('wallet API Security & Validation Tests', () => {
    it('should block wallet creation if userId is missing', async () => {
        const response = await request(app)
        .post('/api/wallets/create')
        .send({}); // Sending empty body

        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
        expect(Array.isArray(response.body.error)).toBe(true);
    });

    it('should block malicious negative transfers', async() => {
        const response = await request(app)
        .post('/api/wallets/transfer')
        .set('Idempotency-Key', 'test-ticket-001')
        .send({
            fromAccountId: '123e4567-e89b-12d3-a456-426614174000',
            toAccountId: '123e4567-e89b-12d3-a456-426614174001',
            amount: -500 // Invalid negative amount
        });
        // Expecting Zod to reject the negative number
    expect(response.status).toBe(400);
  });

  it('should block transfers missing an Idempotency Key', async () => {
    const response = await request(app)
      .post('/api/wallets/transfer')
      // Purposefully omitting the Idempotency-Key header
      .send({
        fromAccountId: '123e4567-e89b-12d3-a456-426614174000',
        toAccountId: '123e4567-e89b-12d3-a456-426614174001',
        amount: 50
      });

    // Expecting the idempotency middleware to block the request
    expect(response.status).toBe(400);
    expect(String(response.body.error).toLowerCase()).toContain('idempotency-key');
  });

});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
