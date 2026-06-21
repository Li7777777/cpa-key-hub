# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10057

COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev --package-lock=false; \
    fi

COPY server.js ./server.js
COPY public ./public

RUN mkdir -p data && chown -R node:node /app

USER node

EXPOSE 10057
VOLUME ["/app/data"]

CMD ["npm", "start"]
