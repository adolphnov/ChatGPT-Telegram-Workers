/* eslint-disable style/no-trailing-spaces */
/* eslint-disable style/indent */
import { CONST, ENV } from '../config/env.js';
import { loadChatLLM } from '../agent/agents.js';
import { requestCompletionsFromLLM } from '../agent/chat.js';
import { deleteMessageFromTelegramWithContext, sendMessageToTelegramWithContext } from './telegram.js';
import { sendTelegraphWithContext } from "./telegraph.js";
import { sendInitMessage } from './message.js';

/**
 * 与LLM聊天
 * @param {LlmRequestParams} params
 * @param {ContextType} context
 * @param {LlmModifier} modifier
 * @returns {Promise<Response>}
 */
export async function chatWithLLM(params, context, modifier) {
    try {
      const llm = loadChatLLM(context)?.request;
      if (llm === null) {
        return sendMessageToTelegramWithContext(context)(`LLM is not enable`);
      }
      if (!context.SHARE_CONTEXT.message_id) {
        await sendInitMessage(context);
      }
  
      const parseMode = context.CURRENT_CHAT_CONTEXT.parse_mode;
      let onStream = null;
      let nextEnableTime = null;
      const sendMessage = sendTextMessageHandler(context, params.index);
      if (ENV.STREAM_MODE) {
        onStream = async (text) => {
          if (ENV.HIDE_MIDDLE_MESSAGE && !context._info.isLastStep) 
return;
          try {
            // 判断是否需要等待
            if (nextEnableTime && nextEnableTime > Date.now()) {
              return;
            }
  
            if (ENV.TELEGRAM_MIN_STREAM_INTERVAL > 0) {
              nextEnableTime = Date.now() + ENV.TELEGRAM_MIN_STREAM_INTERVAL;
            }
  
            let send_content = text;
            if (context._info.is_concurrent) {
              context._info.steps[params.index].concurrent_content = text;
              send_content = context._info.concurrent_content;
            }
  
            const resp = await sendMessage(send_content);
            
            // 判断429
            if (resp.status === 429) {
              // 获取重试时间
              const retryAfter = Number.parseInt(resp.headers.get('Retry-After'));
              if (retryAfter) {
                nextEnableTime = Date.now() + retryAfter * 1000;
                return;
              }
            }
            nextEnableTime = null;
          } catch (e) {
            console.error(e);
          }
        };
      }
  
      if (context._info.is_concurrent && !context._info.concurrent_stream) {
        context._info.concurrent_stream = onStream;
      }
  
      const onStreamSelect = context._info.concurrent_stream || onStream;
  
      console.log(`[START] Chat via ${llm.name}`);
      const answer = await requestCompletionsFromLLM(params, context, llm, modifier, onStreamSelect);
      if (!answer) {
        return sendMessageToTelegramWithContext(context)('None response', 'tip');
      }
  
      context.CURRENT_CHAT_CONTEXT.parse_mode = parseMode;
      if (ENV.SHOW_REPLY_BUTTON && context.CURRENT_CHAT_CONTEXT.message_id) {
        try {
          await deleteMessageFromTelegramWithContext(context)(context.CURRENT_CHAT_CONTEXT.message_id);
          context.CURRENT_CHAT_CONTEXT.message_id = null;
          context.CURRENT_CHAT_CONTEXT.reply_markup = {
            keyboard: [[{ text: '/new' }, { text: '/redo' }]],
            selective: true,
            resize_keyboard: true,
            one_time_keyboard: true,
          };
        } catch (e) {
          console.error(e);
        }
      }
      if (nextEnableTime && nextEnableTime > Date.now()) {
        console.log(`The last message need wait:${((nextEnableTime - Date.now()) / 1000).toFixed(1)}s`);
      }
      if (context._info.chains.length === context._info.step || !ENV.HIDE_MIDDLE_MESSAGE) {
        if (context._info.nextEnableTime) {
          console.log(`Need wait until ${new Date(nextEnableTime).toISOString()}`);
          await new Promise(resolve => setTimeout(resolve, context._info.nextEnableTime - Date.now()));
          context._info.nextEnableTime = null;
        }
        await onStreamSelect(answer);
      }
      console.log(`[DONE] Chat via ${llm.name}`);
      return { type: 'text', text: answer };
    } catch (e) {
      let errMsg = `Error: ${e.message}`;
      console.error(errMsg);
      if (errMsg.length > 2048) {
        // 裁剪错误信息 最长2048
        errMsg = errMsg.substring(0, 2048);
      }
      context.CURRENT_CHAT_CONTEXT.disable_web_page_preview = true;
      return sendMessageToTelegramWithContext(context)(errMsg, 'tip');
    }
  }
  
  /**
   * @description: 发送消息的方式
   * @param {*} context
   * @return {*}
   */
  export function sendTextMessageHandler(context, index) {
      const question = context._info.step?.file.text || 'Redo';
      const prefix = `#Question\n\`\`\`\n${question?.length > 400 ? `${question.slice(0, 200)}...${question.slice(-200)}` : question}\n\`\`\`\n---`;
      const author = {
        short_name: context.SHARE_CONTEXT.currentBotName,
        author_name: context.SHARE_CONTEXT.currentBotName,
        author_url: ENV.TELEGRAPH_AUTHOR_URL,
      };
    const step = context._info.steps[index ?? context._info.index];
      return async (text) => {
        if (
          ENV.TELEGRAPH_NUM_LIMIT > 0
          && text.length > ENV.TELEGRAPH_NUM_LIMIT
          && CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)
        ) {
          const telegraph_prefix = `${prefix}\n#Answer\n🤖 _${step.model}_\n`;
          const debug_info = `debug info:${ENV.CALL_INFO ? '' : `\n${step.call_info.replace('$$f_t$$', '')}\n`}`;
          const telegraph_suffix = `\n---\n\`\`\`\n${debug_info}\n${step.message_title}\n\`\`\``;
          if (!context.SHARE_CONTEXT.telegraphPath) {
            const resp = await sendTelegraphWithContext(context)(
              null,
              telegraph_prefix + text + telegraph_suffix,
              author,
            );
            const url = `https://telegra.ph/${context.SHARE_CONTEXT.telegraphPath}`;
            const msg = `回答已经转换成完整文章~\n[🔗点击进行查看](${url})`;
            const show_info_tag = context.USER_CONFIG.ENABLE_SHOWINFO;
            step.config('show_info', false);
            await sendMessageToTelegramWithContext(context)(msg);
            step.config('show_info', show_info_tag);
            return resp;
          }
          return sendTelegraphWithContext(context)(null, telegraph_prefix + text + telegraph_suffix, author);
        } else {
 return sendMessageToTelegramWithContext(context)(text);
}
      };
  };
