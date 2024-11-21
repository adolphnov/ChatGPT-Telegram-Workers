import type { AgentUserConfig } from '../../config/env';

export class JinaClassifier {
    readonly model = 'jina-embeddings-v3';
    readonly api = 'https://api.jina.ai/v1/classify';

    readonly request = async (context: AgentUserConfig, data: string[], labels: string[]) => {
        const body = {
            model: this.model,
            input: data,
            labels,
        };
        return fetch(this.api, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${context.JINA_API_KEY}`,
            },
            body: JSON.stringify(body),
        }).then(res => res.json()).then(res => res.data.map((item: any) => ({ label: item.prediction, value: data[item.index] })));
    };
}
