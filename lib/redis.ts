// lib/redis.ts
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

// Redis solo se usa si REDIS_URL existe. Si no, la app funciona sin Redis.
let redis: Redis | null = null;
if (redisUrl) {
    try {
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                if (times > 3) return null;
                return Math.min(2000 * times, 5000);
            },
        });
        redis.on('error', (err) => {
            console.warn('[redis] error:', err?.message || err);
        });
        redis.on('close', () => {
            console.warn('[redis] conexión cerrada');
        });
    } catch (e) {
        const err = e instanceof Error ? e.message : e
        console.warn('[redis] init failed:', err);
        redis = null;
    }
} else {
    console.warn('REDIS_URL no definida. Redis desactivado (modo local sin cola).');
}

export { redis };
