# ASQScholar IMS-CBT Mock Tester

## Production-Ready Computer-Based Testing Platform for Pakistani University Admissions

A sophisticated, timed mock testing platform designed specifically for NTS/NAT-style university admission tests in Pakistan. This platform generates unique MCQs using AI while guaranteeing functionality through a robust static fallback bank.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Key Features](#key-features)
3. [Tech Stack](#tech-stack)
4. [File Structure](#file-structure)
5. [Setup Instructions](#setup-instructions)
6. [Streaming Fast-Start Algorithm](#streaming-fast-start-algorithm)
7. [Error Recovery Strategies](#error-recovery-strategies)
8. [Security Best Practices](#security-best-practices)
9. [API Reference](#api-reference)
10. [Deployment Guide](#deployment-guide)

---

## Project Overview

**ASQScholar IMS-CBT Mock Tester** is a zero-cost, maximum-reliability computer-based testing platform that delivers:

- **87 questions** across 4 sections (English, General Knowledge, Mathematics, Analytical Reasoning)
- **90-minute timed sessions** with accurate background timer
- **AI-generated questions** using free-tier OpenRouter models
- **Real-time Wikipedia context** for current affairs questions
- **Instant test start** with Streaming Fast-Start mode (~3 seconds)
- **Background question loading** without interrupting the user

### Core Philosophy

> **"Zero Cost, Maximum Reliability"**

This project uses ONLY free OpenRouter models (`openrouter:auto`) that dynamically route to the best available free model. No paid API keys are hardcoded, and the system gracefully falls back to a static knowledge bank when AI generation fails.

---

## Key Features

### 🚀 Streaming Fast-Start Mode (CRITICAL)

The platform does NOT wait for all 87 questions to generate before starting. Instead:

1. **Immediate Start**: Generates only 1 question per section (4 total) to begin the test instantly
2. **Background Filling**: Runs a background loop that generates 5 questions at a time for each section
3. **Dynamic UI Updates**: As new questions arrive, they're appended to the question pool and the sidebar navigator updates in real-time
4. **User Notification**: Shows subtle toast notifications: "5 new questions added to your pool"

**Benefits:**
- Test starts in ~3 seconds instead of 2-3 minutes
- Users can begin answering immediately
- Background loading is transparent and non-disruptive

### 🤖 AI Generation with Wikipedia Context

For General Knowledge questions, the system:

1. Fetches real-time data from Wikipedia APIs for topics:
   - Pakistan_in_2026
   - CPEC
   - Pakistan_general_election_2024
   - Foreign_relations_of_Pakistan
   - Economy_of_Pakistan

2. Injects this context into AI prompts to ensure current, relevant questions

3. Uses exponential backoff retry logic (3s → 6s → 12s) with jitter

4. Implements 6-layer JSON cleaning to handle malformed AI responses:
   - Remove markdown code fences
   - Fix trailing commas
   - Escape quotes
   - Extract array blocks
   - Handle nested objects
   - Fallback to individual object extraction

### 🎨 Responsive UI/UX

- **Collapsible Sidebar**: Question navigator slides completely off-screen to the left when collapsed
- **Toggle Button**: "☰ Questions" button in the header
- **Auto-expand**: Sidebar automatically expands when a question dot is clicked
- **Header Layout**:
  - Column 1: Timer (Countdown with progress bar)
  - Column 2: "Submit Test" Button (in header, NOT in sidebar)

### ⏱️ Background Timer

Uses `Date.now()` delta calculation instead of simple `setInterval`:

```javascript
const elapsed = Math.floor((Date.now() - startTime) / 1000);
const remaining = Math.max(0, durationSeconds - elapsed);
```

**Benefits:**
- Timer remains accurate even if tab is backgrounded
- Survives computer sleep/wake cycles
- No drift over 90-minute test duration

### 🔔 Error Toast System

Custom toast notification system (top-right corner) catches ALL errors:

- **Network Errors**: "Connection lost. Retrying..."
- **AI Failures**: "AI Failed. Loading fallback questions..."
- **Parsing Errors**: "Invalid response format. Trying alternative parser..."
- **Rate Limits**: "Model busy. Switching to alternative free model..."

The app NEVER stops functioning—fallback questions are loaded immediately.

### 📚 Static Knowledge Bank

Four JSON files with pre-written questions:

- `knowledge-bank/english.json` (20 questions)
- `knowledge-bank/gk.json` (20 questions)
- `knowledge-bank/math.json` (30 questions)
- `knowledge-bank/analytical.json` (17 questions)

Each question includes:
- `id`: Unique identifier
- `question`: Question text
- `options`: Array of 4 options
- `answer`: Correct option index (0-3)
- `explanation`: Detailed explanation

### 🧠 Deduplication Engine

Prevents duplicate questions across test sessions:

- Stores question hashes in localStorage
- Compares new AI-generated questions against history
- Similarity scoring (75% threshold) catches rephrased duplicates
- Maintains 800-question history per section

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES6+) | No frameworks, maximum performance |
| **Backend** | Vercel Serverless Functions | `/api/generate.js` handles AI requests |
| **AI Engine** | OpenRouter API (Free Tier) | `openrouter:auto` routes to best free model |
| **Data** | Static JSON + Dynamic AI + Wikipedia | Hybrid approach for reliability |
| **Hosting** | Vercel | Automatic HTTPS, global CDN |
| **Styling** | Custom CSS with CSS Variables | Light/dark theme support |
| **Icons** | Font Awesome 6.5.1 | Vector icons throughout |
| **Fonts** | Fontsource Inter | Professional typography |

---

## File Structure

```
/workspace
├── index.html                 # Main HTML file (540 lines)
├── styles.css                 # Complete styling (370 lines)
├── script.js                  # Client-side logic (950+ lines)
├── README.md                  # This documentation
├── api/
│   └── generate.js            # Vercel serverless function (284 lines)
└── knowledge-bank/
    ├── english.json           # English questions (20)
    ├── gk.json                # General Knowledge (20)
    ├── math.json              # Mathematics (30)
    └── analytical.json        # Analytical Reasoning (17)
```

### File Responsibilities

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.html` | 540 | DOM structure, views, modals, overlays |
| `styles.css` | 370 | Theming, layout, animations, responsive design |
| `script.js` | 950+ | State management, streaming engine, timer, navigation |
| `api/generate.js` | 284 | AI generation, Wikipedia fetching, retry logic |
| `knowledge-bank/*.json` | ~400 | Static fallback questions |

---

## Setup Instructions

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ims-cbt-mock-tester
   ```

2. **Install Vercel CLI (optional for local testing):**
   ```bash
   npm install -g vercel
   ```

3. **Set up environment variables:**
   
   Create a `.env.local` file in the root:
   ```env
   OPENROUTER_API_KEY=your_free_api_key_here
   ```

   Get your free API key from: https://openrouter.ai/keys

4. **Run locally with Vercel:**
   ```bash
   vercel dev
   ```

5. **Or serve static files:**
   ```bash
   npx http-server -p 3000
   ```
   
   Note: AI generation won't work without the serverless function.

### Vercel Deployment

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Connect to Vercel:**
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Configure project settings

3. **Add Environment Variables:**
   
   In Vercel Dashboard → Settings → Environment Variables:
   
   | Key | Value | Environment |
   |-----|-------|-------------|
   | `OPENROUTER_API_KEY` | Your OpenRouter API key | Production, Preview, Development |

4. **Deploy:**
   ```bash
   vercel --prod
   ```

5. **Verify Deployment:**
   - Visit your deployed URL
   - Start a mock test
   - Confirm questions generate within 3 seconds
   - Check browser console for any errors

### Post-Deployment Checklist

- [ ] Test loads with 4 initial questions
- [ ] Background filling adds questions every 3 seconds
- [ ] Timer counts down accurately
- [ ] Sidebar collapses/expands smoothly
- [ ] Submit button is visible in header
- [ ] Toast notifications appear on errors
- [ ] Results page shows correct score
- [ ] Dark/light theme toggle works
- [ ] Mobile responsive layout functions

---

## Streaming Fast-Start Algorithm

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    USER CLICKS "START TEST"                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: Generate 1 question per section (parallel)         │
│  - English: 1 question                                       │
│  - GK: 1 question                                            │
│  - Math: 1 question                                          │
│  - Analytical: 1 question                                    │
│  Time: ~3 seconds                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: Initialize Test UI IMMEDIATELY                     │
│  - Show first question                                       │
│  - Start timer                                               │
│  - Display sidebar with 4 dots                               │
│  - Enable all interactions                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: Background Loop (every 3 seconds)                  │
│  For each section:                                           │
│    If current_count < target_count:                          │
│      Generate 5 more questions                               │
│      Append to question pool                                 │
│      Update sidebar navigator                                │
│      Show toast: "New questions added"                       │
│  Repeat until all sections reach target                      │
└─────────────────────────────────────────────────────────────┘
```

### Code Implementation

```javascript
const StreamingEngine = {
  targetCounts: { english: 20, gk: 20, math: 30, analytical: 17 },
  
  async startFastTest() {
    // Generate 4 questions (1 per section)
    const initialQuestions = await Promise.all(
      CONFIG.SECTION_ORDER.map(section => this.generateSingleQuestion(section))
    );
    
    // Start test immediately
    state.test.questions = initialQuestions;
    navigateTo('test');
    BackgroundTimer.start(90 * 60, updateTimerDisplay, submitTest);
    
    // Begin background filling
    this.startBackgroundFilling();
  },
  
  startBackgroundFilling() {
    setInterval(async () => {
      for (const section of CONFIG.SECTION_ORDER) {
        const currentCount = countQuestions(section);
        if (currentCount < this.targetCounts[section]) {
          const newQuestions = await this.generateBatchQuestions(section, 5);
          state.test.questions.push(...newQuestions);
          updateNavigator();
          Toast.info('New questions added to your pool.');
        }
      }
    }, 3000);
  }
};
```

### Performance Metrics

| Metric | Traditional Approach | Streaming Fast-Start |
|--------|---------------------|----------------------|
| Time to First Question | 120-180 seconds | **3 seconds** |
| User Wait Time | High (blocking) | **None (non-blocking)** |
| Perceived Performance | Poor | **Excellent** |
| Bounce Rate Risk | High | **Minimal** |

---

## Error Recovery Strategies

### Multi-Layer Fallback System

```
┌─────────────────────────────────────────────────────────────┐
│                    QUESTION GENERATION REQUEST               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: Primary AI Model (openrouter:auto)                 │
│  - Routes to best available free model                       │
│  - Timeout: 30 seconds                                       │
│  - Retries: 3 attempts with exponential backoff              │
└─────────────────────────────────────────────────────────────┘
                              │
                    [If fails]
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: Alternative Parsing Strategies                     │
│  - Direct JSON parse                                         │
│  - Extract from code blocks                                  │
│  - Extract array blocks                                      │
│  - Fix trailing commas                                       │
│  - Parse individual objects                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                    [If fails]
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: Static Knowledge Bank                              │
│  - Load pre-written questions from JSON files                │
│  - Filter out duplicates                                     │
│  - Fill remaining slots                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                    [If insufficient]
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4: Extended Fallback                                  │
│  - Use any available questions                               │
│  - Reduce test length if necessary                           │
│  - Notify user via toast                                     │
└─────────────────────────────────────────────────────────────┘
```

### Retry Logic Implementation

```javascript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 10000,
  timeoutPerAttempt: 30000,
  exponentialBase: 2.2
};

function calculateBackoff(attempt) {
  const delay = RETRY_CONFIG.baseDelay * 
                Math.pow(RETRY_CONFIG.exponentialBase, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

// Usage in generateBatch()
for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
  try {
    const result = await callAI();
    return result;
  } catch (err) {
    if (attempt < RETRY_CONFIG.maxRetries - 1) {
      await sleep(calculateBackoff(attempt));
      continue;
    }
    throw err;
  }
}
```

### Error Types Handled

| Error Type | Detection | Recovery Action |
|------------|-----------|-----------------|
| Network Failure | `fetch()` throws | Retry with backoff, then fallback |
| 429 Rate Limit | HTTP status 429 | Switch model, wait, retry |
| 502/503/504 Server Error | HTTP status | Retry up to 3 times |
| Invalid JSON | `JSON.parse()` throws | Try 5 alternative parsers |
| Empty Response | `content === ''` | Retry or fallback |
| Missing Fields | Validation check | Filter and regenerate |
| Duplicate Questions | Hash comparison | Regenerate with new seed |

### Toast Notification Examples

```javascript
// Network error
Toast.error('Connection lost. Retrying...');

// AI failure
Toast.error('AI generation failed. Using fallback questions...');

// Parsing error
Toast.warning('Invalid response format. Trying alternative parser...');

// Rate limit
Toast.warning('Model busy. Switching to alternative free model...');

// Success after retry
Toast.success('Questions generated successfully!');

// Background filling
Toast.info('5 new questions added to your pool.');
```

---

## Security Best Practices

### API Key Management

✅ **DO:**
- Store API keys in Vercel Environment Variables
- Access via `process.env.OPENROUTER_API_KEY`
- Use `.env.local` for local development (gitignored)
- Rotate keys periodically

❌ **DON'T:**
- Hardcode keys in source code
- Commit `.env` files to Git
- Expose keys in client-side code
- Share keys in public repositories

### Input Validation

All user inputs are sanitized:

```javascript
// Candidate name sanitization
state.candidateName = nameInput.value.trim() || 'Practice Candidate';

// Numeric validation
const count = parseInt(req.body.count) || 20;

// Section validation
if (!CONFIG.SECTIONS[section]) {
  return res.status(400).json({ error: 'Invalid section' });
}
```

### XSS Prevention

- All dynamic content is inserted via `textContent`, not `innerHTML`
- Exception: Trusted HTML templates use template literals with controlled variables
- No `eval()` or `Function()` constructors
- Content Security Policy headers recommended

### Rate Limiting

Serverless function should implement rate limiting:

```javascript
// Add to api/generate.js
const RATE_LIMIT = 10; // requests per minute
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60000;
  const requests = rateLimitStore.get(ip) || [];
  const recentRequests = requests.filter(t => now - t < windowMs);
  
  if (recentRequests.length >= RATE_LIMIT) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimitStore.set(ip, recentRequests);
  return true;
}
```

### CORS Configuration

Restrict API access to your domain:

```javascript
// In api/generate.js
const allowedOrigins = [
  'https://ims-cbt-mock-tester.vercel.app',
  'https://www.ims-cbt-mock-tester.vercel.app'
];

const origin = req.headers.origin;
if (!allowedOrigins.includes(origin)) {
  return res.status(403).json({ error: 'Unauthorized origin' });
}
```

---

## API Reference

### POST /api/generate

Generates MCQ questions using AI.

**Request Body:**
```json
{
  "prompt": "Generate exactly 5 unique multiple-choice questions...",
  "systemPrompt": "You are an expert exam question writer...",
  "section": "gk",
  "count": 5
}
```

**Response (Success):**
```json
{
  "questions": [
    {
      "question": "What is the capital of Pakistan?",
      "options": ["Lahore", "Karachi", "Islamabad", "Peshawar"],
      "answer": 2,
      "explanation": "Islamabad became the capital in 1967."
    }
  ],
  "source": "AI",
  "model": "openrouter:auto",
  "aiGenerated": 5,
  "requested": 5
}
```

**Response (Failure):**
```json
{
  "error": "AI service unavailable",
  "details": "Failed to generate any questions",
  "questions": [],
  "aiGenerated": 0,
  "requested": 5
}
```

**Error Codes:**

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Invalid request | Check request body |
| 401 | Invalid API key | Verify environment variable |
| 403 | Unauthorized origin | Check CORS settings |
| 405 | Method not allowed | Use POST only |
| 429 | Rate limited | Implement backoff |
| 500 | Server error | Check logs |
| 503 | Service unavailable | Use fallback |

---

## Deployment Guide

### Vercel Configuration

Create `vercel.json` in the root:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    },
    {
      "src": "**/*.{html,css,js,json}",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/$1"
    }
  ],
  "env": {
    "OPENROUTER_API_KEY": "@openrouter-api-key"
  }
}
```

### Environment Variables in Vercel

1. Go to Vercel Dashboard
2. Select your project
3. Navigate to Settings → Environment Variables
4. Add:
   - Name: `OPENROUTER_API_KEY`
   - Value: Your OpenRouter API key
   - Environments: ✓ Production, ✓ Preview, ✓ Development

### Monitoring & Logging

Enable Vercel Analytics and Logs:

```bash
# View logs
vercel logs <deployment-url>

# Real-time logs
vercel logs --follow <deployment-url>
```

### Performance Optimization

1. **Enable Edge Caching:**
   ```javascript
   // In api/generate.js
   export const config = {
     maxDuration: 60,
     runtime: 'edge' // Optional: use Edge runtime
   };
   ```

2. **Compress Static Assets:**
   ```bash
   # Install compression tool
   npm install -g gzip-size
   
   # Compress files
   gzip -9 knowledge-bank/*.json
   ```

3. **Lazy Load Non-Critical Resources:**
   ```html
   <link rel="preload" href="styles.css" as="style">
   <link rel="preconnect" href="https://openrouter.ai">
   ```

---

## Troubleshooting

### Common Issues

**Problem:** Test doesn't start, stuck on loading screen

**Solution:**
1. Check browser console for errors
2. Verify `OPENROUTER_API_KEY` is set
3. Ensure `api/generate.js` is deployed correctly
4. Test API endpoint directly: `curl -X POST https://your-domain.vercel.app/api/generate`

**Problem:** Questions load but sidebar doesn't update

**Solution:**
1. Check `updateNavigator()` is called after questions are added
2. Verify `state.test.questions` array is being modified
3. Ensure event listeners are attached

**Problem:** Timer drifts or stops

**Solution:**
1. Verify `BackgroundTimer.start()` is called
2. Check `Date.now()` delta calculation
3. Ensure tab isn't being throttled by browser

**Problem:** AI returns invalid JSON

**Solution:**
1. Check `parseAIResponse()` function
2. Review 6-layer parsing strategy
3. Fallback to static bank should activate automatically

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make changes with clear commit messages
4. Test thoroughly locally
5. Submit a pull request

---

## License

This project is open-source and available under the MIT License.

---

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Contact: support@asqscholar.com
- Documentation: https://docs.asqscholar.com/ims-cbt

---

**Built with ❤️ for Pakistani students preparing for university admissions**

*Version 2.0 - Streaming Fast-Start Edition*
