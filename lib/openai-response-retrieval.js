'use strict';

const { input, failure, requestOnce } = require('./openai-response-http');

// Explicit server-side call only: no ambient key lookup, disk writes, dispatch,
// cancellation, polling or RunRecord mutation. All failures remain unresolved.
async function retrieveOpenAiResponse(requestJson, apiKey) {
  let value;
  try { value = input(requestJson, apiKey); } catch { return failure('retrieval_input_invalid'); }
  return requestOnce(value, apiKey);
}

module.exports = { retrieveOpenAiResponse };
