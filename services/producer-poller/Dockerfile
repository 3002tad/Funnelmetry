# Dockerfile for Producer Poller
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY producer.py .

# Environment variables (can be overridden in docker-compose)
ENV API_DRAIN_URL=http://api-generator:7070/gen/drain
ENV KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENV KAFKA_TOPIC=events_raw
ENV POLL_BATCH_LIMIT=100
ENV POLL_INTERVAL_MS=20

# Run producer
CMD ["python", "-u", "producer.py"]
