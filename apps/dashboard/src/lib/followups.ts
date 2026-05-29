import { db, followupMessages, followupTemplates, funnelStages } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export type StageDetail = {
  id: string;
  slug: string;
  displayName: string;
  nurtureVideoUrl: string | null;
  callLink: string | null;
};

export type MessageRow = {
  id: string;
  templateId: string;
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  sortOrder: number;
  aiImageContext: string | null;
};

export type TemplateDetail = {
  id: string;
  tenantId: string;
  sequenceNumber: number;
  delayMinutes: number;
  type: string;
  textTemplate: string | null;
  flowNs: string | null;
  description: string | null;
  messages: MessageRow[];
};

export async function getStageBySlug(tenantId: string, slug: string): Promise<StageDetail | null> {
  const [row] = await db
    .select({
      id: funnelStages.id,
      slug: funnelStages.slug,
      displayName: funnelStages.displayName,
      nurtureVideoUrl: funnelStages.nurtureVideoUrl,
      callLink: funnelStages.callLink,
    })
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.slug, slug)))
    .limit(1);
  return row ?? null;
}

// Carga las plantillas activas de una etapa con sus mensajes anidados (para type='content').
export async function listFollowups(stageId: string): Promise<TemplateDetail[]> {
  const templates = await db
    .select({
      id: followupTemplates.id,
      tenantId: followupTemplates.tenantId,
      sequenceNumber: followupTemplates.sequenceNumber,
      delayMinutes: followupTemplates.delayMinutes,
      type: followupTemplates.type,
      textTemplate: followupTemplates.textTemplate,
      flowNs: followupTemplates.flowNs,
      description: followupTemplates.description,
    })
    .from(followupTemplates)
    .where(and(eq(followupTemplates.stageId, stageId), eq(followupTemplates.isActive, true)))
    .orderBy(asc(followupTemplates.sequenceNumber));

  const result: TemplateDetail[] = [];
  for (const t of templates) {
    const messages = t.type === 'content' ? await listMessages(t.id) : [];
    result.push({ ...t, messages });
  }
  return result;
}

export async function listMessages(templateId: string): Promise<MessageRow[]> {
  return db
    .select({
      id: followupMessages.id,
      templateId: followupMessages.templateId,
      messageType: followupMessages.messageType,
      textContent: followupMessages.textContent,
      mediaUrl: followupMessages.mediaUrl,
      sortOrder: followupMessages.sortOrder,
      aiImageContext: followupMessages.aiImageContext,
    })
    .from(followupMessages)
    .where(eq(followupMessages.templateId, templateId))
    .orderBy(asc(followupMessages.sortOrder));
}
