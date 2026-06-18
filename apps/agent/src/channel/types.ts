export interface SendFlowResult {
  success: boolean;
  statusCode: number;
  attempts: number;
  errorBody?: string;
}

export interface SendTextResult {
  success: boolean;
  statusCode: number;
  attempts: number;
  errorBody?: string;
}

export interface SendContentResult {
  success: boolean;
  statusCode: number;
  attempts: number;
  errorBody?: string;
}

/** Mensaje individual de un envío `sendContent` multi-parte (texto + imágenes). */
export type ContentMessage = { type: 'text'; text: string } | { type: 'image'; url: string };

export interface ChannelAdapter {
  sendFlow(flowNs: string, manychatSubscriberId: string): Promise<SendFlowResult>;
  sendText(text: string, manychatSubscriberId: string): Promise<SendTextResult>;
  /**
   * Envía una secuencia de mensajes (texto e imágenes) en un solo `sendContent`.
   * Usado por el follow-up runner para templates `type='content'`.
   */
  sendContent(messages: ContentMessage[], manychatSubscriberId: string): Promise<SendContentResult>;
}
