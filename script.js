
// ==================== CONFIGURATION ====================
const CONFIG = {
  TOTAL_QUESTIONS: 87,
  TOTAL_TIME: 90 * 60,
  MAX_SAVED: 26,
  PASS_MARK: 50,
  SECTIONS: {
    english:    { name: 'English',              count: 20, weight: 1, icon: 'fa-language',   order: 1 },
    gk:         { name: 'General Knowledge',    count: 20, weight: 1, icon: 'fa-globe',      order: 2 },
    math:       { name: 'Mathematics',          count: 30, weight: 1, icon: 'fa-calculator', order: 3 },
    analytical: { name: 'Analytical Reasoning', count: 17, weight: 2, icon: 'fa-brain',      order: 4 }
  },
  SECTION_ORDER: ['english', 'gk', 'math', 'analytical'],

  async callSecureAI(prompt, systemPrompt, section) {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemPrompt, section })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
};

// ==================== STATE ====================
let state = {
  currentView: 'landing',
  candidateName: '',
  candidateId: '',
  test: null,
  currentQuestionIndex: 0,
  answers: {},
  markedQuestions: new Set(),
  timer: null,
  timeRemaining: CONFIG.TOTAL_TIME,
  theme: localStorage.getItem('asq_theme') || 'light',
  reviewFilter: 'all'
};

// ==================== DEDUPLICATION ENGINE ====================
const DedupEngine = {
  STORAGE_KEY: 'asq_dedup_v3',
  MAX_HISTORY: 800,
  load() { try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}'); } catch { return {}; } },
  save(h) { try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(h)); } catch {} },
  getGlobalUsed() {
    const h = this.load(); const all = new Set();
    Object.values(h).forEach(arr => { if (Array.isArray(arr)) arr.forEach(x => all.add(x)); });
    return all;
  },
  recordUsed(sectionKey, hashes) {
    const h = this.load();
    if (!h[sectionKey]) h[sectionKey] = [];
    hashes.forEach(x => { if (!h[sectionKey].includes(x)) h[sectionKey].push(x); });
    if (h[sectionKey].length > this.MAX_HISTORY) h[sectionKey] = h[sectionKey].slice(-this.MAX_HISTORY);
    this.save(h);
  },
  clear() { try { localStorage.removeItem(this.STORAGE_KEY); } catch {} }
};

function normalizeText(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function questionHash(q) {
  const text = normalizeText(q.question);
  const opts = (q.options || []).map(o => normalizeText(o)).join('|');
  let hash = 0;
  const str = text + '::' + opts;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return 'h_' + Math.abs(hash).toString(36);
}

function similarityScore(a, b) {
  const na = normalizeText(a); const nb = normalizeText(b);
  if (na === nb) return 1;
  if (!na.length || !nb.length) return 0;
  if (na.includes(nb) || nb.includes(na)) {
    const s = na.length < nb.length ? na : nb; const l = na.length >= nb.length ? na : nb;
    return s.length / l.length;
  }
  const wa = new Set(na.split(' ')); const wb = new Set(nb.split(' '));
  let common = 0; wa.forEach(w => { if (wb.has(w)) common++; });
  const total = Math.max(wa.size, wb.size);
  return total > 0 ? common / total : 0;
}

function isDuplicate(question, globalUsedSet, globalUsedList, threshold = 0.75) {
  const hash = questionHash(question);
  if (globalUsedSet.has(hash)) return true;
  for (const used of globalUsedList.slice(-100)) {
    if (similarityScore(question.question, used.question) >= threshold) return true;
  }
  return false;
}

// ==================== FALLBACK QUESTION BANKS ====================
