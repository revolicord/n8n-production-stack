import { z } from 'zod';

// ───────────────────────────────────────────────────────────────
// Taxonomía de contenido entrante (content_class)
// ----------------------------------------------------------------
// El detector de escalado es una *allowlist por clase*, no "audio OR
// keyword": la pregunta es "¿el agente literalmente NO puede actuar sobre
// esto?" → entonces escala y lo anota fielmente en la memoria. Así, manejo
// de medios y escalado son la misma decisión.
// ───────────────────────────────────────────────────────────────
export const CONTENT_CLASSES = [
  'text',
  'audio',
  'image',
  'video',
  'location',
  'file',
  'share',
  'sticker',
  'unknown',
] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

/**
 * Clases sobre las que el agente NO puede actuar hoy → se escalan a humano.
 * `share`/`sticker` se anotan pero el agente sigue. `audio`/`image`/`video`
 * escalan por ahora; cuando entren transcripción/visión solo cambia su
 * política aquí (o vía tenant.config.media_policy), no el andamiaje.
 */
export const ESCALATING_CLASSES: readonly ContentClass[] = [
  'audio',
  'image',
  'video',
  'location',
  'file',
  'unknown',
];

/**
 * Mapa de `media.type` crudo de ManyChat (Instagram) → content_class.
 * Lo desconocido cae en `unknown`, que escala (fail-safe): nunca dejamos que
 * un tipo nuevo se cuele como placeholder genérico mentiroso en la memoria.
 */
const RAW_MEDIA_TYPE_TO_CLASS: Record<string, ContentClass> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'audio',
  file: 'file',
  location: 'location',
  contact: 'file',
  vcard: 'file',
  share: 'share',
  story_mention: 'share',
  story_reply: 'share',
  reel: 'share',
  sticker: 'sticker',
  gif: 'sticker',
  animation: 'sticker',
};

export function classifyMediaType(rawType: string): ContentClass {
  return RAW_MEDIA_TYPE_TO_CLASS[rawType.toLowerCase().trim()] ?? 'unknown';
}

/** Motivo legible del escalado por clase — va al `reason` de la notificación. */
export function escalationReason(contentClass: ContentClass): string {
  switch (contentClass) {
    case 'audio':
      return 'El lead envió un mensaje de audio';
    case 'image':
      return 'El lead envió una imagen';
    case 'video':
      return 'El lead envió un video';
    case 'location':
      return 'El lead compartió una ubicación';
    case 'file':
      return 'El lead envió un archivo';
    case 'unknown':
      return 'El lead envió contenido no soportado';
    default:
      return 'Contenido que requiere atención humana';
  }
}

/** Placeholder fiel por clase — lo que el agente verá en su memoria. */
export function mediaPlaceholder(contentClass: ContentClass): string {
  switch (contentClass) {
    case 'audio':
      return '[audio sin transcribir]';
    case 'image':
      return '[el lead envió una imagen]';
    case 'video':
      return '[el lead envió un video]';
    case 'location':
      return '[el lead compartió una ubicación]';
    case 'file':
      return '[el lead envió un archivo]';
    case 'share':
      return '[el lead compartió/respondió a una historia]';
    case 'sticker':
      return '[el lead reaccionó / envió un sticker]';
    case 'unknown':
      return '[contenido no soportado]';
    default:
      return '[mensaje sin texto]';
  }
}

export const ManyChatMediaSchema = z.object({
  // Permisivo a propósito: no perdemos tipos nuevos de IG en el Zod parse.
  // La clasificación a content_class la hace classifyMediaType.
  type: z.string(),
  url: z.string().url(),
});

export const ManyChatSubscriberSchema = z.object({
  manychat_id: z.string().min(1),
  ig_user_id: z.string().optional(),
  ig_username: z.string().optional(),
  ig_page_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  full_name: z.string().optional(),
  name: z.string().optional(),
  locale: z.string().optional(),
  subscribed_at: z.string().optional(),
});

export const ManyChatMessageSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().default(''),
  timestamp: z.number().optional(),
  reply_type: z.string().optional(),
  media: z.array(ManyChatMediaSchema).default([]),
});

export const ManyChatTriggerSchema = z.object({
  source: z.string().optional(),
  channel: z.string().optional(),
  ref: z.string().optional(),
});

export const ManyChatInstagramContextSchema = z.object({
  messaging_window: z.string().optional(),
  last_interaction: z.string().optional(),
  last_seen: z.string().optional(),
  opt_in: z.string().optional(),
  follows_you: z.string().optional(),
  followers_count: z.string().optional(),
  verified: z.string().optional(),
});

export const ManyChatWebhookSchema = z.object({
  tenant_slug: z.string().min(1),
  subscriber: ManyChatSubscriberSchema,
  message: ManyChatMessageSchema,
  trigger: ManyChatTriggerSchema.optional(),
  instagram_context: ManyChatInstagramContextSchema.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ManyChatWebhookEvent = z.infer<typeof ManyChatWebhookSchema>;
export type ManyChatSubscriberPayload = z.infer<typeof ManyChatSubscriberSchema>;
export type ManyChatMessagePayload = z.infer<typeof ManyChatMessageSchema>;
export type ManyChatInstagramContext = z.infer<typeof ManyChatInstagramContextSchema>;

/**
 * ManyChat envía voice notes / audios como una URL de CDN de Instagram en el campo
 * `text` con `media=[]` vacío (comportamiento observado en producción). Esta regex
 * detecta ese patrón para clasificarlo como media no-legible, no como texto.
 */
const INSTAGRAM_CDN_RE = /^https?:\/\/lookaside\.fbsbx\.com\/ig_messaging_cdn\//i;

/** True cuando `text` es SOLO una URL del CDN de Instagram (sin texto humano). */
function isInstagramMediaCdnUrl(text: string): boolean {
  const t = text.trim();
  return INSTAGRAM_CDN_RE.test(t) && !t.includes(' ');
}

/**
 * Clasifica un mensaje entrante en una `content_class`. Si trae texto legible, es
 * `text`; si el texto es solo una URL del CDN de Instagram (voice note / media de
 * ManyChat), es `unknown` (escala a humano — el agente no puede leerlo). Si no hay
 * texto, la clase del primer media; si no hay media, `text` (mensaje vacío).
 *
 * Invariante: una sola clase por mensaje. El placeholder solo se usa cuando no hay
 * texto legible (el LLM recibe la etiqueta, no la URL cruda).
 */
export function classifyMessageContent(message: {
  text?: string;
  media?: { type: string }[];
}): ContentClass {
  if (message.text && message.text.trim() !== '') {
    // ManyChat a veces envía voice notes / videos como URL del CDN en text[] con media=[].
    // Detectamos y escalamos como 'unknown' — el LLM no puede leer el contenido.
    if (isInstagramMediaCdnUrl(message.text)) return 'unknown';
    return 'text';
  }
  const first = message.media?.[0];
  if (!first) return 'text';
  return classifyMediaType(first.type);
}
