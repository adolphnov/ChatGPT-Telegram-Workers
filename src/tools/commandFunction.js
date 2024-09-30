/**
 * @description: 
 * @param {*} DATABASE
 * @param {*} key
 * @param {*} fileType
 * @return {*}
 */
async function readMessage(DATABASE, key, fileType = 'text') {
  const data = JSON.parse((await DATABASE.get(key)) || '[]').filter((i) => i.type === fileType);
  return {
    text: data.map(({ text }) => text || '').join('\n\n'),
    id: data.map(({ id }) => id || []).flat(),
    type: fileType,
  };
}

/**
 * @description: 
 * @param {*} params
 * @param {*} userConfig
 * @return {*}
 */
function changeUserConfig(params, userConfig) {
  for (const [key, value] of Object.entries(params)) {
    if (userConfig.ALLOW_MODIFY_KEYS.includes(key)) {
      userConfig[key] = value;
    }
  }
}

const llmControl = {
  'read_history_to_chat_with_llm': {
    'name': 'read_history_to_chat_with_llm',
    'strict': true,
    'description':
      'Based on the user\'s input, generate parameters for the historical records to be read, including quantity and type, and create a question for dialogue with llm based on the user\'s input. For example when a user inputs: "Interpret the two images I just sent,". The limit is 2. The type is "image". And extracts the question: "Interpret these two images."',
    'parameters': {
      'type': 'object',
      'properties': {
        'limit': {
          'type': 'number',
          'description':
            'Number of historical records to be read',
        },
        'type': {
          'type': 'string',
          'enum': ['text', 'image'], // 读取文本与图片
          'description': 'Type of historical records to be read'
        },
        'question': {
          'type': 'string',
          'description':
            'The question posed to the large model',
        }
      },
      'required': ['limit', 'type', 'question'],
      'additionalProperties': false,
    },
  },
  'change_user_config_to_chat_with_llm': {
    'name': 'change_user_config',
    'strict': true,
    'description':
      'Grab text content from provided URL links. Can be used to retrieve text information for web pages, articles, or other online resources',
    'parameters': {
      'type': 'object',
      'properties': {
        'url': {
          'type': 'string',
          'description':
            'The full URL address of the content to be crawled. If the user explicitly requests to read/analyze the content of the link, then call the function. If the data provided by the user is web content with links, but the content is sufficient to answer the question, then there is no need to call the function.',
        },
      },
      'required': ['url'],
      'additionalProperties': false,
    },
  },
  type: 'llm_control',
};