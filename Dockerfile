FROM node:alpine
WORKDIR /app
COPY ./adapter/index.js ./adapter/package.json adapter/ && ./main.js ./src /app/
RUN apk add --no-cache sqlite && \
    npm install --only=production --omit=dev && \
    npm cache clean --force
EXPOSE 8787
CMD ["npm", "run", "start:local"]