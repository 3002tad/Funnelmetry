FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV RABBITMQ_URL=amqp://app:app@rabbitmq:5672
ENV RABBITMQ_EXCHANGE=commerce_events
ENV RABBITMQ_QUEUE=commerce_connector_queue
ENV TRACKING_API_URL=http://tracking-api:3000

CMD ["python", "-u", "main.py"]
