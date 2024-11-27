import type * as Telegram from 'telegram-bot-api-types';
import type { UnionData } from '../utils/utils';

export interface CallbackQueryHandler<Ctx = any> {
    handle: (message: Telegram.Message, context: Ctx) => Promise<Response | UnionData | null>;
}

export interface InlineQueryHandler<Ctx = any> {
    handle: (inlineQuery: Telegram.InlineQuery, context: Ctx) => Promise<Response | UnionData | null>;
}

export interface ChosenInlineQueryHandler<Ctx = any> {
    handle: (chosenInline: Telegram.ChosenInlineResult, context: Ctx) => Promise<Response | UnionData | null>;
}
