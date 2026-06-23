import type { CANONICAL_OBJECTION_TYPES, ObjectionDetectionResult } from '@dm-api/shared';
import { CANONICAL_OBJECTION_TYPES as TYPES } from '@dm-api/shared';

type ObjectionType = (typeof CANONICAL_OBJECTION_TYPES)[number];

/**
 * Normaliza texto eliminando acentos, puntuación y llevando a lowercase.
 * Igual que normalizePhrase en fast-path.
 */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: rango de marcas combinantes, intencional
const COMBINING_MARKS = /[̀-ͯ]/g;

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[.,!¡¿?…·]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detección determinista de objeciones (0 tokens LLM).
 * Solo evalúa los tipos canónicos que tienen `keywords` definidas y `isTerminal=true`
 * (NQ, NI). El resto se clasifica por LLM en el nodo `understand`.
 *
 * Busca match por substring en el texto normalizado de cada mensaje del lead.
 * Si múltiples mensajes matchean tipos distintos, se devuelve el primero encontrado.
 *
 * @param messages Textos del lead en el turno actual.
 * @param resources Recursos de objeción del tenant (category='objecion').
 *   Si no hay recursos configurados, usa solo los tipos canónicos con keywords.
 */
export function detectDeterministicObjection(
  messages: Array<{ text?: string | null }>,
  _resources: Array<{ slug: string; config?: unknown }>,
): ObjectionDetectionResult | null {
  if (messages.length === 0) return null;

  // Combinamos todos los textos del batch en uno solo
  const combinedText = messages
    .map((m) => m.text ?? '')
    .filter((t) => t.length > 0)
    .join(' ');

  if (!combinedText.trim()) return null;

  const normalizedInput = normalizeText(combinedText);

  // Solo evaluamos tipos canónicos con keywords definidas
  const typesWithKeywords = TYPES.filter(
    (t) => (t as ObjectionType).keywords.length > 0,
  ) as ObjectionType[];

  for (const type of typesWithKeywords) {
    for (const keyword of type.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalizedInput.includes(normalizedKeyword)) {
        return {
          objection_id: type.id,
          confidence: 1.0,
          reason: `keyword match: "${keyword}"`,
          source: 'deterministic',
        };
      }
    }
  }

  return null;
}

/**
 * Construye el bloque de prompt para que el LLM clasifique objeciones semánticas.
 * Se incluye en la parte volátil del system prompt cuando hay recursos de objeción configurados.
 *
 * El LLM debe incluir en su respuesta JSON un campo `objection_id` con el slug del
 * recurso que mejor aplica, o null si no hay objeción.
 */
export function buildObjectionClassificationBlock(
  resources: Array<{ slug: string; displayName: string; triggerHint?: string | null }>,
): string {
  if (resources.length === 0) return '';

  const lines: string[] = [
    '',
    '## Clasificación de objeciones',
    'Si el lead expresa una objeción, incluye en tu respuesta JSON el campo `objection_id` con',
    'el slug de la objeción detectada (o null si no hay objeción). Los slugs disponibles son:',
    '',
  ];

  for (const r of resources) {
    const hint = r.triggerHint ? ` — ${r.triggerHint}` : '';
    lines.push(`- \`${r.slug}\`: ${r.displayName}${hint}`);
  }

  lines.push(
    '',
    'Ejemplo de respuesta con objeción:',
    '```json',
    '{ "objection_id": "precio_inquiry", "reasoning": "...", "commands": [...] }',
    '```',
    '',
    'Si no hay objeción, omite el campo o usa `"objection_id": null`.',
  );

  return lines.join('\n');
}
