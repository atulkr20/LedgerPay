import Redis from 'ioredis';

// Connecting to redis database
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => {
    console.log("Redis is awake and guarding the door");
});
