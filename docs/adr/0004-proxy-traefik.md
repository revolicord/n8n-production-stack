# ADR-0004: Routing con Traefik de Dokploy

**Status:** Accepted  
**Date:** 2026-05-01

---

## Y-Statement

> _In the context of_ having Traefik already configured via Dokploy on the server with Let's Encrypt,  
> _facing_ the need to route webhook traffic to `n8n-webhook` and UI traffic to `n8n-main` on the same domain,  
> _we decided_ to use **Traefik labels en Swarm mode** con prioridades para separar el tráfico sin un nginx adicional,  
> _to achieve_ TLS automático, routing por path prefix, y zero-downtime deploys sin infraestructura adicional,  
> _accepting_ que el routing depende de que Traefik esté corriendo (debe iniciarse desde el panel de Dokploy).

---

## Configuración Traefik verificada en el servidor

```yaml
# /etc/dokploy/traefik/traefik.yml
providers:
  swarm:
    exposedByDefault: false
    network: dokploy-network     # ← red a usar
entryPoints:
  web:      # puerto 80
  websecure: # puerto 443
certificatesResolvers:
  letsencrypt:                   # ← nombre del resolver
    acme:
      httpChallenge:
        entryPoint: web
```

## Reglas de routing

```
paneln8n.revolicord.com
├── /webhook/*      → n8n-webhook:5678  (prioridad 10)
└── /*              → n8n-main:5678     (prioridad 1)

minio.revolicord.com           → minio:9000
minio-console.revolicord.com   → minio:9001
```

## Labels en el stack (patrón)

```yaml
deploy:
  labels:
    # Necesario para que Traefik descubra el servicio
    - "traefik.enable=true"
    - "traefik.docker.network=dokploy-network"

    # Router con nombre único por servicio
    - "traefik.http.routers.<nombre>.rule=Host(`dominio`) && PathPrefix(`/webhook/`)"
    - "traefik.http.routers.<nombre>.priority=10"
    - "traefik.http.routers.<nombre>.entrypoints=websecure"
    - "traefik.http.routers.<nombre>.tls.certresolver=letsencrypt"
    - "traefik.http.routers.<nombre>.service=<nombre>-svc"

    # Service (define el puerto del backend)
    - "traefik.http.services.<nombre>-svc.loadbalancer.server.port=5678"
```

## Prerequisito: Iniciar Traefik

Traefik está configurado pero debe iniciarse. Desde el panel de Dokploy (puerto 3000):
1. Settings → Traefik → Enable
2. O manualmente: ver `scripts/deploy.sh` que verifica si Traefik está corriendo.

## DNS requerido (todos apuntan a la misma IP del servidor)

| Dominio | Servicio |
|---|---|
| `paneln8n.revolicord.com` | n8n UI + webhooks |
| `minio.revolicord.com` | MinIO S3 API |
| `minio-console.revolicord.com` | MinIO Console |
