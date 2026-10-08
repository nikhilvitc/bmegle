FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY client/package.json client/package-lock.json* ./client/
RUN npm install && npm install --prefix client --include=dev

COPY . .
RUN npm run build --prefix client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["npm", "start"]
