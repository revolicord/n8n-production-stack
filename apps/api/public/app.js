const API = ''; // same origin

// ── State ────────────────────────────────────────────────────────────────────
const STATE = {
  token: localStorage.getItem('admin_token') ?? null,
  tenantId: localStorage.getItem('tenant_id') ?? null,
  tenantSlug: localStorage.getItem('tenant_slug') ?? null,
  stages: [], // [{ id, displayName, slug, position }]
  activeStageId: null,
  activeSection: null,
  templates: [], // followup templates for active stage (camelCase from Drizzle)
  messages: {}, // { [templateId]: [messages] } — messages use snake_case (toResponse)
  resources: [],
  dirty: new Set(),
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
  const stageB = STATE.stages.find((s) => s.slug === 'B');
  if (stageB) await selectStage(stageB.id);
}

async function loadTenants() {
  const data = await api('/admin/tenants');
  if (!data) return;
  const ts = data.tenants ?? [];
  if (ts.length === 0) {
    toast('No hay tenants activos', false);
    return;
  }
  const t = ts[0];
  STATE.tenantId = t.id;
  STATE.tenantSlug = t.slug;
  localStorage.setItem('tenant_id', t.id);
  localStorage.setItem('tenant_slug', t.slug);

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
    const stageB = STATE.stages.find((s) => s.slug === 'B');
    if (stageB) await selectStage(stageB.id);
  });
  if (ts.length === 1) sel.parentElement.classList.add('hidden');
}

async function loadStages() {
  const data = await api(`/admin/tenants/${STATE.tenantId}/funnel-stages`);
  // Drizzle returns camelCase: displayName, slug, position, isActive
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
  // Drizzle returns camelCase: sequenceNumber, delayMinutes, textTemplate, flowNs, isActive
  STATE.templates = (data?.followups ?? []).filter((t) => t.isActive !== false);

  STATE.messages = {};
  await Promise.all(
    STATE.templates
      .filter((t) => t.type === 'content')
      .map(async (t) => {
        const msgs = await api(`/admin/followup-templates/${t.id}/messages`);
        // messages use snake_case via toResponse: message_type, text_content, media_url, sort_order
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
  const stageB = STATE.stages.find((s) => s.slug === 'B');
  const stageC = STATE.stages.find((s) => s.slug === 'C');

  const btnClass =
    'sidebar-item w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors';
  const divider = '<div class="border-t border-gray-800 mx-3 my-1"></div>';

  const stageBBtn = stageB
    ? `<button data-stage="${stageB.id}" class="${btnClass}" onclick="selectStage('${stageB.id}')">Fase B</button>`
    : '';
  const stageCBtn = stageC
    ? `<button data-stage="${stageC.id}" class="${btnClass}" onclick="selectStage('${stageC.id}')">Fase C</button>`
    : '';

  sidebar.innerHTML = `
    <button data-section="general" class="${btnClass}" onclick="selectSection('general')">General</button>
    ${divider}
    ${stageBBtn}
    ${stageCBtn}
    ${divider}
    <button data-section="cierre" class="${btnClass}" onclick="selectSection('cierre')">Cierres</button>
    <button data-section="objecion" class="${btnClass}" onclick="selectSection('objecion')">Objeciones</button>
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

  const title =
    stage.slug === 'B'
      ? 'Fase B'
      : stage.slug === 'C'
        ? 'Fase C'
        : `Etapa ${escHtml(stage.displayName)}`;
  const visible = STATE.templates.filter((t) => t.sequenceNumber >= 1 && t.sequenceNumber <= 8);
  const cards = visible.map((t) => templateCard(t, stage)).join('');
  main.innerHTML = `
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-white">${title} — Follow-ups</h2>
        <button onclick="saveAllFollowups()" class="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-sm rounded transition-colors">
          Guardar cambios
        </button>
      </div>
      ${cards.length ? cards : '<p class="text-gray-500 text-sm">No hay follow-ups en esta etapa.</p>'}
    </div>
  `;
}

// ── Template card (unified layout for all types) ──────────────────────────────
function templateCard(t, stage) {
  const delayId = `delay-${t.id}`;
  // Header: e.g. "1B · meme_plus_text" using sequenceNumber + stage.slug + description
  const stageTag = stage ? stage.slug.toUpperCase() : '';
  const label = t.description ?? t.type;

  let bodyHtml;
  if (t.type === 'flow') {
    bodyHtml = `<p class="text-xs text-gray-500">Flow: <code>${escHtml(t.flowNs ?? '')}</code></p>`;
  } else if (t.type === 'content') {
    bodyHtml = contentCardBody(t);
  } else {
    // text type — show textarea + asset upload section
    bodyHtml = textCardBody(t);
  }

  return `
    <div id="card-${t.id}" class="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-gray-400 font-mono">${t.sequenceNumber}${stageTag} · <span id="label-${t.id}" data-label="${escHtml(label)}" class="cursor-pointer hover:text-gray-100 hover:underline transition-colors" title="Click para editar" onclick="startEditLabel('${t.id}')">${escHtml(label)}</span></span>
        <div class="flex items-center gap-2">
          <label class="text-xs text-gray-400">Delay (min):</label>
          <input id="${delayId}" type="number" min="1" value="${t.delayMinutes}"
            class="w-20 bg-[#111] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
            onchange="markDirty('${t.id}')">
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function textCardBody(t) {
  return `
    <textarea id="text-${t.id}" rows="3"
      class="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none mb-3"
      onchange="markDirty('${t.id}')">${escHtml(t.textTemplate ?? '')}</textarea>
    <div class="mt-1">
      <p class="text-xs text-gray-500 mb-1">Imagen (opcional — convierte a mensaje multimedia)</p>
      <div class="flex items-center gap-2">
        <input type="file" accept="image/*"
          class="text-xs text-gray-400 file:mr-2 file:text-xs file:bg-teal-700 file:text-white file:border-0 file:rounded file:px-2 file:py-1"
          onchange="uploadAndConvertToContent(event, '${t.id}')">
      </div>
    </div>
  `;
}

function contentCardBody(t) {
  const msgs = STATE.messages[t.id] ?? [];
  const imgMsg = msgs.find((m) => m.message_type === 'image');
  const txtMsg = msgs.find((m) => m.message_type === 'text');

  const thumb = imgMsg?.media_url
    ? `<img src="${escHtml(imgMsg.media_url)}" class="mt-2 max-h-24 w-auto rounded" alt="preview">`
    : '';
  const imgLabel = imgMsg?.media_url ? 'Meme configurado ✓' : 'Sin imagen';
  const imgStatus = imgMsg?.media_url
    ? `<span class="text-xs text-teal-400">imagen cargada ✓</span>`
    : '';
  const clearBtn = imgMsg?.media_url
    ? `<button onclick="clearContentImage('${t.id}', '${imgMsg.id}')"
        class="text-xs text-red-400 hover:text-red-300 transition-colors">Quitar</button>`
    : '';

  return `
    <textarea id="text-${t.id}" rows="3"
      class="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none mb-3"
      onchange="saveContentText('${t.id}', '${txtMsg?.id ?? ''}', this.value)"
    >${escHtml(txtMsg?.text_content ?? '')}</textarea>
    <div class="mt-1">
      <p class="text-xs text-gray-500 mb-1">${imgLabel}</p>
      ${thumb}
      <div class="flex items-center gap-2 mt-2">
        <input type="file" accept="image/*"
          class="text-xs text-gray-400 file:mr-2 file:text-xs file:bg-teal-700 file:text-white file:border-0 file:rounded file:px-2 file:py-1"
          onchange="uploadContentImage(event, '${t.id}', '${imgMsg?.id ?? ''}')">
        ${imgStatus}
        ${clearBtn}
      </div>
      ${
        imgMsg
          ? `<div class="mt-2">
        <label class="text-xs text-gray-500 block mb-1">Descripción de la imagen para la IA (no se envía al lead)</label>
        <textarea rows="2"
          class="w-full bg-[#111] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:border-teal-500 focus:outline-none"
          placeholder="Ej: Meme de esqueleto esperando en una silla"
          onchange="saveImageContext('${t.id}', '${imgMsg.id}', this.value)"
        >${escHtml(imgMsg.ai_image_context ?? '')}</textarea>
      </div>`
          : ''
      }
    </div>
    ${msgs.length > 2 ? `<details class="mt-3"><summary class="text-xs text-gray-500 cursor-pointer">Ver todos los mensajes (${msgs.length})</summary>${messagesSection(t)}</details>` : ''}
  `;
}

function messagesSection(t) {
  const msgs = STATE.messages[t.id] ?? [];
  const msgCards = msgs.map((m) => messageCard(t.id, m)).join('');
  return `
    <div id="msgs-${t.id}" class="mt-2">
      ${msgCards}
    </div>
    <button onclick="addMessage('${t.id}', '${t.tenantId}')"
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
  const imgStatus =
    m.media_url && isImage ? `<span class="text-xs text-teal-400">imagen cargada ✓</span>` : '';
  const clearBtn =
    m.media_url && isImage
      ? `<button onclick="clearMessageImage('${templateId}', '${m.id}')"
        class="text-xs text-red-400 hover:text-red-300 transition-colors">Quitar</button>`
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
              ${imgStatus}
              ${clearBtn}
            </div>
            <div class="mt-2">
              <label class="text-xs text-gray-500 block mb-1">Descripción para la IA (no se envía al lead)</label>
              <textarea rows="2"
                class="w-full bg-[#111] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:border-teal-500 focus:outline-none"
                placeholder="Ej: Meme de esqueleto esperando en una silla"
                onchange="saveImageContext('${templateId}', '${m.id}', this.value)"
              >${escHtml(m.ai_image_context ?? '')}</textarea>
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
  const imgStatus = r.media_url
    ? `<span class="text-xs text-teal-400">imagen cargada ✓</span>`
    : '';
  const clearBtn = r.media_url
    ? `<button onclick="clearResourceImage('${r.id}')"
        class="text-xs text-red-400 hover:text-red-300 transition-colors">Quitar</button>`
    : '';
  return `
    <div id="res-${r.id}" class="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 mb-4">
      <div class="flex items-center justify-between mb-2">
        <span id="res-name-${r.id}" data-name="${escHtml(r.display_name)}" class="text-sm font-medium text-gray-200 cursor-pointer hover:text-white hover:underline transition-colors" title="Click para editar" onclick="startEditResourceName('${r.id}')">${escHtml(r.display_name)}</span>
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
        ${imgStatus}
        ${clearBtn}
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
    // t.delayMinutes and t.textTemplate are camelCase (Drizzle)
    const delay = Number(document.getElementById(`delay-${t.id}`)?.value ?? t.delayMinutes);
    const patch = { delay_minutes: delay }; // API expects snake_case in request body
    if (t.type === 'text') {
      patch.text_template = document.getElementById(`text-${t.id}`)?.value ?? t.textTemplate;
    }
    try {
      await api(`/admin/followup-templates/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      STATE.dirty.delete(t.id);
      saved++;
    } catch (e) {
      toast(`Error guardando #${t.sequenceNumber}: ${e.message}`, false);
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

// ── Inline name editing ───────────────────────────────────────────────────────
function startEditLabel(templateId) {
  const span = document.getElementById(`label-${templateId}`);
  if (!span) return;
  const currentValue = span.dataset.label ?? span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.className =
    'bg-[#111] border border-teal-500 rounded px-1 py-0 text-xs text-gray-200 focus:outline-none w-40';
  input.onblur = () => commitEditLabel(templateId, currentValue, input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = currentValue;
      input.blur();
    }
  };
  span.replaceWith(input);
  input.focus();
  input.select();
}

async function commitEditLabel(templateId, original, newValue) {
  const trimmed = newValue.trim();
  const t = STATE.templates.find((x) => x.id === templateId);
  const fallback = t?.description ?? t?.type ?? original;
  const displayed = trimmed || fallback;
  const span = document.createElement('span');
  span.id = `label-${templateId}`;
  span.dataset.label = displayed;
  span.className = 'cursor-pointer hover:text-gray-100 hover:underline transition-colors';
  span.title = 'Click para editar';
  span.textContent = displayed;
  span.onclick = () => startEditLabel(templateId);
  const container = document.getElementById(`card-${templateId}`);
  const input = container?.querySelector('input[type=text]');
  if (input) input.replaceWith(span);
  if (!trimmed || trimmed === original) return;
  try {
    await api(`/admin/followup-templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify({ description: trimmed }),
    });
    if (t) t.description = trimmed;
    toast('Nombre actualizado');
  } catch (e) {
    span.textContent = original;
    span.dataset.label = original;
    toast(`Error: ${e.message}`, false);
  }
}

function startEditResourceName(resourceId) {
  const span = document.getElementById(`res-name-${resourceId}`);
  if (!span) return;
  const currentValue = span.dataset.name ?? span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.className =
    'bg-[#111] border border-teal-500 rounded px-1 py-0 text-sm text-gray-200 focus:outline-none w-40';
  input.onblur = () => commitEditResourceName(resourceId, currentValue, input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = currentValue;
      input.blur();
    }
  };
  span.replaceWith(input);
  input.focus();
  input.select();
}

async function commitEditResourceName(resourceId, original, newValue) {
  const trimmed = newValue.trim();
  const r = STATE.resources.find((x) => x.id === resourceId);
  const displayed = trimmed || original;
  const span = document.createElement('span');
  span.id = `res-name-${resourceId}`;
  span.dataset.name = displayed;
  span.className =
    'text-sm font-medium text-gray-200 cursor-pointer hover:text-white hover:underline transition-colors';
  span.title = 'Click para editar';
  span.textContent = displayed;
  span.onclick = () => startEditResourceName(resourceId);
  const container = document.getElementById(`res-${resourceId}`);
  const input = container?.querySelector('input[type=text]');
  if (input) input.replaceWith(span);
  if (!trimmed || trimmed === original) return;
  try {
    await api(`/admin/agent-resources/${resourceId}`, {
      method: 'PUT',
      body: JSON.stringify({ display_name: trimmed }),
    });
    if (r) r.display_name = trimmed;
    toast('Nombre actualizado');
  } catch (e) {
    span.textContent = original;
    span.dataset.name = original;
    toast(`Error: ${e.message}`, false);
  }
}

// ── Content card actions ──────────────────────────────────────────────────────
async function saveContentText(templateId, messageId, text) {
  if (!messageId) {
    // No text message yet — create one
    try {
      const msg = await api(`/admin/followup-templates/${templateId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message_type: 'text', text_content: text || ' ', sort_order: 1 }),
      });
      if (msg) STATE.messages[templateId] = [...(STATE.messages[templateId] ?? []), msg];
    } catch (e) {
      toast(`Error guardando texto: ${e.message}`, false);
    }
    return;
  }
  try {
    await api(`/admin/followup-messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ text_content: text }),
    });
  } catch (e) {
    toast(`Error guardando texto: ${e.message}`, false);
  }
}

async function uploadContentImage(event, templateId, existingImageMessageId) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadAsset(file);
  if (!url) return;

  try {
    if (existingImageMessageId) {
      // Update existing image message
      await api(`/admin/followup-messages/${existingImageMessageId}`, {
        method: 'PUT',
        body: JSON.stringify({ media_url: url }),
      });
    } else {
      // Create new image message
      await api(`/admin/followup-templates/${templateId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message_type: 'image', media_url: url, sort_order: 0 }),
      });
    }
    toast('Imagen actualizada');
    await selectStage(STATE.activeStageId);
  } catch (e) {
    toast(`Error actualizando imagen: ${e.message}`, false);
  }
}

// Converts a text-type template to content when an image is uploaded
async function uploadAndConvertToContent(event, templateId) {
  const file = event.target.files[0];
  if (!file) return;

  const t = STATE.templates.find((tmpl) => tmpl.id === templateId);
  if (!t) return;

  const url = await uploadAsset(file);
  if (!url) return;

  try {
    // 1. Convert template type to 'content'
    await api(`/admin/followup-templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'content', text_template: null }),
    });

    // 2. Create image message (sort_order 0 = first)
    await api(`/admin/followup-templates/${templateId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message_type: 'image', media_url: url, sort_order: 0 }),
    });

    // 3. Create text message from current textarea value
    const textValue =
      document.getElementById(`text-${templateId}`)?.value?.trim() || t.textTemplate || ' ';
    await api(`/admin/followup-templates/${templateId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message_type: 'text', text_content: textValue, sort_order: 1 }),
    });

    toast('Convertido a mensaje multimedia');
    await selectStage(STATE.activeStageId);
  } catch (e) {
    toast(`Error convirtiendo template: ${e.message}`, false);
  }
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

async function saveImageContext(_templateId, messageId, context) {
  try {
    await api(`/admin/followup-messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ ai_image_context: context || null }),
    });
  } catch (e) {
    toast(`Error guardando descripción: ${e.message}`, false);
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

// ── Clear image functions ────────────────────────────────────────────────────
async function clearContentImage(_templateId, msgId) {
  if (!confirm('¿Quitar la imagen?')) return;
  try {
    await api(`/admin/followup-messages/${msgId}`, { method: 'DELETE' });
    toast('Imagen eliminada');
    await selectStage(STATE.activeStageId);
  } catch (e) {
    toast(`Error eliminando imagen: ${e.message}`, false);
  }
}

async function clearMessageImage(templateId, msgId) {
  if (!confirm('¿Quitar la imagen?')) return;
  try {
    await api(`/admin/followup-messages/${msgId}`, { method: 'DELETE' });
    STATE.messages[templateId] = (STATE.messages[templateId] ?? []).filter((m) => m.id !== msgId);
    toast('Imagen eliminada');
    renderMain();
  } catch (e) {
    toast(`Error eliminando imagen: ${e.message}`, false);
  }
}

async function clearResourceImage(resourceId) {
  if (!confirm('¿Quitar la imagen?')) return;
  try {
    await api(`/admin/agent-resources/${resourceId}`, {
      method: 'PUT',
      body: JSON.stringify({ media_url: null }),
    });
    toast('Imagen eliminada');
    await selectSection(STATE.activeSection);
  } catch (e) {
    toast(`Error eliminando imagen: ${e.message}`, false);
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
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('login-password').value;
    await login(pw);
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

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
window.saveContentText = saveContentText;
window.uploadContentImage = uploadContentImage;
window.uploadAndConvertToContent = uploadAndConvertToContent;
window.saveMessageText = saveMessageText;
window.saveImageContext = saveImageContext;
window.uploadMessageImage = uploadMessageImage;
window.deleteMessage = deleteMessage;
window.addMessage = addMessage;
window.addResource = addResource;
window.deactivateResource = deactivateResource;
window.uploadResourceImage = uploadResourceImage;
window.clearContentImage = clearContentImage;
window.clearMessageImage = clearMessageImage;
window.clearResourceImage = clearResourceImage;
