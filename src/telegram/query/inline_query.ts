import type { ModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContext } from '../../config/context';
import type { MessageSender } from '../utils/send';
import type { ChosenInlineQueryHandler, InlineQueryHandler } from './types';
import { loadChatLLM } from '../../agent';
import { injectSystemMessage } from '../../agent/chat';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { createTelegramBotAPI } from '../api';
import { SetCommandHandler } from '../command/system';
import { catchError } from '../handler';
import { OnStreamHander } from '../handler/chat';
import { substituteMessage } from '../handler/msg_trimer';
import { ChosenInlineSender } from '../utils/send';
import { ChosenInlineWorkerContext, InlineQueryContext } from './context';

interface AnswerInlineQueryType {
    type: string;
    handler: (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext) => Promise<Response>;
    handlerQuestion: (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext, sender: MessageSender) => Promise<string>;
}

export class AnswerChatInlineQuery implements AnswerInlineQueryType {
    type = ':c';
    handler = async (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext): Promise<Response> => {
        const sender = ChosenInlineSender.from(context.botToken, chosenInline);
        const question = await this.handlerQuestion(chosenInline, context, sender as unknown as MessageSender);
        if (!question) {
            return new Response('ok');
        }
        const agent = loadChatLLM(context.USER_CONFIG);
        if (!agent) {
            throw new Error('Agent not found');
        }
        const isStream = chosenInline.result_id === ':c stream';
        const OnStream = OnStreamHander(sender as unknown as MessageSender, context as unknown as WorkerContext, question);
        const messages = injectSystemMessage([{ role: 'user', content: question }], context.USER_CONFIG.SYSTEM_INIT_MESSAGE);

        try {
            const resp = await agent.request({
                messages: messages as ModelMessage[],
            }, context.USER_CONFIG, isStream ? OnStream : null);
            const { content: answer } = resp;
            if (answer === '') {
                return OnStream.end?.('Response is empty');
            }
            return OnStream.end?.(answer);
        } catch (e) {
            OnStream.clearHeartbeat!();
            const filtered = (e as Error).message.replace(context.botToken, '[REDACTED]');
            return OnStream.sender!.sendRichText(`<pre><code class="language-error">${filtered.substring(0, 2048)}</code></pre>`, 'HTML', 'tip');
        }
    };

    handlerQuestion = async (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext, sender: MessageSender): Promise<string> => {
        const question = chosenInline.query.substring(0, chosenInline.query.length - 1).trim();
        // simulate message and substitute words
        const message = { text: question } as unknown as Telegram.Message;
        substituteMessage(message, context.USER_CONFIG.MESSAGE_REPLACER);
        if (message.text?.startsWith('/set ')) {
            const resp = await new SetCommandHandler().handle(message, message.text.substring(5).trim(), context as unknown as WorkerContext, sender);
            if (resp instanceof Response) {
                return '';
            }
        }

        return message.text || '';
    };
}

class CheckInlineQueryWhiteList implements InlineQueryHandler<InlineQueryContext> {
    handle = async (inlineQuery: Telegram.InlineQuery, context: InlineQueryContext): Promise<Response | null> => {
        if (ENV.CHAT_WHITE_LIST.includes(`${context.from.id}`)) {
            return null;
        }
        log.error(`User ${context.from.username}, id: ${context.from.id} not in the white list`);
        return new Response(`User ${context.from.id} not in the white list`, { status: 403 });
    };
}

export async function handleInlineQuery(token: string, inlineQuery: Telegram.InlineQuery) {
    log.info(`handleInlineQuery`, inlineQuery);
    try {
        const context = new InlineQueryContext(token, inlineQuery);
        const handlers: InlineQueryHandler<InlineQueryContext>[] = [
            new CheckInlineQueryWhiteList(),
            new HandlerInlineQuery(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(inlineQuery, context);
            if (result instanceof Response) {
                return result;
            }
        }
    } catch (error) {
        return catchError(error as Error);
    }
    return null;
}

export async function handleChosenInlineQuery(token: string, chosenInlineQuery: Telegram.ChosenInlineResult) {
    log.info(`handleChosenInlineQueryQuery`, chosenInlineQuery);
    try {
        const context = await ChosenInlineWorkerContext.from(token, chosenInlineQuery);
        const handlers: ChosenInlineQueryHandler<ChosenInlineWorkerContext>[] = [
            new AnswerInlineQuery(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(chosenInlineQuery, context);
            if (result instanceof Response) {
                return result;
            }
        }
    } catch (error) {
        return catchError(error as Error);
    }
    return null;
}

export class HandlerInlineQuery implements InlineQueryHandler<InlineQueryContext> {
    handle = async (chosenInline: Telegram.InlineQuery, context: InlineQueryContext): Promise<Response | null> => {
        const endSuffix = '$';
        if (!chosenInline.query.endsWith(endSuffix)) {
            log.info(`[INLINE QUERY] Not end with $: ${chosenInline.query}`);
            return new Response('success', { status: 200 });
        }
        const api = createTelegramBotAPI(context.token);
        const resp = await api.answerInlineQuery({
            inline_query_id: context.query_id,
            results: [{
                type: 'article',
                id: ':c stream',
                title: 'Stream Mode',
                input_message_content: {
                    message_text: `Please wait a moment`,
                },
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: 'Thinking...',
                            callback_data: ':c stream',
                        }],
                    ],
                },
            }, {
                type: 'article',
                id: ':c full',
                title: 'Full Mode',
                input_message_content: {
                    message_text: `Please wait a moment`,
                },
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: 'Thinking...',
                            callback_data: ':c full',
                        }],
                    ],
                },
            }],
        }).then(r => r.json());
        log.info(`[INLINE QUERY] Answer inline query: ${JSON.stringify(resp)}`);
        return new Response('success', { status: 200 });
    };
}

export class AnswerInlineQuery implements ChosenInlineQueryHandler<ChosenInlineWorkerContext> {
    handle = async (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext): Promise<Response | null> => {
        const answer = new AnswerChatInlineQuery();
        return answer.handler(chosenInline, context);
    };
}

// class AnswerImageInlineQuery implements answerInlineQuery {
//     type = ':i';
//     handler = async (context: InlineQueryContext, query: string): Promise<Response> => {
//         return new Response('ok');
//     };
// }

// class AnswerSpeechInlineQuery implements answerInlineQuery {
//     type = ':s';
//     handler = async (context: InlineQueryContext, query: string): Promise<Response> => {
//         return new Response('ok');
//     };
// }
