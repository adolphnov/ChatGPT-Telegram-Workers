import fs from 'node:fs';
import { createCache, startServer } from 'cloudflare-worker-adapter';
import { installFetchProxy } from 'cloudflare-worker-adapter/fetchProxy';
import toml from 'toml';
import { schedule } from 'node-cron';
import worker from '../../main.js';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const cache = createCache(config?.database?.type, {
  uri: config.database.path || '',
});
console.log(`database: ${config?.database?.type} is ready`);

// 配置代理
const proxy = config?.https_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy) {
  installFetchProxy(proxy);
}

// 配置版本信息
try {
  // 定时任务
  const raw = fs.readFileSync('../../wrangler.toml');
  const env = { ...toml.parse(raw).vars, DATABASE: cache };

  if (env.EXPIRED_TIME && env.EXPIRED_TIME > 0 && env.CRON_CHECK_TIME) {
    try {
      schedule(env.CRON_CHECK_TIME, async () => {
        await worker.scheduled(null, env, null);
      });
    } catch (e) {
      console.error('Failed to schedule cron job:', e);
    }
  }
} catch (e) {
  console.log(e);
}

startServer(
  config.port || 8787,
  config.server.hostname || '0.0.0.0',
  '../../wrangler.toml',
  { DATABASE: cache },
  { server: config.server.baseURL },
  worker.fetch,
);
