import '../types/context.js';
import { ENV } from '../config/env.js';
import { Stream } from './stream.js';
import { loadChatLLM, currentChatModel } from "../agent/agents.js";
import { sendChatActionToTelegramWithContext } from "../telegram/telegram.js";

/**
 * @callback StreamBuilder
 * @param {Response} resp
 * @param {AbortController} controller
 * @returns {Stream}
 */
/**
 * @callback SSEContentExtractor
 * @param {object} data
 * @returns {string|null}
 */
/**
 * @callback FullContentExtractor
 * @param {object} data
 * @returns {string|null}
 */
/**
 * @callback ErrorExtractor
 * @param {object} data
 * @returns {string|null}
 */
/**
 * @typedef {object} SseChatCompatibleOptions
 * @property {StreamBuilder} streamBuilder
 * @property {SSEContentExtractor} contentExtractor
 * @property {FullContentExtractor} fullContentExtractor
 * @property {ErrorExtractor} errorExtractor
 */

/**
 * 修复OpenAI兼容的选项
 * @param {SseChatCompatibleOptions | null} options
 * @returns {SseChatCompatibleOptions}
 * @returns {SseChatCompatibleOptions}
 */
function fixOpenAICompatibleOptions(options) {
  options = options || {};
  options.streamBuilder =
    options.streamBuilder ||
    function (r, c) {
      return new Stream(r, c);
    };
  options.contentExtractor =
    options.contentExtractor ||
    function (d) {
      return d?.choices?.[0]?.delta?.content;
    };
  options.functionCallExtractor =
    options.functionCallExtractor ||
    function (d, call_list) {
      const chunck = d?.choices?.[0]?.delta?.tool_calls;
      if (!Array.isArray(chunck)) return;
      for (const a of chunck) {
        if (!Object.hasOwn(a, 'index')) {
          throw new Error(`The function chunck dont have index: ${JSON.stringify(chunck)}`);
        }
        if (a.type && a.type === 'function') {
          call_list[a.index] = a;
        } else {
          const args_chunck = a.function.arguments;
          call_list[a.index].function.arguments += args_chunck;
        }
      }
    };
  options.fullContentExtractor =
    options.fullContentExtractor ||
    function (d) {
      return d.choices?.[0]?.message.content;
    };
  options.errorExtractor =
    options.errorExtractor ||
    function (d) {
      return d.error?.message;
    };
  return options;
}

/**
 * @param {Response} resp
 * @returns {boolean}
 */
export function isJsonResponse(resp) {
  if (!resp.headers?.get('content-type')) {
    return false;
  }
  return resp.headers.get('content-type').includes('json');
}

/**
 * @param {Response} resp
 * @returns {boolean}
 * @returns {boolean}
 */
export function isEventStreamResponse(resp) {
  if (!resp.headers?.get('content-type')) {
    return false;
  }
  const types = ['application/stream+json', 'text/event-stream'];
  const content = resp.headers.get('content-type');
  for (const type of types) {
    if (content.includes(type)) {
      return true;
    }
  }
  return false;
}

/**
 * 发送请求到支持sse的聊天接口
 * @param {string} url
 * @param {object} header
 * @param {object} body
 * @param {ContextType} context
 * @param {AgentTextHandler| null} onStream
 * @param {AgentTextHandler | null} onResult
 * @param {SseChatCompatibleOptions | null} options
 * @returnss {Promise<string>}
 */
export async function requestChatCompletions(url, header, body, context, onStream, onResult = null, options = null) {
  const controller = new AbortController();
  const { signal } = controller;

  let timeoutID = null;
  if (ENV.CHAT_COMPLETE_API_TIMEOUT > 0) {
    timeoutID = setTimeout(() => controller.abort(), ENV.CHAT_COMPLETE_API_TIMEOUT * 1e3);
  }

  let alltimeoutID = null;
  if (ENV.ALL_COMPLETE_API_TIMEOUT > 0) {
    alltimeoutID = setTimeout(() => controller.abort(), ENV.ALL_COMPLETE_API_TIMEOUT * 1e3);
  }

  if (ENV.DEBUG_MODE) {
    console.log(`url:\n${url}\nheader:\n${JSON.stringify(header)}\nbody:\n${JSON.stringify(body, null, 2)}`);
  }
  // 排除 function call耗时
  context._info.step.updateStartTime();
  console.log('chat start.');

  setTimeout(() => sendChatActionToTelegramWithContext(context)('typing').catch(console.error), 0);
  const resp = await fetch(url, {
    method: 'POST',
    headers: header,
    body: JSON.stringify(body),
    signal,
  });

  if (timeoutID) {
    clearTimeout(timeoutID);
  }

  options = fixOpenAICompatibleOptions(options);
  const immediatePromise = Promise.resolve('ok');
  let isNeedToSend = true;

  if (onStream && resp.ok && isEventStreamResponse(resp)) {
    const stream = options.streamBuilder(resp, controller);
    let contentFull = '';
    const tool_calls = [];
    let lengthDelta = 0;
    let updateStep = 20;
    let msgPromise = null;
    let lastChunk = null;
    let usage = null;
    try {
      for await (const data of stream) {
        const c = options.contentExtractor(data) || '';
        usage = data?.usage;
        if (body.tools?.length > 0) options?.functionCallExtractor(data, tool_calls);
        if (c === '' && tool_calls.length === 0) continue;
        lengthDelta += c.length;
        if (lastChunk) contentFull = contentFull + lastChunk;
        if (tool_calls.length > 0) {
          if (isNeedToSend) {
            msgPromise = onStream(`\`Starting call...\``);
            isNeedToSend = false;
          }
          lastChunk = c;
          continue;
        }
        if (lastChunk && lengthDelta > updateStep) {
          lengthDelta = 0;
          updateStep += 25;
          if (!msgPromise || (await Promise.race([msgPromise, immediatePromise]) !== 'ok')) {
            msgPromise = onStream(`${contentFull}●`);
          }
        }
        lastChunk = c;
      }
      contentFull += lastChunk;
    } catch (e) {
      contentFull += `\nERROR: ${e.message}`;
    }
    if (usage) {
      context._info.step.setToken(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
    }

    await msgPromise;

    if (alltimeoutID) {
      clearTimeout(alltimeoutID);
    }
    if (body.tools?.length > 0){
      return {
        tool_calls: tool_calls,
        content: contentFull,
      };
    } else return contentFull;
  }

  if (alltimeoutID) {
    clearTimeout(alltimeoutID);
  }

  if (ENV.DEBUG_MODE) {
    const r = await resp.clone().text();
    console.log("resp result: ", r);
  }

  if (!isJsonResponse(resp)) {
    throw new Error(resp.statusText);
  }

  const result = await resp.json();

  if (!result) {
    throw new Error('Empty response');
  }

  if (options.errorExtractor(result)) {
    throw new Error(options.errorExtractor(result));
  }

  try {
    if (result.usage) {
      context._info.step.setToken(result.usage.prompt_tokens ?? 0, result.usage.completion_tokens ?? 0);
    }
    // return result;
    return options.fullContentExtractor(result);
  } catch (e) {
    console.error(e);
    throw new Error(JSON.stringify(result));
  }
}
