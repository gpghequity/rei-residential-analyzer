# Pin a Node that satisfies vite 8 / rolldown (needs >=22.12; Railway's nixpacks only
# offers 22.11). node:22-slim tracks the latest 22.x. Build with the rolldown linux
# native binding installed (--include=optional), serve via the Express server.
FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --include=optional

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
