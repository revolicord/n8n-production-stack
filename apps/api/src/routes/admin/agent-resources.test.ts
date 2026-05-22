import { describe, expect, it } from 'vitest';
import { CreateAgentResourceBodySchema, UpdateAgentResourceBodySchema } from './agent-resources.js';

describe('CreateAgentResourceBodySchema', () => {
  it('accepts valid resource with text_content', () => {
    const result = CreateAgentResourceBodySchema.safeParse({
      category: 'cierre',
      slug: 'precio-objecion',
      display_name: 'Respuesta precio',
      text_content: 'El precio incluye todo lo que necesitas...',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid resource with media_url only', () => {
    const result = CreateAgentResourceBodySchema.safeParse({
      category: 'objecion',
      slug: 'garantia-img',
      display_name: 'Imagen garantía',
      media_url: 'https://example.com/img.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects resource with neither text_content nor media_url', () => {
    const result = CreateAgentResourceBodySchema.safeParse({
      category: 'general',
      slug: 'empty',
      display_name: 'Sin contenido',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = CreateAgentResourceBodySchema.safeParse({
      category: 'otro',
      slug: 'test',
      display_name: 'Test',
      text_content: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects slug with uppercase or spaces', () => {
    const result = CreateAgentResourceBodySchema.safeParse({
      category: 'cierre',
      slug: 'Mi Slug',
      display_name: 'Test',
      text_content: 'x',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateAgentResourceBodySchema', () => {
  it('accepts empty patch', () => {
    expect(UpdateAgentResourceBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial patch with only display_name', () => {
    expect(UpdateAgentResourceBodySchema.safeParse({ display_name: 'Nuevo nombre' }).success).toBe(
      true,
    );
  });

  it('accepts null text_content to clear', () => {
    expect(UpdateAgentResourceBodySchema.safeParse({ text_content: null }).success).toBe(true);
  });
});
