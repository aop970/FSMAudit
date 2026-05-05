FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_BRAGI_API_KEY
ENV VITE_BRAGI_API_KEY=$VITE_BRAGI_API_KEY
RUN VITE_BASE_PATH=/ npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g serve@14
COPY --from=builder /app/dist ./dist
CMD ["/bin/sh", "-c", "serve -s dist -l ${PORT:-3000}"]
