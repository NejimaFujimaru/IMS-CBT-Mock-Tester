// api/generate.js — Vercel Serverless (NOT Edge), maxDuration: 60s
// KEY FIX: Tries 6 known free OpenRouter models in order.
// If one returns 404 (unavailable), it moves to the next instantly.
// If one returns 429 (rate limit), it waits 4s and retries once, then moves on.

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ordered list of free models — deepseek is tried first as it's the most reliable.
// Any model returning 404 is skipped in < 1 second. Add/remove as needed.
const FREE_MODELS = [
  'deepseek/deepseek-chat:free',
  'deepseek/deepseek-r1:free',
  'qwen/qwq-32b:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-2-9b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

async function fetchWikipediaContext() {
  const topics = ['Pakistan_in_2025', 'CPEC', 'Pakistan_general_election,_2024'];
  const summaries = [];
  for (const topic of topics) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.extract) summaries.push(data.extract.slice(0, 300));
      }
    } catch { /* skip unavailable topics */ }
  }
  return summaries;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt: basePrompt, systemPrompt: baseSystem, section } = req.body;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY in Vercel settings' });
  }

  // If user sets OPENROUTER_MODEL env var, try that model first
  const models = process.env.OPENROUTER_MODEL
    ? [process.env.OPENROUTER_MODEL, ...FREE_MODELS]
    : FREE_MODELS;

  // Enrich GK prompts with free Wikipedia current affairs context
  let finalPrompt = basePrompt;
  if (section === 'gk') {
    const summaries = await fetchWikipediaContext();
    if (summaries.length > 0) {
      finalPrompt +=
        '\n\n[CURRENT AFFAIRS CONTEXT — use these to inspire 2-3 topical questions]:\n' +
        summaries.join('\n').slice(0, 600);
    }
  }

  const systemMessage =
    baseSystem ||
    'Output ONLY a valid JSON object. No markdown. No code fences. Start with { and end with }.';

  let lastError = 'All models failed';

  // Outer loop: try each free model in order
  for (const model of models) {

    // Inner loop: retry once if rate-limited (429)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000); // 30s per attempt

      try {
        const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ims-cbt-mock-tester.vercel.app',
            'X-Title': 'ASQScholar CBT Mock Test',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: finalPrompt },
            ],
            temperature: 0.8,
            max_tokens: 2000,
          }),
        });

        clearTimeout(timer);

        if (apiRes.status === 404) {
          // This free model slot is unavailable — skip to next model instantly
          lastError = `${model} not available for free (404)`;
          break; // exits inner loop, tries next model
        }

        if (apiRes.status === 429) {
          // Rate limited — wait 4s then retry this same model once
          lastError = `${model} rate limited (429)`;
          if (attempt < 2) { await sleep(4000); continue; }
          break; // give up on this model after one retry
        }

        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => '');
          lastError = `${model} HTTP ${apiRes.status}: ${errText.slice(0, 100)}`;
          break; // try next model
        }

        // SUCCESS — return the response
        const data = await apiRes.json();
        return res.status(200).json(data);

      } catch (err) {
        clearTimeout(timer);
        lastError = err.name === 'AbortError'
          ? `${model} timed out after 30s`
          : `${model} error: ${err.message}`;
        break; // try next model on any exception
      }
    }
    // continue to next model in outer loop
  }

  // Every model failed — client will use fallback question bank
  return res.status(503).json({ error: `AI unavailable: ${lastError}` });
}