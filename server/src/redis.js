import Redis from "ioredis";
import { config } from "./config.js";

// null quando REDIS_URL não está setada (dev local, docker-compose sem Redis):
// os rate limiters caem para MemoryStore nesse caso — ver rateLimitStore.js.
export const redisClient = config.redisUrl
  ? new Redis(config.redisUrl, { maxRetriesPerRequest: 1 })
  : null;

if (redisClient) {
  redisClient.on("error", (err) => {
    console.error("Erro de conexão com o Redis", err.message);
  });
}
