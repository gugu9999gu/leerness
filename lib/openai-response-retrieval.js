'use strict';

const { input, failure, requestOnce } = require('./openai-response-http');

 
 
async function retrieveOpenAiResponse(requestJson, apiKey) {
  let value;
  try { value = input(requestJson, apiKey); } catch { return failure('retrieval_input_invalid'); }
  return requestOnce(value, apiKey);
}

module.exports = { retrieveOpenAiResponse };
