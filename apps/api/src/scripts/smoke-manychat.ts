#!/usr/bin/env tsx
/**
 * SMOKE TEST MANUAL — ManyChat + Escalado a Humano
 * ═══════════════════════════════════════════════════════════════════
 *
 * Propósito: verificar de extremo a extremo que los mensajes llegan
 * a Instagram sin pasar por el agente ni por n8n. Ideal para saber
 * si un fallo es de código, de credenciales o de la API de ManyChat.
 *
 * Uso:
 *   pnpm --filter @dm-api/api smoke:manychat
 *
 * Variables requeridas (en .env o exportadas):
 *   DATABASE_URL         — PostgreSQL de producción
 *   SMOKE_TENANT_SLUG    — slug del tenant a probar (ej: "quantum-creators")
 *   SMOKE_SUBSCRIBER_ID  — ID numérico del subscriber en ManyChat (tu cuenta de prueba)
 *
 * Variables opcionales:
 *   SMOKE_API_KEY        — override de api_key (si no está en tenant.config)
 *   SMOKE_STAGE          — filtrar solo flows de esta etapa (ej: "prospecto")
 *   SMOKE_SKIP_FLOWS     — "true" para saltar la prueba de flows
 *   SMOKE_SKIP_FOLLOWUPS — "true" para saltar la prueba de follow-ups
 *   TELEGRAM_BOT_TOKEN   — si está, prueba envío de notificación a Telegram
 *   TELEGRAM_CHAT_ID     — chat donde enviar la notificación de prueba
 *
 * Cómo encontrar tu SMOKE_SUBSCRIBER_ID:
 *   En ManyChat > Audience > busca tu usuario de IG > copia el Subscriber ID
 * ═══════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import readline from 'node:readline';

// Cargar .env manualmente (sin dependencia de dotenv)
try {
  const envFile = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env no existe o no es legible — continuar con variables de entorno del sistema
}
import { createDb } from '@dm-api/db';
import { followupTemplates, funnelStages, stageFlows, tenants } from '@dm-api/db';
import { and, eq, isNotNull } from 'drizzle-orm';

// ── Config ─────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? '';
const SUBSCRIBER_ID = process.env.SMOKE_SUBSCRIBER_ID ?? '';
const OVERRIDE_API_KEY = process.env.SMOKE_API_KEY ?? '';
const FILTER_STAGE = process.env.SMOKE_STAGE ?? '';
const SKIP_FLOWS = process.env.SMOKE_SKIP_FLOWS === 'true';
const SKIP_FOLLOWUPS = process.env.SMOKE_SKIP_FOLLOWUPS === 'true';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_DEFAULT_CHAT_ID ?? '';

// ── Tipos ──────────────────────────────────────────────────────────

interface ApiResult {
  success: boolean;
  statusCode: number;
  attempts: number;
  errorBody?: string;
}

type UserConfirm = 'yes' | 'no' | 'skip';

interface TestResult {
  name: string;
  category: string;
  apiSuccess: boolean;
  apiStatusCode: number;
  apiAttempts: number;
  apiError?: string;
  userConfirm: UserConfirm;
}

// ── Readline ───────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    rl.once('line', (line) => resolve(line.trim().toLowerCase()));
  });
}

async function confirmReceipt(apiSuccess: boolean): Promise<UserConfirm> {
  if (!apiSuccess) return 'skip';
  const ans = await ask('  ¿Lo recibiste en Instagram? [s=sí / n=no / Enter=skip]: ');
  if (ans === 's' || ans === 'si' || ans === 'sí' || ans === 'y' || ans === 'yes') return 'yes';
  if (ans === 'n' || ans === 'no') return 'no';
  return 'skip';
}

// ── ManyChat HTTP ──────────────────────────────────────────────────

const MC_BASE = 'https://api.manychat.com';
const RETRY_DELAYS = [500, 1500];

async function mcPost(path: string, body: unknown, apiKey: string): Promise<ApiResult> {
  let attempts = 0;
  let lastErr: { statusCode: number; body: string } | null = null;

  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    attempts++;
    const res = await fetch(`${MC_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) return { success: true, statusCode: res.status, attempts };

    const text = await res.text().catch(() => '');
    lastErr = { statusCode: res.status, body: text };

    const retriable = [429, 500, 502, 503, 504].includes(res.status);
    const delay = RETRY_DELAYS[i];
    if (!retriable || delay === undefined) break;
    await new Promise((r) => setTimeout(r, delay));
  }

  return {
    success: false,
    statusCode: lastErr?.statusCode ?? 0,
    attempts,
    errorBody: lastErr?.body,
  };
}

function mcSendText(text: string, subscriberId: string, apiKey: string): Promise<ApiResult> {
  return mcPost(
    '/fb/sending/sendContent',
    { subscriber_id: Number(subscriberId), messages: [{ type: 'text', text }] },
    apiKey,
  );
}

function mcSendFlow(flowNs: string, subscriberId: string, apiKey: string): Promise<ApiResult> {
  return mcPost(
    '/fb/sending/sendFlow',
    { subscriber_id: Number(subscriberId), flow_ns: flowNs },
    apiKey,
  );
}

// ── Telegram HTTP ──────────────────────────────────────────────────

async function tgSendMessage(
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN no configurado' };
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  return data.ok ? { ok: true } : { ok: false, error: data.description };
}

// ── Colores / formato ──────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
};

function ok(s: string) {
  return `${C.green}✓${C.reset} ${s}`;
}
function fail(s: string) {
  return `${C.red}✗${C.reset} ${s}`;
}
function skip(s: string) {
  return `${C.gray}─${C.reset} ${s}`;
}
function bold(s: string) {
  return `${C.bold}${s}${C.reset}`;
}
function dim(s: string) {
  return `${C.gray}${s}${C.reset}`;
}

// ── Runner de test individual ──────────────────────────────────────

const results: TestResult[] = [];
let testIdx = 0;

async function runTest(
  name: string,
  category: string,
  fn: () => Promise<ApiResult>,
): Promise<TestResult> {
  testIdx++;
  console.info(`\n${C.cyan}──────────────────────────────────────────${C.reset}`);
  console.info(`${bold(`TEST ${testIdx}:`)} ${name}`);
  console.info(`${dim('Categoría:')} ${category}`);
  console.info(`${C.cyan}──────────────────────────────────────────${C.reset}`);

  process.stdout.write('  Enviando a ManyChat... ');

  let result: ApiResult;
  try {
    result = await fn();
  } catch (err) {
    result = { success: false, statusCode: 0, attempts: 1, errorBody: String(err) };
  }

  if (result.success) {
    console.info(
      ok(`${result.statusCode} OK (${result.attempts} intento${result.attempts !== 1 ? 's' : ''})`),
    );
  } else {
    console.info(fail(`ERROR ${result.statusCode} (${result.attempts} intentos)`));
    if (result.errorBody) {
      console.info(`  ${C.red}${result.errorBody}${C.reset}`);
    }
  }

  const userConfirm = await confirmReceipt(result.success);

  const testResult: TestResult = {
    name,
    category,
    apiSuccess: result.success,
    apiStatusCode: result.statusCode,
    apiAttempts: result.attempts,
    apiError: result.errorBody,
    userConfirm,
  };
  results.push(testResult);
  return testResult;
}

// ── Resumen final ──────────────────────────────────────────────────

function printSummary() {
  console.info(`\n${C.bold}═══════════════════════════════════════════${C.reset}`);
  console.info(bold('  RESUMEN DE PRUEBAS'));
  console.info(`${C.bold}═══════════════════════════════════════════${C.reset}\n`);

  const passed = results.filter((r) => r.userConfirm === 'yes');
  const failed = results.filter((r) => r.userConfirm === 'no' || !r.apiSuccess);
  const skipped = results.filter((r) => r.userConfirm === 'skip' && r.apiSuccess);

  for (const r of results) {
    if (!r.apiSuccess) {
      console.info(
        fail(`${bold(r.name)} ${dim(`[${r.category}]`)} — API error ${r.apiStatusCode}`),
      );
      if (r.apiError) console.info(`    ${dim(r.apiError.slice(0, 120))}`);
    } else if (r.userConfirm === 'yes') {
      console.info(ok(`${bold(r.name)} ${dim(`[${r.category}]`)}`));
    } else if (r.userConfirm === 'no') {
      console.info(
        fail(`${bold(r.name)} ${dim(`[${r.category}]`)} — API OK pero NO recibido en IG`),
      );
    } else {
      console.info(skip(`${bold(r.name)} ${dim(`[${r.category}]`)} — sin confirmar`));
    }
  }

  console.info('');
  console.info(
    `${C.bold}Resultado:${C.reset} ${C.green}${passed.length} PASS${C.reset}  ${C.red}${failed.length} FAIL${C.reset}  ${C.gray}${skipped.length} sin confirmar${C.reset}  de ${results.length} pruebas`,
  );

  if (failed.length === 0 && passed.length > 0) {
    console.info(`\n${C.green}${bold('🎉 Todo llegó a Instagram correctamente.')}${C.reset}`);
  } else if (failed.length > 0) {
    console.info(`\n${C.red}${bold('Revisar los FAILs.')}${C.reset} Posibles causas:`);
    const hasApiErrors = results.some((r) => !r.apiSuccess);
    const hasIgErrors = results.some((r) => r.apiSuccess && r.userConfirm === 'no');
    if (hasApiErrors) {
      console.info('  • API error: revisar SMOKE_API_KEY y SMOKE_SUBSCRIBER_ID');
      console.info('  • Verificar que el API key del tenant es válido en ManyChat');
    }
    if (hasIgErrors) {
      console.info('  • La API respondió OK pero el mensaje no llegó a IG');
      console.info('  • Verificar que el subscriber_id corresponde a tu cuenta de IG');
      console.info('  • Verificar que el flow_ns existe y está activo en ManyChat');
    }
  }
  console.info('');
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.info(`\n${C.bold}${C.blue}╔═══════════════════════════════════════════╗${C.reset}`);
  console.info(`${C.bold}${C.blue}║   SMOKE TEST — ManyChat + Telegram        ║${C.reset}`);
  console.info(`${C.bold}${C.blue}╚═══════════════════════════════════════════╝${C.reset}\n`);

  // Validaciones
  if (!DATABASE_URL) {
    console.error(fail('DATABASE_URL no configurado'));
    process.exit(1);
  }
  if (!TENANT_SLUG) {
    console.error(fail('SMOKE_TENANT_SLUG no configurado (ej: "quantum-creators")'));
    process.exit(1);
  }
  if (!SUBSCRIBER_ID) {
    console.error(fail('SMOKE_SUBSCRIBER_ID no configurado (ID numérico de ManyChat)'));
    process.exit(1);
  }

  // Conexión DB
  console.info(`${dim('Conectando a DB...')} `);
  const db = createDb(DATABASE_URL);

  // Cargar tenant
  const tenantRows = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);

  const tenant = tenantRows[0];
  if (!tenant) {
    console.error(fail(`Tenant "${TENANT_SLUG}" no encontrado`));
    process.exit(1);
  }

  // API key: override > tenant.config.manychat_api_key > error
  const tenantConfig = (tenant.config ?? {}) as Record<string, unknown>;
  const apiKey = OVERRIDE_API_KEY || (tenantConfig.manychat_api_key as string | undefined) || '';
  if (!apiKey) {
    console.error(
      fail(
        'API key de ManyChat no encontrado. Configura SMOKE_API_KEY o guarda manychat_api_key en tenant.config',
      ),
    );
    process.exit(1);
  }

  console.info(`\n${bold('Configuración:')}`);
  console.info(`  Tenant:        ${C.cyan}${tenant.slug}${C.reset} (${tenant.id})`);
  console.info(`  Subscriber ID: ${C.cyan}${SUBSCRIBER_ID}${C.reset}`);
  console.info(`  API Key:       ${C.gray}...${apiKey.slice(-6)}${C.reset}`);
  if (FILTER_STAGE) console.info(`  Filtro etapa:  ${C.yellow}${FILTER_STAGE}${C.reset}`);
  if (TG_TOKEN)
    console.info(
      `  Telegram:      ${C.green}configurado${C.reset} → chat ${TG_CHAT || '(default)'}`,
    );
  console.info('');

  // ─── TEST 1: Texto libre ───────────────────────────────────────────
  const timestamp = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const testText = `Hola, este es un mensaje de prueba de texto libre. [smoke-test ${timestamp}]`;

  console.info(`${dim('Texto que se enviará:')} "${testText}"`);
  await runTest('Texto libre (sendContent)', 'texto', () =>
    mcSendText(testText, SUBSCRIBER_ID, apiKey),
  );

  // ─── TEST 2..N: Flows por etapa ────────────────────────────────────
  if (!SKIP_FLOWS) {
    // Cargar etapas del tenant
    const stages = await db
      .select()
      .from(funnelStages)
      .where(and(eq(funnelStages.tenantId, tenant.id), eq(funnelStages.isActive, true)))
      .orderBy(funnelStages.position);

    const filteredStages = FILTER_STAGE ? stages.filter((s) => s.slug === FILTER_STAGE) : stages;

    for (const stage of filteredStages) {
      // Cargar flows activos de la etapa con flow_ns definido
      const flows = await db
        .select()
        .from(stageFlows)
        .where(
          and(
            eq(stageFlows.stageId, stage.id),
            eq(stageFlows.isActive, true),
            isNotNull(stageFlows.flowNs),
          ),
        )
        .orderBy(stageFlows.humanName);

      for (const flow of flows) {
        if (!flow.flowNs) continue;

        const label = flow.humanName ?? flow.slugId ?? flow.flowNs;
        const mediaTag = flow.mediaType ? ` [${flow.mediaType}]` : '';

        console.info(
          `\n  ${dim('Flow NS:')} ${flow.flowNs}${flow.slugId ? `  ${dim('Slug:')} ${flow.slugId}` : ''}`,
        );

        const flowNs = flow.flowNs;
        await runTest(`${label}${mediaTag}`, `flow / etapa: ${stage.slug}`, () =>
          mcSendFlow(flowNs, SUBSCRIBER_ID, apiKey),
        );
      }
    }
  }

  // ─── TEST N+1..M: Follow-ups por etapa ────────────────────────────
  if (!SKIP_FOLLOWUPS) {
    const stages = await db
      .select()
      .from(funnelStages)
      .where(and(eq(funnelStages.tenantId, tenant.id), eq(funnelStages.isActive, true)));

    const filteredStages = FILTER_STAGE ? stages.filter((s) => s.slug === FILTER_STAGE) : stages;

    for (const stage of filteredStages) {
      const templates = await db
        .select()
        .from(followupTemplates)
        .where(and(eq(followupTemplates.stageId, stage.id), eq(followupTemplates.isActive, true)))
        .orderBy(followupTemplates.sequenceNumber);

      for (const tmpl of templates) {
        const label = tmpl.description ?? `Follow-up #${tmpl.sequenceNumber}`;

        if (tmpl.type === 'text' && tmpl.textTemplate) {
          const rendered = tmpl.textTemplate
            .replace('{lead_name}', 'Lead de Prueba')
            .replace('{first_name}', 'Lead')
            .replace(/\{[^}]+\}/g, '[var]');

          console.info(
            `\n  ${dim('Texto:')} "${rendered.slice(0, 80)}${rendered.length > 80 ? '...' : ''}"`,
          );

          await runTest(
            `${label} (texto)`,
            `follow-up / etapa: ${stage.slug} / seq ${tmpl.sequenceNumber}`,
            () => mcSendText(rendered, SUBSCRIBER_ID, apiKey),
          );
        } else if (tmpl.type === 'flow' && tmpl.flowNs) {
          console.info(`\n  ${dim('Flow NS:')} ${tmpl.flowNs}`);

          const tmplFlowNs = tmpl.flowNs;
          await runTest(
            `${label} (flow)`,
            `follow-up / etapa: ${stage.slug} / seq ${tmpl.sequenceNumber}`,
            () => mcSendFlow(tmplFlowNs, SUBSCRIBER_ID, apiKey),
          );
        }
      }
    }
  }

  // ─── TEST: Telegram ────────────────────────────────────────────────
  if (TG_TOKEN && TG_CHAT) {
    testIdx++;
    console.info(`\n${C.cyan}──────────────────────────────────────────${C.reset}`);
    console.info(`${bold(`TEST ${testIdx}:`)} Notificación Telegram (escalado a humano)`);
    console.info(`${C.cyan}──────────────────────────────────────────${C.reset}`);
    console.info(`  Chat ID: ${TG_CHAT}`);

    process.stdout.write('  Enviando a Telegram... ');
    const tgResult = await tgSendMessage(
      TG_CHAT,
      `🤖 <b>Smoke test ManyChat</b>\n\nEste mensaje verifica que la entrega a Telegram funciona correctamente.\nTenant: <code>${TENANT_SLUG}</code>\nTimestamp: ${new Date().toISOString()}`,
    );

    if (tgResult.ok) {
      console.info(ok('Enviado'));
    } else {
      console.info(fail(`ERROR: ${tgResult.error}`));
    }

    const tgConfirm = await confirmReceipt(tgResult.ok);
    results.push({
      name: 'Notificación Telegram',
      category: 'escalado',
      apiSuccess: tgResult.ok,
      apiStatusCode: tgResult.ok ? 200 : 0,
      apiAttempts: 1,
      apiError: tgResult.error,
      userConfirm: tgConfirm,
    });
  }

  // ─── Resumen ───────────────────────────────────────────────────────
  printSummary();
  rl.close();
  process.exit(results.some((r) => !r.apiSuccess || r.userConfirm === 'no') ? 1 : 0);
}

main().catch((err) => {
  console.error(fail(`Error fatal: ${err}`));
  rl.close();
  process.exit(1);
});
