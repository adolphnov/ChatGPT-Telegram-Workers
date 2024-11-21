import type { AgentUserConfig } from '../../config/env';
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { OpenAIBase } from '../../agent/openai';

export class OpenaiEmbedding extends OpenAIBase {
    readonly request = async (context: AgentUserConfig, data: string[]) => {
        const { embeddings, values } = await embedMany({
            model: createOpenAI({
                baseURL: context.OPENAI_API_BASE,
                apiKey: this.apikey(context),
            }).embedding(context.OPENAI_EMBEDDING_MODEL),
            values: data,
            maxRetries: 0,
        });
        return values.map((value, i) => ({ embed: embeddings[i], value }));
    };
}

export class JinaEmbedding {
    readonly task: 'retrieval.query' | 'retrieval.passage' | 'separation' | 'classification' | 'text-matching' | undefined;
    readonly model = 'jina-embeddings-v3';

    constructor(task?: 'retrieval.query' | 'retrieval.passage' | 'separation' | 'classification' | 'text-matching') {
        this.task = task;
    }

    readonly request = async (context: AgentUserConfig, data: string[]) => {
        const url = 'https://api.jina.ai/v1/embeddings';
        const body = {
            model: this.model,
            task: this.task,
            dimensions: 1024,
            late_chunking: false,
            embedding_type: 'float',
            input: data,
        };
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${context.JINA_API_KEY}`,
            },
            body: JSON.stringify(body),
        }).then(res => res.json()).then(res => res.data.map((item: any) => ({ embed: item.embedding, value: data[item.index] })));
    };
}
