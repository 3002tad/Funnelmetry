# Dockerfile for Spark Streaming
FROM python:3.11-slim

WORKDIR /app

# Install Java (required for Spark)
RUN apt-get update && \
    apt-get install -y openjdk-21-jre-headless wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set Java environment
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY spark_stream.py .

# Environment variables
ENV SPARK_MASTER=local[*]
ENV KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENV POSTGRES_HOST=postgres
ENV POSTGRES_PORT=5432
ENV POSTGRES_DB=realtime
ENV POSTGRES_USER=app
ENV POSTGRES_PASSWORD=app

# Run Spark Streaming
CMD ["python", "-u", "spark_stream.py"]
