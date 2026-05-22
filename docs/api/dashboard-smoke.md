# Dashboard Smoke Checklist

Smoke e2e checklist for the Quantum Setting Dashboard (`/dashboard`).

Run after every deploy. All steps must pass before marking a release as good.

---

## Pre-conditions

- [ ] API is running and `/healthz` returns 200
- [ ] `ADMIN_PASSWORD` and `ADMIN_JWT_SECRET` are set in the environment
- [ ] MinIO bucket `assets` exists with anonymous download enabled
- [ ] At least one active tenant exists in `api.tenants`
- [ ] Funnel stages seeded for that tenant (`api.funnel_stages`)

---

## Smoke steps

### 1. Dashboard redirect

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard
# → 302
```

### 2. Dashboard loads HTML

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard/
# → 200
curl -s http://localhost:3000/dashboard/ | grep -q "Quantum Dashboard"
# → (no output = pass)
```

### 3. Login with wrong password → 401

```bash
curl -s -w "\n%{http_code}" -X POST http://localhost:3000/admin/login \
  -H "Content-Type: application/json" -d '{"password":"wrong"}' | tail -1
# → 401
```

### 4. Login with correct password → JWT

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/admin/login \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .token)
echo $TOKEN | cut -c1-10
# → eyJ... (JWT prefix)
```

### 5. List tenants via JWT

```bash
curl -s http://localhost:3000/admin/tenants \
  -H "Authorization: Bearer $TOKEN" | jq '.tenants[0].slug'
# → "quantum-creators" (or your tenant slug)
```

### 6. List funnel stages via JWT

```bash
TENANT_ID=$(curl -s http://localhost:3000/admin/tenants \
  -H "Authorization: Bearer $TOKEN" | jq -r '.tenants[0].id')
curl -s "http://localhost:3000/admin/tenants/$TENANT_ID/funnel-stages" \
  -H "Authorization: Bearer $TOKEN" | jq '.stages | length'
# → 5 (or number of active stages)
```

### 7. n8n static bearer still works

```bash
curl -s "http://localhost:3000/admin/tenants/$TENANT_ID/funnel-stages" \
  -H "Authorization: Bearer $N8N_CALLBACK_TOKEN" | jq '.stages | length'
# → same number as above (backwards compat)
```

### 8. Browser login flow

- Open `http://localhost:3000/dashboard/` in a browser
- Login overlay appears → enter `ADMIN_PASSWORD` → click Entrar
- Sidebar shows funnel stages + Cierres / Objeciones / General sections
- Select a stage → follow-up cards appear with delay inputs

### 9. Edit delay and save

- Change delay value in any follow-up card
- Click "Guardar cambios"
- Toast "X follow-up(s) guardados" appears
- Reload page → same value persists

### 10. Upload image

- Navigate to Cierres section
- If resources exist: click file input → choose a JPG/PNG ≤ 8 MB
- Toast "Imagen actualizada" appears
- Thumbnail renders below the upload input
- Open URL in incógnito tab → image loads without auth

### 11. Soft delete resource

- In Cierres section, click "Eliminar" on a resource → confirm
- Resource disappears from the list
- Check DB: `SELECT is_active FROM api.agent_resources WHERE id='...'` → `false`

---

## After smoke

If all 11 steps pass → release is good. Tag with `git tag dashboard-smoke-<date>`.

If any step fails → do NOT push to production. Fix and re-run from step 1.
