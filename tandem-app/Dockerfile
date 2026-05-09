FROM node:18-slim

# Install Python 3 and pip (slim image has neither)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Python dependencies (slim set — no opencv/mediapipe, not needed server-side)
COPY requirements-prod.txt ./
RUN pip3 install --no-cache-dir -r requirements-prod.txt

# Copy application source
COPY server.js ./
COPY server/ ./server/
COPY public/ ./public/

# Copy model directory — model.p is excluded from .dockerignore for build,
# but mount it at runtime via: -v /path/to/model.p:/app/asl/model.p
# Or download it in CI via scripts/download_model.sh before building.
COPY asl/labels_dict.py ./asl/

EXPOSE 3000

COPY scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x ./scripts/entrypoint.sh

ENTRYPOINT ["./scripts/entrypoint.sh"]
