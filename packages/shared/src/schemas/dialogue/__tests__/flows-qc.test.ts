import { describe, expect, it } from 'vitest';
import flowsQc from '../../../../../../packages/db/src/seeds/flows-qc.json' assert { type: 'json' };
import { FlowDefinitionSchema } from '../flow.js';

// TRANSITION_MACROS del Router v4.5 (fuente de verdad del comportamiento vivo)
const TRANSITION_MACROS: Record<
  string,
  { lookup_stage?: string; after: Array<{ type: string; slug_id?: string; new_stage?: string }> }
> = {
  'A->MS': {
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados' },
      { type: 'change_stage', new_stage: 'B' },
    ],
  },
  'MS->B': {
    lookup_stage: 'MS',
    after: [
      { type: 'send_content', slug_id: 'QC_MS_AUDIO_se envia antes de la vsl' },
      { type: 'send_content', slug_id: 'QC_MS_VIDEO_vsl que demuestra resultados' },
    ],
  },
  'B->C': {
    after: [{ type: 'reply_text_with_link' }],
  },
};

describe('flows-qc seeds', () => {
  it('todos los flows parsean contra FlowDefinitionSchema', () => {
    for (const raw of flowsQc) {
      const result = FlowDefinitionSchema.safeParse(raw);
      expect(result.success, `flow_id ${raw.flow_id}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('qc_cascade_a_ms replica TRANSITION_MACROS A->MS acción por acción', () => {
    const flow = FlowDefinitionSchema.parse(flowsQc.find((f) => f.flow_id === 'qc_cascade_a_ms'));
    const macro = TRANSITION_MACROS['A->MS'];

    expect(flow.trigger).toMatchObject({ type: 'stage_transition', from: 'A', to: 'MS' });

    const actionSteps = flow.steps.filter((s) => s.type === 'action');
    expect(actionSteps).toHaveLength(macro.after.length);

    // send_content: audio
    const s1 = actionSteps[0];
    expect(s1?.type).toBe('action');
    if (s1?.type === 'action') {
      expect(s1.action).toBe('send_content');
      expect(s1.config.slug_id).toBe(macro.after[0]?.slug_id);
    }

    // send_content: VSL
    const s2 = actionSteps[1];
    if (s2?.type === 'action') {
      expect(s2.action).toBe('send_content');
      expect(s2.config.slug_id).toBe(macro.after[1]?.slug_id);
    }

    // change_stage: B, cascade false (anti-recursión)
    const s3 = actionSteps[2];
    if (s3?.type === 'action') {
      expect(s3.action).toBe('change_stage');
      expect(s3.config.to_stage).toBe('B');
      expect(s3.config.cascade).toBe(false);
    }
  });

  it('qc_cascade_ms_b replica TRANSITION_MACROS MS->B acción por acción', () => {
    const flow = FlowDefinitionSchema.parse(flowsQc.find((f) => f.flow_id === 'qc_cascade_ms_b'));
    const macro = TRANSITION_MACROS['MS->B'];

    expect(flow.trigger).toMatchObject({ type: 'stage_transition', from: 'MS', to: 'B' });

    const actionSteps = flow.steps.filter((s) => s.type === 'action');
    expect(actionSteps).toHaveLength(macro.after.length);

    const s1 = actionSteps[0];
    if (s1?.type === 'action') {
      expect(s1.action).toBe('send_content');
      expect(s1.config.slug_id).toBe(macro.after[0]?.slug_id);
      expect(s1.config.lookup_stage).toBe(macro.lookup_stage);
    }

    const s2 = actionSteps[1];
    if (s2?.type === 'action') {
      expect(s2.action).toBe('send_content');
      expect(s2.config.slug_id).toBe(macro.after[1]?.slug_id);
    }
  });

  it('qc_cascade_b_c replica TRANSITION_MACROS B->C con Calendly', () => {
    const flow = FlowDefinitionSchema.parse(flowsQc.find((f) => f.flow_id === 'qc_cascade_b_c'));

    expect(flow.trigger).toMatchObject({ type: 'stage_transition', from: 'B', to: 'C' });
    expect(flow.steps).toHaveLength(1);

    const s1 = flow.steps[0];
    if (s1?.type === 'action') {
      expect(s1.action).toBe('reply_text');
      expect(s1.config.template).toContain('{tenant.calendly_url}');
      expect(s1.config.fallback).toContain('{tenant.calendly_url}');
    }
  });

  it('qc_farewell_disqualified usa from="*" colapsando las 4 macros X->disqualified', () => {
    const flow = FlowDefinitionSchema.parse(
      flowsQc.find((f) => f.flow_id === 'qc_farewell_disqualified'),
    );

    expect(flow.trigger).toMatchObject({ type: 'stage_transition', from: '*', to: 'disqualified' });
    expect(flow.steps).toHaveLength(1);

    const s1 = flow.steps[0];
    if (s1?.type === 'action') {
      expect(s1.action).toBe('reply_text');
    }
  });

  it('flow_ids tienen formato snake_case', () => {
    for (const flow of flowsQc) {
      expect(flow.flow_id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('todos los step ids son únicos dentro de cada flow', () => {
    for (const raw of flowsQc) {
      const ids = raw.steps.map((s) => s.id);
      expect(new Set(ids).size, `flow ${raw.flow_id} tiene step ids duplicados`).toBe(ids.length);
    }
  });
});
