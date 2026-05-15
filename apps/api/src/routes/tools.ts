import type { FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { getDb } from '../lib/db.js';
import { getRedis } from '../lib/redis.js';
import { getTenantBySlug, parseTenantConfig } from '../services/tenants.js';
import { funnelStages } from '@dm-api/db';

interface ManyChatFlow {
  ns: string;
  name: string;
}

interface ManyChatFlowsResponse {
  status: string;
  data: { flows: ManyChatFlow[] };
}

// Patrón: QC_{STAGE}_{MEDIA_TYPE}_{DESC}[__{USAGE}][_{vN}]
// DESC  = qué ES el contenido  (ej: video_gancho_25s)
// USAGE = cuándo usarlo        (ej: primer_contacto_pedir_pulgar, separado por __)
// Ej: QC_A_VIDEO_video_gancho_25s__primer_contacto_pedir_pulgar_v1
const FLOW_NAME_TOP_RE = /^([A-Z0-9]+)_([A-Z]+)_(video|audio|img|imagen|txt|sticker)_(.+)$/i;

const MEDIA_TYPE_MAP: Record<string, string> = { imagen: 'img' };

interface ParsedFlowName {
  prefix: string;
  stage: string;
  mediaType: string;
  contentDescription: string;
  usageCondition: string | null;
  variant: string | null;
  variantGroup: string;
}

function parseFlowName(name: string): ParsedFlowName | null {
  const m = FLOW_NAME_TOP_RE.exec(name);
  if (!m) return null;
  const [, prefix, stage, rawMedia, rest] = m as [string, string, string, string, string];
  const mediaType = MEDIA_TYPE_MAP[rawMedia.toLowerCase()] ?? rawMedia.toLowerCase();

  // Strip optional variant suffix _vN
  let body = rest;
  let variant: string | null = null;
  const variantM = /_(v\d+)$/i.exec(body);
  if (variantM) {
    variant = variantM[1] ?? null;
    body = body.slice(0, -variantM[0].length);
  }

  // Split on __ to get content description and optional usage condition
  const dblIdx = body.indexOf('__');
  const descRaw = dblIdx !== -1 ? body.slice(0, dblIdx) : body;
  const usageRaw = dblIdx !== -1 ? body.slice(dblIdx + 2) : null;

  return {
    prefix,
    stage: stage.toUpperCase(),
    mediaType,
    contentDescription: descRaw.replace(/_/g, ' '),
    usageCondition: usageRaw ? usageRaw.replace(/_/g, ' ') : null,
    variant,
    variantGroup: descRaw,
  };
}

export interface TenantTool {
  name: string;
  description: string;
  flow_id: string;
  stage: string;
  media_type: string;
  variant_group: string;
  usage_condition: string | null;
}

export default async function toolsRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /tenants/:slug/tools ──────────────────────────────────────────────
  // Devuelve la lista de flows de ManyChat filtrados por prefijo del tenant.
  // Útil para explorar qué flows están disponibles.
  app.get<{ Params: { slug: string } }>('/tenants/:slug/tools', async (req, reply) => {
    const config = getConfig();

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${config.N8N_CALLBACK_TOKEN}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { slug } = req.params;
    const tenant = await getTenantBySlug(getDb(), slug);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const tenantConfig = parseTenantConfig(tenant.config);
    const mcApiKey = tenantConfig.manychat_api_key;
    if (!mcApiKey) return reply.send({ tools: [] });

    const cacheKey = `mc:tools:${tenant.id}`;
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      return reply.send({ tools: JSON.parse(cached) as TenantTool[] });
    }

    const mcFlows = await fetchManyChatFlows(mcApiKey, req.log);
    if (!mcFlows) return reply.send({ tools: [] });

    const flowPrefix = getFlowPrefix(tenantConfig);

    const tools: TenantTool[] = mcFlows
      .filter((f) => f.name.toUpperCase().startsWith(flowPrefix.toUpperCase()))
      .flatMap((f) => {
        const parsed = parseFlowName(f.name);
        if (!parsed) {
          req.log.warn({ name: f.name, slug }, 'flow name does not match convention — skipped');
          return [];
        }
        return [{
          name: f.name,
          description: `[${parsed.stage}/${parsed.mediaType}] ${parsed.contentDescription}${parsed.variant ? ` (${parsed.variant})` : ''}`,
          flow_id: f.ns,
          stage: parsed.stage,
          media_type: parsed.mediaType,
          variant_group: parsed.variantGroup,
          usage_condition: parsed.usageCondition,
        }];
      });

    await getRedis().set(cacheKey, JSON.stringify(tools), 'EX', 300);
    req.log.info({ slug, tool_count: tools.length }, 'tools fetched from ManyChat');
    return reply.send({ tools });
  });

  // ── POST /tenants/:slug/tools/sync ────────────────────────────────────────
  // Sincroniza flows de ManyChat → stage_flows en DB.
  // Por defecto escribe en pending_ns (requiere aprobación SQL manual).
  // ?force=true activa directamente — solo funciona en NODE_ENV != production.
  app.post<{
    Params: { slug: string };
    Querystring: { force?: string };
  }>('/tenants/:slug/tools/sync', async (req, reply) => {
    const config = getConfig();

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${config.N8N_CALLBACK_TOKEN}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const isProduction = config.NODE_ENV === 'production';
    const force = req.query.force === 'true' && !isProduction;

    const { slug } = req.params;
    const tenant = await getTenantBySlug(getDb(), slug);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const tenantConfig = parseTenantConfig(tenant.config);
    const mcApiKey = tenantConfig.manychat_api_key;
    if (!mcApiKey) return reply.code(400).send({ error: 'No manychat_api_key configured for tenant' });

    const mcFlows = await fetchManyChatFlows(mcApiKey, req.log);
    if (!mcFlows) return reply.code(502).send({ error: 'ManyChat API unavailable' });

    const flowPrefix = getFlowPrefix(tenantConfig);
    const db = getDb();
    const synced: string[] = [];
    const skipped: string[] = [];

    for (const f of mcFlows) {
      if (!f.name.toUpperCase().startsWith(flowPrefix.toUpperCase())) continue;

      const parsed = parseFlowName(f.name);
      if (!parsed) {
        req.log.warn({ name: f.name, slug }, 'flow skipped — name does not match convention');
        skipped.push(f.name);
        continue;
      }

      // Look up funnel stage
      const stageRows = await db
        .select({ id: funnelStages.id })
        .from(funnelStages)
        .where(and(eq(funnelStages.tenantId, tenant.id), eq(funnelStages.slug, parsed.stage)))
        .limit(1);

      if (!stageRows[0]) {
        req.log.warn({ name: f.name, stage: parsed.stage, slug }, 'flow skipped — stage not found in DB');
        skipped.push(f.name);
        continue;
      }

      const stageId = stageRows[0].id;

      // Check if row with this human_name exists (new columns not in Drizzle schema → raw SQL)
      const existing = await db.execute(sql`
        SELECT id, flow_ns FROM api.stage_flows
        WHERE tenant_id = ${tenant.id} AND human_name = ${f.name}
        LIMIT 1
      `);

      if (existing.length > 0) {
        const row = existing[0] as { id: string; flow_ns: string };
        if (row.flow_ns !== f.ns) {
          await db.execute(sql`
            UPDATE api.stage_flows
            SET pending_ns = ${f.ns}, synced_at = NOW(),
                description = ${parsed.contentDescription},
                content_description = ${parsed.contentDescription},
                usage_condition = ${parsed.usageCondition}
            WHERE id = ${row.id}
          `);
          req.log.info({ name: f.name, oldNs: row.flow_ns, newNs: f.ns }, 'ns change pending approval');
        }
      } else {
        const activeNs = force ? f.ns : 'PENDING';
        const pendingNs = force ? null : f.ns;
        await db.execute(sql`
          INSERT INTO api.stage_flows
            (stage_id, tenant_id, flow_ns, human_name, media_type, variant_group,
             description, content_description, usage_condition,
             weight, is_active, pending_ns, synced_at)
          VALUES (
            ${stageId}, ${tenant.id}, ${activeNs}, ${f.name},
            ${parsed.mediaType}, ${parsed.variantGroup},
            ${parsed.contentDescription}, ${parsed.contentDescription}, ${parsed.usageCondition},
            1, ${force}, ${pendingNs}, NOW()
          )
          ON CONFLICT DO NOTHING
        `);
        req.log.info({ name: f.name, ns: f.ns, force }, 'new flow synced');
      }

      synced.push(f.name);
    }

    await getRedis().del(`mc:tools:${tenant.id}`);

    return reply.send({
      synced,
      skipped,
      pending_approval: !force,
      message: force
        ? 'Flows synced and activated directly (dev mode)'
        : 'Flows written to pending_ns. Run approval SQL to activate. See docs-dm-settings/15-flow-registry-manychat.md',
    });
  });
}

function getFlowPrefix(tenantConfig: ReturnType<typeof parseTenantConfig>): string {
  const cfg = tenantConfig as Record<string, unknown>;
  return typeof cfg['flow_prefix'] === 'string' ? cfg['flow_prefix'] : 'QC_';
}

async function fetchManyChatFlows(
  apiKey: string,
  log: FastifyInstance['log'],
): Promise<ManyChatFlow[] | null> {
  try {
    const res = await fetch('https://api.manychat.com/fb/page/getFlows', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      log.error({ status: res.status }, 'ManyChat getFlows failed');
      return null;
    }

    const data = (await res.json()) as ManyChatFlowsResponse;
    if (data.status !== 'success') return null;
    return data.data.flows;
  } catch (err) {
    log.error({ err }, 'ManyChat getFlows error');
    return null;
  }
}
