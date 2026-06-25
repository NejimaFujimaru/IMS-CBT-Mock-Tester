// api/generate.js — Vercel Serverless, maxDuration: 60s
// CHANGES: hermes moved to position 1 (skip dead models instantly)
//          429 retry increased to 3 attempts (5s → 8s → 12s backoff)

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hermes is FIRST — the only confirmed-working free model right now.
// The others are backups in case it becomes unavailable later.
const FREE_MODELS = [
  
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen3-next-80b-a3b-instruct',
  'google/gemma-4-26b-a4b-it',
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
    } catch { /* skip */ }
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

  const models = process.env.OPENROUTER_MODEL
    ? [process.env.OPENROUTER_MODEL, ...FREE_MODELS]
    : FREE_MODELS;

  let finalPrompt = basePrompt;
  if (section === 'gk') {
    const summaries = await fetchWikipediaContext();
    if (summaries.length > 0) {
      finalPrompt += '\n\n[CURRENT AFFAIRS CONTEXT — use to inspire 2-3 topical questions]:\n'
        + summaries.join('\n').slice(0, 600);
    }
  }

  const systemMessage = baseSystem ||
    'Output ONLY a valid JSON object. No markdown. No code fences. Start with { and end with }.';

  let lastError = 'All models exhausted';

  for (const model of models) {

    // Up to 3 retries per model for rate-limit (429) with increasing backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
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
          // Model unavailable for free — skip instantly, no delay
          lastError = `${model}: not available for free (404)`;
          break; // next model
        }

        if (apiRes.status === 429) {
          // Rate limited — wait longer each attempt, then retry same model
          const waits = [5000, 8000, 12000];
          lastError = `${model}: rate limited (429), attempt ${attempt}`;
          if (attempt < 3) { await sleep(waits[attempt - 1]); continue; }
          break; // gave up on this model after 3 tries
        }

        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => '');
          lastError = `${model}: HTTP ${apiRes.status} — ${errText.slice(0, 100)}`;
          break; // next model
        }

        // SUCCESS
        const data = await apiRes.json();
        return res.status(200).json(data);

      } catch (err) {
        clearTimeout(timer);
        lastError = err.name === 'AbortError'
          ? `${model}: timed out after 30s`
          : `${model}: ${err.message}`;
        break; // next model
      }
    }
    // continue outer loop to next model
  }

  return res.status(503).json({ error: `AI unavailable: ${lastError}` });
}