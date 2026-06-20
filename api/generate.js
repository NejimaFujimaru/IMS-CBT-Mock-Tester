import { NextResponse } from 'next/server';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { messages } = await req.json();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY environment variable');
    return NextResponse.json(
      { error: 'Server configuration error: Missing API Key' },
      { status: 500 }
    );
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ims-cbt-mock-tester.vercel.app/',
        'X-Title': 'ASQScholar CBT Mock Test',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter API Error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `AI Service Error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response structure from AI');
    }

    const content = data.choices[0].message.content;

    return NextResponse.json({ result: content });
    
  } catch (error) {
    console.error('Server Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
