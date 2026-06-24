// ============================================================
// api/generate.js  —  Vercel Node.js Serverless Function
// KEY CHANGE: "runtime: 'edge'" REMOVED → 60s timeout instead of 25s
// ADDS: retry logic, rate-limit backoff, Wikipedia GK context
// ============================================================

export const config = {
  maxDuration: 60, // 60 seconds (Vercel Hobby plan max)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free Wikipedia REST API — no key needed
// Used to inject current Pakistan affairs context into GK prompts
async function fetchWikipediaContext() {
  const topics = ['Pakistan_in_2025', 'Pakistan_in_2024', 'CPEC', 'Pakistan_general_election,_2024'];
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
    } catch {
      // Skip any topic that fails — network issues shouldn't block the test
    }
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
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  // --- Enrich GK prompts with free, live Wikipedia context ---
  let finalPrompt = basePrompt;
  if (section === 'gk') {
    const summaries = await fetchWikipediaContext();
    if (summaries.length > 0) {
      const context = summaries.join('\n\n').slice(0, 700);
      finalPrompt +=
        '\n\n[CURRENT AFFAIRS CONTEXT — use these facts to inspire 2-3 topical GK questions]:\n' +
        context;
    }
  }

  const systemMessage =
    baseSystem ||
    'Output ONLY a valid JSON object. No markdown. No code fences. Start your response with { and end with }.';

  // Check openrouter.ai/models?order=pricing for latest free models
  // Using meta-llama which is reliably free and handles JSON well
  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

  let lastError = 'No attempts made';

  // --- 3-attempt retry loop with exponential backoff for 429s ---
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000); // 45s per attempt

    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
          max_tokens: 2500,
        }),
      });

      clearTimeout(timer);

      if (apiRes.status === 429) {
        // Rate limited — wait longer each attempt: 5s → 10s → 15s
        lastError = `OpenRouter rate limit (429) on attempt ${attempt}`;
        await sleep(attempt * 5000);
        continue;
      }

      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        lastError = `OpenRouter HTTP ${apiRes.status}: ${errText.slice(0, 100)}`;
        if (attempt < 3) { await sleep(3000); continue; }
        throw new Error(lastError);
      }

      const data = await apiRes.json();
      return res.status(200).json(data);

    } catch (err) {
      clearTimeout(timer);
      lastError =
        err.name === 'AbortError'
          ? `Attempt ${attempt} timed out after 45s`
          : err.message || 'Unknown fetch error';

      if (attempt < 3) await sleep(3000);
    }
  }

  // All 3 attempts failed — return 503 so client uses fallback bank gracefully
  return res.status(503).json({
    error: `AI generation failed after 3 attempts. Last: ${lastError}`,
  });
}