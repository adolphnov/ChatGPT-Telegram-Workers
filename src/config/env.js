import '../types/i18n.js';
import '../types/context.js';
import PROMPT from "../prompt/prompt.js";;

/**
 * @class
 * @implements {UserConfigType}
 */
export class UserConfig {
  // -- 非配置属性 --
  DEFINE_KEYS = [];

  // -- 通用配置 --
  //
  // AI提供商: auto, openai, azure, workers, gemini, mistral
  AI_PROVIDER = 'auto';
  // AI图片提供商: auto, openai, azure, workers
  AI_IMAGE_PROVIDER = 'auto';
  // 全局默认初始化消息
  SYSTEM_INIT_MESSAGE = null;
  // 全局默认初始化消息角色
  SYSTEM_INIT_MESSAGE_ROLE = 'system';

  // -- Open AI 配置 --
  //
  // OpenAI API Key
  OPENAI_API_KEY = [];
  // OpenAI的模型名称
  OPENAI_CHAT_MODEL = 'gpt-4o-mini';
  // OpenAI API BASE ``
  OPENAI_API_BASE = 'https://api.openai.com/v1';
  // OpenAI API Extra Params
  OPENAI_API_EXTRA_PARAMS = {};

  // -- DALLE 配置 --
  //
  // DALL-E的模型名称
  OPENAI_IMAGE_MODEL = 'dall-e-3';
  // DALL-E图片尺寸
  DALL_E_IMAGE_SIZE = '1024x1024';
  // DALL-E图片质量
  DALL_E_IMAGE_QUALITY = 'standard';
  // DALL-E图片风格
  DALL_E_IMAGE_STYLE = 'vivid';

  // -- AZURE 配置 --
  //
  // Azure API Key
  AZURE_API_KEY = null;
  // Azure Completions API
    // https://RESOURCE_NAME.openai.azure.com/openai/deployments/MODEL_NAME/chat/completions?api-version=VERSION_NAME
  AZURE_PROXY_URL = null;
  // Azure DallE API
    // https://RESOURCE_NAME.openai.azure.com/openai/deployments/MODEL_NAME/images/generations?api-version=VERSION_NAME
  AZURE_DALLE_API = null;

  // -- Workers 配置 --
  //
  // Cloudflare Account ID
  CLOUDFLARE_ACCOUNT_ID = null;
  // Cloudflare Token
  CLOUDFLARE_TOKEN = null;
  // Text Generation Model
  WORKERS_CHAT_MODEL = '@cf/mistral/mistral-7b-instruct-v0.1 ';
  // Text-to-Image Model
  WORKERS_IMAGE_MODEL = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

  // -- Gemini 配置 --
  //
  // Google Gemini API Key
  GOOGLE_API_KEY = null;
  // Google Gemini API
  GOOGLE_COMPLETIONS_API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // Google Gemini Model
  GOOGLE_CHAT_MODEL = 'gemini-pro';

  // -- Mistral 配置 --
  //
  // mistral api key
  MISTRAL_API_KEY = null;
  // mistral api base
  MISTRAL_API_BASE = 'https://api.mistral.ai/v1';
  // mistral api model
  MISTRAL_CHAT_MODEL = 'mistral-tiny';

  // -- Cohere 配置 --
  //
  // cohere api key
  COHERE_API_KEY = null;
  // cohere api base
  COHERE_API_BASE = 'https://api.cohere.com/v1';
  // cohere api model
  COHERE_CHAT_MODEL = 'command-r-plus';

  // -- Anthropic 配置 --
  //
  // Anthropic api key
  ANTHROPIC_API_KEY = null;
  // Anthropic api base
  ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
  // Anthropic api model
  ANTHROPIC_CHAT_MODEL = 'claude-3-haiku-20240307';

  // -- EXTRA 配置 --
  //
  // OpenAI Speech to text额外参数
  OPENAI_STT_EXTRA_PARAMS = {};
  // 语音识别模型
  OPENAI_STT_MODEL = 'whisper-1';
  // 文字生成语音模型
  OPENAI_TTS_MODEL = 'tts-1';
  // 图像识别模型
  OPENAI_VISION_MODEL = 'gpt-4o';
  // cohere extra Params
  COHERE_API_EXTRA_PARAMS = {};
  // 提供商来源 {"foo": { PROXY_URL: "https://xxxxxx", API_KEY: "xxxxxx" }}
  PROVIDER_SOURCES = {};
  MODES = {
    // process_type: 默认为'消息类型:text' ; 消息类型分为: text audio image
    // privider: 默认为default
    // AI_PROVIDER: 默认为openai, 与AI对话时使用openai风格接口
    // prompt: default
    // model: 不同类型下的默认值
      // text:text, CHAT_MODEL
      // audio:text, OPENAI_STT_MODEL
      // image:text, OPENAI_VISION_MODEL
      // text:image, OPENAI_IMAGE_MODEL
      // text:audio, TODO
    default: {
      text: [{}],
      audio: [
        // 后若出现模型能直接audio:text对话 则可加上指定模型, 去掉流程中的text:text
        {},
        { process_type: 'text:text' },
      ],
      image: [{}],
    },
    'dall-e': {
      text: [{prompt: 'dall-e'}, { process_type: 'text:image'}],
    },
  };
  CURRENT_MODE = 'default';
}


class Environment {

    // -- 版本数据 --
    //
    // 当前版本
    BUILD_TIMESTAMP = process?.env?.BUILD_TIMESTAMP || 0;
    // 当前版本 commit id
    BUILD_VERSION = process?.env?.BUILD_VERSION || '';


    // -- 基础配置 --
    /**
     * @type {I18n | null}
     */
    I18N = null;
    // 多语言支持
    LANGUAGE = 'zh-cn';
    // 检查更新的分支
    UPDATE_BRANCH = 'dev';
    // Chat Complete API Timeout
    CHAT_COMPLETE_API_TIMEOUT = 0;

    // -- Telegram 相关 --
    //
    // Telegram API Domain
    TELEGRAM_API_DOMAIN = 'https://api.telegram.org';
    // 允许访问的Telegram Token， 设置时以逗号分隔
    TELEGRAM_AVAILABLE_TOKENS = [];
    // 默认消息模式
    DEFAULT_PARSE_MODE = 'MarkdownV2';

    // --  权限相关 --
    //
    // 允许所有人使用
    I_AM_A_GENEROUS_PERSON = false;
    // 白名单
    CHAT_WHITE_LIST = [];
    // 用户配置
    LOCK_USER_CONFIG_KEYS = [
        // 默认为API BASE 防止被替换导致token 泄露
        'OPENAI_API_BASE',
        'GOOGLE_COMPLETIONS_API',
        'MISTRAL_API_BASE',
        'COHERE_API_BASE',
        'ANTHROPIC_API_BASE',
        'AZURE_PROXY_URL',
        'AZURE_DALLE_API',
    ];

    // -- 群组相关 --
    //
    // 允许访问的Telegram Token 对应的Bot Name， 设置时以逗号分隔
    TELEGRAM_BOT_NAME = [];
    // 群组白名单
    CHAT_GROUP_WHITE_LIST = [];
    // 群组机器人开关
    GROUP_CHAT_BOT_ENABLE = true;
    // 群组机器人共享模式,关闭后，一个群组只有一个会话和配置。开启的话群组的每个人都有自己的会话上下文
    GROUP_CHAT_BOT_SHARE_MODE = false;

    // -- 历史记录相关 --
    //
    // 为了避免4096字符限制，将消息删减
    AUTO_TRIM_HISTORY = true;
    // 最大历史记录长度
    MAX_HISTORY_LENGTH = 8;
    // 最大消息长度
    MAX_TOKEN_LENGTH = 2048;


    // -- 特性开关 --
    //
    // 隐藏部分命令按钮
    HIDE_COMMAND_BUTTONS = [];
    // 显示快捷回复按钮
    SHOW_REPLY_BUTTON = false;
    // 额外引用消息开关
    EXTRA_MESSAGE_CONTEXT = false;

    // -- 模式开关 --
    //
    // 使用流模式
    STREAM_MODE = true;
    // 安全模式
    SAFE_MODE = true;
    // 调试模式
    DEBUG_MODE = false;
    // 开发模式
    DEV_MODE = false;

    USER_CONFIG = new UserConfig();

    // -- EXTRA 配置 --
    //
    // cohere connector 触发条件; example: {"web-search":["^search","搜一下"]};
    COHERE_CONNECT_TRIGGER = {};
    // 
    // 是否读取文件类型消息(当前支持图片与音频)
    ENABLE_FILE = false;
    // 是否下载图片，不开始时将以链接形式发送图片（链接包含bot token信息）
    LOAD_IMAGE_FILE = true;
    // 群聊中回复对象默认为触发对象，开启时优先为被回复的对象
    ENABLE_REPLY_TO_MENTION = false;
    // 忽略指定文本开头的消息
    IGNORE_TEXT = '';
    // 消息中是否显示模型、时间额外信息
    ENABLE_SHOWINFO = false;
    // 消息中是否显示token信息(如果有)
    ENABLE_SHOWTOKENINFO = false;
    // 多流程时, 是否隐藏中间步骤信息
    HIDE_MIDDLE_MESSAGE = false;
    // 群聊中, 指定文本触发对话, 键为触发文本, 值为替换的文本
    CHAT_MESSAGE_TRIGGER = {};
    // CHAT_MESSAGE_TRIGGER = { ':n': '/new', ':g3': '/gpt3', ':g4': '/gpt4'}

    // 提示词 修改SYSTEM_INIT_MESSAGE时使用 使用 /set 指令快速切换
    // 可配合CHAT_MESSAGE_TRIGGER: 'role:':'/setenv SYSTEM_INIT_MESSAGE=~role'
    // 快速修改变量:'model:':'/setenv OPENAI_CHAT_MODEL='  'pro:':'/setenv AI_PROVIDER='
    PROMPT = PROMPT;
    // /set 指令映射变量 | 分隔多个关系，:分隔映射
    MAPPING_KEY = '-p:SYSTEM_INIT_MESSAGE|-n:MAX_HISTORY_LENGTH|-a:AI_PROVIDER|-ai:AI_IMAGE_PROVIDER|-m:CHAT_MODEL|-v:OPENAI_VISION_MODEL|-t :OPENAI_TTS_MODEL';
    // /set 指令映射值  | 分隔多个关系，:分隔映射
    MAPPING_VALUE = "";
    // MAPPING_VALUE = "c35son:claude-3-5-sonnet-20240620|haiku:claude-3-haiku-20240307|g4m:gpt-4o-mini|g4:gpt-4o|rp+:command-r-plus";
}

export const ENV_KEY_MAPPER = {
    CHAT_MODEL: 'OPENAI_CHAT_MODEL',
    API_KEY: 'OPENAI_API_KEY',
    WORKERS_AI_MODEL: 'WORKERS_CHAT_MODEL',
};


// Environment Variables: Separate configuration values from a Worker script with Environment Variables.
export const ENV = new Environment();
// KV Namespace Bindings: Bind an instance of a KV Namespace to access its data in a Worker
export let DATABASE = null;
// Service Bindings: Bind to another Worker to invoke it directly from your code.
export let API_GUARD = null;

export const CUSTOM_COMMAND = {};
export const CUSTOM_COMMAND_DESCRIPTION = {};

export const CONST = {
    PASSWORD_KEY: 'chat_history_password',
    GROUP_TYPES: ['group', 'supergroup'],
};

const ENV_TYPES = {
    SYSTEM_INIT_MESSAGE: 'string',
    AZURE_API_KEY: 'string',
    AZURE_PROXY_URL: 'string',
    AZURE_DALLE_API: 'string',
    CLOUDFLARE_ACCOUNT_ID: 'string',
    CLOUDFLARE_TOKEN: 'string',
    GOOGLE_API_KEY: 'string',
    MISTRAL_API_KEY: 'string',
    COHERE_API_KEY: 'string',
    ANTHROPIC_API_KEY: 'string',
};

function parseArray(raw) {
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.error(e);
        }
    }
    return raw.split(',');
}

export function mergeEnvironment(target, source) {
    const sourceKeys = new Set(Object.keys(source));
    for (const key of Object.keys(target)) {
        // 不存在的key直接跳过
        if (!sourceKeys.has(key)) {
            continue;
        }
        const t = ENV_TYPES[key] || typeof target[key];
        // 不是字符串直接赋值
        if (typeof source[key] !== 'string') {
            target[key] = source[key];
            continue;
        }
        switch (t) {
            case 'number':
                target[key] = parseInt(source[key], 10);
                break;
            case 'boolean':
                target[key] = (source[key] || 'false') === 'true';
                break;
            case 'string':
                target[key] = source[key];
                break;
            case 'array':
                target[key] = parseArray(source[key]);
                break;
            case 'object':
                if (Array.isArray(target[key])) {
                    target[key] = parseArray(source[key]);
                } else {
                    try {
                        target[key] = { ...target[key], ...JSON.parse(source[key]) };
                    } catch (e) {
                        console.error(e);
                    }
                }
                break;
            default:
                target[key] = source[key];
                break;
        }
    }
}


/**
 * @param {object} env
 * @param {I18nGenerator} i18n
 */
export function initEnv(env, i18n) {

    // 全局对象
    DATABASE = env.DATABASE;
    API_GUARD = env.API_GUARD;

    // 绑定自定义命令
    const customCommandPrefix = 'CUSTOM_COMMAND_';
    const customCommandDescriptionPrefix = 'COMMAND_DESCRIPTION_';
    for (const key of Object.keys(env)) {
        if (key.startsWith(customCommandPrefix)) {
            const cmd = key.substring(customCommandPrefix.length);
            CUSTOM_COMMAND['/' + cmd] = env[key];
            CUSTOM_COMMAND_DESCRIPTION['/' + cmd] = env[customCommandDescriptionPrefix + cmd];
        }
    }

    // 合并环境变量
    mergeEnvironment(ENV, env);
    mergeEnvironment(ENV.USER_CONFIG, env);
    ENV.USER_CONFIG.DEFINE_KEYS = [];

    // 兼容旧版配置
    {
        ENV.I18N = i18n((ENV.LANGUAGE || 'cn').toLowerCase());

        // 兼容旧版 TELEGRAM_TOKEN
        if (env.TELEGRAM_TOKEN && !ENV.TELEGRAM_AVAILABLE_TOKENS.includes(env.TELEGRAM_TOKEN)) {
            if (env.BOT_NAME && ENV.TELEGRAM_AVAILABLE_TOKENS.length === ENV.TELEGRAM_BOT_NAME.length) {
                ENV.TELEGRAM_BOT_NAME.push(env.BOT_NAME);
            }
            ENV.TELEGRAM_AVAILABLE_TOKENS.push(env.TELEGRAM_TOKEN);
        }

        // 兼容旧版 OPENAI_API_DOMAIN
        if (env.OPENAI_API_DOMAIN && !ENV.OPENAI_API_BASE) {
            ENV.USER_CONFIG.OPENAI_API_BASE = `${env.OPENAI_API_DOMAIN}/v1`;
        }

        // 兼容旧版 WORKERS_AI_MODEL
        if (env.WORKERS_AI_MODEL && !ENV.USER_CONFIG.WORKERS_CHAT_MODEL) {
            ENV.USER_CONFIG.WORKERS_CHAT_MODEL = env.WORKERS_AI_MODEL;
        }

        // 兼容旧版API_KEY
        if (env.API_KEY && ENV.USER_CONFIG.OPENAI_API_KEY.length === 0) {
            ENV.USER_CONFIG.OPENAI_API_KEY = env.API_KEY.split(',');
        }

        // 兼容旧版CHAT_MODEL
        if (env.CHAT_MODEL && !ENV.USER_CONFIG.OPENAI_CHAT_MODEL) {
            ENV.USER_CONFIG.OPENAI_CHAT_MODEL = env.CHAT_MODEL;
        }

        // 选择对应语言的SYSTEM_INIT_MESSAGE
        if (!ENV.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
            ENV.USER_CONFIG.SYSTEM_INIT_MESSAGE = ENV.I18N?.env?.system_init_message || 'You are a helpful assistant';
        }
    }
}