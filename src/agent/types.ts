import type { AssistantModelMessage, ModelMessage, ToolModelMessage, UserModelMessage } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { MessageSender } from '../telegram/utils/send';
import type { UnionData } from '../telegram/utils/tg_utils';

export interface OpenAIFuncCallData {
    // index: number;
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
};
export type HistoryItem = ModelMessage;

export interface HistoryModifierResult {
    history: HistoryItem[];
    message: UserModelMessage;
}

export interface CompletionData {
    content: string;
    tool_calls?: OpenAIFuncCallData[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface MessageBase {
    role: string;
    content: string;
}

export type MessageAssistantFunction = MessageBase & {
    tool_calls: OpenAIFuncCallData[];
};

export type MessageTool = MessageBase & {
    name: string;
    tool_call_id: string;
};

export interface ChatStreamTextHandler {
    sender?: MessageSender;
    send: (text: string, type?: 'chat' | 'error' | 'heartbeat') => Promise<any>;
    end?: (text: string, needLog?: boolean, type?: 'chat' | 'error' | 'heartbeat') => Promise<any>;
    clearHeartbeat?: () => void;
}

export type ImageAgentRequest = (prompt: string, context: AgentUserConfig, extraParams?: Record<string, any>) => Promise<ImageResult>;
export type HistoryModifier = (history: HistoryItem[], message: UserModelMessage | null) => HistoryModifierResult;

export type LLMChatRequestParams = UserModelMessage;

export interface LLMChatParams {
    prompt?: string;
    messages: ModelMessage[];
    cache?: string[];
}

export type ResponseMessage = AssistantModelMessage | ToolModelMessage;

export type ChatAgentRequest = (params: LLMChatParams, context: AgentUserConfig, onStream: ChatStreamTextHandler | null) => Promise<{ messages: ResponseMessage[]; content: string }>;

export interface Agent<AgentRequest> {
    name: string;
    modelKey: string;
    enable: (context: AgentUserConfig) => boolean;
    request: AgentRequest;
    model: (ctx: AgentUserConfig, params?: LLMChatRequestParams) => string;
    models?: (ctx: AgentUserConfig) => Promise<string[]>;
    render?: (result: Response | GeneratedImage[] | string[], prompt: string) => Promise<ImageResult>;
}

export interface ImageResult extends Pick<UnionData, 'url' | 'raw' | 'text'> {
    message?: string;
    caption?: string[];
}

export type ASRAgentRequest = (audio: Blob, context: AgentUserConfig) => Promise<string>;

export type TTSAgentRequest = (text: string, context: AgentUserConfig) => Promise<Blob>;

export type Image2ImageAgentRequest = (message: any, context: AgentUserConfig) => Promise<string | string[] | Blob>;

export interface Image2ImageAgent {
    name: string;
    modelKey: string;
    enable: (context: AgentUserConfig) => boolean;
    request: Image2ImageAgentRequest;
    model: (ctx: AgentUserConfig) => string;
}

export type ChatAgent = Agent<ChatAgentRequest>;

export type ImageAgent = Agent<ImageAgentRequest>;

export type TTSAgent = Agent<TTSAgentRequest>;

export type ASRAgent = Agent<ASRAgentRequest>;

export interface GeneratedImage {
    base64: string;
    uint8Array: Uint8Array;
}

export type GoogleVertexImageModelId = 'imagen-3.0-fast-generate-001' | 'imagen-3.0-generate-001';
