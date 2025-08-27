#!/bin/bash

# Carbon Credits Blockchain System - Docker Stop Script
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

echo -e "${BLUE}🛑 Stopping Carbon Credits Blockchain System${NC}"
echo "=============================================="

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

# Parse command line arguments
REMOVE_VOLUMES=false
REMOVE_IMAGES=false
SERVICES=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --volumes|-v)
            REMOVE_VOLUMES=true
            shift
            ;;
        --images|-i)
            REMOVE_IMAGES=true
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
            echo "  -v, --volumes     Remove named volumes (WARNING: This will delete all data!)"
            echo "  -i, --images      Remove built images"
            echo "  -s, --services    Comma-separated list of specific services to stop"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                          # Stop all services"
            echo "  $0 --volumes               # Stop and remove volumes (DELETE ALL DATA)"
            echo "  $0 --services backend      # Stop only backend service"
            echo "  $0 --images                # Stop and remove built images"
            exit 0
            ;;
        *)
            SERVICES="$SERVICES $1"
            shift
            ;;
    esac
done

# Stop services
if [ -n "$SERVICES" ]; then
    print_status "Stopping specific services: $SERVICES"
    DOCKER_SERVICES=$(echo $SERVICES | tr ',' ' ')
    docker-compose -p $PROJECT_NAME stop $DOCKER_SERVICES
else
    print_status "Stopping all services..."
    docker-compose -p $PROJECT_NAME down --remove-orphans
fi

# Remove volumes if requested
if [ "$REMOVE_VOLUMES" = true ]; then
    print_warning "⚠️  REMOVING ALL VOLUMES - THIS WILL DELETE ALL DATA!"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Removing volumes..."
        docker-compose -p $PROJECT_NAME down -v
        
        # Remove named volumes explicitly
        print_status "Removing named volumes..."
        docker volume rm ${PROJECT_NAME}_mongodb_data 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_redis_data 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_mqtt_data 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_mqtt_logs 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_blockchain_data 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_prometheus_data 2>/dev/null || true
        docker volume rm ${PROJECT_NAME}_grafana_data 2>/dev/null || true
        
        print_status "✅ All volumes removed"
    else
        print_status "Volume removal cancelled"
    fi
fi

# Remove images if requested
if [ "$REMOVE_IMAGES" = true ]; then
    print_status "Removing built images..."
    
    # Remove project-specific images
    docker images --format "table {{.Repository}}:{{.Tag}}" | grep "carbon-credits" | while read image; do
        if [ "$image" != "REPOSITORY:TAG" ]; then
            print_status "Removing image: $image"
            docker rmi "$image" 2>/dev/null || true
        fi
    done
    
    # Remove dangling images
    print_status "Removing dangling images..."
    docker image prune -f
    
    print_status "✅ Images removed"
fi

# Show final status
print_status "Checking remaining containers..."
REMAINING=$(docker-compose -p $PROJECT_NAME ps -q)
if [ -z "$REMAINING" ]; then
    print_status "✅ All Carbon Credits services stopped successfully"
else
    print_warning "Some containers are still running:"
    docker-compose -p $PROJECT_NAME ps
fi

# System cleanup suggestion
echo ""
print_status "💡 Cleanup suggestions:"
echo "  - To remove all stopped containers: docker container prune"
echo "  - To remove unused networks: docker network prune" 
echo "  - To remove unused images: docker image prune -a"
echo "  - To remove build cache: docker builder prune"
echo ""
echo "⚠️  Use with caution - these commands affect the entire Docker system!"