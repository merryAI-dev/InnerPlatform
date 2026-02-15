FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
ENV BFF_HOST=0.0.0.0
ENV BFF_PORT=8080
ENV BFF_ALLOWED_ORIGINS=*

EXPOSE 8080

CMD ["node", "server/bff/server.mjs"]
