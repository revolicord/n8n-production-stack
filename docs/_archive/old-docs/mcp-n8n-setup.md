# Configurar MCP de n8n en Claude Code

## Prerrequisitos

En n8n: Settings → MCP Server → Enable. Copiar la URL del servidor y generar una credencial JWT.

## Pasos

### 1. Obtén la URL y el token desde n8n

En n8n verás algo así:

```
URL:   https://paneln8n.revolicord.com/mcp-server/http
Token: eyJhbGci...
```

### 2. Registra el MCP con el CLI de Claude

Ejecuta este comando en el servidor (sustituye URL y TOKEN):

```bash
claude mcp add n8n-mcp \
  --transport http \
  "URL_DEL_SERVIDOR" \
  --header "Authorization: Bearer TOKEN_JWT"
```

Ejemplo real:

```bash
claude mcp add n8n-mcp \
  --transport http \
  "https://paneln8n.revolicord.com/mcp-server/http" \
  --header "Authorization: Bearer eyJhbGci..."
```

El CLI confirma: `Added HTTP MCP server n8n-mcp ... to local config`  
Y escribe en: `/root/.claude.json`

### 3. Verifica que quedó conectado

```bash
claude mcp list
```

Debes ver:

```
n8n-mcp: https://paneln8n.revolicord.com/mcp-server/http (HTTP) - ✓ Connected
```

## Notas importantes

- **No edites `~/.claude/mcp.json` a mano** — Claude Code no lo lee en este entorno. Usa siempre `claude mcp add`.
- **No commitees `/root/.claude.json` a git** — contiene el JWT que es una credencial.
- La config persiste entre reinicios de Claude Code. No necesitas repetir estos pasos salvo que regeneres el token en n8n.
- Si el token expira o lo regeneras en n8n, elimina el servidor y agrégalo de nuevo:

```bash
claude mcp remove n8n-mcp
claude mcp add n8n-mcp --transport http "URL" --header "Authorization: Bearer NUEVO_TOKEN"
```
