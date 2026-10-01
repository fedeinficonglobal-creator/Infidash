import type { FastifyInstance } from 'fastify';

const CLIENT_ERRORS: Record<number, { error: string; code: string }> = {
  400: { error: 'Solicitud no válida', code: 'INVALID_REQUEST' },
  401: { error: 'Sesión no autenticada', code: 'UNAUTHENTICATED' },
  403: { error: 'No tienes permisos para realizar esta acción', code: 'FORBIDDEN' },
  404: { error: 'Ruta no encontrada', code: 'NOT_FOUND' },
  405: { error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' },
  408: { error: 'La solicitud tardó demasiado', code: 'REQUEST_TIMEOUT' },
  413: { error: 'La solicitud es demasiado grande', code: 'PAYLOAD_TOO_LARGE' },
  415: { error: 'Tipo de contenido no soportado', code: 'UNSUPPORTED_MEDIA_TYPE' },
  429: { error: 'Demasiadas solicitudes. Espera antes de volver a intentarlo.', code: 'RATE_LIMITED' },
};

/**
 * Global error handler. Framework errors below 500 (validation, payload too large, bad JSON...)
 * keep their status with a fixed Spanish message; anything else becomes a generic 500 and the real
 * error is logged with method and URL only (never the body, headers or tokens).
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const body = CLIENT_ERRORS[statusCode] ?? CLIENT_ERRORS[400];
      return reply.code(statusCode).send({ error: body.error, code: body.code });
    }

    console.error('[infidash] unhandled error', request.method, request.url, error);
    return reply.code(500).send({ error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  });
}
