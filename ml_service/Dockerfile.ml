FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for AutoGluon
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    fastapi[standard] \
    uvicorn \
    autogluon.tabular \
    pandas \
    python-multipart \
    scikit-learn \
    numpy \
    lightgbm \
    xgboost
    
COPY ml_service.py .

EXPOSE 8000
CMD ["uvicorn", "ml_service:app", "--host", "0.0.0.0", "--port", "8000"]