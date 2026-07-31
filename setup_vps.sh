#!/usr/bin/env bash
# ==============================================================================
# Preempt - VPS Setup & Deployment Script
# ==============================================================================
# This script automates setting up Preempt on a fresh Linux VPS.
# It includes optional/automatic steps for installing Docker & Docker Compose first,
# checks/installs dependencies (Git, Curl), clones or pulls the repository,
# prompts for or configures email SMTP settings to generate keycloak-config/realm-export.json,
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
NON_INTERACTIVE=false

# SMTP Configuration Defaults
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_FROM="${SMTP_FROM:-}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"
ENABLE_VERIFY_EMAIL="${ENABLE_VERIFY_EMAIL:-false}"

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
  -y, --non-interactive Run in non-interactive mode using default/env values
  --smtp-host <host>    SMTP host for Keycloak email delivery
  --smtp-port <port>    SMTP port for Keycloak email delivery (Default: 587)
  --smtp-from <email>   SMTP sender email address
  --smtp-user <user>    SMTP authentication username
  --smtp-pass <pass>    SMTP authentication password
  --verify-email        Require mandatory email verification on user registration
  -h, --help            Show this help message

Environment Variables:
  INSTALL_DOCKER        Set to 'true' to force Docker installation first
  REPO_URL              Git repository URL
  BRANCH                Git branch name
  TARGET_DIR            Target installation directory
  SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASS, ENABLE_VERIFY_EMAIL

Examples:
  ./setup_vps.sh --install-docker
  ./setup_vps.sh --smtp-host smtp.resend.com --smtp-from noreply@mycompany.com --smtp-pass secret
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
        -y|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --smtp-host)
            SMTP_HOST="$2"
            shift 2
            ;;
        --smtp-port)
            SMTP_PORT="$2"
            shift 2
            ;;
        --smtp-from)
            SMTP_FROM="$2"
            shift 2
            ;;
        --smtp-user)
            SMTP_USER="$2"
            shift 2
            ;;
        --smtp-pass)
            SMTP_PASS="$2"
            shift 2
            ;;
        --verify-email)
            ENABLE_VERIFY_EMAIL=true
            shift
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
# 4. Environment & Keycloak Realm Configuration
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
OIDC_ISSUER=https://localhost/auth/realms/preempt
OIDC_CLIENT_ID=preempt-app
OIDC_CLIENT_SECRET=secret
OIDC_REDIRECT_URI=https://localhost/api/oauth/callback
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

# Ensure initial self-signed SSL certificate and Traefik dynamic config exist
mkdir -p certs
if [ ! -f "certs/server.crt" ] || [ ! -f "certs/server.key" ]; then
    log_info "Generating initial self-signed SSL certificate..."
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout certs/server.key \
        -out certs/server.crt \
        -subj "/CN=${PUBLIC_IP:-localhost}" \
        -days 365 2>/dev/null || true
    log_success "Generated initial self-signed SSL certificate in ./certs"
fi

if [ ! -f "traefik-dynamic.yml" ]; then
    cat <<'EOF' > traefik-dynamic.yml
tls:
  certificates:
    - certFile: /certs/server.crt
      keyFile: /certs/server.key
EOF
fi

# Generate Keycloak realm import configuration dynamically
mkdir -p keycloak-config
if [ ! -f "keycloak-config/realm-export.json" ]; then
    log_info "Configuring Keycloak Realm import configuration..."

    if [ -c /dev/tty ] && [ "${NON_INTERACTIVE}" = "false" ] && [ -z "${SMTP_HOST}" ]; then
        echo "" >/dev/tty 2>/dev/null || true
        echo -e "${YELLOW}--- Keycloak Email SMTP Configuration (Optional) ---${NC}" >/dev/tty 2>/dev/null || true
        echo -e "Press ENTER to accept defaults or enter custom SMTP credentials:" >/dev/tty 2>/dev/null || true
        
        read -r -p "SMTP Host [smtp.example.com]: " INPUT_SMTP_HOST </dev/tty || true
        SMTP_HOST="${INPUT_SMTP_HOST:-smtp.example.com}"

        read -r -p "SMTP Port [587]: " INPUT_SMTP_PORT </dev/tty || true
        SMTP_PORT="${INPUT_SMTP_PORT:-587}"

        read -r -p "SMTP From Email [noreply@example.com]: " INPUT_SMTP_FROM </dev/tty || true
        SMTP_FROM="${INPUT_SMTP_FROM:-noreply@example.com}"

        read -r -p "SMTP Username [smtp_user]: " INPUT_SMTP_USER </dev/tty || true
        SMTP_USER="${INPUT_SMTP_USER:-smtp_user}"

        read -r -s -p "SMTP Password (leave blank for placeholder): " INPUT_SMTP_PASS </dev/tty || true
        echo "" >/dev/tty 2>/dev/null || true
        SMTP_PASS="${INPUT_SMTP_PASS:-smtp_password_placeholder}"

        read -r -p "Require mandatory Email Verification on signup? [Y/n]: " INPUT_VERIFY </dev/tty || true
        if [[ "${INPUT_VERIFY}" =~ ^[Nn] ]]; then
            ENABLE_VERIFY_EMAIL="false"
        else
            ENABLE_VERIFY_EMAIL="true"
        fi
        echo "" >/dev/tty 2>/dev/null || true
    else
        SMTP_HOST="${SMTP_HOST:-smtp.example.com}"
        SMTP_PORT="${SMTP_PORT:-587}"
        SMTP_FROM="${SMTP_FROM:-noreply@example.com}"
        SMTP_USER="${SMTP_USER:-smtp_user}"
        SMTP_PASS="${SMTP_PASS:-smtp_password_placeholder}"
        ENABLE_VERIFY_EMAIL="${ENABLE_VERIFY_EMAIL:-true}"
    fi

    if [ "${SMTP_PORT}" = "465" ]; then
        SMTP_SSL="${SMTP_SSL:-true}"
        SMTP_STARTTLS="${SMTP_STARTTLS:-false}"
    else
        SMTP_SSL="${SMTP_SSL:-false}"
        SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
    fi

    log_info "Generating keycloak-config/realm-export.json..."
    cat <<EOF > keycloak-config/realm-export.json
{
  "id": "preempt",
  "realm": "preempt",
  "sslRequired": "external",
  "browserSecurityHeaders": {
    "contentSecurityPolicyReportOnly": "",
    "xContentTypeOptions": "nosniff",
    "xRobotsTag": "none",
    "xFrameOptions": "SAMEORIGIN",
    "contentSecurityPolicy": "frame-src 'self'; frame-ancestors 'self'; object-src 'none';",
    "xXSSProtection": "1; mode=block",
    "strictTransportSecurity": "max-age=0"
  },
  "enabled": true,
  "registrationAllowed": true,
  "registrationEmailAsUsername": false,
  "verifyEmail": ${ENABLE_VERIFY_EMAIL},
  "resetPasswordAllowed": true,
  "eventsEnabled": true,
  "eventsListeners": [
    "kafka",
    "jboss-logging"
  ],
  "smtpServer": {
    "host": "${SMTP_HOST}",
    "port": "${SMTP_PORT}",
    "from": "${SMTP_FROM}",
    "fromDisplayName": "Preempt App",
    "replyTo": "${SMTP_FROM}",
    "replyToDisplayName": "Preempt App",
    "envelopeFrom": "${SMTP_FROM}",
    "ssl": "${SMTP_SSL}",
    "starttls": "${SMTP_STARTTLS}",
    "auth": "true",
    "user": "${SMTP_USER}",
    "password": "${SMTP_PASS}"
  },
  "clients": [
    {
      "clientId": "preempt-app",
      "name": "Preempt Application",
      "enabled": true,
      "clientAuthenticatorType": "client-secret",
      "secret": "secret",
      "redirectUris": [
        "*"
      ],
      "webOrigins": [
        "*"
      ],
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": true,
      "serviceAccountsEnabled": false,
      "publicClient": false,
      "protocol": "openid-connect"
    }
  ],
  "users": [
    {
      "username": "testuser",
      "enabled": true,
      "email": "test@preempt.com",
      "firstName": "Test",
      "lastName": "User",
      "credentials": [
        {
          "type": "password",
          "value": "password",
          "temporary": false
        }
      ]
    }
  ]
}
EOF
    log_success "Generated keycloak-config/realm-export.json successfully."
else
    log_info "Existing keycloak-config/realm-export.json detected. Preserving configuration."
fi

# Configure Production Vite Settings to reduce bundle size
if [ -f "vite.config.ts" ]; then
    log_info "Optimizing Vite compilation settings for production (minification, chunking, no sourcemaps)..."
    cat <<'EOF' > vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Minify with esbuild for compact, production-ready bundles
    minify: 'esbuild',
    // Disable sourcemaps in production to drastically reduce package size
    sourcemap: false,
    // Enable CSS minification and code splitting
    cssMinify: true,
    cssCodeSplit: true,
    // Target modern JavaScript runtime for smaller syntax payload
    target: 'es2022',
    // Rollup chunk splitting and compaction
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        compact: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  esbuild: {
    // Strip debugging logs and debugger statements in production
    drop: ['console', 'debugger'],
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
  },
});
EOF
    log_success "Production Vite compilation settings applied."
fi

# Ensure executable permissions on helper scripts
chmod +x rebuild_frontend.sh reset_db.sh setup_vps.sh 2>/dev/null || true

# ------------------------------------------------------------------------------
# 5. Spin up Docker Stack
# ------------------------------------------------------------------------------
log_info "Building and launching Docker containers..."
${DOCKER_COMPOSE_CMD} up -d --build

log_info "Waiting for backend service to complete 'npm install' and start listening on port 3001..."
MAX_WAIT=120
WAIT_TIME=0
BACKEND_UP=false

while [ ${WAIT_TIME} -lt ${MAX_WAIT} ]; do
    HTTP_CODE=$(docker exec preempt_backend curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ 2>/dev/null || true)
    if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "302" ] || [ "${HTTP_CODE}" = "403" ] || [ "${HTTP_CODE}" = "404" ]; then
        BACKEND_UP=true
        break
    fi
    sleep 4
    WAIT_TIME=$((WAIT_TIME + 4))
    log_info "Bootstrapping dependencies & starting Express backend... (${WAIT_TIME}s / ${MAX_WAIT}s)"
done

if ${BACKEND_UP}; then
    log_success "Backend service is online and healthy!"
else
    log_warn "Backend takes longer than expected to boot. Containers are starting in the background."
    log_warn "If you temporarily see 'Bad Gateway', wait a few seconds and run 'docker compose logs -f backend'."
fi

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
echo -e "  - Traefik Edge Proxy:     https://${PUBLIC_IP} (HTTP redirects to HTTPS)"
echo -e "  - Traefik Dashboard:      http://${PUBLIC_IP}:8080"
echo -e "  - Keycloak Auth Realm:    https://${PUBLIC_IP}/auth"
echo -e "  - SSR & API Server:       https://${PUBLIC_IP}"
echo ""
echo -e "${YELLOW}IMPORTANT NEXT STEPS (SSR Setup Endpoints):${NC}"
echo -e "  1. Complete Initial Admin Setup & Seed Database:"
echo -e "     Navigate to ${BLUE}https://${PUBLIC_IP}/setup${NC} in your browser (accept self-signed SSL warning)."
echo -e "     Log in, initialize security secrets, elevate your admin user, and load component libraries."
echo ""
echo -e "  2. Configure Production Domain & HTTPS (SSL):"
echo -e "     Navigate to ${BLUE}https://${PUBLIC_IP}/setup/traefik${NC} in your browser."
echo -e "     Set your production domain name and select Let's Encrypt or Custom SSL."
echo ""
echo -e "${GREEN}Useful Management Commands (Run inside project directory: cd $(pwd)):${NC}"
echo -e "  - View Logs:              ${DOCKER_COMPOSE_CMD} logs -f"
echo -e "  - Restart Backend:        ${DOCKER_COMPOSE_CMD} restart backend"
echo -e "  - Stop Stack:             ${DOCKER_COMPOSE_CMD} down"
echo -e "  - Start Stack:            ${DOCKER_COMPOSE_CMD} up -d"
echo -e "  - Rebuild Frontend:       ./rebuild_frontend.sh"
echo -e "  - Reset DB to Seed:       ./reset_db.sh"
echo -e "${GREEN}==============================================================================${NC}"
