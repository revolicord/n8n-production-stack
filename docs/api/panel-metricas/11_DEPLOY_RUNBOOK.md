# 11 — Deploy runbook

> Cómo llevar el panel de "funciona en mi máquina" a `https://dashboard.revolicord.com`. Sigue el patrón del stack existente: Docker Swarm + Traefik + Let's Encrypt.

## Pre-requisitos del entorno

- El stack `n8n-production-stack` ya está desplegado en el servidor de producción.
- Traefik con `certresolver=letsencrypt` está activo y resuelve `api.revolicord.com`, `paneln8n.revolicord.com`, etc.
- El servidor tiene Docker Swarm inicializado.
- Existe un registry accesible (GHCR o equivalente). Si el stack usa GHCR vía `ghcr.io/revolicord/<image>`, este paquete sigue el mismo patrón.

## Paso 1 — DNS

Antes de cualquier despliegue, crear el registro DNS:

```
Type:   A
Name:   dashboard.revolicord.com
Value:  <IP pública del servidor Swarm>
TTL:    300
```

Verificar la propagación con:

```bash
dig +short dashboard.revolicord.com
```

Debe devolver la IP del servidor. Sin DNS, Traefik no podrá emitir el certificado.

## Paso 2 — Dockerfile

Crear `apps/dashboard/Dockerfile`. Multi-stage para minimizar tamaño y respetar el output `standalone` de Next.js 15.

```dockerfile
# syntax=docker/dockerfile:1.7

# Stage 1: deps
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copiar solo lo necesario para resolver workspaces e instalar
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY apps/dashboard/package.json ./apps/dashboard/

RUN corepack enable && corepack prepare pnpm@9 --activate
RUN pnpm install --frozen-lockfile --filter @revolicord/dashboard...

# Stage 2: builder
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules

# Copiar el source completo
COPY . .

# Build de Next.js con output standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @revolicord/dashboard build

# Stage 3: runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario no-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiar el output standalone
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

USER nextjs

EXPOSE 3000

# Next standalone genera server.js dentro de la app
CMD ["node", "apps/dashboard/server.js"]
```

### Notas críticas del Dockerfile

1. **`output: 'standalone'`** debe estar habilitado en `next.config.mjs` (doc 06). Si no lo está, este Dockerfile falla porque `.next/standalone` no existe.
2. **`transpilePackages: ['@revolicord/db']`** debe estar en `next.config.mjs`. Sin esto, los imports de TypeScript desde `packages/db/src/` no se compilan en el bundle estándar de Next.
3. El standalone genera `server.js` en `<output>/apps/dashboard/server.js`. La ruta del CMD asume esta convención del monorepo.
4. **No usamos `npm run start`** porque el standalone se ejecuta directo con `node`.

## Paso 3 — Build y push de la imagen

Desde la raíz del repo:

```bash
# Variables
export VERSION=$(git rev-parse --short HEAD)
export IMAGE=ghcr.io/revolicord/dashboard

# Login al registry (una vez por máquina)
echo $GITHUB_TOKEN | docker login ghcr.io -u <user> --password-stdin

# Build
docker build -f apps/dashboard/Dockerfile -t $IMAGE:$VERSION -t $IMAGE:latest .

# Push
docker push $IMAGE:$VERSION
docker push $IMAGE:latest
```

> Si el stack ya tiene un `Makefile` con target `build-dashboard` y `push-dashboard`, usar esos en su lugar para mantener consistencia. Probablemente algo como:
>
> ```makefile
> build-dashboard:
> 	docker build -f apps/dashboard/Dockerfile -t $(IMAGE):$(VERSION) .
> push-dashboard: build-dashboard
> 	docker push $(IMAGE):$(VERSION)
> ```

## Paso 4 — Variables de entorno en producción

Editar el `.env` del servidor (típicamente `/opt/n8n-stack/.env` o similar). Añadir:

```
# === Dashboard analítico ===
PANEL_PASSWORD=<elegir password robusta ≥ 12 chars>
PANEL_JWT_SECRET=<openssl rand -hex 32>
```

**NO** sobrescribir `ADMIN_PASSWORD` ni `ADMIN_JWT_SECRET` — esas son del SPA admin y son distintas.

Verificar que el `.env` ya contiene `DATABASE_URL` (debe estar desde la API Fastify). Si no, **no proceder**: el panel necesita exactamente la misma URL.

## Paso 5 — Entrada en `docker-stack.yml`

Añadir el servicio al archivo del stack existente. NO crear un compose nuevo aparte. Ejemplo de bloque a insertar:

```yaml
services:
  # ... servicios existentes (api, n8n, postgres, redis, minio, etc.) ...

  dashboard:
    image: ghcr.io/revolicord/dashboard:latest
    networks:
      - traefik-public
      - internal
    environment:
      DATABASE_URL: ${DATABASE_URL}
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      PANEL_JWT_SECRET: ${PANEL_JWT_SECRET}
      NODE_ENV: production
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 5
      update_config:
        parallelism: 1
        order: start-first
        failure_action: rollback
        delay: 10s
      labels:
        - "traefik.enable=true"
        # Router HTTPS
        - "traefik.http.routers.dashboard.rule=Host(`dashboard.revolicord.com`)"
        - "traefik.http.routers.dashboard.entrypoints=websecure"
        - "traefik.http.routers.dashboard.tls=true"
        - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
        # Service
        - "traefik.http.services.dashboard.loadbalancer.server.port=3000"
        # Redirect HTTP → HTTPS (si Traefik no lo hace globalmente)
        - "traefik.http.routers.dashboard-http.rule=Host(`dashboard.revolicord.com`)"
        - "traefik.http.routers.dashboard-http.entrypoints=web"
        - "traefik.http.routers.dashboard-http.middlewares=https-redirect"
        - "traefik.http.middlewares.https-redirect.redirectscheme.scheme=https"
        - "traefik.http.middlewares.https-redirect.redirectscheme.permanent=true"

networks:
  traefik-public:
    external: true
  internal:
    external: true
```

**Verificar el nombre exacto de las networks** en el `docker-stack.yml` existente. Si la red de Traefik se llama distinto (e.g. `proxy`, `web`, `traefik_public`), usar ese nombre. **El `internal` solo es necesario si Postgres está en una red interna** — si está expuesto solo internamente al stack, el dashboard debe estar en esa red para alcanzarlo.

> **Importante:** si `DATABASE_URL` apunta a `postgres://postgres:5432/...` (sin host externo), el contenedor del dashboard debe estar en la misma red que el servicio `postgres`. Verificar el bloque del servicio Postgres existente para conocer el nombre exacto del servicio y la red.

## Paso 6 — Deploy

Desde el servidor:

```bash
cd /opt/n8n-stack  # o el path donde vive docker-stack.yml

# Si hay Makefile:
make deploy

# Si no, manual:
docker stack deploy -c docker-stack.yml --with-registry-auth n8n-stack
```

Verificar que el servicio arranca:

```bash
docker service ls | grep dashboard
docker service logs -f n8n-stack_dashboard
```

Buscar en los logs:

- `▲ Next.js 15.x.x`
- `- Local:        http://0.0.0.0:3000`
- `✓ Ready in <ms>`

Si en lugar de eso aparece un error como `ECONNREFUSED postgres:5432` → revisar networks. Si aparece `PANEL_JWT_SECRET is not defined` → la variable no se está pasando bien al contenedor.

## Paso 7 — Verificación del certificado TLS

Tras 30–60 segundos, Traefik debería emitir el certificado:

```bash
curl -I https://dashboard.revolicord.com
```

Esperado: `HTTP/2 307` (redirect a `/login`) o `HTTP/2 200` si va a la home. NUNCA `HTTP/2 404` (significa que Traefik no enruta) ni cert error.

Si el certificado no se emite:

- Revisar logs de Traefik: `docker service logs n8n-stack_traefik | grep dashboard`.
- Confirmar DNS otra vez.
- Confirmar que el puerto 80 está abierto (Let's Encrypt HTTP-01 challenge).

## Paso 8 — Smoke test post-deploy

```bash
# 1. Health implícito
curl -sI https://dashboard.revolicord.com | head -5
# Debe devolver 307 o 200

# 2. Login (POST)
curl -i -X POST https://dashboard.revolicord.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<password real>"}'
# Debe devolver 200 con Set-Cookie: panel_session=...

# 3. Login fallido
curl -i -X POST https://dashboard.revolicord.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"wrong"}'
# Debe devolver 401

# 4. Logout
curl -i -X POST https://dashboard.revolicord.com/api/auth/logout
# Debe devolver 200 con Set-Cookie: panel_session= (vacío, max-age=0)
```

Ver doc 12 para checklist e2e manual completo en navegador.

## Paso 9 — Rollback

Si el deploy rompe algo (UI no carga, queries explotan, panel devuelve 500):

```bash
# Rollback al deploy anterior
docker service rollback n8n-stack_dashboard

# O fijar manualmente una imagen anterior conocida:
docker service update --image ghcr.io/revolicord/dashboard:<versión-anterior> n8n-stack_dashboard
```

El SPA admin y la API Fastify **NO se ven afectados** por rollbacks del dashboard porque son servicios independientes.

## Paso 10 — Actualizaciones futuras (CI/CD)

Si el repo tiene GitHub Actions con un workflow tipo `deploy.yml`:

1. Añadir un job `build-and-push-dashboard` que builda y pushea la imagen `ghcr.io/revolicord/dashboard:${{ github.sha }}` y `:latest`.
2. Disparar `docker service update --image ghcr.io/revolicord/dashboard:${{ github.sha }} n8n-stack_dashboard` vía SSH al servidor.

Patrón sugerido (no implementarlo si no existe ya para los otros servicios — mantener coherencia):

```yaml
# .github/workflows/deploy-dashboard.yml
name: Deploy dashboard
on:
  push:
    branches: [main]
    paths:
      - 'apps/dashboard/**'
      - 'packages/db/**'
      - 'pnpm-lock.yaml'
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/dashboard/Dockerfile
          push: true
          tags: |
            ghcr.io/revolicord/dashboard:${{ github.sha }}
            ghcr.io/revolicord/dashboard:latest
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd /opt/n8n-stack
            docker service update --image ghcr.io/revolicord/dashboard:${{ github.sha }} n8n-stack_dashboard
```

> **No** crear este workflow en Sprint 0 si no hay equivalente para los otros servicios. Coherencia primero. Documentar como pendiente en doc 13.

## Troubleshooting frecuente

| Síntoma | Causa probable | Solución |
|---|---|---|
| `dashboard.revolicord.com` devuelve 404 desde Traefik | Labels mal escritos o stack no actualizado | Revisar `docker service inspect n8n-stack_dashboard --pretty` |
| Cert error en navegador | LE no pudo verificar el dominio | DNS no propagado o puerto 80 cerrado |
| `/login` carga, password correcta devuelve 401 | `PANEL_PASSWORD` distinto al `.env` o longitud <8 | Revisar el `.env` del servidor |
| Login OK pero `/year/2026` da 500 | `DATABASE_URL` no accesible desde el contenedor del dashboard | Networks; ver Paso 5 nota importante |
| `/year/2026` carga pero todos los datos son 0 | Filtro `tenant_id` con UUID incorrecto | Verificar `getActiveTenant()` devuelve QC, no otro tenant |
| Layout sin estilos (texto plano) | Tailwind no compilado | Build no incluyó `.next/static` — revisar Dockerfile stage runner |
| Bundle muy grande | `transpilePackages` falta | Confirmar en `next.config.mjs` |
| Logs spammean errores de Drizzle | Driver `postgres-js` vs `pg` mismatch | Alinear con `packages/db/src/client.ts` |

## Checklist post-deploy

- [ ] DNS resuelve a la IP correcta.
- [ ] HTTPS funciona, certificado válido.
- [ ] `/login` carga visualmente correcto.
- [ ] Password correcta entra al panel.
- [ ] El nombre del tenant aparece en sidebar.
- [ ] Vista anual carga con datos reales.
- [ ] No hay errores en logs durante 5 minutos de uso normal.
- [ ] Logout funciona.

Fin del documento 11.
