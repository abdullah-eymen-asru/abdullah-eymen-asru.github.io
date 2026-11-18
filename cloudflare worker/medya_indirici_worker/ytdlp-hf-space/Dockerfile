# Hugging Face Space (SDK: Docker) — medya çözümleyici (yt-dlp+ffmpeg) + belge dönüştürücü (LibreOffice, açık kaynak).
#  — bulutta derlenir; kendi bilgisayarına Docker kurmana GEREK YOK.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libreoffice-impress fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu fonts-noto-core && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 kullanici
USER kullanici
WORKDIR /home/kullanici/uygulama
COPY --chown=kullanici requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=kullanici app.py .
ENV PORT=7860
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
