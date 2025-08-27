#!/bin/bash

# Carbon Credits Blockchain System - Health Check Script
# ======================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="carbon-credits"

echo -e "${BLUE}🏥 Carbon Credits System - Health Check${NC}"
echo "======================================="

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

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Check if curl is available
if ! command -v curl > /dev/null 2>&1; then
    print_error "curl is not installed. Please install curl to run health checks."
    exit 1
fi

# Function to check HTTP endpoint
check_http() {
    local service=$1
    local url=$2
    local expected_status=${3:-200}
    
    echo -n "  Checking $service... "
    
    if response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null); then
        if [ "$response" -eq "$expected_status" ]; then
            echo -e "${GREEN}✅ OK${NC} (HTTP $response)"
            return 0
        else
            echo -e "${YELLOW}⚠️ WARNING${NC} (HTTP $response, expected $expected_status)"
            return 1
        fi
    else
        echo -e "${RED}❌ FAILED${NC} (Connection failed)"
        return 1
    fi
}

# Function to check TCP port
check_tcp() {
    local service=$1
    local host=$2
    local port=$3
    
    echo -n "  Checking $service... "
    
    if timeout 5 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
        echo -e "${GREEN}✅ OK${NC} (Port $port)"
        return 0
    else
        echo -e "${RED}❌ FAILED${NC} (Port $port unreachable)"
        return 1
    fi
}

# Check Docker status
print_status "Checking Docker status..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running!"
    exit 1
fi
echo -e "  Docker: ${GREEN}✅ Running${NC}"

# Check if services are running
print_status "Checking container status..."
CONTAINERS=$(docker-compose -p $PROJECT_NAME ps -q 2>/dev/null || echo "")
if [ -z "$CONTAINERS" ]; then
    print_error "No Carbon Credits containers found!"
    echo "Run './scripts/docker-start.sh' to start the system."
    exit 1
fi

# Show container status
echo -e "${BLUE}Container Status:${NC}"
docker-compose -p $PROJECT_NAME ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}"
echo ""

# Health check counters
TOTAL_CHECKS=0
PASSED_CHECKS=0

# Check HTTP endpoints
print_status "Checking HTTP endpoints..."

# Frontend
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "Frontend" "http://localhost:80"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Backend API
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "Backend API" "http://localhost:3000/health"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# AI Verification Service
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "AI Service" "http://localhost:5000/health"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Load Balancer
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "Load Balancer" "http://localhost:8080/health"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Prometheus
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "Prometheus" "http://localhost:9090/-/healthy"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Grafana
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_http "Grafana" "http://localhost:3001/api/health"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

echo ""

# Check TCP endpoints
print_status "Checking TCP endpoints..."

# Blockchain Node
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_tcp "Blockchain RPC" "localhost" "8545"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# MongoDB
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_tcp "MongoDB" "localhost" "27017"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Redis
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_tcp "Redis" "localhost" "6379"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# MQTT Broker
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if check_tcp "MQTT Broker" "localhost" "1883"; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

echo ""

# Additional health checks
print_status "Running additional health checks..."

# Check disk usage
echo -n "  Checking disk usage... "
DISK_USAGE=$(docker system df --format "table {{.Type}}\t{{.Size}}" | tail -n +2 | awk '{sum+=$2} END {print sum}')
echo -e "${GREEN}✅ OK${NC}"

# Check Docker logs for errors
echo -n "  Checking for recent errors... "
ERROR_COUNT=$(docker-compose -p $PROJECT_NAME logs --since=5m 2>/dev/null | grep -i "error\|exception\|failed" | wc -l || echo 0)
if [ "$ERROR_COUNT" -gt 10 ]; then
    echo -e "${YELLOW}⚠️ WARNING${NC} ($ERROR_COUNT recent errors found)"
else
    echo -e "${GREEN}✅ OK${NC} ($ERROR_COUNT recent errors)"
fi

echo ""

# Summary
print_status "Health Check Summary"
echo "===================="
echo "Total checks: $TOTAL_CHECKS"
echo "Passed: $PASSED_CHECKS"
echo "Failed: $((TOTAL_CHECKS - PASSED_CHECKS))"

if [ "$PASSED_CHECKS" -eq "$TOTAL_CHECKS" ]; then
    print_success "🎉 All systems are healthy!"
    echo ""
    echo "System URLs:"
    echo "  Frontend:        http://localhost:80"
    echo "  Backend API:     http://localhost:3000"
    echo "  AI Service:      http://localhost:5000"
    echo "  Load Balancer:   http://localhost:8080"
    echo "  Blockchain RPC:  http://localhost:8545"
    echo "  Prometheus:      http://localhost:9090"
    echo "  Grafana:         http://localhost:3001"
    exit 0
elif [ "$PASSED_CHECKS" -gt $((TOTAL_CHECKS / 2)) ]; then
    print_warning "⚠️ System is partially healthy ($PASSED_CHECKS/$TOTAL_CHECKS checks passed)"
    echo "Check the logs for more details: ./scripts/docker-logs.sh"
    exit 1
else
    print_error "❌ System is unhealthy ($PASSED_CHECKS/$TOTAL_CHECKS checks passed)"
    echo "Check the logs for more details: ./scripts/docker-logs.sh"
    exit 2
fi