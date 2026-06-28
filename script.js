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
  reviewFilter: 'all',
  testStartTime: null
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

// ==================== KNOWLEDGE BANK LOADER ====================
const KnowledgeBank = {
  async loadSection(section) {
    try {
      const response = await fetch(`/knowledge-bank/${section}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      console.warn(`Failed to load knowledge bank for ${section}:`, e);
      return [];
    }
  },
  
  async loadAll() {
    const banks = {};
    for (const section of CONFIG.SECTION_ORDER) {
      banks[section] = await this.loadSection(section);
    }
    return banks;
  }
};

// ==================== TOAST NOTIFICATIONS ====================
const Toast = {
  container: null,
  
  init() {
    this.container = document.getElementById('toastContainer');
  },
  
  show(message, type = 'info') {
    if (!this.container) this.init();
    
    const icons = { error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', success: 'fa-circle-check', info: 'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon"><i class="fa-solid ${icons[type]}"></i></div>
      <div class="toast-message">${message}</div>
      <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
      <div class="toast-progress"></div>
    `;
    
    this.container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
      }
    }, 3500);
  },
  
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  success(msg) { this.show(msg, 'success'); },
  info(msg) { this.show(msg, 'info'); }
};

// ==================== BACKGROUND TIMER (WEB WORKER APPROACH) ====================
const BackgroundTimer = {
  startTime: null,
  intervalId: null,
  callback: null,
  
  start(durationSeconds, onTick, onComplete) {
    this.startTime = Date.now();
    const targetEnd = this.startTime + (durationSeconds * 1000);
    this.callback = { onTick, onComplete };
    
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - this.startTime) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      
      if (remaining <= 0) {
        this.stop();
        if (onComplete) onComplete();
      } else {
        if (onTick) onTick(remaining);
      }
    }, 1000);
  },
  
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },
  
  getRemaining() {
    if (!this.startTime) return 0;
    return Math.max(0, CONFIG.TOTAL_TIME - Math.floor((Date.now() - this.startTime) / 1000));
  }
};

// ==================== THEME MANAGEMENT ====================
function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('asq_theme', state.theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = state.theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = state.theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// ==================== NAVIGATION ====================
function navigateTo(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  state.currentView = viewId;
  
  const subHeader = document.getElementById('subHeader');
  if (subHeader) subHeader.style.display = viewId === 'test' ? 'flex' : 'none';
}

// ==================== SIDEBAR MANAGEMENT ====================
function toggleSidebar() {
  const sidebar = document.querySelector('.test-sidebar');
  const main = document.querySelector('.test-main');
  if (sidebar && main) {
    sidebar.classList.toggle('expanded');
    main.classList.toggle('with-sidebar');
  }
}

function expandSidebar() {
  const sidebar = document.querySelector('.test-sidebar');
  const main = document.querySelector('.test-main');
  if (sidebar && main && !sidebar.classList.contains('expanded')) {
    sidebar.classList.add('expanded');
    main.classList.add('with-sidebar');
  }
}

function showTestUI() {
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const headerSubmitBtn = document.getElementById('headerSubmitBtn');
  const headerSubmitBtnTest = document.getElementById('headerSubmitBtnTest');
  if (sidebarToggleBtn) sidebarToggleBtn.style.display = 'flex';
  if (headerSubmitBtn) headerSubmitBtn.style.display = 'none'; // Hide old button in main header
  if (headerSubmitBtnTest) headerSubmitBtnTest.style.display = 'flex'; // Show button in sub-header next to timer
}

// ==================== QUESTION NAVIGATION ====================
function goToQuestion(index) {
  if (state.test && index >= 0 && index < state.test.questions.length) {
    state.currentQuestionIndex = index;
    renderQuestion(index);
    updateNavigator();
    // Do NOT automatically close sidebar - user must manually click toggle
  }
}

function nextQuestion() {
  if (state.currentQuestionIndex < state.test.questions.length - 1) {
    goToQuestion(state.currentQuestionIndex + 1);
  }
}

function prevQuestion() {
  if (state.currentQuestionIndex > 0) {
    goToQuestion(state.currentQuestionIndex - 1);
  }
}

function selectOption(optionIndex) {
  const q = state.test.questions[state.currentQuestionIndex];
  if (!q) return;
  state.answers[q.id] = optionIndex;
  renderOptions(q);
  updateNavigator();
  updateStats();
}

function toggleMark() {
  const q = state.test.questions[state.currentQuestionIndex];
  if (!q) return;
  if (state.markedQuestions.has(q.id)) {
    state.markedQuestions.delete(q.id);
  } else {
    if (state.markedQuestions.size >= CONFIG.MAX_SAVED) {
      Toast.warning(`Maximum ${CONFIG.MAX_SAVED} questions can be saved for later`);
      return;
    }
    state.markedQuestions.add(q.id);
  }
  updateNavigator();
  updateStats();
}

// ==================== RENDERING ====================
function renderQuestion(index) {
  const q = state.test.questions[index];
  if (!q) return;

  const questionNumberLabelEl = document.getElementById('questionNumberLabel');
  const sectionTagEl = document.getElementById('sectionTag');
  const questionWeightEl = document.getElementById('questionWeight');
  const questionTextEl = document.getElementById('questionText');
  const passageContainerEl = document.getElementById('passageContainer');
  const prevBtnEl = document.getElementById('prevBtn');
  const nextBtnEl = document.getElementById('nextBtn');
  const sectionProgressTextEl = document.getElementById('sectionProgressText');
  const breadcrumbSubjectEl = document.getElementById('breadcrumbSubject');

  if (questionNumberLabelEl) questionNumberLabelEl.textContent = `Question ${index + 1}`;
  if (sectionTagEl) sectionTagEl.innerHTML = `<i class="fa-solid ${CONFIG.SECTIONS[q.section].icon}"></i> ${CONFIG.SECTIONS[q.section].name}`;
  if (questionWeightEl) questionWeightEl.textContent = `Weight ${q.weight}`;
  if (questionTextEl) questionTextEl.textContent = q.question;

  if (passageContainerEl) {
    if (q.passage) {
      passageContainerEl.innerHTML = `<div class="passage-box"><span class="passage-label">Passage</span>${q.passage}</div>`;
    } else {
      passageContainerEl.innerHTML = '';
    }
  }

  renderOptions(q);

  if (prevBtnEl) prevBtnEl.disabled = index === 0;
  if (nextBtnEl) {
    nextBtnEl.innerHTML = index === state.test.questions.length - 1 
      ? 'Save & Submit <i class="fa-solid fa-flag-checkered"></i>' 
      : 'Save & Next <i class="fa-solid fa-chevron-right"></i>';
  }

  if (sectionProgressTextEl) sectionProgressTextEl.textContent = `${index + 1} of ${state.test.questions.length}`;
  if (breadcrumbSubjectEl) breadcrumbSubjectEl.textContent = CONFIG.SECTIONS[q.section].name;
}

function renderOptions(q) {
  const list = document.getElementById('optionsList');
  if (!list) return;
  list.innerHTML = '';
  q.options.forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = `option-item${state.answers[q.id] === i ? ' selected' : ''}`;
    item.onclick = () => selectOption(i);
    item.innerHTML = `
      <div class="option-radio"></div>
      <div class="option-text">${String.fromCharCode(65 + i)}. ${opt}</div>
    `;
    list.appendChild(item);
  });
}

function updateNavigator() {
  const nav = document.getElementById('questionNavigator');
  if (!nav || !state.test) return;
  
  nav.innerHTML = '';
  
  // Group questions by section and render with headers
  CONFIG.SECTION_ORDER.forEach(sectionKey => {
    const sectionConfig = CONFIG.SECTIONS[sectionKey];
    const sectionQuestions = state.test.questions.filter(q => q.section === sectionKey);
    
    if (sectionQuestions.length === 0) return;
    
    // Create section header
    const header = document.createElement('div');
    header.className = 'sidebar-section-header';
    const currentCount = sectionQuestions.length;
    const targetCount = StreamingEngine.targetCounts[sectionKey] || sectionConfig.count;
    header.innerHTML = `<strong>${sectionConfig.name}</strong> <span>(${currentCount}/${targetCount})</span>`;
    nav.appendChild(header);
    
    // Create container for this section's dots
    const sectionGrid = document.createElement('div');
    sectionGrid.className = 'sidebar-section-grid';
    
    sectionQuestions.forEach((q, i) => {
      // Find global index
      const globalIndex = state.test.questions.findIndex(qq => qq.id === q.id);
      
      const dot = document.createElement('div');
      dot.className = 'nav-dot';
      if (globalIndex === state.currentQuestionIndex) dot.classList.add('current');
      if (state.answers[q.id] !== undefined) dot.classList.add('answered');
      if (state.markedQuestions.has(q.id)) dot.classList.add('marked');
      if (state.answers[q.id] !== undefined && state.markedQuestions.has(q.id)) dot.classList.add('answered-marked');
      dot.textContent = globalIndex + 1;
      dot.onclick = () => goToQuestion(globalIndex);
      sectionGrid.appendChild(dot);
    });
    
    nav.appendChild(sectionGrid);
  });
}

function updateStats() {
  const answered = Object.keys(state.answers).length;
  const saved = state.markedQuestions.size;
  const percent = Math.round((answered / state.test.questions.length) * 100);
  
  document.getElementById('answeredCount').textContent = answered;
  document.getElementById('savedCount').textContent = saved;
  document.getElementById('answeredPercent').textContent = `${percent}% complete`;
  document.getElementById('answeredProgress').style.width = `${percent}%`;
}

function updateTimerDisplay(remaining) {
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  
  // Update both timer displays (stats card and header)
  const timerDisplayEl = document.getElementById('timerDisplay');
  const headerTimerDisplayEl = document.getElementById('headerTimerDisplay');
  if (timerDisplayEl) timerDisplayEl.textContent = timeStr;
  if (headerTimerDisplayEl) headerTimerDisplayEl.textContent = timeStr;
  
  const timerProgressEl = document.getElementById('timerProgress');
  if (timerProgressEl) {
    timerProgressEl.style.width = `${(remaining / CONFIG.TOTAL_TIME) * 100}%`;
  }
  
  const paceBadge = document.getElementById('paceBadge');
  const paceDetail = document.getElementById('paceDetail');
  const paceText = document.getElementById('paceText');
  
  const totalQ = state.test.questions.length;
  const answered = Object.keys(state.answers).length;
  const elapsed = CONFIG.TOTAL_TIME - remaining;
  const expectedProgress = (elapsed / CONFIG.TOTAL_TIME) * totalQ;
  
  if (answered < expectedProgress * 0.8) {
    if (paceBadge) paceBadge.className = 'pace-badge behind';
    if (paceDetail) paceDetail.textContent = 'Need to speed up';
    if (paceText) {
      paceText.textContent = 'Behind pace';
      paceText.style.color = 'var(--accent-orange)';
    }
  } else if (answered > expectedProgress * 1.2) {
    if (paceBadge) paceBadge.className = 'pace-badge ahead';
    if (paceDetail) paceDetail.textContent = 'Great progress';
    if (paceText) {
      paceText.textContent = 'Ahead of pace';
      paceText.style.color = 'var(--accent-green)';
    }
  } else {
    if (paceBadge) paceBadge.className = 'pace-badge on-track';
    if (paceDetail) paceDetail.textContent = 'Good pace';
    if (paceText) {
      paceText.textContent = 'On track';
      paceText.style.color = 'var(--accent-blue)';
    }
  }
}

// ==================== TEST GENERATION ====================
async function generateSectionQuestions(section, count, existingQuestions) {
  const maxAttempts = 3;
  let collected = [];
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const needed = count - collected.length;
    if (needed <= 0) break;
    
    try {
      const batchCount = Math.min(10, needed);
      const prompt = `Generate exactly ${batchCount} unique multiple-choice questions for ${CONFIG.SECTIONS[section].name}. Each question must have: question (string), options (array of 4 strings), answer (integer 0-3), explanation (string). Return ONLY a valid JSON array.`;
      const systemPrompt = `You are an expert exam question writer. Generate challenging but fair questions for Pakistani university admission tests. Focus on current affairs, Pakistan national issues, international relations (UN, OIC, SCO), CPEC, economy, politics, and major cities for GK section. Return ONLY valid JSON array with no markdown or extra text.`;
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          systemPrompt,
          section,
          count: batchCount
        })
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse AI response with multiple recovery strategies
      let questions = parseAIResponse(content);
      
      // Filter and validate
      questions = questions.filter(q => {
        if (!q.question || !q.options || q.options.length !== 4 || typeof q.answer !== 'number') return false;
        if (isDuplicate(q, DedupEngine.getGlobalUsed(), [])) return false;
        q.section = section;
        q.weight = CONFIG.SECTIONS[section].weight;
        q.aiGenerated = true;
        return true;
      });
      
      collected.push(...questions);
      
    } catch (e) {
      console.warn(`Attempt ${attempt + 1} failed for ${section}:`, e.message);
      // Show toast on every attempt failure during generation phase
      const retryMsg = attempt < maxAttempts - 1 ? ' Retrying...' : '';
      Toast.error(`AI generation attempt ${attempt + 1}/${maxAttempts} failed: ${e.message}.${retryMsg}`);
      if (attempt === maxAttempts - 1) {
        Toast.warning(`AI generation failed for ${CONFIG.SECTIONS[section].name}. Using fallback questions from Knowledge Bank.`);
      }
    }
  }
  
  // Fill remaining with static questions
  while (collected.length < count) {
    const staticQs = await KnowledgeBank.loadSection(section);
    const needed = count - collected.length;
    const available = staticQs.filter(q => !isDuplicate(q, DedupEngine.getGlobalUsed(), collected.map(q => ({ question: q.question }))));
    const toAdd = available.slice(0, needed);
    
    if (toAdd.length === 0) {
      // No more unique questions available, use what we have
      break;
    }
    
    toAdd.forEach(q => {
      q.section = section;
      q.weight = CONFIG.SECTIONS[section].weight;
      q.aiGenerated = false;
    });
    collected.push(...toAdd);
  }
  
  // Record used questions
  collected.forEach(q => {
    const hash = questionHash(q);
    DedupEngine.recordUsed(section, [hash]);
  });
  
  return collected;
}

function parseAIResponse(content) {
  if (!content) return [];
  
  // Strategy 1: Direct JSON parse
  try { return JSON.parse(content); } catch {}
  
  // Strategy 2: Extract JSON array from code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch {}
  }
  
  // Strategy 3: Extract first [...] block
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }
  
  // Strategy 4: Fix trailing commas
  const fixed = content.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
  try { return JSON.parse(fixed); } catch {}
  
  // Strategy 5: Try extracting individual question objects
  const questions = [];
  const objMatches = content.match(/{[\s\S]*?}/g) || [];
  for (const match of objMatches) {
    try {
      const q = JSON.parse(match);
      if (q.question && q.options) questions.push(q);
    } catch {}
  }
  if (questions.length > 0) return questions;
  
  // Strategy 6: Last resort - return empty
  return [];
}

// ==================== STREAMING FAST-START MODE ====================
const StreamingEngine = {
  targetCounts: { english: 20, gk: 20, math: 30, analytical: 17 },
  backgroundInterval: null,
  currentSectionIndex: 0, // Track which section we're filling
  
  async startFastTest() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingMessage = document.getElementById('loadingMessage');
    
    loadingOverlay.style.display = 'flex';
    loadingMessage.textContent = 'Generating initial 10 English questions...';
    
    state.test = { questions: [] };
    state.answers = {};
    state.markedQuestions = new Set();
    state.currentQuestionIndex = 0;
    
    // Generate exactly 10 English questions immediately to start the test
    try {
      const initialQuestions = await this.generateBatchQuestions('english', 10);
      initialQuestions.forEach(q => {
        q.section = 'english';
        q.weight = CONFIG.SECTIONS['english'].weight;
      });
      state.test.questions.push(...initialQuestions);
    } catch (e) {
      console.warn('Failed to generate initial English questions:', e.message);
      Toast.error('Failed to generate English questions. Using fallback.');
      // Fallback to static bank
      const staticQs = await KnowledgeBank.loadSection('english');
      const fallback = staticQs.slice(0, 10);
      fallback.forEach(q => {
        q.section = 'english';
        q.weight = CONFIG.SECTIONS['english'].weight;
        q.aiGenerated = false;
      });
      state.test.questions.push(...fallback);
    }
    
    loadingOverlay.style.display = 'none';
    
    // Initialize test UI and START IMMEDIATELY
    navigateTo('test');
    renderQuestion(0);
    updateNavigator();
    updateStats();
    showTestUI();
    
    // Start background timer
    BackgroundTimer.start(CONFIG.TOTAL_TIME, updateTimerDisplay, () => {
      Toast.warning('Time is up! Submitting your test...');
      setTimeout(submitTest, 2000);
    });
    
    expandSidebar(); // Expand sidebar on initial load so user can see the questions
    Toast.success(`Test started with ${state.test.questions.length} English questions. More loading in background...`);
    
    // Begin sequential background filling (starts from english since we already have 10)
    this.currentSectionIndex = 0; // Start from english
    this.startBackgroundFilling();
  },
  
  async generateSingleQuestion(section) {
    const prompt = `Generate exactly 1 unique multiple-choice question for ${CONFIG.SECTIONS[section].name}. Return ONLY a JSON array with 1 object: [{"question":"...","options":["A)","B)","C)","D)"],"answer":0,"explanation":"..."}]`;
    const systemPrompt = 'You are an expert exam question writer. Output ONLY valid JSON array with exactly 1 question.';
    
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemPrompt, section, count: 1 })
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    let questions = parseAIResponse(content);
    
    if (questions.length > 0) {
      questions[0].aiGenerated = true;
      return questions[0];
    }
    return null;
  },
  
  startBackgroundFilling() {
    this.backgroundInterval = setInterval(async () => {
      // Check if all sections are complete - if so, stop immediately
      const allComplete = CONFIG.SECTION_ORDER.every(s => 
        state.test.questions.filter(q => q.section === s).length >= this.targetCounts[s]
      );
      
      if (allComplete) {
        this.stopBackgroundFilling();
        Toast.success('All questions loaded!');
        return;
      }
      
      let anyAdded = false;
      
      // Sequential Section Filler: Process sections in order
      for (let i = this.currentSectionIndex; i < CONFIG.SECTION_ORDER.length; i++) {
        const section = CONFIG.SECTION_ORDER[i];
        const currentCount = state.test.questions.filter(q => q.section === section).length;
        const targetCount = this.targetCounts[section];
        
        if (currentCount >= targetCount) {
          // This section is full, move to next section
          this.currentSectionIndex = i + 1;
          continue;
        }
        
        // Generate 5 at a time for this section
        const batchSize = Math.min(5, targetCount - currentCount);
        
        try {
          const newQuestions = await this.generateBatchQuestions(section, batchSize);
          
          if (newQuestions.length > 0) {
            newQuestions.forEach(q => {
              q.section = section;
              q.weight = CONFIG.SECTIONS[section].weight;
            });
            
            state.test.questions.push(...newQuestions);
            
            updateNavigator();
            updateStats();
            
            anyAdded = true;
            console.log(`[Streaming] Added ${newQuestions.length} ${section} questions. Total: ${state.test.questions.length}`);
          }
        } catch (e) {
          console.warn(`Background generation failed for ${section}:`, e.message);
          // Fill from static bank silently
          const staticQs = await KnowledgeBank.loadSection(section);
          const available = staticQs.slice(currentCount, currentCount + batchSize);
          if (available.length > 0) {
            available.forEach(q => {
              q.section = section;
              q.weight = CONFIG.SECTIONS[section].weight;
              q.aiGenerated = false;
            });
            state.test.questions.push(...available);
            updateNavigator();
            updateStats();
            anyAdded = true;
          }
        }
        
        // After adding to current section, check if it's now complete
        const newCount = state.test.questions.filter(q => q.section === section).length;
        if (newCount >= targetCount) {
          this.currentSectionIndex = i + 1; // Move to next section
        }
        
        // Only process one section per interval tick (sequential, not parallel)
        break;
      }
      
      if (anyAdded) {
        Toast.info('New questions added to your pool.');
      }
      
      // Final check if all sections are complete after this iteration
      const finalCheck = CONFIG.SECTION_ORDER.every(s => 
        state.test.questions.filter(q => q.section === s).length >= this.targetCounts[s]
      );
      
      if (finalCheck) {
        this.stopBackgroundFilling();
        Toast.success('All questions loaded!');
      }
    }, 3000); // Run every 3 seconds
  },
  
  async generateBatchQuestions(section, count) {
    const prompt = `Generate exactly ${count} unique multiple-choice questions for ${CONFIG.SECTIONS[section].name}. Return ONLY a JSON array.`;
    const systemPrompt = 'You are an expert exam question writer. Output ONLY valid JSON array.';
    
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemPrompt, section, count })
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    let questions = parseAIResponse(content);
    
    // Deduplicate
    const existingHashes = new Set(state.test.questions.map(questionHash));
    questions = questions.filter(q => {
      const hash = questionHash(q);
      if (existingHashes.has(hash)) return false;
      existingHashes.add(hash);
      q.aiGenerated = true;
      return true;
    });
    
    return questions;
  },
  
  stopBackgroundFilling() {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
    }
  }
};

async function startMockTest() {
  const nameInput = document.getElementById('candidateName');
  state.candidateName = nameInput.value.trim() || 'Practice Candidate';
  state.candidateId = 'PRC' + Math.floor(Math.random() * 900 + 100);
  
  document.getElementById('headerCandidateName').textContent = state.candidateName;
  document.getElementById('headerCandidateId').textContent = state.candidateId;
  
  // Use Streaming Fast-Start Mode
  await StreamingEngine.startFastTest();
}

// ==================== TEST SUBMISSION ====================
function confirmSubmit() {
  const answered = Object.keys(state.answers).length;
  const unanswered = state.test.questions.length - answered;
  
  document.getElementById('confirmTitle').textContent = 'Submit Test?';
  document.getElementById('confirmMessage').textContent = 
    `You have answered ${answered} out of ${state.test.questions.length} questions.${unanswered > 0 ? ` ${unanswered} questions will be marked as unanswered.` : ''}`;
  
  const actionBtn = document.getElementById('confirmAction');
  actionBtn.textContent = 'Confirm Submit';
  actionBtn.onclick = () => { closeConfirm(); submitTest(); };
  
  document.getElementById('confirmDialog').style.display = 'flex';
}

function closeConfirm() {
  document.getElementById('confirmDialog').style.display = 'none';
}

function submitTest() {
  BackgroundTimer.stop();
  
  // Calculate results
  let correct = 0, incorrect = 0, skipped = 0, totalWeight = 0, earnedWeight = 0;
  
  state.test.questions.forEach(q => {
    const userAnswer = state.answers[q.id];
    if (userAnswer === undefined) {
      skipped++;
    } else if (userAnswer === q.answer) {
      correct++;
      earnedWeight += q.weight;
    } else {
      incorrect++;
    }
    totalWeight += q.weight;
  });
  
  const percentage = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const passed = percentage >= CONFIG.PASS_MARK;
  
  // Display results - with null checks
  const resultsCandidateInfoEl = document.getElementById('resultsCandidateInfo');
  const scorePercentEl = document.getElementById('scorePercent');
  const scoreCircleEl = document.getElementById('scoreCircle');
  const correctCountEl = document.getElementById('correctCount');
  const wrongCountEl = document.getElementById('wrongCount');
  const unattemptedCountEl = document.getElementById('unattemptedCount');
  
  if (resultsCandidateInfoEl) resultsCandidateInfoEl.textContent = `${state.candidateName} | ID: ${state.candidateId}`;
  if (scorePercentEl) scorePercentEl.textContent = `${percentage}%`;
  if (scoreCircleEl) {
    scoreCircleEl.setAttribute('stroke-dasharray', `${2 * Math.PI * 70}`);
    scoreCircleEl.setAttribute('stroke-dashoffset', `${2 * Math.PI * 70 * (1 - percentage / 100)}`);
    const scoreColor = passed ? 'var(--accent-green)' : 'var(--accent-red)';
    scoreCircleEl.setAttribute('stroke', scoreColor);
  }
  if (scorePercentEl) scorePercentEl.style.color = passed ? 'var(--accent-green)' : 'var(--accent-red)';
  if (correctCountEl) correctCountEl.textContent = correct;
  if (wrongCountEl) wrongCountEl.textContent = incorrect;
  if (unattemptedCountEl) unattemptedCountEl.textContent = skipped;
  
  // Render review
  renderReview();
  
  navigateTo('results');
  const sidebarEl = document.querySelector('.test-sidebar');
  const mainEl = document.querySelector('.test-main');
  if (sidebarEl) sidebarEl.classList.remove('expanded');
  if (mainEl) mainEl.classList.remove('with-sidebar');
  
  Toast.success(`Test submitted! You scored ${percentage}%`);
}

function renderReview() {
  const grid = document.getElementById('reviewGrid');
  grid.innerHTML = '';
  
  const filter = state.reviewFilter;
  state.test.questions.forEach((q, i) => {
    const userAnswer = state.answers[q.id];
    let status = 'skipped';
    if (userAnswer !== undefined) {
      status = userAnswer === q.answer ? 'correct' : 'incorrect';
    }
    
    if (filter !== 'all' && filter !== status) return;
    
    const item = document.createElement('div');
    item.className = `review-item ${status}`;
    item.innerHTML = `
      <div class="review-question">${i + 1}. ${q.question}</div>
      <div class="review-options">
        ${q.options.map((opt, j) => {
          let classes = 'review-option';
          if (j === userAnswer) classes += ' user-selected';
          if (j === q.answer) classes += ' correct-answer';
          if (j === userAnswer && j !== q.answer) classes += ' wrong-answer';
          return `<div class="${classes}">${String.fromCharCode(65 + j)}. ${opt}</div>`;
        }).join('')}
      </div>
      ${q.explanation ? `<div class="review-explanation"><strong>Explanation</strong>${q.explanation}</div>` : ''}
    `;
    grid.appendChild(item);
  });
}

function setReviewFilter(filter) {
  state.reviewFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderReview();
}

function confirmExitTest() {
  document.getElementById('confirmTitle').textContent = 'Exit Test?';
  document.getElementById('confirmMessage').textContent = 'Your progress will be lost. Are you sure you want to exit?';
  
  const actionBtn = document.getElementById('confirmAction');
  actionBtn.textContent = 'Exit Test';
  actionBtn.onclick = () => {
    closeConfirm();
    BackgroundTimer.stop();
    navigateTo('landing');
  };
  
  document.getElementById('confirmDialog').style.display = 'flex';
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  if (state.currentView !== 'test') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  if (e.key >= '1' && e.key <= '4') {
    selectOption(parseInt(e.key) - 1);
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    nextQuestion();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prevQuestion();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMark();
  }
});

// ==================== BEFORE UNLOAD WARNING ====================
window.addEventListener('beforeunload', (e) => {
  if (state.currentView === 'test' && state.test) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  Toast.init();
  navigateTo('landing');
});
