import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const FALLBACK_MODEL = 'phi4:14b';

const GENERATE_KEYWORDS = [
  'generate', 'create', 'draw', 'make an image', 'make image',
  'picture of', 'image of', 'illustration of', 'diagram of',
  'visualize', 'render', 'paint', 'sketch', 'design',
  'show me', 'give me an image', 'give me a picture'
];

const GENERATE_REGEX = new RegExp(`\\b(${GENERATE_KEYWORDS.join('|')})\\b`, 'i');

/**
 * Rule-based intent detection
 * Returns { intent: 'ask' | 'generate_image', confidence: number, reasoning: string }
 */
function detectIntentRuleBased(message, hasImage) {
  const normalized = message.toLowerCase().trim();

  // Check for generate keywords
  const hasGenerateKeyword = GENERATE_REGEX.test(normalized);

  if (hasImage) {
    if (hasGenerateKeyword) {
      return {
        intent: 'generate_image',
        confidence: 0.9,
        reasoning: 'Image attached with generate keyword'
      };
    }
    // Image without generate keyword -> OCR + ask
    return {
      intent: 'ask',
      confidence: 0.85,
      reasoning: 'Image attached without generate keyword, defaulting to OCR + question'
    };
  }

  // Text only
  if (hasGenerateKeyword) {
    return {
      intent: 'generate_image',
      confidence: 0.85,
      reasoning: 'Generate keyword detected in text-only message'
    };
  }

  return {
    intent: 'ask',
    confidence: 0.95,
    reasoning: 'No image, no generate keyword - standard question'
  };
}

/**
 * Fallback to Phi-4-14B for ambiguous cases
 */
async function detectIntentLLM(message, hasImage) {
  const systemPrompt = `You are an intent classifier for a university chat assistant.
Classify the user's message into one of two intents:
1. "ask" - User wants to ask a question, get information, or have text analyzed (including OCR on attached images)
2. "generate_image" - User wants to create/generate/draw a new image from a prompt

Rules:
- If user has an image attached and asks "what is this", "explain this", "read this", "analyze this" -> "ask" (OCR)
- If user has an image attached and says "generate", "create", "draw", "make an image based on this" -> "generate_image"
- If text only contains "generate", "create", "draw", "make an image", "picture of", "image of" -> "generate_image"
- Otherwise -> "ask"

Respond with ONLY a JSON object: {"intent": "ask|generate_image", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  const userPrompt = `Message: "${message}"
Has attached image: ${hasImage}`;

  try {
    const response = await ollama.chat({
      model: FALLBACK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      options: {
        temperature: 0.1,
        num_predict: 100,
        num_ctx: 2048,
      },
      stream: false,
    });

    const content = response.message.content.trim();
    const parsed = JSON.parse(content);

    if (parsed.intent && ['ask', 'generate_image'].includes(parsed.intent)) {
      return {
        intent: parsed.intent,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        reasoning: parsed.reasoning || 'LLM classification'
      };
    }
  } catch (err) {
    console.warn('LLM intent detection failed, using rule-based:', err.message);
  }

  // Fallback to rule-based
  return detectIntentRuleBased(message, hasImage);
}

/**
 * Main intent detection function
 * Uses rule-based first, falls back to LLM for ambiguous cases
 */
export async function detectIntent(message, hasImage = false) {
  // Quick rule-based check
  const ruleResult = detectIntentRuleBased(message, hasImage);

  // High confidence -> return immediately
  if (ruleResult.confidence >= 0.85) {
    return ruleResult;
  }

  // Ambiguous -> use LLM
  console.log('Intent ambiguous, using LLM fallback:', ruleResult);
  return detectIntentLLM(message, hasImage);
}

export { detectIntentRuleBased };