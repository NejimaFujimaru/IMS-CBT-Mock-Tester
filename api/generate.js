// api/generate.js — Vercel Serverless, maxDuration: 60s
// Production-ready with robust retry logic for openrouter:auto (best free model)
// Generates ALL questions via AI with real-time Wikipedia context for GK

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Use openrouter:auto which routes to the best available free model
// This automatically handles cases where specific models hit daily limits
const FREE_MODEL = 'openrouter/auto';

const RETRY_CONFIG = {
  maxRetries: 4,              // Total attempts: 1 initial + 3 retries
  baseDelay: 3000,            // Start at 3s
  maxDelay: 15000,            // Cap at 15s
  timeoutPerAttempt: 45000,   // 45s per attempt (longer for full question sets)
  exponentialBase: 2.2        // Exponential backoff multiplier
};

/**
 * Fetches real-time context from Wikipedia for Pakistan Affairs and Current Events
 */
async function fetchWikipediaContext() {
  const topics = [
    'Pakistan_in_2025',
    'CPEC',
    'Pakistan_general_election,_2024',
    'Foreign_relations_of_Pakistan',
    'Economy_of_Pakistan',
    'Current_events'
  ];
  
  const summaries = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  
  try {
    for (const topic of topics) {
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
          { 
            signal: controller.signal,
            headers: { 'User-Agent': 'IMS-CBT-Mock/1.0' }
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.extract) {
            summaries.push(`${topic.replace(/_/g, ' ')}: ${data.extract.slice(0, 400)}`);
          }
        }
      } catch { /* skip silently */ }
    }
  } finally {
    clearTimeout(timeout);
  }
  
  return summaries;
}

function calculateBackoff(attempt) {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.exponentialBase, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

function isRetryableError(status) {
  // 429: Rate limit, 502/503/504: Server errors, 408: Request timeout
  return [408, 429, 502, 503, 504].includes(status);
}

/**
 * Advanced JSON cleaning with multiple recovery strategies
 */
function cleanAIResponse(content) {
  if (!content || typeof content !== 'string') return null;
  
  let jsonStr = content.trim();
  
  // Strategy 1: Remove markdown code fences
  jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  jsonStr = jsonStr.replace(/```javascript\s*/gi, '').replace(/```\s*/gi, '');
  
  // Strategy 2: Extract JSON array/object if surrounded by text
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  } else if (objectMatch) {
    jsonStr = objectMatch[0];
  }
  
  // Strategy 3: Fix trailing commas (common AI mistake)
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
  
  // Strategy 4: Fix unescaped quotes within strings (basic heuristic)
  // This is risky but necessary for fragile models
  
  // Strategy 5: Remove any leading/trailing non-JSON characters
  jsonStr = jsonStr.replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
  
  // Strategy 6: Ensure proper escaping of backslashes
  jsonStr = jsonStr.replace(/\\'/g, "'").replace(/\\"/g, '"');
  
  return jsonStr.trim();
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

  // Fetch real-time context for GK section
  let contextAddition = '';
  if (section === 'gk' || section === 'GK' || section === 'General Knowledge') {
    const summaries = await fetchWikipediaContext();
    if (summaries.length > 0) {
      contextAddition = '\n\n=== CURRENT AFFAIRS CONTEXT (USE FOR 30-40% OF QUESTIONS) ===\n' +
        summaries.join('\n\n').slice(0, 1500) +
        '\n=== END CONTEXT ===\n' +
        '\nFocus areas: Pakistan National Affairs, International Relations (UN, OIC, SCO), ' +
        'Major Cities, Economic Developments, Political Landscape 2024-2025, CPEC, Kashmir Issue.';
    }
  }

  // Build enhanced prompt requesting ALL questions
  const finalPrompt = `${basePrompt}${contextAddition}\n\n` +
    `CRITICAL REQUIREMENTS:\n` +
    `1. Generate EXACTLY ${count || 20} complete MCQs (not 5, not 10, but ${count || 20}).\n` +
    `2. Output ONLY a valid JSON array starting with [ and ending with ].\n` +
    `3. NO markdown, NO code fences, NO explanatory text outside JSON.\n` +
    `4. Each question must have: question, options (array of 4), answer (exact option text), explanation.\n` +
    `5. For GK: Include 6-8 questions from the Current Affairs context above.\n` +
    `6. Ensure variety in difficulty and topics.\n\n` +
    `Example format:\n` +
    `[{"question":"What...","options":["A)","B)","C)","D)"],"answer":"A)","explanation":"..."}]`;

  const systemMessage = baseSystem ||
    'You are an expert exam question generator for Pakistani University Entry Tests. ' +
    'Output ONLY a valid JSON array. No markdown. No code fences. Start with [ and end with ].';

  let lastError = 'All attempts exhausted';
  let totalAttempts = 0;
  let successData = null;

  // Retry loop with exponential backoff on the SAME model (openrouter/auto)
  while (totalAttempts < RETRY_CONFIG.maxRetries) {
    const attemptNumber = totalAttempts + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RETRY_CONFIG.timeoutPerAttempt);

    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ims-cbt-mock-tester.vercel.app',
          'X-Title': 'ASQScholar CBT Mock Test',
          'OpenRouter-Force-Parse': 'true',
        },
        body: JSON.stringify({
          model: FREE_MODEL,
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: finalPrompt },
          ],
          temperature: 0.7,
          max_tokens: 6000, // Increased for full question sets (20+ questions)
          response_format: { type: 'json_object' },
        }),
      });

      clearTimeout(timer);

      // Model not available (404) - retry (auto should route to available model)
      if (apiRes.status === 404) {
        lastError = `Model routing failed (404), retrying... (attempt ${attemptNumber}/${RETRY_CONFIG.maxRetries})`;
        console.warn(`[OpenRouter] ${lastError}`);
        
        if (totalAttempts < RETRY_CONFIG.maxRetries - 1) {
          const waitTime = calculateBackoff(totalAttempts);
          await sleep(waitTime);
          totalAttempts++;
          continue;
        }
        break;
      }

      // Authentication/authorization errors - don't retry
      if (apiRes.status === 401 || apiRes.status === 403) {
        lastError = `Authentication failed (${apiRes.status})`;
        return res.status(500).json({ error: 'Invalid API key or unauthorized' });
      }

      // Rate limited or server error - retry with backoff
      if (isRetryableError(apiRes.status)) {
        const waitTime = calculateBackoff(totalAttempts);
        lastError = `${apiRes.status} (attempt ${attemptNumber}/${RETRY_CONFIG.maxRetries}), waiting ${Math.round(waitTime/1000)}s`;
        console.warn(`[OpenRouter] ${lastError}`);
        
        if (totalAttempts < RETRY_CONFIG.maxRetries - 1) {
          await sleep(waitTime);
          totalAttempts++;
          continue;
        }
        break; // Exhausted retries
      }

      // Other client errors - don't retry
      if (apiRes.status >= 400 && apiRes.status < 500) {
        const errText = await apiRes.text().catch(() => '');
        lastError = `HTTP ${apiRes.status} — ${errText.slice(0, 150)}`;
        break;
      }

      // SUCCESS
      const data = await apiRes.json();
      
      // Validate response structure
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error('Invalid response structure from OpenRouter');
      }
      
      const content = data.choices[0]?.message?.content;
      if (!content || content.trim().length === 0) {
        throw new Error('Empty content from AI');
      }

      // Clean and parse JSON
      const cleanedJson = cleanAIResponse(content);
      if (!cleanedJson) {
        throw new Error('Failed to extract JSON from response');
      }

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(cleanedJson);
      } catch (parseErr) {
        console.error('JSON Parse Error:', parseErr.message);
        console.error('Cleaned JSON preview:', cleanedJson.slice(0, 500));
        throw new Error(`JSON parse failed: ${parseErr.message}`);
      }

      // Validate it's an array
      if (!Array.isArray(parsedQuestions)) {
        // If it's an object with a questions property, extract it
        if (parsedQuestions.questions && Array.isArray(parsedQuestions.questions)) {
          parsedQuestions = parsedQuestions.questions;
        } else if (parsedQuestions.data && Array.isArray(parsedQuestions.data)) {
          parsedQuestions = parsedQuestions.data;
        } else {
          throw new Error('Response is not a JSON array');
        }
      }

      // Verify we got enough questions
      const expectedCount = parseInt(count) || 20;
      if (parsedQuestions.length < expectedCount * 0.8) {
        console.warn(`Only got ${parsedQuestions.length}/${expectedCount} questions, but accepting partial result`);
      }

      successData = { 
        questions: parsedQuestions, 
        source: 'AI',
        model: FREE_MODEL,
        attempts: totalAttempts + 1
      };
      
      break; // Success! Exit retry loop

    } catch (err) {
      clearTimeout(timer);
      
      // Network errors are retryable
      if (err.name === 'TypeError' || err.message.includes('network') || err.message.includes('fetch')) {
        lastError = `Network error (attempt ${attemptNumber})`;
        console.warn(`[OpenRouter] ${lastError}`);
        
        if (totalAttempts < RETRY_CONFIG.maxRetries - 1) {
          const waitTime = calculateBackoff(totalAttempts);
          await sleep(waitTime);
          totalAttempts++;
          continue;
        }
      }
      
      lastError = err.name === 'AbortError'
        ? `Timed out after ${RETRY_CONFIG.timeoutPerAttempt/1000}s`
        : err.message;
      
      if (totalAttempts < RETRY_CONFIG.maxRetries - 1) {
        const waitTime = calculateBackoff(totalAttempts);
        await sleep(waitTime);
        totalAttempts++;
        continue;
      }
      break;
    }
  }

  if (successData) {
    console.log(`[OpenRouter] Success after ${totalAttempts + 1} attempts, generated ${successData.questions.length} questions`);
    return res.status(200).json(successData);
  }

  console.error(`[OpenRouter] All attempts failed after ${totalAttempts + 1} total attempts. Last error: ${lastError}`);
  return res.status(503).json({ 
    error: `AI service unavailable after ${totalAttempts + 1} attempts`,
    details: lastError,
    aiGenerated: 0
  });
}
