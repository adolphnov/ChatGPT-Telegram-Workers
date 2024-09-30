/* eslint-disable object-shorthand */
/* eslint-disable prefer-template */
/* eslint-disable style/no-multiple-empty-lines */
/* eslint-disable antfu/curly */
/* eslint-disable style/eol-last */
/* eslint-disable style/no-trailing-spaces */
/* eslint-disable style/indent */
import { DATABASE, ENV } from '../config/env.js';
import { sendMessageToTelegramWithContext } from "../telegram/telegram.js";
import { loadAudioLLM } from '../agent/agents.js';
import { handleFile } from "../config/middle.js";

/**
 * @returns {(function(string): number)}
 */
function tokensCounter() {
  return (text) => {
    return text.length;
  };
}

/**
 * 加载历史TG消息
 * @param {string} key
 * @returns {Promise<HistoryItem[]>}
 */
async function loadHistory(key, MAX_HISTORY_LENGTH = ENV.MAX_HISTORY_LENGTH) {
  // 加载历史记录
  let history = [];
  try {
    history = JSON.parse((await DATABASE.get(key)) || '[]');
  } catch (e) {
    console.error(e);
  }
  if (!history || !Array.isArray(history)) {
    history = [];
  }

  const counter = tokensCounter();

  const trimHistory = (list, initLength, maxLength, maxToken) => {
    // 历史记录超出长度需要裁剪, 小于0不裁剪
    if (maxLength >= 0 && list.length > maxLength) {
      list = list.splice(list.length - maxLength);
    }
    // 处理token长度问题, 小于0不裁剪
    if (maxToken > 0) {
      let tokenLength = initLength;
      for (let i = list.length - 1; i >= 0; i--) {
        const historyItem = list[i];
        let length = 0;
        if (historyItem.content) {
          length = counter(historyItem.content);
        } else {
          historyItem.content = '';
        }
        // 如果最大长度超过maxToken,裁剪history
        tokenLength += length;
        if (tokenLength > maxToken) {
          list = list.splice(i + 1);
          break;
        }
      }
    }
    return list;
  };

  // 裁剪
  if (ENV.AUTO_TRIM_HISTORY && MAX_HISTORY_LENGTH > 0) {
    history = trimHistory(history, 0, MAX_HISTORY_LENGTH, ENV.MAX_TOKEN_LENGTH);
  }

  return history;
}

/**
 * @typedef {function (string): Promise<any>} StreamResultHandler
 */

/**
 * @param {LlmRequestParams} params
 * @param {ContextType} context
 * @param {ChatAgentRequest} llm
 * @param {LlmModifier} modifier
 * @param {StreamResultHandler} onStream
 * @returns {Promise<string>}
 */
export async function requestCompletionsFromLLM(params, context, llm, modifier, onStream) {
  if (context._info.steps.length === 0) {
    context._info.initStep();
    params.index = 0;
  }

  const step = context._info?.steps[params.index];
  const historyDisable = ENV.AUTO_TRIM_HISTORY && step.history <= 0;
  const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
  const readStartTime = performance.now();
  let history = [];
  if (!params?.images && step.history > 0) {
    history = await loadHistory(historyKey, step.history);
  }
  const readTime = ((performance.now() - readStartTime) / 1000).toFixed(2);
  console.log(`readHistoryTime: ${readTime}s`);
  if (modifier) {
    const modifierData = modifier(history, params?.message);
    history = modifierData.history;
    params.message = modifierData.message;
  }
  const llmParams = {
    ...params,
    history: history,
    prompt: step.prompt,
  };
  let answer = await llm(llmParams, context, onStream);
  if (params.images) {
    params.message = '[A IMAGE] ' + params.message;
  }

  if (typeof answer === 'object') {
    params.message = answer.q;
    answer = answer.a;
  }

  if (!historyDisable && answer) {
    history.push({ role: 'user', content: params.message || '' });
    history.push({ role: 'assistant', content: answer });
    await DATABASE.put(historyKey, JSON.stringify(history)).catch(console.error);
  }
  return answer;
}




/**
 * @description: 
 * @param {*} context
 * @param {*} params
 * @return {*}
 */
export async function chatViaFileWithLLM(context, params) {
    try {
      const { raw, file_name } = await handleFile(params.files);
      const llm = loadAudioLLM(context)?.request;
      if (llm === null) {
        return sendMessageToTelegramWithContext(context)(`LLM is not enable`);
      }
      const startTime = performance.now();
      context._info.steps[params.index].updateStartTime();
      const answer = await llm(raw, file_name, context);
      if (!answer.ok) {
        console.error(answer.message);
        return sendMessageToTelegramWithContext(context)('Chat via file failed.', 'tip');
      }
      console.log(`[FILE DONE] ${llm.name}: ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
  
      const file_result = { type: answer.type };
      if (answer.type === 'text') {
        file_result.text = answer.content;
        if (context._info.chains.length === context._info.step || !ENV.HIDE_MIDDLE_MESSAGE) {
          await sendMessageToTelegramWithContext(context)(answer.content);
        }
      } else if (typeof answer.content === 'string') {
        file_result.url = [answer.content];
      } else file_result.raw = [answer.content];
  
      return file_result;
    } catch (e) {
      context.CURRENT_CHAT_CONTEXT.disable_web_page_preview = true;
      return sendMessageToTelegramWithContext(context)(e.message.substring(2048), 'tip');
    }
  }