FROM node:alpine AS DEV

WORKDIR /app
COPY package.json vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm install && npm run build:local

FROM node:alpine AS PROD

WORKDIR /app
COPY --from=DEV /app/dist/index.js /app/dist/index.js
COPY --from=DEV /app/package.json /app/
RUN npm install --only=production --omit=dev && \
    npm cache clean --force && \
    apk add --no-cache sqlite ffmpeg
EXPOSE 8787
CMD ["npm", "run", "start:dist"]
