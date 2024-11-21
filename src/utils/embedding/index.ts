import type { AgentUserConfig } from '../../config/env';
import { createOpenAI } from '@ai-sdk/openai';
import { cosineSimilarity, embedMany } from 'ai';
import { OpenAIBase } from '../../agent/openai';

export class OpenaiEmbedding extends OpenAIBase {
    readonly request = async (context: AgentUserConfig, data: string[]) => {
        const { embeddings, values } = await embedMany({
            model: createOpenAI({
                baseURL: context.OPENAI_API_BASE,
                apiKey: this.apikey(context),
            }).embedding('text-embedding-3-small'),
            values: data,
            maxRetries: 0,
        });
        return values.map((value, i) => ({ embed: embeddings[i], value }));
    };
}

export class Rerank {
    jina_base_url = 'https://api.jina.ai/v1/rerank';
    rank = (context: any, data: string[], topN: number = 1) => {
        switch (context.RERANK_AGENT) {
            case 'jina':
                return this.jina(context, data, topN);
            case 'openai':
                return this.openai(context, data, topN);
            default:
                throw new Error('Invalid RERANK_AGENT');
        }
    };

    private jina = (context: any, data: string[], topN: number) => {
        return fetch(this.jina_base_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${context.JINA_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'jina-reranker-v1-tiny-en',
                query: data[0],
                documents: data.slice(1),
                top_n: topN,
            }),
        }).then(res => res.json()).then(res => res.results
            .map((item: any) => ({ similar: item.relevance_score, name: item.document.text })));
    };

    private openai = async (context: any, data: string[], topN: number) => {
        const embeddings = await new OpenaiEmbedding().request(context, data);
        const inputEmbeddings = embeddings[0].embed;
        return embeddings.slice(1)
            .map(({ embed, value }) => ({ similar: cosineSimilarity(inputEmbeddings, embed), value }))
            .sort((a, b) => b.similar - a.similar)
            .slice(0, topN)
            .map(i => i.value);
    };
}
