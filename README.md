# n8n Production Stack — Revolicord

Stack de n8n en producción con Docker Swarm, MinIO, Redis y PostgreSQL.  
Dominio: `paneln8n.revolicord.com` | Webhooks ManyChat/Instagram.

## Arquitectura

```
Internet
   │
   ▼
Traefik (Dokploy) — TLS automático Let's Encrypt
   │
   ├── paneln8n.revolicord.com/webhook/*  → n8n-webhook (prioridad alta)
   ├── paneln8n.revolicord.com/*          → n8n-main    (UI + API)
   ├── minio.revolicord.com               → MinIO S3 API
   └── minio-console.revolicord.com       → MinIO Console
            │
       [Redis Queue]
       /     |     \
  [worker] [worker] [worker]   ← 3 réplicas, escalables
       \     |     /
    [PostgreSQL] [MinIO]
```

## Prerequisitos

- [ ] Docker Swarm activo (`docker info | grep Swarm`)
- [ ] Traefik iniciado desde el panel de Dokploy (puerto 3000 → Settings → Traefik → Enable)
- [ ] DNS creados y propagados:
  - `paneln8n.revolicord.com` → IP del servidor
  - `minio.revolicord.com` → IP del servidor
  - `minio-console.revolicord.com` → IP del servidor
- [ ] Puertos 80 y 443 abiertos en el firewall

## Instalación desde cero

```bash
# 1. Clonar el repositorio
git clone <repo-url> /opt/n8n-production
cd /opt/n8n-production

# 2. Crear el archivo de configuración
cp .env.example .env

# 3. Generar claves seguras y rellenar .env
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "REDIS_PASSWORD=$(openssl rand -base64 24)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -base64 24)"
# Pegar los valores generados en .env

nano .env  # o el editor de tu preferencia

# 4. Dar permisos a los scripts
chmod +x scripts/*.sh

# 5. Desplegar
make deploy

# 6. Verificar que todos los servicios están corriendo
make status
```

## Operaciones habituales

```bash
make status          # Estado de todos los servicios
make logs-webhook    # Logs del receptor de webhooks
make logs-worker     # Logs de los workers
make scale-workers N=5  # Escalar a 5 workers
make backup          # Backup manual de Postgres + MinIO
make update          # Actualizar n8n a latest
make down            # Parar el stack (datos seguros en volúmenes)
```

## Configurar backup automático (cron diario a las 2am)

```bash
crontab -e
# Añadir la siguiente línea:
0 2 * * * /opt/n8n-production/scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

## Configurar ManyChat

1. Entrar a `https://paneln8n.revolicord.com` y crear cuenta
2. Crear un workflow nuevo con trigger **Webhook**
3. Activar el workflow
4. Copiar la URL de producción (ej. `https://paneln8n.revolicord.com/webhook/manychat-instagram`)
5. En ManyChat → Integrations → Webhook → pegar la URL

Para verificar que el webhook funciona:
```bash
curl -X POST https://paneln8n.revolicord.com/webhook/TU_PATH \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Variables de entorno (.env)

| Variable | Descripción |
|---|---|
| `N8N_HOST` | Dominio de n8n (paneln8n.revolicord.com) |
| `N8N_ENCRYPTION_KEY` | Clave de cifrado de credenciales — NO cambiar después del primer deploy |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL |
| `REDIS_PASSWORD` | Contraseña de Redis |
| `MINIO_ROOT_USER` | Usuario admin de MinIO |
| `MINIO_ROOT_PASSWORD` | Contraseña admin de MinIO |
| `MINIO_DOMAIN` | Dominio público S3 (minio.revolicord.com) |
| `MINIO_CONSOLE_DOMAIN` | Dominio consola MinIO (minio-console.revolicord.com) |
| `TRAEFIK_NETWORK` | Red Docker de Traefik (dokploy-network) |

## ADRs (Decisiones arquitecturales)

- [ADR-0001](docs/adr/0001-arquitectura-general.md) — Arquitectura general y topología
- [ADR-0002](docs/adr/0002-swarm-replicas.md) — Docker Swarm para réplicas
- [ADR-0003](docs/adr/0003-almacenamiento-minio.md) — Almacenamiento binario con MinIO
- [ADR-0004](docs/adr/0004-proxy-traefik.md) — Routing con Traefik de Dokploy
- [ADR-0005](docs/adr/0005-webhooks-manychat.md) — Integración ManyChat/Instagram

## Observabilidad (futura — no en este deploy)

n8n expone métricas en `/metrics` compatibles con Prometheus.  
Para activar: añadir `N8N_METRICS=true` al stack cuando sea necesario.
