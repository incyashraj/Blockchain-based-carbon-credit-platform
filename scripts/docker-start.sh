#!/bin/bash

# Carbon Credits Blockchain System - Docker Startup Script
# =========================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.yml"
PROJECT_NAME="carbon-credits"

echo -e "${BLUE}🌱 Carbon Credits Blockchain System - Docker Startup${NC}"
echo "=================================================="

# Function to print status
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose > /dev/null 2>&1; then
    print_error "docker-compose is not installed. Please install docker-compose first."
    exit 1
fi

# Create necessary directories
print_status "Creating necessary directories..."
mkdir -p logs/nginx
mkdir -p nginx/ssl
mkdir -p scripts
mkdir -p deployments

# Check if .env file exists
if [ ! -f .env ]; then
    print_warning ".env file not found. Copying from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        print_warning "Please edit .env file with your configuration before running again."
    else
        print_error ".env.example file not found. Please create .env file manually."
        exit 1
    fi
fi

# Parse command line arguments
SERVICES=""
REBUILD=false
LOGS=false
DAEMON=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --rebuild|-r)
            REBUILD=true
            shift
            ;;
        --logs|-l)
            LOGS=true
            DAEMON=false
            shift
            ;;
        --foreground|-f)
            DAEMON=false
            shift
            ;;
        --services|-s)
            SERVICES="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS] [SERVICES...]"
            echo ""
            echo "Options:"
            echo "  -r, --rebuild     Rebuild images before starting"
            echo "  -l, --logs        Show logs and keep running in foreground"
            echo "  -f, --foreground  Run in foreground without showing logs"
            echo "  -s, --services    Comma-separated list of specific services to start"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Services:"
            echo "  mongodb, redis, mosquitto, blockchain-node, backend"
            echo "  ai-verification, frontend, iot-simulation, nginx-lb"
            echo "  prometheus, grafana"
            echo ""
            echo "Examples:"
            echo "  $0                          # Start all services"
            echo "  $0 --rebuild                # Rebuild and start all services"
            echo "  $0 --logs                   # Start with logs"
            echo "  $0 --services backend,frontend  # Start only backend and frontend"
            exit 0
            ;;
        *)
            SERVICES="$SERVICES $1"
            shift
            ;;
    esac
done

# Stop any existing containers
print_status "Stopping any existing containers..."
docker-compose -p $PROJECT_NAME down --remove-orphans

# Pull latest images if not rebuilding
if [ "$REBUILD" = false ]; then
    print_status "Pulling latest images..."
    docker-compose -p $PROJECT_NAME pull
fi

# Build/rebuild images if needed
if [ "$REBUILD" = true ]; then
    print_status "Building/rebuilding images..."
    docker-compose -p $PROJECT_NAME build --no-cache
fi

# Start services
if [ -n "$SERVICES" ]; then
    print_status "Starting specific services: $SERVICES"
    DOCKER_SERVICES=$(echo $SERVICES | tr ',' ' ')
else
    print_status "Starting all services..."
    DOCKER_SERVICES=""
fi

# Start containers
if [ "$DAEMON" = true ]; then
    print_status "Starting containers in daemon mode..."
    docker-compose -p $PROJECT_NAME up -d $DOCKER_SERVICES
    
    print_status "Waiting for services to start..."
    sleep 10
    
    # Check service health
    print_status "Checking service health..."
    docker-compose -p $PROJECT_NAME ps
    
    echo ""
    print_status "🎉 Carbon Credits Blockchain System started successfully!"
    echo ""
    echo "Service URLs:"
    echo "  Frontend:        http://localhost:80"
    echo "  Backend API:     http://localhost:3000"
    echo "  AI Service:      http://localhost:5000" 
    echo "  Blockchain RPC:  http://localhost:8545"
    echo "  Load Balancer:   http://localhost:8080"
    echo "  Prometheus:      http://localhost:9090"
    echo "  Grafana:         http://localhost:3001 (admin/carbon_credits_admin)"
    echo "  MongoDB:         mongodb://localhost:27017"
    echo "  Redis:           redis://localhost:6379"
    echo "  MQTT Broker:     mqtt://localhost:1883"
    echo ""
    echo "To view logs: docker-compose -p $PROJECT_NAME logs -f [service_name]"
    echo "To stop:      ./scripts/docker-stop.sh"
else
    if [ "$LOGS" = true ]; then
        print_status "Starting containers with logs..."
        docker-compose -p $PROJECT_NAME up $DOCKER_SERVICES
    else
        print_status "Starting containers in foreground..."
        docker-compose -p $PROJECT_NAME up --no-log-prefix $DOCKER_SERVICES
    fi
fi