const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cached system prompts — both share the same ephemeral cache block so
// switching between the two calls within a session still benefits from caching.

const WORD_SYSTEM = `You are interpreting ASL (American Sign Language) finger spelling in real time.
The user signs one letter at a time and the ML model recognises each letter.
Your job is to interpret the sequence of letters as the most likely English word.
The model is imperfect — it may miss a letter, repeat one, or misread one.
Rules:
- Reply with ONLY the interpreted word. No punctuation, no explanation.
- If it is clearly a single letter (like "I" or "A"), return just that letter.
- Correct obvious spelling errors (e.g. "HELO" → "HELLO", "WROLD" → "WORLD").
- If the sequence is ambiguous, pick the most common English word.
- Never return more than 2 words.`;

const SENTENCE_SYSTEM = `You are a post-processor for ASL (American Sign Language) finger spelling output.
You receive a sequence of words that were individually interpreted from finger spelling.
Your job is to turn them into a single clean, natural English sentence.
The words may contain minor errors from the ML model.
Rules:
- Reply with ONLY the final sentence. Capitalise the first word. Add a period at the end.
- Fix any obvious word errors based on context.
- Do not add words that were not signed — only clean up what is there.
- Keep the original meaning.
- Maximum 20 words.`;

const CACHED_WORD_SYSTEM = [
  { type: 'text', text: WORD_SYSTEM, cache_control: { type: 'ephemeral' } },
];

const CACHED_SENTENCE_SYSTEM = [
  { type: 'text', text: SENTENCE_SYSTEM, cache_control: { type: 'ephemeral' } },
];

/**
 * Interpret a sequence of ASL letters into a word using Claude Haiku.
 * @param {string[]} letters - e.g. ['H','E','L','L','O']
 * @returns {Promise<string>} - e.g. "HELLO"
 */
async function interpretLetters(letters) {
  if (!letters || letters.length === 0) return '';

  const sequence = letters.join('-');
  console.log(`[Claude/word] ${sequence}`);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 24,
    system: CACHED_WORD_SYSTEM,
    messages: [{ role: 'user', content: `Letters signed: ${sequence}` }],
  });

  const result = (message.content[0]?.text || '').trim().toUpperCase();
  console.log(`[Claude/word] ${sequence} → "${result}"`);
  return result;
}

/**
 * Clean up a sequence of interpreted words into a natural English sentence.
 * @param {string[]} words - e.g. ['HELLO', 'HOW', 'ARE', 'YOU']
 * @returns {Promise<string>} - e.g. "Hello, how are you."
 */
async function interpretSentence(words) {
  if (!words || words.length === 0) return '';
  if (words.length === 1) return words[0];

  const raw = words.join(' ');
  console.log(`[Claude/sentence] "${raw}"`);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    system: CACHED_SENTENCE_SYSTEM,
    messages: [{ role: 'user', content: `Words signed: ${raw}` }],
  });

  const result = (message.content[0]?.text || '').trim();
  console.log(`[Claude/sentence] "${raw}" → "${result}"`);
  return result || raw;
}

module.exports = { interpretLetters, interpretSentence };
