import { describe, expect, it } from 'vitest';
import flowsBufete from '../../../../../../packages/db/src/seeds/flows-bufete.json' assert {
  type: 'json',
};
import { FlowDefinitionSchema } from '../flow.js';

/**
 * Test de agnosticidad: el vocabulario de flows debe ser suficiente para modelar
 * un tenant B2B (bufete) sin agregar ningún tipo de step ni comando nuevo.
 * Si este test requiere modificar flow.ts, es una señal de alerta (ver R3 del plan).
 */
describe('flows-bufete seeds — test de agnosticidad', () => {
  it('todos los flows parsean contra FlowDefinitionSchema sin modificaciones', () => {
    for (const raw of flowsBufete) {
      const result = FlowDefinitionSchema.safeParse(raw);
      expect(result.success, `flow_id ${raw.flow_id}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('bg_intake usa trigger llm (arrancado por el LLM con StartFlow)', () => {
    const flow = FlowDefinitionSchema.parse(flowsBufete.find((f) => f.flow_id === 'bg_intake'));

    expect(flow.trigger.type).toBe('llm');
    if (flow.trigger.type === 'llm') {
      expect(flow.trigger.description.length).toBeGreaterThan(5);
    }
  });

  it('bg_intake define los 3 slots esperados (materia, contraparte, jurisdiccion)', () => {
    const flow = FlowDefinitionSchema.parse(flowsBufete.find((f) => f.flow_id === 'bg_intake'));

    const slotNames = flow.slots.map((s) => s.name);
    expect(slotNames).toContain('materia');
    expect(slotNames).toContain('contraparte');
    expect(slotNames).toContain('jurisdiccion');

    const materia = flow.slots.find((s) => s.name === 'materia');
    expect(materia?.type).toBe('option');
    expect(materia?.options).toEqual(
      expect.arrayContaining(['penal', 'laboral', 'civil', 'familiar']),
    );
  });

  it('bg_intake contiene pasos collect, branch y action sin step nuevo', () => {
    const flow = FlowDefinitionSchema.parse(flowsBufete.find((f) => f.flow_id === 'bg_intake'));

    const types = new Set(flow.steps.map((s) => s.type));
    // Solo usa tipos existentes del vocabulario
    for (const t of types) {
      expect(['collect', 'action', 'branch', 'link']).toContain(t);
    }

    expect(types).toContain('collect');
    expect(types).toContain('branch');
    expect(types).toContain('action');
  });

  it('bg_intake branch evalúa jurisdiccion_valida (slot derivado por LLM via SetSlot)', () => {
    const flow = FlowDefinitionSchema.parse(flowsBufete.find((f) => f.flow_id === 'bg_intake'));

    const branchStep = flow.steps.find((s) => s.type === 'branch');
    expect(branchStep).toBeDefined();
    if (branchStep?.type === 'branch') {
      expect(branchStep.cases[0]?.when.slot).toBe('jurisdiccion_valida');
      expect(branchStep.cases[0]?.when.op).toBe('eq');
      expect(branchStep.cases[0]?.when.value).toBe(false);
    }
  });

  it('bg_cascade_conflict_check usa http_request con on_failure=handoff', () => {
    const flow = FlowDefinitionSchema.parse(
      flowsBufete.find((f) => f.flow_id === 'bg_cascade_conflict_check'),
    );

    expect(flow.trigger).toMatchObject({
      type: 'stage_transition',
      from: 'intake',
      to: 'conflict_check',
    });

    const httpStep = flow.steps.find((s) => s.type === 'action' && s.action === 'http_request');
    expect(httpStep).toBeDefined();
    if (httpStep?.type === 'action') {
      expect(httpStep.on_failure).toBe('handoff');
      expect(httpStep.save_as).toBe('conflict_result');
    }
  });

  it('bg_cascade_conflict_check branch usa dot-path en slot (conflict_result.has_conflict)', () => {
    const flow = FlowDefinitionSchema.parse(
      flowsBufete.find((f) => f.flow_id === 'bg_cascade_conflict_check'),
    );

    const branchStep = flow.steps.find((s) => s.type === 'branch');
    expect(branchStep).toBeDefined();
    if (branchStep?.type === 'branch') {
      expect(branchStep.cases[0]?.when.slot).toBe('conflict_result.has_conflict');
    }
  });

  it('ningún flow bufete usa un tipo de step fuera del vocabulario base', () => {
    const allowedTypes = new Set(['collect', 'action', 'branch', 'link']);
    for (const raw of flowsBufete) {
      for (const step of raw.steps) {
        expect(
          allowedTypes.has(step.type),
          `flow ${raw.flow_id} step ${step.id} usa tipo desconocido: ${step.type}`,
        ).toBe(true);
      }
    }
  });

  it('flow_ids tienen formato snake_case', () => {
    for (const flow of flowsBufete) {
      expect(flow.flow_id).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
