# Dockerfile for Producer Poller
FROM python:3.11-slim

WORKDIR /app

# Install system deps for snappy compression
RUN apt-get update && apt-get install -y --no-install-recommends libsnappy-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY producer.py .

# Environment variables (can be overridden in docker-compose)
ENV API_URL=http://api-generator:7070/gen/event
ENV KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENV KAFKA_TOPIC=events_raw
ENV POLL_INTERVAL_MS=500

# Run producer
CMD ["python", "-u", "producer.py"]
