/* eslint-disable unused-imports/no-unused-vars */
import { initEnv } from './src/config/env.js';
import { handleRequest } from './src/route.js';
import { errorToString } from './src/utils/utils.js';
import i18n from './src/i18n/index.js';
import tasks from './src/tools/scheduleTask.js';

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env.DATABASE && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        const { RedisCache } = await import('./src/utils/redis.js');
        env.DATABASE = new RedisCache(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
      }
      initEnv(env, i18n);
      return await handleRequest(request);
    } catch (e) {
      console.error(e);
      return new Response(errorToString(e), { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    try {
      if (!env.DATABASE && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        const { RedisCache } = await import('./src/utils/redis.js');
        env.DATABASE = new RedisCache(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
      }
      const promises = [];
      for (const task of Object.values(tasks)) {
        promises.push(task(env));
      }
      await Promise.all(promises);
      console.log('All tasks done.');
    } catch (e) {
      console.error('Error in scheduled tasks:', e);
    }
  },
};
