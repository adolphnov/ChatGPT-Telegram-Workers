import type { CoreAssistantMessage, CoreMessage, CoreToolMessage, CoreUserMessage } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { UnionData } from '../telegram/utils/utils';

export interface OpenAIFuncCallData {
    // index: number;
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
};
export type HistoryItem = CoreMessage;

export interface HistoryModifierResult {
    history: HistoryItem[];
    message: CoreUserMessage;
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
    send: (text: string, sendType?: 'chat' | 'telegraph') => Promise<any>;
    end?: (text: string) => Promise<any>;
}

export type ImageAgentRequest = (prompt: string, context: AgentUserConfig) => Promise<ImageResult>;
export type HistoryModifier = (history: HistoryItem[], message: CoreUserMessage | null) => HistoryModifierResult;

export type LLMChatRequestParams = CoreUserMessage;

export interface LLMChatParams {
    prompt?: string;
    messages: CoreMessage[];
}

export type ResponseMessage = CoreAssistantMessage | CoreToolMessage;

export type ChatAgentRequest = (params: LLMChatParams, context: AgentUserConfig, onStream: ChatStreamTextHandler | null) => Promise<{ messages: ResponseMessage[]; content: string }>;

export interface Agent<AgentRequest> {
    name: string;
    modelKey: string;
    enable: (context: AgentUserConfig) => boolean;
    request: AgentRequest;
    model: (ctx: AgentUserConfig, params?: LLMChatRequestParams) => string;
    render?: (response: Response) => Promise<ImageResult>;
}

export interface ImageResult extends UnionData {
    type: 'image';
    message?: string;
    caption?: string;
}

export type AudioAgentRequest = (audio: Blob, context: AgentUserConfig) => Promise<UnionData>;

export interface AudioAgent {
    name: string | string[];
    modelKey: string;
    enable: (context: AgentUserConfig) => boolean;
    request: AudioAgentRequest;
    model: (ctx: AgentUserConfig) => string;
}

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
