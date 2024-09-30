export const jina_reader = {
  schema: {
    'name': 'jina_reader',
    'description':
      'Grab text content from provided URL links. Can be used to retrieve text information for web pages, articles, or other online resources',
    'parameters': {
      'type': 'object',
      'properties': {
        'url': {
          'type': 'string',
          'description':
            "The full URL address of the content to be crawled. If the user explicitly requests to read/analyze the content of the link, then call the function. If the data provided by the user is web content with links, but the content is sufficient to answer the question, then there is no need to call the function.",
        },
      },
      'required': ['url'],
      "additionalProperties": false
    },
  },

  need:'JINA_API_KEY',

  func: async ({url, keys}, signal) => {
    if (!url) {
      throw new Error('url is null');
    }
    if (!Array.isArray(keys) || keys?.length === 0) {
      throw new Error('JINA_API_KEY is null or all keys is expired.');
    }
    const key_length = keys.length;
    const key = keys[Math.floor(Math.random() * key_length)];
    console.log('jina-reader:', url);
    const startTime = Date.now();
    let result = await fetch('https://r.jina.ai/' + url, {
      headers: {
        'X-Return-Format': 'text',
        'Authorization': `Bearer ${key}`,
        // 'X-Timeout': 15
      },
      ...(signal && { signal } || {})
    });
    if (!result.ok) {
      if (result.status.toString().startsWith('4') && key_length > 1) {
        console.error(`jina key: ${key.slice(0, 10) + ' ... ' + key.slice(-5)} is expired`); 
        keys.splice(keys.indexOf(key), 1);
        return jina_reader.func({ url, keys }, signal);
      }
      keys.pop();
      throw new Error('All keys is unavailable. ' + (await result.json()).message);
    }
    const time = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    return { content: await result.text(), time };
    
  },
  
  type: 'web_crawler'
};