import { RedisStore } from "rate-limit-redis";
import { redisClient } from "./redis.js";

/**
 * Store compartilhado entre réplicas para express-rate-limit. Sem Redis
 * configurado, retorna undefined e express-rate-limit usa seu MemoryStore
 * padrão (correto só para uma única instância).
 */
export function sharedRateLimitStore(prefix) {
  if (!redisClient) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix,
  });
}
