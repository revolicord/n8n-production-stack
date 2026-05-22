const API = ''; // same origin

// ── State ────────────────────────────────────────────────────────────────────
const STATE = {
  token: localStorage.getItem('admin_token') ?? null,
  tenantId: localStorage.getItem('tenant_id') ?? null,
  tenantSlug: localStorage.getItem('tenant_slug') ?? null,
  stages: [], // [{ id, name, position }]
  activeStageId: null, // currently selected stage in sidebar
  activeSection: null, // 'cierre' | 'objecion'
  templates: [], // followup templates for active stage
  messages: {}, // { [templateId]: [messages] }
  resources: [], // agent resources for active section
  dirty: new Set(), // set of element IDs with unsaved changes
};

// ── Utils ────────────────────────────────────────────────────────────────────
function jwtExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Date.now() / 1000 > payload.exp;
  } catch {
    return true;
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      ...(opts.body && !(opts.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      Authorization: `Bearer ${STATE.token}`,
    },
  });
  if (res.status === 401) {
    logout();
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = `toast fixed bottom-4 right-4 z-50 px-4 py-2 rounded shadow-lg text-sm font-medium ${ok ? 'bg-teal-600 text-white' : 'bg-red-700 text-white'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function logout() {
  STATE.token = null;
  localStorage.removeItem('admin_token');
  showLoginOverlay();
}

function showLoginOverlay() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function hideLoginOverlay() {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

async function login(password) {
  const res = await fetch(`${API}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    toast('Contraseña incorrecta', false);
    return;
  }
  const { token } = await res.json();
  STATE.token = token;
  localStorage.setItem('admin_token', token);
  hideLoginOverlay();
  await boot();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  await loadTenants();
  await loadStages();
  renderSidebar();
  if (STATE.stages.length > 0) {
    await selectStage(STATE.stages[0].id);
  }
}

async function loadTenants() {
  const data = await api('/admin/tenants');
  if (!data) return;
  const ts = data.tenants ?? [];
  if (ts.length === 0) {
    toast('No hay tenants activos', false);
    return;
  }
  // Use first active tenant
  const t = ts[0];
  STATE.tenantId = t.id;
  STATE.tenantSlug = t.slug;
  localStorage.setItem('tenant_id', t.id);
  localStorage.setItem('tenant_slug', t.slug);

  // Populate tenant select if more than one
  const sel = document.getElementById('tenant-select');
  sel.innerHTML = ts
    .map((x) => `<option value="${x.id}" data-slug="${x.slug}">${x.name}</option>`)
    .join('');
  sel.value = STATE.tenantId;
  sel.addEventListener('change', async () => {
    const opt = sel.options[sel.selectedIndex];
    STATE.tenantId = sel.value;
    STATE.tenantSlug = opt.dataset.slug;
    localStorage.setItem('tenant_id', STATE.tenantId);
    localStorage.setItem('tenant_slug', STATE.tenantSlug);
    STATE.dirty.clear();
    await loadStages();
    renderSidebar();
    if (STATE.stages.length > 0) await selectStage(STATE.stages[0].id);
  });
  if (ts.length === 1) sel.parentElement.classList.add('hidden');
}

async function loadStages() {
  const data = await api(`/admin/tenants/${STATE.tenantId}/funnel-stages`);
  STATE.stages = data?.stages ?? [];
  STATE.activeStageId = null;
  STATE.templates = [];
  STATE.messages = {};
}

async function selectStage(stageId) {
  STATE.activeStageId = stageId;
  STATE.activeSection = null;
  for (const el of document.querySelectorAll('.sidebar-item')) el.classList.remove('active');
  document.querySelector(`[data-stage="${stageId}"]`)?.classList.add('active');

  const data = await api(`/admin/funnel-stages/${stageId}/followups`);
  STATE.templates = (data?.followups ?? []).filter((t) => t.is_active !== false);

  // Load messages for 'content' type templates
  STATE.messages = {};
  await Promise.all(
    STATE.templates
      .filter((t) => t.type === 'content')
      .map(async (t) => {
        const msgs = await api(`/admin/followup-templates/${t.id}/messages`);
        STATE.messages[t.id] = msgs ?? [];
      }),
  );

  renderMain();
}

async function selectSection(section) {
  STATE.activeSection = section;
  STATE.activeStageId = null;
  for (const el of document.querySelectorAll('.sidebar-item')) el.classList.remove('active');
  document.querySelector(`[data-section="${section}"]`)?.classList.add('active');

  const data = await api(`/admin/tenants/${STATE.tenantId}/agent-resources?category=${section}`);
  STATE.resources = data?.resources ?? [];
  renderMain();
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const sidebar = document.getElementById('sidebar-nav');
  const stageItems = STATE.stages
    .map(
      (s) => `
    <button data-stage="${s.id}"
      class="sidebar-item w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
      onclick="selectStage('${s.id}')">
      Etapa ${s.name}
    </button>
  `,
    )
    .join('');

  sidebar.innerHTML = `
    <div class="text-xs uppercase tracking-widest text-gray-500 px-4 pt-4 pb-1">Cadencia</div>
    ${stageItems}
    <div class="text-xs uppercase tracking-widest text-gray-500 px-4 pt-4 pb-1">Recursos Agente</div>
    <button data-section="cierre"
      class="sidebar-item w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
      onclick="selectSection('cierre')">
      Cierres
    </button>
    <button data-section="objecion"
      class="sidebar-item w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
      onclick="selectSection('objecion')">
      Objeciones
    </button>
    <button data-section="general"
      class="sidebar-item w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
      onclick="selectSection('general')">
      General
    </button>
  `;
}

// ── Main panel ───────────────────────────────────────────────────────────────
function renderMain() {
  const main = document.getElementById('main-panel');

  if (STATE.activeStageId) {
    renderStagePanel(main);
  } else if (STATE.activeSection) {
    renderResourcesPanel(main);
  } else {
    main.innerHTML = '<p class="text-gray-500 text-sm p-8">Selecciona una etapa o sección.</p>';
  }
}

function renderStagePanel(main) {
  const stage = STATE.stages.find((s) => s.id === STATE.activeStageId);
  if (!stage) {
    main.innerHTML = '';
    return;
  }

  const cards = STATE.templates.map((t) => templateCard(t)).join('');
  main.innerHTML = `
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-white">Etapa ${stage.name} — Follow-ups</h2>
        <button onclick="saveAllFollowups()" class="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-sm rounded transition-colors">
          Guardar cambios
        </button>
      </div>
      ${cards.length ? cards : '<p class="text-gray-500 text-sm">No hay follow-ups en esta etapa.</p>'}
    </div>
  `;
}

function templateCard(t) {
  const delayId = `delay-${t.id}`;
  const msgSection =
    t.type === 'content'
      ? messagesSection(t)
      : t.type === 'text'
        ? `<textarea id="text-${t.id}" rows="3"
            class="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
            onchange="markDirty('${t.id}')">${escHtml(t.text_template ?? '')}</textarea>`
        : `<p class="text-xs text-gray-500">Flow: <code>${escHtml(t.flow_ns ?? '')}</code></p>`;

  return `
    <div id="card-${t.id}" class="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-gray-400 font-mono">Seq #${t.sequence_number} · tipo: ${t.type}</span>
        <div class="flex items-center gap-2">
          <label class="text-xs text-gray-400">Delay (min):</label>
          <input id="${delayId}" type="number" min="1" value="${t.delay_minutes}"
            class="w-20 bg-[#111] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
            onchange="markDirty('${t.id}')">
        </div>
      </div>
      ${msgSection}
    </div>
  `;
}

function messagesSection(t) {
  const msgs = STATE.messages[t.id] ?? [];
  const msgCards = msgs.map((m) => messageCard(t.id, m)).join('');
  return `
    <div id="msgs-${t.id}">
      ${msgCards}
    </div>
    <button onclick="addMessage('${t.id}', '${t.tenant_id}')"
      class="mt-2 text-xs text-teal-400 hover:text-teal-300 transition-colors">
      + Añadir mensaje
    </button>
  `;
}

function messageCard(templateId, m) {
  const isImage = m.message_type === 'image';
  const thumb = m.media_url
    ? `<img src="${escHtml(m.media_url)}" class="thumb mt-2 max-h-24 w-auto" alt="preview">`
    : '';
  return `
    <div id="msg-${m.id}" class="border border-gray-700 rounded p-3 mb-2 relative">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-500">Tipo: ${m.message_type} · orden: ${m.sort_order}</span>
        <button onclick="deleteMessage('${templateId}', '${m.id}')"
          class="text-xs text-red-400 hover:text-red-300 transition-colors">Eliminar</button>
      </div>
      ${
        isImage
          ? `<div>
            ${thumb}
            <div class="flex items-center gap-2 mt-2">
              <input type="file" accept="image/*" class="text-xs text-gray-400 file:mr-2 file:text-xs file:bg-teal-700 file:text-white file:border-0 file:rounded file:px-2 file:py-1"
                onchange="uploadMessageImage(event, '${templateId}', '${m.id}')">
            </div>
          </div>`
          : `<textarea rows="2"
              class="w-full bg-[#111] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
              onchange="saveMessageText('${templateId}', '${m.id}', this.value)"
            >${escHtml(m.text_content ?? '')}</textarea>`
      }
    </div>
  `;
}

function renderResourcesPanel(main) {
  const section = STATE.activeSection;
  const label =
    section === 'cierre' ? 'Cierres' : section === 'objecion' ? 'Objeciones' : 'General';
  const cards = STATE.resources.map((r) => resourceCard(r)).join('');

  main.innerHTML = `
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-white">${label}</h2>
        <button onclick="saveAllResources()" class="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-sm rounded transition-colors">
          Guardar cambios
        </button>
      </div>
      ${cards.length ? cards : '<p class="text-gray-500 text-sm">No hay recursos en esta categoría.</p>'}
      <button onclick="addResource('${section}')"
        class="mt-4 text-sm text-teal-400 hover:text-teal-300 transition-colors">
        + Añadir recurso
      </button>
    </div>
  `;
}

function resourceCard(r) {
  const thumb = r.media_url
    ? `<img src="${escHtml(r.media_url)}" class="thumb mt-2 max-h-24 w-auto" alt="preview">`
    : '';
  return `
    <div id="res-${r.id}" class="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-200">${escHtml(r.display_name)}</span>
        <button onclick="deactivateResource('${r.id}')"
          class="text-xs text-red-400 hover:text-red-300 transition-colors">Eliminar</button>
      </div>
      <input type="text" placeholder="Hint para el agente (opcional)" value="${escHtml(r.trigger_hint ?? '')}"
        class="w-full mb-2 bg-[#111] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
        id="hint-${r.id}" onchange="markDirty('res-${r.id}')">
      <textarea rows="2" placeholder="Texto del recurso (opcional)"
        class="w-full bg-[#111] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-teal-500 focus:outline-none mb-2"
        id="text-res-${r.id}" onchange="markDirty('res-${r.id}')">${escHtml(r.text_content ?? '')}</textarea>
      ${thumb}
      <div class="flex items-center gap-2 mt-2">
        <input type="file" accept="image/*" class="text-xs text-gray-400 file:mr-2 file:text-xs file:bg-teal-700 file:text-white file:border-0 file:rounded file:px-2 file:py-1"
          onchange="uploadResourceImage(event, '${r.id}')">
      </div>
    </div>
  `;
}

// ── Save actions ─────────────────────────────────────────────────────────────
function markDirty(id) {
  STATE.dirty.add(id);
}

async function saveAllFollowups() {
  let saved = 0;
  for (const t of STATE.templates) {
    if (!STATE.dirty.has(t.id)) continue;
    const delay = Number(document.getElementById(`delay-${t.id}`)?.value ?? t.delay_minutes);
    const patch = { delay_minutes: delay };
    if (t.type === 'text') {
      patch.text_template = document.getElementById(`text-${t.id}`)?.value ?? t.text_template;
    }
    try {
      await api(`/admin/followup-templates/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      STATE.dirty.delete(t.id);
      saved++;
    } catch (e) {
      toast(`Error guardando #${t.sequence_number}: ${e.message}`, false);
    }
  }
  if (saved > 0) toast(`${saved} follow-up(s) guardados`);
  else toast('Sin cambios pendientes');
}

async function saveAllResources() {
  let saved = 0;
  for (const r of STATE.resources) {
    if (!STATE.dirty.has(`res-${r.id}`)) continue;
    const patch = {
      trigger_hint: document.getElementById(`hint-${r.id}`)?.value ?? r.trigger_hint,
      text_content: document.getElementById(`text-res-${r.id}`)?.value ?? r.text_content,
    };
    try {
      await api(`/admin/agent-resources/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      STATE.dirty.delete(`res-${r.id}`);
      saved++;
    } catch (e) {
      toast(`Error guardando recurso: ${e.message}`, false);
    }
  }
  if (saved > 0) toast(`${saved} recurso(s) guardados`);
  else toast('Sin cambios pendientes');
}

// ── Message actions ──────────────────────────────────────────────────────────
async function saveMessageText(_templateId, messageId, text) {
  try {
    await api(`/admin/followup-messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ text_content: text }),
    });
  } catch (e) {
    toast(`Error guardando mensaje: ${e.message}`, false);
  }
}

async function uploadMessageImage(event, _templateId, messageId) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadAsset(file);
  if (!url) return;
  try {
    await api(`/admin/followup-messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ media_url: url }),
    });
    toast('Imagen actualizada');
    await selectStage(STATE.activeStageId);
  } catch (e) {
    toast(`Error actualizando imagen: ${e.message}`, false);
  }
}

async function deleteMessage(templateId, messageId) {
  if (!confirm('¿Eliminar este mensaje?')) return;
  try {
    await api(`/admin/followup-messages/${messageId}`, { method: 'DELETE' });
    STATE.messages[templateId] = (STATE.messages[templateId] ?? []).filter(
      (m) => m.id !== messageId,
    );
    renderMain();
  } catch (e) {
    toast(`Error eliminando: ${e.message}`, false);
  }
}

async function addMessage(templateId, _tenantId) {
  const type = prompt('Tipo de mensaje: text o image', 'text');
  if (!type || !['text', 'image'].includes(type)) return;
  const body = { message_type: type, sort_order: STATE.messages[templateId]?.length ?? 0 };
  if (type === 'text') body.text_content = ' ';
  if (type === 'image') body.media_url = prompt('URL de imagen:', 'https://') ?? '';
  try {
    const msg = await api(`/admin/followup-templates/${templateId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (msg) {
      STATE.messages[templateId] = [...(STATE.messages[templateId] ?? []), msg];
      renderMain();
    }
  } catch (e) {
    toast(`Error creando mensaje: ${e.message}`, false);
  }
}

// ── Resource actions ─────────────────────────────────────────────────────────
async function addResource(category) {
  const displayName = prompt('Nombre del recurso:');
  if (!displayName?.trim()) return;
  const slug = displayName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  try {
    const r = await api(`/admin/tenants/${STATE.tenantId}/agent-resources`, {
      method: 'POST',
      body: JSON.stringify({ category, slug, display_name: displayName, text_content: ' ' }),
    });
    if (r) {
      STATE.resources.push(r);
      renderMain();
    }
  } catch (e) {
    toast(`Error creando recurso: ${e.message}`, false);
  }
}

async function deactivateResource(id) {
  if (!confirm('¿Eliminar este recurso?')) return;
  try {
    await api(`/admin/agent-resources/${id}`, { method: 'DELETE' });
    STATE.resources = STATE.resources.filter((r) => r.id !== id);
    renderMain();
  } catch (e) {
    toast(`Error eliminando: ${e.message}`, false);
  }
}

async function uploadResourceImage(event, resourceId) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadAsset(file);
  if (!url) return;
  try {
    await api(`/admin/agent-resources/${resourceId}`, {
      method: 'PUT',
      body: JSON.stringify({ media_url: url }),
    });
    toast('Imagen actualizada');
    await selectSection(STATE.activeSection);
  } catch (e) {
    toast(`Error actualizando imagen: ${e.message}`, false);
  }
}

// ── Asset upload ─────────────────────────────────────────────────────────────
async function uploadAsset(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/admin/assets/upload?tenant_id=${STATE.tenantId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STATE.token}` },
    body: form,
  });
  if (!res.ok) {
    toast('Error subiendo imagen', false);
    return null;
  }
  const { url } = await res.json();
  return url;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('login-password').value;
    await login(pw);
  });

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Check token
  if (!STATE.token || jwtExpired(STATE.token)) {
    showLoginOverlay();
  } else {
    hideLoginOverlay();
    await boot();
  }
});

// Expose to inline onclick handlers
window.selectStage = selectStage;
window.selectSection = selectSection;
window.markDirty = markDirty;
window.saveAllFollowups = saveAllFollowups;
window.saveAllResources = saveAllResources;
window.saveMessageText = saveMessageText;
window.uploadMessageImage = uploadMessageImage;
window.deleteMessage = deleteMessage;
window.addMessage = addMessage;
window.addResource = addResource;
window.deactivateResource = deactivateResource;
window.uploadResourceImage = uploadResourceImage;
