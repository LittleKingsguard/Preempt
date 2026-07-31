#!/usr/bin/env bash
# ==============================================================================
# Preempt - VPS Setup & Deployment Script
# ==============================================================================
# This script automates setting up Preempt on a fresh Linux VPS.
# It includes optional/automatic steps for installing Docker & Docker Compose first,
# checks/installs dependencies (Git, Curl), clones or pulls the repository,
# initializes environment configuration, builds and launches Docker containers,
# and provides guidance for completing SSR setup endpoints.
# ==============================================================================

set -euo pipefail

# Default Configuration
DEFAULT_REPO="https://github.com/LittleKingsguard/Preempt.git"
DEFAULT_BRANCH="main"
REPO_URL="${REPO_URL:-$DEFAULT_REPO}"
BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
TARGET_DIR="${TARGET_DIR:-.}"
FORCE_INSTALL_DOCKER=false

# Color Output Formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    cat <<EOF
Preempt VPS Deployment & Setup Script

Usage:
  ./setup_vps.sh [OPTIONS]

Options:
  -i, --install-docker  Force installation/update of Docker Engine and Docker Compose
  -r, --repo <url>      Git repository URL (Default: ${DEFAULT_REPO})
  -b, --branch <branch> Git branch to checkout (Default: ${DEFAULT_BRANCH})
  -d, --dir <path>      Target installation directory (Default: current directory)
  -h, --help            Show this help message

Environment Variables:
  INSTALL_DOCKER        Set to 'true' to force Docker installation first
  REPO_URL              Git repository URL
  BRANCH                Git branch name
  TARGET_DIR            Target installation directory

Examples:
  ./setup_vps.sh --install-docker
  ./setup_vps.sh -b dev -d /opt/preempt
EOF
    exit 0
}

# Parse Command Line Arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--install-docker)
            FORCE_INSTALL_DOCKER=true
            shift
            ;;
        -r|--repo)
            REPO_URL="$2"
            shift 2
            ;;
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        -d|--dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

if [ "${INSTALL_DOCKER:-false}" = "true" ]; then
    FORCE_INSTALL_DOCKER=true
fi

# ------------------------------------------------------------------------------
# 1. Docker Setup Routine (Optional / Automatic if missing)
# ------------------------------------------------------------------------------
install_docker_engine() {
    log_info "Installing Docker Engine & Docker Compose..."
    
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release
    fi

    # Run official Docker convenience installer
    curl -fsSL https://get.docker.com | sh

    if command -v systemctl &>/dev/null; then
        sudo systemctl enable --now docker
    fi

    # Add current user to docker group to run without sudo
    CURRENT_USER="${SUDO_USER:-$(whoami)}"
    if [ -n "${CURRENT_USER}" ] && [ "${CURRENT_USER}" != "root" ]; then
        log_info "Adding user '${CURRENT_USER}' to the 'docker' group..."
        sudo usermod -aG docker "${CURRENT_USER}" || true
    fi

    log_success "Docker Engine and Docker Compose installed successfully."
}

# ------------------------------------------------------------------------------
# 2. Dependency Verification & Installation
# ------------------------------------------------------------------------------
log_info "Checking system requirements and dependencies..."

install_package() {
    local pkg=$1
    log_info "Installing ${pkg}..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq "${pkg}"
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y "${pkg}"
    elif command -v yum &>/dev/null; then
        sudo yum install -y "${pkg}"
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm "${pkg}"
    else
        log_error "Unsupported package manager. Please manually install ${pkg}."
        exit 1
    fi
}

# Check Git
if ! command -v git &>/dev/null; then
    install_package "git"
fi

# Check Curl
if ! command -v curl &>/dev/null; then
    install_package "curl"
fi

# Check Docker / Install if requested or missing
if ${FORCE_INSTALL_DOCKER} || ! command -v docker &>/dev/null; then
    install_docker_engine
fi

# Ensure Docker Daemon is running
if ! docker info &>/dev/null; then
    log_warn "Docker daemon is not running. Attempting to start..."
    if command -v systemctl &>/dev/null; then
        sudo systemctl start docker
    else
        log_error "Docker daemon is not running. Please start the Docker service."
        exit 1
    fi
fi

# Check Docker Compose (plugin or standalone)
DOCKER_COMPOSE_CMD=""
if docker compose version &>/dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    log_info "Installing Docker Compose CLI plugin..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin
    else
        log_error "Docker compose plugin not found. Please install docker-compose."
        exit 1
    fi
    DOCKER_COMPOSE_CMD="docker compose"
fi

log_success "All dependencies verified: git, curl, docker, ${DOCKER_COMPOSE_CMD}"

# ------------------------------------------------------------------------------
# 3. Repository Setup / Pull
# ------------------------------------------------------------------------------
ensure_repo() {
    if [ "${TARGET_DIR}" != "." ] && [ ! -d "${TARGET_DIR}" ]; then
        log_info "Creating target directory ${TARGET_DIR}..."
        mkdir -p "${TARGET_DIR}"
    fi

    if [ "${TARGET_DIR}" != "." ]; then
        cd "${TARGET_DIR}"
    fi

    # Case A: Current directory is already a Git repository
    if [ -d ".git" ]; then
        log_info "Existing Git repository detected in $(pwd). Fetching and pulling latest changes..."
        git fetch origin
        git checkout "${BRANCH}" || git checkout -b "${BRANCH}" "origin/${BRANCH}"
        git pull origin "${BRANCH}"
        return 0
    fi

    # Case B: Current directory is completely empty
    if [ -z "$(ls -A . 2>/dev/null)" ]; then
        log_info "Empty directory detected. Cloning Preempt repository (${REPO_URL}, branch: ${BRANCH}) into $(pwd)..."
        git clone -b "${BRANCH}" "${REPO_URL}" .
        return 0
    fi

    # Case C: Current directory is not empty and not a Git repo (e.g., /root)
    log_info "Directory $(pwd) is not empty and not a Git repository. Using subfolder './preempt'..."
    if [ -d "preempt/.git" ]; then
        cd preempt
        log_info "Existing Git repository detected in $(pwd). Fetching and pulling latest changes..."
        git fetch origin
        git checkout "${BRANCH}" || git checkout -b "${BRANCH}" "origin/${BRANCH}"
        git pull origin "${BRANCH}"
    else
        if [ -d "preempt" ]; then
            log_warn "Non-git directory './preempt' exists from a previous incomplete run. Removing before cloning..."
            rm -rf preempt
        fi
        log_info "Cloning Preempt repository (${REPO_URL}, branch: ${BRANCH}) into $(pwd)/preempt..."
        git clone -b "${BRANCH}" "${REPO_URL}" preempt
        cd preempt
    fi
}

ensure_repo
log_success "Repository code is up to date in $(pwd)."

# ------------------------------------------------------------------------------
# 4. Environment Configuration
# ------------------------------------------------------------------------------
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        log_info "Creating .env configuration file from .env.example..."
        cp .env.example .env
        log_success ".env created successfully."
    else
        log_warn ".env.example not found. Creating standard default .env..."
        cat <<'EOF' > .env
PGUSER=preempt
PGPASSWORD=preemptpassword
PGDATABASE=preempt
PGHOST=localhost
PGPORT=5432
PORT=3001
OAUTH_PORT=3002
JWT_SECRET=supersecretkey
OIDC_ISSUER=http://localhost/auth/realms/preempt
OIDC_CLIENT_ID=preempt-app
OIDC_CLIENT_SECRET=secret
OIDC_REDIRECT_URI=http://localhost/api/oauth/callback
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=admin
KAFKA_BROKERS=kafka:9092
LOG_LEVEL=info
EOF
        log_success "Default .env created."
    fi
else
    log_info "Existing .env file detected. Preserving configuration."
fi

# Ensure executable permissions on helper scripts
chmod +x rebuild_frontend.sh reset_db.sh setup_vps.sh 2>/dev/null || true

# ------------------------------------------------------------------------------
# 5. Spin up Docker Stack
# ------------------------------------------------------------------------------
log_info "Building and launching Docker containers..."
${DOCKER_COMPOSE_CMD} up -d --build

log_info "Waiting for services to boot and pass basic checks..."
sleep 5

# Check status of containers
log_info "Current container status:"
${DOCKER_COMPOSE_CMD} ps

# Determine Host IP / Domain
PUBLIC_IP=$(curl -s --connect-timeout 3 https://ifconfig.me || curl -s --connect-timeout 3 https://api.ipify.org || echo "YOUR_VPS_IP")

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}                       PREEMPT VPS SETUP COMPLETE!                           ${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo -e "${BLUE}Running Services:${NC}"
echo -e "  - Traefik Edge Proxy:     http://${PUBLIC_IP}:80"
echo -e "  - Traefik Dashboard:      http://${PUBLIC_IP}:8080"
echo -e "  - Keycloak Auth Realm:    http://${PUBLIC_IP}/auth"
echo -e "  - SSR & API Server:       http://${PUBLIC_IP}:3001"
echo ""
echo -e "${YELLOW}IMPORTANT NEXT STEPS (SSR Setup Endpoints):${NC}"
echo -e "  1. Complete Initial Admin Setup & Seed Database:"
echo -e "     Navigate to ${BLUE}http://${PUBLIC_IP}/setup${NC} in your browser."
echo -e "     Log in, initialize security secrets, elevate your admin user, and load component libraries."
echo ""
echo -e "  2. Configure Production Domain & HTTPS (SSL):"
echo -e "     Navigate to ${BLUE}http://${PUBLIC_IP}/setup/traefik${NC} in your browser."
echo -e "     Set your production domain name and select Let's Encrypt or Custom SSL."
echo ""
echo -e "${GREEN}Useful Management Commands:${NC}"
echo -e "  - View Logs:              ${DOCKER_COMPOSE_CMD} logs -f"
echo -e "  - Restart Backend:        ${DOCKER_COMPOSE_CMD} restart backend"
echo -e "  - Rebuild Frontend:       ./rebuild_frontend.sh"
echo -e "  - Reset DB to Seed:       ./reset_db.sh"
echo -e "${GREEN}==============================================================================${NC}"
