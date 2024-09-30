import "../types/context.js"
import "../types/agent.js";
import {requestChatCompletions} from "./request.js";
import {renderOpenAIMessage} from "./openai.js";

/**
 * @param {ContextType} context
 * @returns {string|null}
 */
function azureKeyFromContext(context) {
    return context.USER_CONFIG.AZURE_API_KEY;
}

/**
 * @param {ContextType} context
 * @returns {boolean}
 */
export function isAzureEnable(context) {
    return !!(context.USER_CONFIG.AZURE_API_KEY && context.USER_CONFIG.AZURE_PROXY_URL);
}

/**
 * @param {ContextType} context
 * @returns {boolean}
 */
export function isAzureImageEnable(context) {
    return !!(context.USER_CONFIG.AZURE_API_KEY && context.USER_CONFIG.AZURE_DALLE_API);
}

/**
 * 发送消息到Azure ChatGPT
 * @param {LlmParams} params
 * @param {ContextType} context
 * @param {AgentTextHandler} onStream
 * @returns {Promise<string>}
 */
export async function requestCompletionsFromAzureOpenAI(params, context, onStream) {
    const {message, images, prompt, history} = params;
    const url = context.USER_CONFIG.AZURE_PROXY_URL;
    const messages = [...(history || []), {role: 'user', content: message, images}];
    if (prompt) {
        messages.unshift({role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: prompt})
    }
    const extra_params = context.USER_CONFIG.OPENAI_API_EXTRA_PARAMS; 

    const body = {
        ...extra_params,
        messages: await Promise.all(messages.map(renderOpenAIMessage)),
        stream: onStream != null,
    };

    return requestChatCompletions(url, header, body, context, onStream);
}

/**
 * 请求AzureOpenai生成图片
 * @param {string} prompt
 * @param {ContextType} context
 * @returns {Promise<string>}
 */
export async function requestImageFromAzureOpenAI(params, context) {
    const url = context.USER_CONFIG.AZURE_DALLE_API;
    const header = {
        'Content-Type': 'application/json',
        'api-key': azureKeyFromContext(context),
    };
    
    const body = {
        prompt,
        n: 1,
        size: context.USER_CONFIG.DALL_E_IMAGE_SIZE,
        style: context.USER_CONFIG.DALL_E_IMAGE_STYLE,
        quality: context.USER_CONFIG.DALL_E_IMAGE_QUALITY,
    };
    const validSize = ['1792x1024', '1024x1024', '1024x1792'];
    if (!validSize.includes(body.size)) {
        body.size = '1024x1024';
    }
    return { url, header, body }; 
}
