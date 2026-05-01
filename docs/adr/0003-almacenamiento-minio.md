# ADR-0003: Almacenamiento binario con MinIO (S3-compatible)

**Status:** Accepted  
**Date:** 2026-05-01

---

## Y-Statement

> _In the context of_ n8n processing Instagram media (images, audio) from ManyChat webhooks,  
> _facing_ the need to store binary data outside of container ephemeral storage and make files publicly accessible via signed URLs,  
> _we decided_ to use **MinIO** as S3-compatible object storage with public endpoint on `minio.revolicord.com`,  
> _to achieve_ durable binary storage accessible to all n8n processes (main, webhook, 3 workers) and to external services like ManyChat,  
> _accepting_ that all n8n→MinIO traffic goes through Traefik (hairpin) because n8n uses one single host for both writes and public URL generation.

---

## Contexto

n8n en modo queue corre múltiples procesos (main, webhook, workers). Los archivos binarios deben ser accesibles desde todos ellos. Sin almacenamiento externo, cada proceso tendría su propio sistema de archivos local y los workers no podrían leer archivos recibidos por el webhook processor.

ManyChat necesita poder hacer GET a las imágenes procesadas → las URLs firmadas deben ser públicas.

## Variables de entorno correctas (verificadas en el código fuente de n8n)

```bash
# El ejemplo de referencia tenía 5 variables incorrectas. Las correctas son:
N8N_DEFAULT_BINARY_DATA_MODE=s3            # ← era N8N_BINARY_DATA_MODE (no existe)
N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME=n8n-data    # ← era S3_BUCKET (no existe)
N8N_EXTERNAL_STORAGE_S3_BUCKET_REGION=us-east-1 # ← era S3_REGION (no existe)
N8N_EXTERNAL_STORAGE_S3_ACCESS_SECRET=xxx       # ← era S3_SECRET_KEY (no existe)
N8N_EXTERNAL_STORAGE_S3_HOST=minio.revolicord.com # ← era S3_ENDPOINT (no existe)
N8N_EXTERNAL_STORAGE_S3_PROTOCOL=https          # nuevo — separado del host
N8N_EXTERNAL_STORAGE_S3_FORCE_PATH_STYLE=true   # ✅ correcto
N8N_EXTERNAL_STORAGE_S3_ACCESS_KEY=xxx          # ✅ correcto
```

## Flujo de datos binarios (imagen de Instagram)

```
ManyChat → /webhook/ → n8n-webhook
               ↓
           Descarga imagen
               ↓
    MinIO (via minio.revolicord.com)    ← escribe binario
               ↓
       n8n-worker ejecuta workflow
               ↓
    Genera URL firmada pública
    https://minio.revolicord.com/n8n-data/<uuid>
               ↓
    Responde a ManyChat con la URL
```

## Endpoints MinIO

| Propósito | Endpoint público | Puerto interno |
|---|---|---|
| S3 API (n8n + ManyChat) | `https://minio.revolicord.com` | `minio:9000` |
| Consola web (admin) | `https://minio-console.revolicord.com` | `minio:9001` |

## Inicialización del bucket

El bucket `n8n-data` no se crea automáticamente. Se usa un servicio `minio-init` (one-shot) que ejecuta `mc mb --ignore-existing` y luego termina. En Swarm, `restart_policy: condition: none` asegura que no se reinicie tras salir con código 0.

## DNS adicional requerido

- `minio.revolicord.com` → IP del servidor
- `minio-console.revolicord.com` → IP del servidor
