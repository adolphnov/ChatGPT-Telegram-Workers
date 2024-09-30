import { requestChatCompletions } from './request.js';
import { ENV } from '../config/env.js';
import { sendMessageToTelegramWithContext } from '../telegram/telegram.js';
import tools_settings from '../prompt/tools.js';

/**
 * 处理tool
 *
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
export async function handleOpenaiFunctionCall(params, context, onStream) {
  let call_times = 0;
  const func_results = [];
  const step = context._info.steps[params.index];
  try {
    const tools = step.tool;
    const { tools_name, tools_struct } = filterValidTools(tools) || {};
    if (tools_name) {
      const payload = renderCallPayload(params, tools_struct, context, onStream);
      const opt = {};
      const exposure_vars = ['JINA_API_KEY'];
      exposure_vars.forEach((i) => (opt[i] = context.USER_CONFIG[i]));
      const stopLoopType = ['web_crawler'];

      let chatPromise = Promise.resolve();
      while (call_times < ENV.FUNC_LOOP_TIMES && payload.body.tools?.length > 0) {
        const start_time = Date.now();
        call_times += 1;
        const llm_content = await functionCallWithLLM(context, payload, tools_name);

        if (!Array.isArray(llm_content)) {
          return { call_times, llm_content, func_results };
        }
        step.setCallInfo(((Date.now() - start_time) / 1000).toFixed(1) + 's', 'c_t');
        setTimeout(() => {
          chatPromise = sendMessageToTelegramWithContext(context)(`\`call ${llm_content[0].name}\``);
        }, 0);

        const func_result = await functionExec(llm_content, step, opt);
        // 取第一个函数的类型
        const func_type = ENV.TOOLS[llm_content[0].name].type;
        func_results.push({ type: func_type, content: func_result });
        trimPayload(payload, func_results, func_type);
        if (stopLoopType.includes(func_type)) break;
      }
      await chatPromise;
    }

    return { call_times, func_results };
    
  } catch (e) {
    console.error(e.message);
    let errorMsg = e.message;
    if (e.name === 'AbortError') {
      errorMsg = 'call timeout';
    }
    step.setCallInfo(`⚠️${errorMsg.slice(0,50)}`);
    return { call_times, message: e.message, func_results };
  }
}

/**
 * @description: 构造初次与llm的payload
 * @param {object} params
 * @param {object} tools_structs
 * @param {ContextType} context
 * @param {Function} onStream
 * @return {object}
 */
function renderCallPayload(params, tools_structs, context, onStream) {
  const { url, header, prompt, body } = params;
  let call_url = url;
  if (context.USER_CONFIG.FUNCTION_CALL_BASE) {
    call_url = context.USER_CONFIG.FUNCTION_CALL_BASE + '/chat/completions';
  }

  const call_key = context.USER_CONFIG.FUNCTION_CALL_API_KEY;
  const call_headers = { ...header, ...((call_key && { Authorization: `Bearer ${call_key}` }) || {}) };

  const options = {
    fullContentExtractor: (d) => {
      return d.choices?.[0]?.message;
    },
  };

  const call_body = {
    model: context.USER_CONFIG.FUNCTION_CALL_MODEL,
    tools: tools_structs,
    tool_choice: 'auto',
    ...tools_settings.default.extra_params,
    messages: [...body.messages],
    stream: !!(context.USER_CONFIG.FUNCTION_REPLY_ASAP && onStream),
    ...(context.USER_CONFIG.ENABLE_SHOWTOKEN && { stream_options: { include_usage: true } }),
  };

  let streamHandler = null;
  if (context.USER_CONFIG.FUNCTION_REPLY_ASAP) {
    delete call_body['max_tokens'];
    streamHandler = onStream;
  }
  // 通用prompt
  const tool_prompt = tools_settings.default.prompt;
  if (prompt) call_body.messages.shift(); // 直接丢掉原始prompt避免关联修改
  call_body.messages.unshift({ role: 'system', content: tool_prompt });

  return { url: call_url, header: call_headers, body: call_body, streamHandler, options };
}

/**
 * @description: 修整函数调用完毕后的请求
 * @param {ContextType} context
 * @param {object} body
 * @param {string[]} func_results
 * @param {string} prompt
 * @return {null}
 */
export function renderAfterCallPayload(context, body, func_results, prompt) {
  if (func_results.length ===0) return;
  const last_tool_type = func_results.at(-1).type;
  const tool_prompt = tools_settings[last_tool_type].prompt;

  if (tool_prompt) {
    if (prompt) {
      body.messages[0].content = tool_prompt;
    } else body.messages.unshift({ role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: tool_prompt });
  }

  if (func_results.length > 0) {
    // let message = body.messages.at(-1).content;
    for (const { type, content } of func_results) {
      body.messages.at(-1).content += '\n\n' + tools_settings[type].render(content.join('\n\n'));
    }
    // body.messages.at(-1).content = message;
  }

  for (const [key, value] of Object.entries((tools_settings[last_tool_type]?.extra_params) || {})) {
    body[key] = value;
  }
}


/**
 * @description: 过滤有效tool
 * @param {string[]} tools
 * @return {object}
 */
function filterValidTools(tools) {
  const valid_tools = tools.filter((i) => Object.keys(ENV.TOOLS).includes(i));
  if (valid_tools.length > 0) {
    const tools_struct = valid_tools.map((tool) => {
      return {
        'type': 'function',
        'function': ENV.TOOLS[tool].schema,
        'strict': true,
      };
    });
    return {tools_name: valid_tools, tools_struct};
  }
}


/**
 * @description: 请求llm确认函数
 * @param {ContextType} context
 * @param {object} payload
 * @param {string[]} tools_name
 * @param {Promise<Response>} chatPromise
 * @return {Promise<object>}
 */
async function functionCallWithLLM(context, payload, tools_name) {
  const { url, header, body, streamHandler, options } = payload;

  const llm_resp = await requestChatCompletions(url, header, body, context, streamHandler, null, options);

  if (!llm_resp.tool_calls) {
    return llm_resp.content;
  }

  const valid_calls = llm_resp?.tool_calls?.filter((i) => tools_name.includes(i.function.name));
  if (valid_calls.length === 0) return llm_resp.content;
  // await chatPromise;

  return valid_calls.map((func) => ({
    name: func.function.name,
    args: JSON.parse(func.function.arguments),
  }));
}

/**
 * @description: 执行函数
 * @param {object[]} funcList
 * @param {ContextType} context
 * @param {object} opt
 * @return {Promise<string[]>}
 */
async function functionExec(funcList, step, opt) {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutId = null;
  const INFO_LENGTH_LIMIT = 80;
  if (ENV.FUNC_TIMEOUT > 0) {
    timeoutId = setTimeout(() => controller.abort(), ENV.FUNC_TIMEOUT * 1e3);
  }
  let exec_times = ENV.CON_EXEC_FUN_NUM;
  const funcPromise = [];
  for (const { name, args } of funcList) {
    if (exec_times <= 0) break;
    const args_i = Object.values(args).join();
    step.setCallInfo(`${name}:${args_i.length > INFO_LENGTH_LIMIT ? args_i.slice(0, INFO_LENGTH_LIMIT) : args_i}`, 'f_i');
    console.log('start use function: ', name);
    const params = args;
    if (ENV.TOOLS[name].need) {
      params.keys = opt[ENV.TOOLS[name].need];
    }
    funcPromise.push(ENV.TOOLS[name].func(params, signal));
    exec_times--;
  }

  const func_resp = await raceTimeout(funcPromise);
  if (timeoutId) clearTimeout(timeoutId);
  const func_time = [];
  const content = func_resp.map((r) => {
    func_time.push(r.time || '');
    return r.content || r || '';
  });

  console.log('func call content: ', content.join('\n\n').substring(0, 500));

  if (func_time.join('').trim()) step.setCallInfo(func_time.join(), 'f_t');
  if (!content.join('').trim()) {
    step.setCallInfo(`func call response is none or timeout.`);
    throw new Error('None response in func call.');
  }
  return content;
}


/**
 * @description: 修整下次与llm的对话
 * @param {object} payload
 * @param {string[]} func_results
 * @return {*}
 */
function trimPayload(payload, func_results, func_type) {
  const render = tools_settings[func_type].render;
  const all_content = func_results.map(i => i.content).join('\n\n').trim();
  payload.body.messages.push({
    role: 'user',
    content: render?.(all_content) || all_content,
  });
  // 每种func只调用一次
  payload.body.tools = payload.body.tools.filter((t) => ENV.TOOLS[t.function.name].type !== func_type);
}


/**
 * @description: 收集所有promise数据 跳过超时
 * @param {Promise} promises
 * @param {number} ms
 * @return {Promise<object[]}
 */
async function raceTimeout(promises, ms = ENV.FUNC_TIMEOUT * 1e3) {
  if (ms <= 0) return Promise.all(promises);
  return Promise.all(promises.map((p) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]))).then(
    (results) => results.filter(Boolean),
  );
}