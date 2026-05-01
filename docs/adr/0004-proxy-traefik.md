# ADR-0004: Routing con Traefik (standalone)

**Status:** Accepted  
**Date:** 2026-05-01

---

## Y-Statement

> _In the context of_ needing HTTPS termination and routing of webhook vs UI traffic on the same domain,  
> _facing_ the need for automatic Let's Encrypt certificates and path-based routing without extra infrastructure,  
> _we decided_ to run **Traefik v2.11 as a Docker Swarm service** in the same cluster, using `providers.docker.swarmMode: true` to autodiscover services via labels,  
> _to achieve_ zero-config TLS, priority-based routing, and zero-downtime deploys,  
> _accepting_ that if Traefik is down no traffic reaches n8n (single point of ingress).

## Por qué v2.11 y no v3.x

Traefik v3.x introdujo `providers.swarm` (reemplazando `providers.docker.swarmMode`). Sin embargo, el Swarm provider de v3.x usa Docker API v1.24 de forma hardcodeada. Docker Engine 29+ requiere **mínimo API v1.40**. El resultado es que Traefik v3.x no puede leer los servicios Swarm en este servidor.

Traefik v2.11 usa `providers.docker.swarmMode: true` y negocia la versión de API correctamente con Docker Engine 29.

---

## Configuración de Traefik (generada por setup.sh en /etc/traefik/traefik.yml)

```yaml
global:
  sendAnonymousUsage: false

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    network: traefik-public    # ← CRÍTICO: red overlay compartida con los servicios
    exposedByDefault: false
    swarmMode: true            # ← lee SERVICE labels (deploy.labels), no container labels
    watch: true
  file:
    directory: /etc/traefik/dynamic
    watch: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: <ACME_EMAIL>
      storage: /acme.json
      httpChallenge:
        entryPoint: web
```

### Por qué `network: traefik-public` es crítico

Cuando un servicio tiene múltiples redes (ej. `n8n_internal` + `traefik-public`), Traefik no sabe a cuál conectarse. Sin `network: traefik-public`, intenta la red equivocada y no puede alcanzar el container → 502/504.

La label `traefik.docker.network=traefik-public` en cada servicio refuerza esto por servicio, pero la config a nivel de provider es la fuente principal.

---

## Reglas de routing

```
<N8N_HOST>
├── /webhook/*      → n8n-webhook:5678  (priority=10)
└── /*              → n8n-main:5678     (priority=1)

<MINIO_DOMAIN>           → minio:9000
<MINIO_CONSOLE_DOMAIN>   → minio:9001
```

## Labels en docker-stack.yml (patrón obligatorio en Swarm)

En Swarm, los labels de Traefik **deben ir bajo `deploy.labels`**, no bajo `labels`. De lo contrario Traefik no los lee.

```yaml
deploy:
  labels:
    - "traefik.enable=true"
    - "traefik.docker.network=traefik-public"
    - "traefik.http.routers.<nombre>.rule=Host(`<dominio>`)"
    - "traefik.http.routers.<nombre>.entrypoints=websecure"
    - "traefik.http.routers.<nombre>.tls.certresolver=letsencrypt"
    - "traefik.http.routers.<nombre>.service=<nombre>-svc"
    - "traefik.http.services.<nombre>-svc.loadbalancer.server.port=<puerto>"
```

## Ciclo de vida del servicio Traefik

```bash
# Ver estado
docker service ls | grep traefik
docker service logs -f traefik

# Si los servicios no aparecen en Traefik (forzar redescubrimiento)
docker service update --force traefik

# Ver certificados generados
docker service exec $(docker ps -q -f name=traefik) cat /acme.json | python3 -m json.tool
```

## DNS requerido

Todos los dominios deben apuntar a la IP del servidor **antes** de arrancar Traefik. Let's Encrypt valida por HTTP en el puerto 80.

| Variable | Ejemplo |
|---|---|
| `N8N_HOST` | `n8n.tudominio.com` |
| `MINIO_DOMAIN` | `minio.tudominio.com` |
| `MINIO_CONSOLE_DOMAIN` | `minio-console.tudominio.com` |
