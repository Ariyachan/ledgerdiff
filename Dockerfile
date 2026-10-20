FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4200
EXPOSE 4200
CMD ["npm", "start"]
