import { streamHandler } from '../../agent/request';
import { log } from '../../log/logger';
import { AsyncIter } from './readable';

const perplexityExtractor = {
    contentExtractor: (data: any): string => {
        if (data.chunks && data.chunks.length > 0) {
            const chunk = data.chunks.at(-1) || '';
            return chunk;
        }
        return '';
    },
    fullContentExtractor: (data: any): string => {
        return `${data?.answer || ''}\n\n${perplexityExtractor.finalAdd(data)}`;
    },
    finalAdd: (data: any): string => {
        if (data.web_results && data.web_results.length > 0) {
            return `${data.web_results.map((r: Record<string, string>, i: number) => `${i + 1}. [${r.name}](${r.url})`).join('\n')}`;
        }
        return '';
    },
};

function perplexityFormatter(message: any[]): { done: boolean; content: any } {
    const [event, data] = message;
    switch (event) {
        case 'query_progress':
            if (data.text) {
                return {
                    done: data.final,
                    content: JSON.parse(data.text),
                };
            }
            return {
                done: false,
                content: '',
            };
        case 'error':
            return {
                done: true,
                content: '[ERROR] Occur error',
            };
        case 'disconnect':
        default:
            return {
                done: true,
                content: '',
            };
    }
}

export async function WssRequest(url: string, protocols: string | string[] | null, options: Record<string, any>, messages: string[], handlers: Record<string, any>): Promise<any> {
    const { WebSocket } = await import('ws');
    let { extractor, formatter, onStream } = handlers;
    return new Promise((resolve) => {
        const ws = protocols ? new WebSocket(url, protocols, options) : new WebSocket(url, options);
        let result: any = {};
        let streamSender: Promise<string>;

        extractor = extractor || perplexityExtractor;
        formatter = formatter || perplexityFormatter;
        let streamIter: AsyncIter<any> | null = null;
        if (onStream) {
            streamIter = new AsyncIter();
            streamSender = streamHandler(streamIter as unknown as AsyncIterable<any>, extractor, onStream);
        }

        ws.on('open', () => {
            log.info('wss connected.');
        });

        ws.on('message', async (data) => {
            const message = data.toString('utf-8');
            if (message.startsWith('0')) {
                const handshake = JSON.parse(message.substring(1));
                log.info('Handshake received:', handshake);
                // send connection confirm message
                ws.send('40');
                // send custom event message
                for (const message of messages) {
                    ws.send(message);
                }
            } else if (message.startsWith('42')) {
                const parsedMsg = JSON.parse(message.substring(2));
                const extracted = perplexityFormatter(parsedMsg);
                // log.info('Received data:', parsedMsg);
                if (streamIter && !streamIter.isDone) {
                    streamIter.add(extracted);
                    // log.info('added:\n', extracted);
                }
                if (extracted.done) {
                    log.info('Stream done.');
                    result = extracted.content;
                    ws.close();
                }
            } else if (message.startsWith('3')) {
                // handle heartbeat message
                log.info('Heartbeat received');
            } else {
                log.info('Received non-data message:', message);
            }
        });

        ws.on('close', async () => {
            log.info('wss closed.');
            closeWss(resolve, result, streamIter, streamSender, extractor);
        });

        ws.on('error', async (e) => {
            console.error(e.message);
            if (streamIter) {
                streamIter.return();
            }
            result.message = `Error: ${e.message}`;
        });
    });
}

async function closeWss(resolve: any, result: any, streamIter: AsyncIter<any> | null, streamSender: Promise<string> | null, extractor: any) {
    let data = '';
    if (streamIter) {
        data = (await streamSender) || '';
        data += `\n\n${extractor.finalAdd(result)}`;
        data += result.message ? `\n${result.message}` : '';
    } else {
        data = `${extractor.fullContentExtractor(result)}\n${result.message || ''}`;
    }

    log.info('Result:', data.trim());
    resolve(data.trim());
}
