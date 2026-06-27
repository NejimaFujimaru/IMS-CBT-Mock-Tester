// api/generate.js — Vercel Serverless, maxDuration: 60s
// BATCH generation (10 at a time) for maximum reliability with openrouter:auto
// Automatically handles model rate limits by routing to available free models

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FREE_MODEL = 'openrouter/auto';
const BATCH_SIZE = 10;

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 10000,
  timeoutPerAttempt: 30000,
  exponentialBase: 2.2
};

async function fetchWikipediaContext() {
  const currentYear = new Date().getFullYear(); // Evaluates to 2026
  const recentElectionYear = 2024;             // The most recent general election year

  const topics = [
    `Pakistan_in_${currentYear}`,
    'CPEC',
    `Pakistan_general_election,_${recentElectionYear}`,
    'Foreign_relations_of_Pakistan',
    'Economy_of_Pakistan',
    'Current_events',
    'Islamabad',
    'Karachi',
    'Lahore'
  ];

  let contextText = "";
  
  // Fetch summaries in parallel but limit concurrency if needed (native fetch handles this well enough for 9 topics)
  const promises = topics.map(async (topic) => {
    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
      if (!response.ok) return null;
      const data = await response.json();
      // Extract relevant text: extract + first few sentences of content if available
      let text = data.extract || "";
      if (text.length > 300) text = text.substring(0, 300) + "...";
      return `${data.title}: ${text}`;
    } catch (e) {
      console.error(`Failed to fetch Wikipedia for ${topic}:`, e.message);
      return null;
    }
  });

  const results = await Promise.all(promises);
  
  // Filter out nulls and join
  const validContexts = results.filter(r => r !== null);
  if (validContexts.length > 0) {
    contextText = "\n\n--- REAL-TIME CONTEXT FOR QUESTION GENERATION ---\n" + validContexts.join("\n") + "\n--- END CONTEXT ---\n";
  } else {
    contextText = "\n\n(Note: Real-time context fetching failed. Use general knowledge about Pakistan, its cities, economy, and foreign relations as of 2026.)\n";
  }

  return contextText;
}

function calculateBackoff(attempt) {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.exponentialBase, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

function isRetryableError(status) {
  return [408, 429, 502, 503, 504].includes(status);
}

function cleanAIResponse(content) {
  if (!content || typeof content !== 'string') return null;
  
  let jsonStr = content.trim();
  jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  jsonStr = jsonStr.replace(/```javascript\s*/gi, '').replace(/```\s*/gi, '');
  
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) jsonStr = arrayMatch[0];
  
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
  jsonStr = jsonStr.replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
  jsonStr = jsonStr.replace(/\\'/g, "'").replace(/\\"/g, '"');
  
  return jsonStr.trim();
}

async function generateBatch(batchCount, section, wikiContext) {
  let contextAddition = '';
  if (wikiContext && typeof wikiContext === 'string' && wikiContext.length > 0) {
    contextAddition = '\n\n=== CURRENT AFFAIRS CONTEXT ===\n' +
      wikiContext.slice(0, 2500) +
      '\n=== END CONTEXT ===\n' +
      '\nFocus: Pakistan National Affairs (2026), International Relations (UN, OIC, SCO), ' +
      'Major Cities (Islamabad, Karachi, Lahore), Economic Developments, Political Landscape, CPEC, Kashmir.';
  }

  const prompt = `Generate EXACTLY ${batchCount} multiple-choice questions for "${section}".
Format: JSON array only. NO markdown. NO code fences. NO text before or after.
Structure: [{"question":"...","options":["A)","B)","C)","D)"],"answer":"Correct Option","explanation":"..."}]
${contextAddition}
Rules:
1. Output ONLY the JSON array starting with [ and ending with ].
2. Each question must have exactly 4 options.
3. Answer must match one option text exactly.
4. For GK: Use 40-50% questions from Current Affairs context above.`;

  const systemMessage = 'You are an expert exam generator. Output ONLY valid JSON arrays. No explanations outside JSON.';

  let lastError = 'All attempts exhausted';
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RETRY_CONFIG.timeoutPerAttempt);

    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ims-cbt-mock-tester.vercel.app',
          'X-Title': 'ASQScholar CBT Mock Test',
          'OpenRouter-Force-Parse': 'true',
        },
        body: JSON.stringify({
          model: FREE_MODEL,
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
      });

      clearTimeout(timer);

      if (apiRes.status === 404) {
        lastError = `Model routing failed (404)`;
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          await sleep(calculateBackoff(attempt));
          continue;
        }
        break;
      }

      if (apiRes.status === 401 || apiRes.status === 403) {
        throw new Error(`Authentication failed (${apiRes.status})`);
      }

      if (isRetryableError(apiRes.status)) {
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          await sleep(calculateBackoff(attempt));
          continue;
        }
        lastError = `Server error ${apiRes.status}`;
        break;
      }

      if (apiRes.status >= 400) {
        const errText = await apiRes.text().catch(() => '');
        throw new Error(`HTTP ${apiRes.status}: ${errText.slice(0, 100)}`);
      }

      const data = await apiRes.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error('Empty response');

      const cleanedJson = cleanAIResponse(content);
      if (!cleanedJson) throw new Error('Failed to extract JSON');

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(cleanedJson);
      } catch (parseErr) {
        throw new Error(`JSON parse failed: ${parseErr.message}`);
      }

      if (!Array.isArray(parsedQuestions)) {
        if (parsedQuestions.questions && Array.isArray(parsedQuestions.questions)) {
          parsedQuestions = parsedQuestions.questions;
        } else {
          throw new Error('Response is not a JSON array');
        }
      }

      const validQuestions = parsedQuestions.filter(q => 
        q.question && 
        Array.isArray(q.options) && 
        q.options.length === 4 && 
        q.answer
      );

      if (validQuestions.length === 0) {
        throw new Error('No valid questions in batch');
      }

      return { success: true, questions: validQuestions };

    } catch (err) {
      clearTimeout(timer);
      lastError = err.message;
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        await sleep(calculateBackoff(attempt));
        continue;
      }
    }
  }

  return { success: false, error: lastError, questions: [] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt: basePrompt, systemPrompt: baseSystem, section, count } = req.body;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY in Vercel settings' });
  }

  let wikiContext = null;
  if (section === 'gk' || section === 'GK' || section === 'General Knowledge') {
    wikiContext = await fetchWikipediaContext();
  }

  const allQuestions = [];
  let totalAiGenerated = 0;
  let remaining = parseInt(count) || 20;
  let generationFailed = false;

  while (remaining > 0 && !generationFailed) {
    const batchSize = Math.min(BATCH_SIZE, remaining);
    
    console.log(`[Batch] Generating ${batchSize} questions for ${section}, ${remaining} remaining`);
    
    const result = await generateBatch(batchSize, section, wikiContext);
    
    if (result.success && result.questions.length > 0) {
      allQuestions.push(...result.questions);
      const actualCount = result.questions.length;
      totalAiGenerated += actualCount;
      remaining -= actualCount;
      console.log(`[Batch] Success: got ${actualCount} questions, ${remaining} remaining`);
    } else {
      console.warn(`[Batch] Failed: ${result.error}`);
      generationFailed = true;
    }
  }

  if (allQuestions.length > 0) {
    console.log(`[OpenRouter] Generated ${totalAiGenerated}/${count} questions for ${section}`);
    return res.status(200).json({ 
      questions: allQuestions, 
      source: 'AI',
      model: FREE_MODEL,
      aiGenerated: totalAiGenerated,
      requested: count
    });
  }

  console.error(`[OpenRouter] Generation failed for ${section}`);
  return res.status(503).json({ 
    error: 'AI service unavailable',
    details: 'Failed to generate any questions',
    questions: [],
    aiGenerated: 0,
    requested: count
  });
}
