#!/bin/bash

# Carbon Credits Blockchain System - Modern Stack Setup Script
# Enhanced for 2025 with Podman, Kubernetes, GitOps, and Polygon innovations
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Carbon Credits Modern Stack Setup (2025)${NC}"
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

print_header() {
    echo -e "${PURPLE}[SETUP]${NC} $1"
}

# Check system requirements
print_header "Checking system requirements..."

# Check if macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This script is designed for macOS. For Linux, modify package managers accordingly."
    exit 1
fi

# Check for Homebrew
if ! command -v brew > /dev/null 2>&1; then
    print_error "Homebrew is required. Install it from https://brew.sh/"
    exit 1
fi

print_status "System check passed ✅"

# Parse command line arguments
INSTALL_PODMAN=false
INSTALL_KUBERNETES=false
INSTALL_GITOPS=false
SETUP_POLYGON=false
SETUP_MONITORING=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --podman|-p)
            INSTALL_PODMAN=true
            shift
            ;;
        --kubernetes|-k)
            INSTALL_KUBERNETES=true
            shift
            ;;
        --gitops|-g)
            INSTALL_GITOPS=true
            shift
            ;;
        --polygon)
            SETUP_POLYGON=true
            shift
            ;;
        --monitoring|-m)
            SETUP_MONITORING=true
            shift
            ;;
        --all|-a)
            INSTALL_PODMAN=true
            INSTALL_KUBERNETES=true
            INSTALL_GITOPS=true
            SETUP_POLYGON=true
            SETUP_MONITORING=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -p, --podman        Install Podman and podman-compose"
            echo "  -k, --kubernetes    Install Kubernetes tools (kubectl, kind, helm)"
            echo "  -g, --gitops        Install GitOps tools (ArgoCD CLI)"
            echo "      --polygon       Setup enhanced Polygon configuration"
            echo "  -m, --monitoring    Setup monitoring tools"
            echo "  -a, --all           Install everything"
            echo "  -h, --help          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --all                    # Install complete modern stack"
            echo "  $0 --podman --kubernetes    # Install container and orchestration tools"
            echo "  $0 --polygon --monitoring   # Setup blockchain and monitoring"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# If no options specified, show help
if [ "$INSTALL_PODMAN" = false ] && [ "$INSTALL_KUBERNETES" = false ] && [ "$INSTALL_GITOPS" = false ] && [ "$SETUP_POLYGON" = false ] && [ "$SETUP_MONITORING" = false ]; then
    print_warning "No installation options specified. Use --help for options or --all for complete setup."
    exit 0
fi

# Install Podman and related tools
if [ "$INSTALL_PODMAN" = true ]; then
    print_header "Installing Podman ecosystem..."
    
    # Install Podman
    if ! command -v podman > /dev/null 2>&1; then
        print_status "Installing Podman..."
        brew install podman
        
        # Initialize Podman machine for macOS
        print_status "Initializing Podman machine..."
        podman machine init --cpus 4 --memory 8192 --disk-size 100
        podman machine start
    else
        print_status "Podman already installed ✅"
    fi
    
    # Install podman-compose
    if ! command -v podman-compose > /dev/null 2>&1; then
        print_status "Installing podman-compose..."
        brew install podman-compose
    else
        print_status "podman-compose already installed ✅"
    fi
    
    # Install Podman Desktop (GUI)
    if ! brew list --cask podman-desktop > /dev/null 2>&1; then
        print_status "Installing Podman Desktop..."
        brew install --cask podman-desktop
    else
        print_status "Podman Desktop already installed ✅"
    fi
    
    print_status "Podman ecosystem setup complete ✅"
fi

# Install Kubernetes tools
if [ "$INSTALL_KUBERNETES" = true ]; then
    print_header "Installing Kubernetes ecosystem..."
    
    # Install kubectl
    if ! command -v kubectl > /dev/null 2>&1; then
        print_status "Installing kubectl..."
        brew install kubectl
    else
        print_status "kubectl already installed ✅"
    fi
    
    # Install kind (Kubernetes in Docker)
    if ! command -v kind > /dev/null 2>&1; then
        print_status "Installing kind..."
        brew install kind
    else
        print_status "kind already installed ✅"
    fi
    
    # Install Helm
    if ! command -v helm > /dev/null 2>&1; then
        print_status "Installing Helm..."
        brew install helm
    else
        print_status "Helm already installed ✅"
    fi
    
    # Install k9s (Kubernetes CLI dashboard)
    if ! command -v k9s > /dev/null 2>&1; then
        print_status "Installing k9s..."
        brew install k9s
    else
        print_status "k9s already installed ✅"
    fi
    
    print_status "Kubernetes ecosystem setup complete ✅"
fi

# Install GitOps tools
if [ "$INSTALL_GITOPS" = true ]; then
    print_header "Installing GitOps ecosystem..."
    
    # Install ArgoCD CLI
    if ! command -v argocd > /dev/null 2>&1; then
        print_status "Installing ArgoCD CLI..."
        brew install argocd
    else
        print_status "ArgoCD CLI already installed ✅"
    fi
    
    # Install Terraform
    if ! command -v terraform > /dev/null 2>&1; then
        print_status "Installing Terraform..."
        brew install terraform
    else
        print_status "Terraform already installed ✅"
    fi
    
    # Install Ansible
    if ! command -v ansible > /dev/null 2>&1; then
        print_status "Installing Ansible..."
        brew install ansible
    else
        print_status "Ansible already installed ✅"
    fi
    
    print_status "GitOps ecosystem setup complete ✅"
fi

# Setup enhanced Polygon configuration
if [ "$SETUP_POLYGON" = true ]; then
    print_header "Setting up enhanced Polygon configuration..."
    
    # Create data directories
    print_status "Creating data directories..."
    mkdir -p data/{mongodb,redis,mqtt,blockchain,prometheus,grafana}
    mkdir -p logs/{nginx,mqtt}
    
    # Update environment configuration for Polygon 2025
    print_status "Updating environment configuration for Polygon 2025..."
    
    if [ -f .env ]; then
        # Backup existing .env
        cp .env .env.backup
        print_status "Existing .env backed up as .env.backup"
    fi
    
    # Add Polygon 2025 enhancements to .env
    cat >> .env << EOF

# Polygon 2025 Enhanced Configuration
BLOCKCHAIN_NETWORK=polygon
POLYGON_RPC_URL=https://polygon-rpc.com
AGGLAYER_ENABLED=true
AGGLAYER_RPC_URL=https://agglayer-rpc.polygon.technology
CDK_VERSION=2.0
ZKEVM_TYPE=1
NATIVE_TOKEN=POL
CROSS_CHAIN_ENABLED=true

# Performance Optimizations
THROUGHPUT_TARGET=60
WITHDRAWAL_DELAY=0
GAS_PRICE_STRATEGY=dynamic
MAX_GAS_PRICE=500000000000
MIN_GAS_PRICE=30000000000

# Enhanced Security
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPM=1000
SIGNATURE_VERIFICATION=enabled
EOF
    
    print_status "Polygon 2025 configuration complete ✅"
fi

# Setup monitoring tools
if [ "$SETUP_MONITORING" = true ]; then
    print_header "Setting up monitoring ecosystem..."
    
    # Install Grafana CLI
    if ! command -v grafana-cli > /dev/null 2>&1; then
        print_status "Installing Grafana..."
        brew install grafana
    else
        print_status "Grafana already installed ✅"
    fi
    
    # Install Prometheus
    if ! command -v prometheus > /dev/null 2>&1; then
        print_status "Installing Prometheus..."
        brew install prometheus
    else
        print_status "Prometheus already installed ✅"
    fi
    
    print_status "Monitoring ecosystem setup complete ✅"
fi

# Create convenience scripts
print_header "Creating convenience scripts..."

# Create Podman startup script
cat > scripts/start-podman.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting Carbon Credits with Podman..."
podman-compose -f podman-compose.yml up -d
echo "✅ Podman stack started. Access at http://localhost:80"
EOF

# Create Kubernetes deployment script
cat > scripts/deploy-k8s.sh << 'EOF'
#!/bin/bash
echo "☸️ Deploying to Kubernetes..."
kubectl apply -f kubernetes/
echo "✅ Kubernetes deployment complete"
EOF

# Make scripts executable
chmod +x scripts/*.sh

print_status "Convenience scripts created ✅"

echo ""
print_header "🎉 Modern Stack Setup Complete!"
echo "================================="
echo ""
echo "Available Commands:"
if [ "$INSTALL_PODMAN" = true ]; then
    echo "  Podman:      podman-compose -f podman-compose.yml up -d"
    echo "  Podman GUI:  Open Podman Desktop application"
fi
if [ "$INSTALL_KUBERNETES" = true ]; then
    echo "  Kubernetes:  kubectl apply -f kubernetes/"
    echo "  K8s UI:      k9s"
fi
if [ "$INSTALL_GITOPS" = true ]; then
    echo "  ArgoCD:      argocd version"
    echo "  Terraform:   terraform version"
fi
if [ "$SETUP_POLYGON" = true ]; then
    echo "  Polygon:     Enhanced configuration ready in .env"
fi
if [ "$SETUP_MONITORING" = true ]; then
    echo "  Monitoring:  Prometheus & Grafana tools installed"
fi
echo ""
echo "Next Steps:"
echo "1. Review the configuration files created"
echo "2. Run './scripts/start-podman.sh' for Podman deployment"
echo "3. Or deploy to Kubernetes with './scripts/deploy-k8s.sh'"
echo "4. Access monitoring at http://localhost:3001 (Grafana)"
echo ""
echo "For help: $0 --help"