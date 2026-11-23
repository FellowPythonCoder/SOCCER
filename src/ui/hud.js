// All DOM UI: score, calls, dive readout, menus, help.
const fmtPct = (n) => `${Math.round(n * 100)}%`;

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    this.build();
    this.results = [];
    this.promptTimer = 0;
  }

  build() {
    this.root.innerHTML = `
      <div class="hud">
        <div class="topbar">
          <div class="score">
            <div class="stat"><span id="hud-goals">0</span><label>Goals conceded</label></div>
            <div class="stat"><span id="hud-saves">0</span><label>Saves</label></div>
            <div class="stat"><span id="hud-shot">0</span><label>Shots faced</label></div>
            <div class="stat"><span id="hud-streak">0</span><label>Save streak</label></div>
          </div>
          <div class="brand">
            <b>KEEPER</b><i>vs</i><b>STRIKER</b>
          </div>
          <div class="right">
            <div id="hud-saved" class="saved">SAVE %<span id="hud-pct">–</span></div>
            <button id="btn-menu" class="ghost" title="Menu (Esc)">☰</button>
          </div>
        </div>

        <div class="calls" id="hud-calls"></div>

        <div class="prompt" id="hud-prompt">
          <div class="shot-clock"><div id="hud-clock-fill"></div></div>
          <div class="prompt-text" id="hud-prompt-text">Striker approaching…</div>
        </div>

        <div class="dive-readout" id="hud-dive">
          <div class="dive-title">DIVE COMPUTED</div>
          <div class="dive-row"><label>Direction</label><span id="dive-dir">–</span></div>
          <div class="dive-row"><label>Type</label><span id="dive-type">–</span></div>
          <div class="dive-row"><label>Reach</label><span id="dive-reach">–</span></div>
          <div class="dive-row"><label>Glove</label><span id="dive-arm">–</span></div>
          <div class="dive-row"><label>Contact in</label><span id="dive-time">–</span></div>
          <div class="dive-bar"><div id="dive-conf"></div></div>
        </div>

        <div class="controls-hint" id="hud-hint">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</div>
          <div><kbd>R</kbd> automatic dive</div>
          <div><kbd>Mouse</kbd> look &nbsp;<kbd>Esc</kbd> menu</div>
        </div>

        <div class="crosshair" id="hud-cross"></div>

        <div class="touch" id="hud-touch">
          <div class="touch-dpad">
            <button class="tbtn" data-dir="up">▲</button>
            <button class="tbtn" data-dir="left">◀</button>
            <button class="tbtn" data-dir="right">▶</button>
            <button class="tbtn" data-dir="down">▼</button>
          </div>
          <button class="tdive" id="btn-touch-dive">R<span>dive</span></button>
        </div>

        <div class="result" id="hud-result">
          <div class="result-label" id="result-label">GOAL</div>
          <div class="result-sub" id="result-sub"></div>
        </div>

        <div class="menu hidden" id="hud-menu">
          <div class="menu-card">
            <h1>KEEPER <span>vs</span> STRIKER</h1>
            <p class="tag">A physics goalkeeper simulator. You are the keeper. The striker is an AI.</p>
            <div class="menu-section">
              <h2>Difficulty</h2>
              <div class="seg" id="menu-difficulty">
                <button data-diff="rookie">Rookie</button>
                <button data-diff="pro" class="on">Pro</button>
                <button data-diff="world">World Class</button>
              </div>
            </div>
            <div class="menu-section">
              <h2>Assists</h2>
              <label class="toggle"><input type="checkbox" id="opt-assisted"> <span>Assisted diving<em>Auto-dive triggers itself when the shot is committed. You stay in control of positioning.</em></span></label>
              <label class="toggle"><input type="checkbox" id="opt-cinematic" checked> <span>Cinematic replay<em>Slow-motion camera after each shot.</em></span></label>
              <label class="toggle"><input type="checkbox" id="opt-guide"> <span>Show shot trajectory<em>Display the ball's predicted path.</em></span></label>
            </div>
            <div class="menu-buttons">
              <button id="btn-play" class="primary">Play</button>
              <button id="btn-help" class="ghost">How diving works</button>
            </div>
            <div class="menu-help hidden" id="menu-help">
              <h2>How the dive works</h2>
              <p><b>R</b> is the only dive button. When you press it the game reads the live ball
              state (position, velocity, spin), predicts the flight with drag and Magnus force, and
              then <em>rehearses</em> every candidate dive — left, right, low, high, forward, jump,
              brace — by running the real ragdoll through the physics solver. It picks the dive that
              actually puts a glove closest to the ball, then launches your body with a real impulse
              and joint torques. There are no diving animations.</p>
              <p>You do not choose a side. If the ball is too close, too wide or too fast, the keeper
              still throws himself at it — a desperate dive looks desperate, because it is.</p>
              <h2>Tips</h2>
              <ul>
                <li>Standing on the angle makes the far corner a much longer dive.</li>
                <li>Narrow the angle by coming forward, but a chip can beat you.</li>
                <li>Wait until the ball is committed, then dive. Early dives are free goals.</li>
                <li>Ledger: the faster the ball, the less time the planner has.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
    const q = (id) => this.root.querySelector(`#${id}`);
    this.el = {
      goals: q('hud-goals'),
      saves: q('hud-saves'),
      shot: q('hud-shot'),
      streak: q('hud-streak'),
      pct: q('hud-pct'),
      calls: q('hud-calls'),
      prompt: q('hud-prompt'),
      promptText: q('hud-prompt-text'),
      clock: q('hud-clock-fill'),
      dive: q('hud-dive'),
      diveDir: q('dive-dir'),
      diveType: q('dive-type'),
      diveReach: q('dive-reach'),
      diveArm: q('dive-arm'),
      diveTime: q('dive-time'),
      conf: q('dive-conf'),
      result: q('hud-result'),
      resultLabel: q('result-label'),
      resultSub: q('result-sub'),
      menu: q('hud-menu'),
      cross: q('hud-cross'),
      hint: q('hud-hint'),
      touch: q('hud-touch'),
    };
    // Touch controls are pointer-events:auto and only shown on touch devices
    if (!('ontouchstart' in window)) this.el.touch.classList.add('hidden');
    else this.el.touch.classList.add('show');
  }

  setStats(score) {
    this.el.goals.textContent = score.goals;
    this.el.saves.textContent = score.saves;
    this.el.shot.textContent = score.shots;
    const pct = score.shots ? score.saves / score.shots : 0;
    this.el.pct.textContent = score.shots ? fmtPct(pct) : '–';
    this.el.streak.textContent = this.streakValue ?? 0;
  }

  setStreak(n) {
    this.streakValue = n;
    this.el.streak.textContent = n;
  }

  // Text banner across the screen ("SAVED!", "GOAL", …)
  call(text, kind = 'info', sub = '') {
    const div = document.createElement('div');
    div.className = `call ${kind}`;
    div.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.el.calls.appendChild(div);
    setTimeout(() => div.classList.add('out'), 1500);
    setTimeout(() => div.remove(), 2200);
    while (this.el.calls.children.length > 3) this.el.calls.firstChild.remove();
  }

  showResult(kind, detail) {
    const labels = {
      goal: ['GOAL', 'The striker beat you'],
      save: ['SAVED', 'Gloves on it'],
      catch: ['CAUGHT', 'Held cleanly'],
      miss: ['OFF TARGET', 'Never in doubt'],
    };
    const [label, sub] = labels[kind] ?? ['—', ''];
    this.el.resultLabel.textContent = label;
    this.el.resultSub.textContent = detail || sub;
    this.el.result.className = `result show ${kind}`;
    setTimeout(() => { this.el.result.className = 'result'; }, 1900);
  }

  showPrompt(text, frac = null) {
    this.el.prompt.classList.add('show');
    this.el.promptText.textContent = text;
    if (frac !== null) {
      this.el.clock.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      this.el.clock.parentElement.style.opacity = 1;
    } else {
      this.el.clock.parentElement.style.opacity = 0;
    }
  }

  hidePrompt() {
    this.el.prompt.classList.remove('show');
  }

  showDive(plan) {
    const dirMap = {
      'dive-left': 'LEFT', 'low-left': 'LOW LEFT', 'high-left': 'HIGH LEFT',
      'dive-right': 'RIGHT', 'low-right': 'LOW RIGHT', 'high-right': 'HIGH RIGHT',
      'forward-low': 'FORWARD LOW', 'forward-high': 'FORWARD HIGH',
      jump: 'UP', block: 'BLOCK', stand: 'STAY TALL', reflex: 'REFLEX BRACE',
    };
    this.el.diveDir.textContent = dirMap[plan.profile] ?? '—';
    this.el.diveType.textContent = plan.profile;
    const reach = plan.rehearsedError != null
      ? `${(plan.rehearsedError * 100).toFixed(0)} cm off`
      : `${(plan.error ?? 0).toFixed(2)} m margin`;
    this.el.diveReach.textContent = reach;
    this.el.diveArm.textContent = plan.arm === 'both' ? 'both hands' : `${plan.arm} hand`;
    this.el.diveTime.textContent = `${(plan.tContact ?? 0).toFixed(2)} s`;
    this.el.conf.style.width = `${Math.round((plan.confidence ?? 0) * 100)}%`;
    this.el.dive.classList.add('show');
    clearTimeout(this.diveTimer);
    this.diveTimer = setTimeout(() => this.el.dive.classList.remove('show'), 2400);
  }

  showMenu(show) {
    this.el.menu.classList.toggle('hidden', !show);
  }

  menuVisible() {
    return !this.el.menu.classList.contains('hidden');
  }

  toggleHelp(force) {
    const help = this.root.querySelector('#menu-help');
    const show = force ?? help.classList.contains('hidden');
    help.classList.toggle('hidden', !show);
  }

  setCrosshair(on) {
    this.el.cross.style.opacity = on ? 0.55 : 0;
  }
}
