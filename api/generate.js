import OpenAI from 'openai';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { messages } = await req.json();

  if (!process.env.OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: 'API Key missing on server' }), { status: 500 });
  }

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'https://your-vercel-app.vercel.app', // Replace with your actual Vercel URL
      'X-Title': 'ASQScholar CBT Mock Test',
    },
  });

  try {
    const completion = await openai.chat.completions.create({
      model: 'openrouter/free',
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content received from AI');
    }

    return new Response(JSON.stringify({ result: content }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('OpenRouter Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'AI Generation Failed' }), { 
      status: 500 
    });
  }
}
