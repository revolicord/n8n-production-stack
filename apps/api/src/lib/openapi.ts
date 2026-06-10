import type { FastifySchema, FastifySchemaCompiler, RouteShorthandOptions } from 'fastify';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Documentación OpenAPI sin tocar el comportamiento de las rutas.
 *
 * La validación real de este API vive en Zod DENTRO de cada handler
 * (safeParse → { error: { code: 'INVALID_PAYLOAD' } }). Si dejáramos que
 * Fastify compile el `schema` con Ajv, validaría antes del handler y cambiaría
 * el formato de error que consumen n8n y el dashboard. Por eso `doc()` adjunta
 * el schema solo para @fastify/swagger y neutraliza validación y serialización.
 */

// Acepta cualquier payload: el handler decide con Zod.
const passthroughValidator: FastifySchemaCompiler<FastifySchema> = () => () => true;

// Serializa con JSON.stringify plano: las respuestas no se filtran por schema.
const passthroughSerializer = () => (data: unknown) => JSON.stringify(data);

export function doc(schema: FastifySchema): RouteShorthandOptions {
  return {
    schema,
    validatorCompiler: passthroughValidator,
    serializerCompiler: passthroughSerializer,
  };
}

/** JSON Schema (OpenAPI 3) derivado de un schema Zod existente. */
export function zodDoc(schema: ZodTypeAny): object {
  return zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
}

/** `params` con uno o más path params UUID. */
export function uuidParams(...names: string[]): object {
  return {
    type: 'object',
    properties: Object.fromEntries(
      names.map((n) => [n, { type: 'string', format: 'uuid' }] as const),
    ),
    required: names,
  };
}

/** Seguridad bearer (N8N_CALLBACK_TOKEN estático o JWT admin del dashboard). */
export const adminSecurity = [{ bearerAuth: [] }];
