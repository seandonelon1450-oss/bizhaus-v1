FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Render (and most hosts) inject PORT at runtime; the app reads process.env.PORT.
EXPOSE 10000
CMD ["npm", "start"]
