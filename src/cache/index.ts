import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { logger, logCache } from '../utils/logger';
import { CacheKeyType } from '../models/types';

class CacheService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      try {
        const socketOptions = {
          host: config.redis.host,
          port: config.redis.port,
          ...(config.redis.tlsEnabled
            ? {
                tls: true,
                rejectUnauthorized: config.redis.tlsRejectUnauthorized,
              }
            : {}),
        };

        this.client = createClient({
          socket: socketOptions,
          password: config.redis.password || undefined,
          database: config.redis.db,
        });

        this.client.on('error', (err) => {
          logger.error('Redis Client Error', err);
          this.isConnected = false;
        });

        this.client.on('connect', () => {
          logger.info('Redis client connected');
        });

        this.client.on('ready', () => {
          this.isConnected = true;
          logger.info('Redis client ready');
        });

        this.client.on('disconnect', () => {
          this.isConnected = false;
          logger.warn('Redis client disconnected');
        });

        await this.client.connect();
      } catch (error) {
        logger.error('Failed to connect to Redis', error as Error);
        this.connectionPromise = null;
        throw error;
      }
    })();

    return this.connectionPromise;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      this.client = null;
      this.connectionPromise = null;
      logger.info('Redis client disconnected');
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Build cache key with type prefix
   */
  private buildKey(type: CacheKeyType, identifier: string): string {
    return `sunset:${type}:${identifier}`;
  }

  /**
   * Get TTL for cache type
   */
  private getTTL(type: CacheKeyType): number {
    switch (type) {
      case 'reverse-geocoding':
        return config.cache.ttl.geocoding;
      case 'forecast':
      case 'weather':
        return config.cache.ttl.forecast;
      case 'historical':
        return config.cache.ttl.historical;
      default:
        return 3600; // 1 hour default
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(type: CacheKeyType, identifier: string): Promise<T | null> {
    if (!this.isAvailable()) {
      logCache('miss', identifier, { reason: 'redis_unavailable' });
      return null;
    }

    try {
      const key = this.buildKey(type, identifier);
      const value = await this.client!.get(key);

      if (value) {
        logCache('hit', key);
        return JSON.parse(value) as T;
      }

      logCache('miss', key);
      return null;
    } catch (error) {
      logger.error('Cache get error', error as Error, { type, identifier });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(type: CacheKeyType, identifier: string, value: T, ttl?: number): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const key = this.buildKey(type, identifier);
      const cacheTtl = ttl ?? this.getTTL(type);
      const serialized = JSON.stringify(value);

      await this.client!.setEx(key, cacheTtl, serialized);
      logCache('set', key, { ttl: cacheTtl });
      return true;
    } catch (error) {
      logger.error('Cache set error', error as Error, { type, identifier });
      return false;
    }
  }

  async setPersistent<T>(type: CacheKeyType, identifier: string, value: T): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const key = this.buildKey(type, identifier);
      const serialized = JSON.stringify(value);

      await this.client!.set(key, serialized);
      logCache('set', key, { ttl: 'persistent' });
      return true;
    } catch (error) {
      logger.error('Persistent cache set error', error as Error, { type, identifier });
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(type: CacheKeyType, identifier: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const key = this.buildKey(type, identifier);
      const exists = await this.client!.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Cache exists check error', error as Error, { type, identifier });
      return false;
    }
  }

  /**
   * Acquire distributed lock for request deduplication
   */
  async acquireLock(lockKey: string, ttl?: number): Promise<boolean> {
    if (!this.isAvailable()) {
      return true; // Fail open - allow request if cache unavailable
    }

    try {
      const key = this.buildKey('forecast', `lock:${lockKey}`);
      const lockTtl = ttl ?? config.cache.lockTtl;
      
      // Use SET NX EX for atomic lock acquisition
      const result = await this.client!.set(key, '1', {
        NX: true,
        EX: lockTtl,
      });

      return result === 'OK';
    } catch (error) {
      logger.error('Lock acquisition error', error as Error, { lockKey });
      return true; // Fail open
    }
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockKey: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      const key = this.buildKey('forecast', `lock:${lockKey}`);
      await this.client!.del(key);
    } catch (error) {
      logger.error('Lock release error', error as Error, { lockKey });
    }
  }

  /**
   * Wait for lock to be released (polling with timeout)
   */
  async waitForLock(lockKey: string, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeoutMs) {
      const lockExists = await this.exists('forecast', `lock:${lockKey}`);
      if (!lockExists) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    logger.warn('Lock wait timeout', { lockKey, timeoutMs });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    keyCount: number;
    memoryUsed?: string;
  }> {
    if (!this.isAvailable()) {
      return { connected: false, keyCount: 0 };
    }

    try {
      const [keyCount, info] = await Promise.all([
        this.countKeys('sunset:*'),
        this.client!.info('memory'),
      ]);
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      
      return {
        connected: true,
        keyCount,
        memoryUsed: memoryMatch?.[1].trim(),
      };
    } catch (error) {
      logger.error('Cache stats error', error as Error);
      return { connected: this.isConnected, keyCount: 0 };
    }
  }

  private async countKeys(pattern: string): Promise<number> {
    if (!this.client) {
      return 0;
    }

    let count = 0;

    for await (const _key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      count += 1;
    }

    return count;
  }
}

// Export singleton instance
export const cacheService = new CacheService();
