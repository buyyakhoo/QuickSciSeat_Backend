FROM node:22-alpine

# set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache mechanisms
COPY package.json .
COPY package-lock.json .

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Generate Prisma client
# RUN npx prisma db pull
# RUN npx prisma generate
CMD sh -c "npx prisma db pull && npx prisma generate"

# Build the SvelteKit app
RUN npm run build

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
CMD ["npm", "run", "start"]