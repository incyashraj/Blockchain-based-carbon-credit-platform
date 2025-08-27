# Multi-stage Docker build for Carbon Credit Blockchain System
FROM node:22-alpine AS base

# Install Python and build dependencies
RUN apk add --no-cache python3 py3-pip make g++ git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm ci --only=production
RUN cd backend && npm ci --only=production
RUN cd frontend && npm ci --only=production

# Backend stage
FROM base AS backend
WORKDIR /app
COPY backend ./backend
COPY blockchain ./blockchain
COPY .env* ./
COPY hardhat.config.js ./
COPY deployments ./deployments

# Install Python dependencies for AI
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

EXPOSE 3000
CMD ["node", "backend/server.js"]

# Frontend stage
FROM base AS frontend
WORKDIR /app
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm run build

FROM nginx:alpine AS frontend-prod
COPY --from=frontend /app/frontend/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# AI Verification Service
FROM python:3.12-alpine AS ai-service
WORKDIR /app
RUN apk add --no-cache gcc musl-dev linux-headers
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY ai-verification ./ai-verification
EXPOSE 5000
CMD ["python", "ai-verification/api/verification_api.py"]

# Blockchain Node (Hardhat)
FROM base AS blockchain-node
WORKDIR /app
COPY blockchain ./blockchain
COPY hardhat.config.js ./
COPY .env* ./
EXPOSE 8545
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]

# IoT Simulation Service
FROM python:3.12-alpine AS iot-service
WORKDIR /app
RUN pip install paho-mqtt numpy python-dotenv
COPY iot ./iot
COPY .env* ./
CMD ["python", "iot/sensors/co2_sensor.py"]