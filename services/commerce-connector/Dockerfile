FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY lib ./lib

ENV RABBITMQ_URL=amqp://app:app@rabbitmq:5672
ENV RABBITMQ_EXCHANGE=ecommerce.events
ENV RABBITMQ_EXCHANGE_TYPE=topic
ENV RABBITMQ_TRACKING_QUEUE=tracking.business-events
ENV TRACKING_API_URL=http://tracking-api:3000

CMD ["python", "-u", "main.py"]
