import { type DbClient, funnelStages, stageFlows } from '@dm-api/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

export interface ManyChatFlow {
  ns: string;
  name: string;
}

interface ManyChatFlowsResponse {
  status: string;
  data: { flows: ManyChatFlow[] };
}

// Patrón: QC_{STAGE}_{MEDIA}_{DESC}[__{WHEN}][_vN]
// El nombre puede ser truncado por ManyChat — DESC y WHEN son opcionales en la práctica.
// Los campos content_description y usage_condition se editan en el panel tras el sync.
export const FLOW_NAME_RE = /^([A-Z0-9]+)_([A-Z0-9]+)_(video|audio|img|imagen|txt|sticker)_(.+)$/i;

const MEDIA_ALIAS: Record<string, string> = { imagen: 'img', txt: 'text' };

export interface ParsedFlow {
  prefix: string;
  stage: string;
  mediaType: string;
  contentDescription: string;
  usageCondition: string | null;
  variant: string | null;
  variantGroup: string;
}

export function parseFlowName(name: string): ParsedFlow | null {
  const m = FLOW_NAME_RE.exec(name);
  if (!m) return null;
  const [, prefix, stage, rawMedia, rest] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const mediaType = MEDIA_ALIAS[rawMedia.toLowerCase()] ?? rawMedia.toLowerCase();

  let body = rest;
  let variant: string | null = null;
  const variantM = /_(v\d+)$/i.exec(body);
  if (variantM) {
    variant = variantM[1] ?? null;
    body = body.slice(0, -variantM[0].length);
  }

  const dblIdx = body.indexOf('__');
  const descRaw = dblIdx !== -1 ? body.slice(0, dblIdx) : body;
  const usageRaw = dblIdx !== -1 ? body.slice(dblIdx + 2) : null;

  return {
    prefix,
    stage: stage.toUpperCase(),
    mediaType,
    // Best-effort parse from name; user should edit in panel if ManyChat truncated the name
    contentDescription: descRaw.replace(/_/g, ' '),
    usageCondition: usageRaw ? usageRaw.replace(/_/g, ' ') : null,
    variant,
    variantGroup: descRaw,
  };
}

export async function fetchManyChatFlows(
  apiKey: string,
  log?: FastifyBaseLogger,
): Promise<ManyChatFlow[] | null> {
  try {
    const res = await fetch('https://api.manychat.com/fb/page/getFlows', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log?.error({ status: res.status }, 'ManyChat getFlows failed');
      return null;
    }
    const data = (await res.json()) as ManyChatFlowsResponse;
    if (data.status !== 'success') return null;
    return data.data.flows;
  } catch (err) {
    log?.error({ err }, 'ManyChat getFlows error');
    return null;
  }
}

export type SyncResult = {
  synced: string[];
  skipped: string[];
  pending_approval: boolean;
};

/**
 * UPSERT flows from ManyChat into stage_flows.
 * In production always writes to pending_ns (gate de aprobación).
 * force=true activa directamente — solo para dev/tests.
 */
export async function syncFlowsToDb(
  db: DbClient,
  tenantId: string,
  flows: ManyChatFlow[],
  flowPrefix: string,
  force: boolean,
  log?: FastifyBaseLogger,
): Promise<SyncResult> {
  const synced: string[] = [];
  const skipped: string[] = [];

  for (const f of flows) {
    if (!f.name.toUpperCase().startsWith(flowPrefix.toUpperCase())) continue;

    const parsed = parseFlowName(f.name);
    if (!parsed) {
      log?.warn({ name: f.name }, 'flow skipped — name does not match convention');
      skipped.push(f.name);
      continue;
    }

    const stageRows = await db
      .select({ id: funnelStages.id })
      .from(funnelStages)
      .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.slug, parsed.stage)))
      .limit(1);

    if (!stageRows[0]) {
      log?.warn({ name: f.name, stage: parsed.stage }, 'flow skipped — stage not found in DB');
      skipped.push(f.name);
      continue;
    }

    const stageId = stageRows[0].id;

    const existing = await db
      .select({ id: stageFlows.id, flowNs: stageFlows.flowNs })
      .from(stageFlows)
      .where(and(eq(stageFlows.tenantId, tenantId), eq(stageFlows.humanName, f.name)))
      .limit(1);

    if (existing[0]) {
      // Flow exists — if ns changed, record pending change
      if (existing[0].flowNs !== f.ns) {
        await db
          .update(stageFlows)
          .set({
            pendingNs: f.ns,
            syncedAt: new Date(),
          })
          .where(eq(stageFlows.id, existing[0].id));
        log?.info({ name: f.name, oldNs: existing[0].flowNs, newNs: f.ns }, 'ns change pending');
      } else {
        // ns unchanged — just refresh syncedAt
        await db
          .update(stageFlows)
          .set({ syncedAt: new Date() })
          .where(eq(stageFlows.id, existing[0].id));
      }
    } else {
      // New flow — insert with pending gate
      await db.execute(sql`
        INSERT INTO api.stage_flows
          (stage_id, tenant_id, flow_ns, human_name, media_type, variant_group,
           description, content_description, usage_condition,
           weight, is_active, pending_ns, synced_at)
        VALUES (
          ${stageId}, ${tenantId}, ${force ? f.ns : 'PENDING'}, ${f.name},
          ${parsed.mediaType}, ${parsed.variantGroup},
          ${parsed.contentDescription}, ${parsed.contentDescription}, ${parsed.usageCondition},
          1, ${force}, ${force ? null : f.ns}, NOW()
        )
        ON CONFLICT DO NOTHING
      `);
      log?.info({ name: f.name, ns: f.ns, force }, 'new flow synced');
    }

    synced.push(f.name);
  }

  return { synced, skipped, pending_approval: !force };
}
