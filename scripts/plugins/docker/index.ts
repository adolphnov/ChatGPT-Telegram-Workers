import * as fs from 'node:fs/promises';
import path from 'node:path';

const dockerfile = `
FROM node:alpine as PROD

WORKDIR /app
COPY index.js package.json /app/
RUN npm install --only=production --omit=dev && \
apk add --no-cache sqlite && \
npm cache clean --force
EXPOSE 8787
CMD ["npm", "run", "start"]
`;

const packageJson = `
{
  "name": "chatgpt-telegram-workers",
  "type": "module",
  "version": "1.8.0",
  "author": "TBXark",
  "license": "MIT",
  "module": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^1.0.1",
    "@ai-sdk/azure": "^1.0.3",
    "@ai-sdk/cohere": "^1.0.1",
    "@ai-sdk/google": "^1.0.1",
    "@ai-sdk/google-vertex": "^1.0.1",
    "@ai-sdk/mistral": "^1.0.2",
    "@ai-sdk/openai": "^1.0.2",
    "@ai-sdk/xai": "^1.0.2",
    "ai": "^4.0.2",
    "cloudflare-worker-adapter": "^1.3.4",
    "node-cron": "^3.0.3",
    "ws": "^8.18.0"
  },
  "devDependencies": {}
}
`;

export function createDockerPlugin(targetDir: string) {
    return {
        name: 'docker',
        async closeBundle() {
            await fs.writeFile(path.resolve(targetDir, 'Dockerfile'), dockerfile.trim());
            await fs.writeFile(path.resolve(targetDir, 'package.json'), packageJson.trim());
        },
    };
}
