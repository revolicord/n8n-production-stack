export interface SendFlowResult {
  success: boolean;
  statusCode: number;
  attempts: number;
}

export interface SendTextResult {
  success: boolean;
  statusCode: number;
  attempts: number;
}

export interface ChannelAdapter {
  sendFlow(flowNs: string, manychatSubscriberId: string): Promise<SendFlowResult>;
  sendText(text: string, manychatSubscriberId: string): Promise<SendTextResult>;
}
