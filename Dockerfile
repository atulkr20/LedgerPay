# 1. Start with a blank computer that has Node.js installed
FROM node:20-alpine

# 2. Create a folder inside this new computer called /app
WORKDIR /app

# 3. Copy your package files and Prisma folder into the box first
COPY package*.json ./
COPY prisma ./prisma/

# 4. Install all your npm dependencies
RUN npm install

# 5. Generate the Prisma Client so it can understand your database later
RUN npx prisma generate

# 6. Copy all the rest of your code into the box
COPY . .

# 7. Translate your TypeScript code into fast JavaScript
RUN npx tsc

# 8. Open up port 3000 so the internet can reach it
EXPOSE 3000

# 9. The exact command to start your fast, production server!
CMD ["npm", "start"]