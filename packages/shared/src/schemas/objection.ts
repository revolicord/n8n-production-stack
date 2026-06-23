import { z } from 'zod';

export const OBJECTION_ACTION_TYPES = [
  'reply_text',
  'send_flow',
  'change_stage',
  'add_tag',
] as const;
export type ObjectionActionType = (typeof OBJECTION_ACTION_TYPES)[number];

export const ObjectionActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reply_text'),
    params: z.object({ text: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('send_flow'),
    params: z.object({ flow_id: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('change_stage'),
    params: z.object({ stage_id: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('add_tag'),
    params: z.object({ tag: z.string().min(1) }),
  }),
]);

export type ObjectionAction = z.infer<typeof ObjectionActionSchema>;

/**
 * Configuración estructurada de una objeción almacenada en agent_resources.config.
 * Define las acciones a ejecutar cuando se detecta esta objeción.
 */
export const ObjectionResourceConfigSchema = z.object({
  is_terminal: z.boolean().optional().default(false),
  confidence_threshold: z.number().min(0).max(1).optional(),
  actions: z.array(ObjectionActionSchema).optional().default([]),
});

export type ObjectionResourceConfig = z.infer<typeof ObjectionResourceConfigSchema>;

/**
 * Tipos canónicos de objeción. Derivados del playbook de Quantum Creators.
 * Válidos para todos los tenants (label y descripción pueden personalizarse vía dashboard).
 */
export const CANONICAL_OBJECTION_TYPES = [
  {
    id: 'precio_inquiry',
    label: 'Pregunta por precio',
    description: 'El lead pregunta cuánto cuesta, cuál es la inversión o la tarifa.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'info_request',
    label: 'Pide info / explícame aquí',
    description: 'Pide información general o que se le explique todo por chat.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'time_friction',
    label: 'No tengo tiempo',
    description: 'El lead está ocupado, posterga o usa falta de tiempo como fricción.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'budget_friction',
    label: 'No tengo dinero ahora',
    description: 'Dice que no puede invertir ahora, no tiene presupuesto o va justo de liquidez.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'defer_decision',
    label: 'Lo miro luego / me lo pienso',
    description: 'No rechaza pero pide tiempo, dice que lo mirará o que lo pensará.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'not_interested',
    label: 'No me interesa',
    description: 'Dice que no, que no le interesa, que no es para él.',
    keywords: [
      'no me interesa',
      'no quiero',
      'archivame',
      'archívame',
      'borra mi contacto',
      'no te quiero escuchar',
      'dejame en paz',
      'déjame en paz',
    ],
    isTerminal: true,
  },
  {
    id: 'no_qualify',
    label: 'No cualifica',
    description:
      'No tiene negocio, solo tiene negocio físico, está empezando, o no tiene oferta online activa.',
    keywords: [
      'no tengo negocio',
      'no tengo empresa',
      'negocio fisico',
      'negocio físico',
      'estoy empezando',
      'quiero empezar',
      'no tengo clientes',
      'no vendo nada',
    ],
    isTerminal: true,
  },
  {
    id: 'has_solution',
    label: 'Ya tengo equipo o agencia',
    description:
      'Tiene agencia, editor, equipo interno o proveedor que ya gestiona marketing/contenido.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'alternate_strategy',
    label: 'Ya hago contenido o ads',
    description: 'Usa otros canales y cree que eso sustituye YouTube o la captación orgánica.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'wrong_priority',
    label: 'YouTube no es prioridad',
    description: 'Dice que ahora YouTube no es su foco o no lo ve prioritario.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'booking_friction',
    label: 'Problemas con Calendly',
    description:
      'Tiene el enlace pero no reserva, no encuentra hueco o menciona problemas con el calendario.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'booking_verify',
    label: 'Dice que reservó pero no aparece',
    description: 'Afirma que ya agendó pero no se ve el booking.',
    keywords: [],
    isTerminal: false,
  },
  {
    id: 'hostile_tone',
    label: 'Tono negativo u hostil',
    description: 'Insulto, burla, mala fe o tono que no merece seguir conversación.',
    keywords: [],
    isTerminal: false,
  },
] as const;

export type CanonicalObjectionId = (typeof CANONICAL_OBJECTION_TYPES)[number]['id'];

/** Resultado de la detección de objeción (determinista o LLM). */
export const ObjectionDetectionResultSchema = z.object({
  objection_id: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  source: z.enum(['deterministic', 'llm']),
});

export type ObjectionDetectionResult = z.infer<typeof ObjectionDetectionResultSchema>;
