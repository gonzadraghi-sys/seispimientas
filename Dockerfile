FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN apk add --no-cache postgresql16-client

EXPOSE 3000

CMD ["sh", "-c", "node db/migrate.js && node src/server.js"]
