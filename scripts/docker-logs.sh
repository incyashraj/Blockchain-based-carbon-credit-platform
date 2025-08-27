#!/bin/bash

# Carbon Credits Blockchain System - Docker Logs Script
# =====================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="carbon-credits"

echo -e "${BLUE}📋 Carbon Credits System - Log Viewer${NC}"
echo "====================================="

# Function to print status
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Available services
AVAILABLE_SERVICES="mongodb redis mosquitto blockchain-node backend ai-verification frontend iot-simulation nginx-lb prometheus grafana"

# Parse command line arguments
SERVICE=""
FOLLOW=true
TAIL_LINES=50
SINCE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --service|-s)
            SERVICE="$2"
            shift 2
            ;;
        --no-follow|-n)
            FOLLOW=false
            shift
            ;;
        --tail|-t)
            TAIL_LINES="$2"
            shift 2
            ;;
        --since)
            SINCE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -s, --service SERVICE  Show logs for specific service"
            echo "  -n, --no-follow       Don't follow logs (show and exit)"
            echo "  -t, --tail LINES      Number of lines to show from end (default: 50)"
            echo "      --since TIME      Show logs since timestamp (e.g. 2023-01-01T00:00:00Z)"
            echo "  -h, --help            Show this help message"
            echo ""
            echo "Available services:"
            for service in $AVAILABLE_SERVICES; do
                echo "  - $service"
            done
            echo ""
            echo "Examples:"
            echo "  $0                           # Show all service logs"
            echo "  $0 -s backend               # Show only backend logs"
            echo "  $0 -s backend -n            # Show backend logs and exit"
            echo "  $0 --since 1h               # Show logs from last hour"
            echo "  $0 -t 100                   # Show last 100 lines"
            exit 0
            ;;
        *)
            SERVICE="$1"
            shift
            ;;
    esac
done

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if services are running
RUNNING_SERVICES=$(docker-compose -p $PROJECT_NAME ps --services --filter "status=running" 2>/dev/null || echo "")
if [ -z "$RUNNING_SERVICES" ]; then
    print_error "No Carbon Credits services are running. Start them first with ./scripts/docker-start.sh"
    exit 1
fi

# Build docker-compose command
DOCKER_CMD="docker-compose -p $PROJECT_NAME logs"

if [ "$FOLLOW" = true ]; then
    DOCKER_CMD="$DOCKER_CMD -f"
fi

if [ -n "$TAIL_LINES" ]; then
    DOCKER_CMD="$DOCKER_CMD --tail=$TAIL_LINES"
fi

if [ -n "$SINCE" ]; then
    DOCKER_CMD="$DOCKER_CMD --since=$SINCE"
fi

# Show logs for specific service or all services
if [ -n "$SERVICE" ]; then
    # Validate service name
    if [[ ! " $AVAILABLE_SERVICES " =~ " $SERVICE " ]]; then
        print_error "Unknown service: $SERVICE"
        echo "Available services: $AVAILABLE_SERVICES"
        exit 1
    fi
    
    # Check if service is running
    if [[ ! " $RUNNING_SERVICES " =~ " $SERVICE " ]]; then
        print_error "Service '$SERVICE' is not running"
        echo "Running services: $RUNNING_SERVICES"
        exit 1
    fi
    
    print_status "Showing logs for service: $SERVICE"
    echo "Press Ctrl+C to exit"
    echo "=========================================="
    $DOCKER_CMD $SERVICE
else
    print_status "Showing logs for all running services"
    echo "Running services: $RUNNING_SERVICES"
    echo "Press Ctrl+C to exit"
    echo "=========================================="
    $DOCKER_CMD
fi