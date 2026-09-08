// ============================================================
// Portfolio Quest — side-scrolling resume platformer
// วิ่งผ่านไทม์ไลน์ 2000 → ปัจจุบัน เก็บทักษะ 48 orb + ใบเซอร์ 5 ใบ
// ============================================================
(() => {
  "use strict";

  let W = 960, H = 540; // ปรับตามสัดส่วนจอ — เกมเต็มหน้าจอเสมอ
  const GROUND_Y = 460;  // พิกัดโลกของพื้น (อิงเฟรมสูง 540 แล้วขยายฟ้าเพิ่มด้านบน)
  const GRAVITY = 0.55;
  const MOVE_SPEED = 4.6;
  const JUMP_V = -12.5;
  const BRIDGE_W = 700;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  function resize() {
    const aspect = Math.max(0.4, innerWidth / Math.max(1, innerHeight));
    if (aspect >= 1.2) { // จอกว้าง — สูงคงที่ ขยายมุมมองด้านข้าง (มือถือแนวนอง 20:9 ต้องไม่ถูกบีบ)
      H = 540; W = Math.min(Math.round(540 * aspect), 1600);
    } else {            // จอสูง/แนวตั้ง — กว้างคงที่ ขยายท้องฟ้าขึ้นบน
      W = 700; H = Math.min(Math.round(700 / aspect), 1600);
    }
    canvas.width = W; canvas.height = H;
  }
  addEventListener("resize", resize);
  resize();

  // ---------------- World building ----------------
  const zones = [];   // {level, x0, x1, w}
  const platforms = []; // {x,y,w,h, zone}
  const orbs = [];    // {x,y,skill,zone,collected,phase, fromMonster}
  const monsters = []; // {x,y,w,h,dir,minX,maxX,alive,squashT,skill,zone,phase}
  const certs = [];   // {x,y,name,zone,collected,phase}
  let worldW = 0;
  let flagX = 0;

  function zoneWidth(lv) {
    if (lv.kind === "bridge") return BRIDGE_W;
    return 1000 + lv.skills.length * 240 + lv.certs.length * 160;
  }

  function buildWorld() {
    let x = 520; // starting pad before first zone
    LEVELS.forEach((lv, zi) => {
      const w = zoneWidth(lv);
      zones.push({ level: lv, x0: x, x1: x + w, w });

      if (lv.kind !== "bridge") {
        const nSkills = lv.skills.length;
        // จำนวนทักษะที่ฝากไว้กับ monster (เหยียบแล้วได้)
        const nMon = nSkills >= 5 ? 2 : nSkills >= 3 ? 1 : 0;
        const nOrb = nSkills - nMon;
        const innerX = x + 260;
        const innerW = w - 520;

        // แท่นลอยสลับความสูง
        const heights = [352, 292, 232];
        const nPlat = Math.max(2, Math.round(nSkills * 0.8));
        for (let i = 0; i < nPlat; i++) {
          const px = innerX + (innerW * (i + 0.5)) / nPlat - 60;
          const py = heights[i % heights.length];
          platforms.push({ x: px, y: py, w: 120, h: 16, zone: zi });
        }

        // orb ทักษะ — สลับพื้น / บนแท่น
        for (let i = 0; i < nOrb; i++) {
          const ox = innerX + (innerW * (i + 0.5)) / nOrb;
          let oy = GROUND_Y - 70;
          const plat = platforms.filter(p => p.zone === zi)
            .find(p => ox > p.x - 10 && ox < p.x + p.w + 10);
          if (plat) oy = plat.y - 46;
          orbs.push({ x: ox, y: oy, skill: lv.skills[i], zone: zi, collected: false, phase: Math.random() * 6.28, fromMonster: false });
        }

        // monster ถือทักษะที่เหลือ เดินบนพื้น
        for (let m = 0; m < nMon; m++) {
          const cx = x + w * (0.35 + 0.3 * m);
          monsters.push({
            x: cx, y: GROUND_Y - 34, w: 40, h: 34,
            dir: m % 2 ? -1 : 1, minX: cx - 130, maxX: cx + 130,
            alive: true, squashT: 0, skill: lv.skills[nOrb + m], zone: zi,
            phase: Math.random() * 6.28,
          });
        }

        // ใบเซอร์ — แท่นสูงพิเศษ พร้อมขั้นบันไดให้ปีน + double jump
        lv.certs.forEach((name, ci) => {
          const cx2 = x + w - 340 - ci * 260;
          platforms.push({ x: cx2 - 55, y: 178, w: 110, h: 14, zone: zi });
          platforms.push({ x: cx2 - 210, y: 310, w: 96, h: 14, zone: zi }); // ขั้นบันได
          certs.push({ x: cx2, y: 132, name, zone: zi, collected: false, phase: Math.random() * 6.28 });
        });
      }
      x += w;
    });
    worldW = x + 560;
    flagX = x - 340;
  }

  // ---------------- Player ----------------
  const player = {
    x: 160, y: GROUND_Y - 56, w: 30, h: 56,
    vx: 0, vy: 0, onGround: true, facing: 1,
    jumps: 0, runT: 0, hurtT: 0,
  };
  const history = []; // ตำแหน่งย้อนหลังสำหรับ NPC ทีมงานเดินตาม

  // ---------------- State ----------------
  let camX = 0;
  let started = false, finished = false;
  let collectedSkills = 0, collectedCerts = 0;
  let curZone = -1;
  let tick = 0;
  const collectedLog = []; // {type:'skill'|'cert', name, zone}

  // ---------------- Input ----------------
  const keys = {};
  addEventListener("keydown", e => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyA", "KeyD", "KeyW"].includes(e.code)) e.preventDefault();
    if (!keys[e.code] && (e.code === "ArrowUp" || e.code === "Space" || e.code === "KeyW")) tryJump();
    keys[e.code] = true;
    if (!started && (e.code === "Enter" || e.code === "Space")) startGame();
  });
  addEventListener("keyup", e => { keys[e.code] = false; });

  function bindTouch(id, code) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { e.preventDefault(); if (code === "JUMP") tryJump(); else keys[code] = true; };
    const off = e => { e.preventDefault(); if (code !== "JUMP") keys[code] = false; };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  }
  bindTouch("btn-left", "ArrowLeft");
  bindTouch("btn-right", "ArrowRight");
  bindTouch("btn-jump", "JUMP");

  function tryJump() {
    if (!started || finished) return;
    if (player.onGround) { player.vy = JUMP_V; player.onGround = false; player.jumps = 1; sfx("jump"); }
    else if (player.jumps === 1) { player.vy = JUMP_V * 0.88; player.jumps = 2; sfx("jump2"); }
  }

  // ---------------- Sound (WebAudio blips) ----------------
  let audioCtx = null;
  function sfx(type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      const cfg = {
        jump: [300, 520, 0.09], jump2: [420, 680, 0.09],
        orb: [740, 1180, 0.14], cert: [520, 1560, 0.3],
        stomp: [220, 90, 0.12], hurt: [180, 90, 0.18], win: [520, 1040, 0.6],
      }[type] || [440, 440, 0.1];
      o.frequency.setValueAtTime(cfg[0], t);
      o.frequency.exponentialRampToValueAtTime(cfg[1], t + cfg[2]);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg[2]);
      o.start(t); o.stop(t + cfg[2] + 0.02);
    } catch (_) { /* เสียงไม่ใช่ของจำเป็น */ }
  }

  // ---------------- HUD ----------------
  const elSkillCount = document.getElementById("skill-count");
  const elCertCount = document.getElementById("cert-count");
  const elZoneName = document.getElementById("zone-name");
  const elProgFill = document.getElementById("prog-fill");
  const elToasts = document.getElementById("toasts");

  function toast(html, cls) {
    while (elToasts.children.length >= 2) elToasts.firstChild.remove(); // กันซ้อนบังจอ
    const d = document.createElement("div");
    d.className = "toast " + (cls || "");
    d.innerHTML = html;
    elToasts.appendChild(d);
    setTimeout(() => d.classList.add("show"), 16);
    setTimeout(() => { d.classList.remove("show"); setTimeout(() => d.remove(), 400); }, 2200);
  }

  const badgeLabel = b =>
    b === "edu" ? "🎓 สถานศึกษา" : b === "work" ? "💼 สถานที่ทำงาน" : "🪖 รับราชการทหาร";

  function updateHUD() {
    elSkillCount.textContent = collectedSkills + " / " + GAME_INFO.totalSkills;
    elCertCount.textContent = collectedCerts + " / " + GAME_INFO.totalCerts;
    elProgFill.style.width = Math.min(100, (player.x / flagX) * 100).toFixed(1) + "%";
    const z = zones.findIndex(z2 => player.x >= z2.x0 - 120 && player.x < z2.x1);
    if (z !== curZone && z >= 0) {
      curZone = z;
      const lv = zones[z].level;
      elZoneName.innerHTML =
        `<span class="badge ${lv.badge}">${badgeLabel(lv.badge)}</span> ` +
        `<b>${lv.place}</b> · ${lv.yearLabel}` +
        (lv.parallel ? ` <span class="parallel">⚡ ${lv.parallel}</span>` : "");
      if (lv.kind !== "bridge")
        toast(`<b>${badgeLabel(lv.badge)}</b><br>${lv.place}<br><small>${lv.role}</small>`, "zone " + lv.badge);
    }
  }

  // ---------------- Skill log panel ----------------
  const panel = document.getElementById("skills-panel");
  document.getElementById("btn-skills").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderPanel();
  });
  document.getElementById("panel-close").addEventListener("click", () => { panel.hidden = true; });

  function renderPanel() {
    const body = document.getElementById("panel-body");
    let html = "";
    zones.forEach((z, zi) => {
      const lv = z.level;
      if (lv.kind === "bridge") return;
      const items = collectedLog.filter(c => c.zone === zi);
      const total = lv.skills.length + lv.certs.length;
      html += `<div class="pz"><div class="pz-head"><span class="badge ${lv.badge}">${lv.badge === "edu" ? "🎓" : "💼"}</span> ${lv.place} <small>${lv.yearLabel}</small> <span class="pz-n">${items.length}/${total}</span></div>`;
      if (items.length) html += "<div class='pz-items'>" + items.map(c => (c.type === "cert" ? "📜 " : "✦ ") + c.name).join("<br>") + "</div>";
      html += "</div>";
    });
    body.innerHTML = html || "<p>ยังไม่เก็บทักษะเลย — ออกวิ่งกันเถอะ!</p>";
  }

  // ---------------- Start / End ----------------
  function startGame() {
    if (started) return;
    started = true;
    document.getElementById("start-overlay").classList.add("gone");
  }
  document.getElementById("btn-start").addEventListener("click", startGame);

  function finishGame() {
    if (finished) return;
    finished = true;
    sfx("win");
    const ov = document.getElementById("end-overlay");
    document.getElementById("end-collected").innerHTML =
      `เก็บทักษะได้ <b>${collectedSkills}/${GAME_INFO.totalSkills}</b> · ใบเซอร์ <b>${collectedCerts}/${GAME_INFO.totalCerts}</b>`;
    document.getElementById("end-stats").innerHTML =
      GAME_INFO.finalStats.map(s => `<li>${s}</li>`).join("");
    ov.hidden = false;
    setTimeout(() => ov.classList.add("show"), 30);
  }
  document.getElementById("btn-restart").addEventListener("click", () => location.reload());

  // ---------------- Update ----------------
  function update() {
    tick++;
    if (!started || finished) return;

    const left = keys.ArrowLeft || keys.KeyA;
    const right = keys.ArrowRight || keys.KeyD;
    player.vx = right ? MOVE_SPEED : left ? -MOVE_SPEED : 0;
    if (player.hurtT > 0) { player.hurtT--; player.vx *= 0.3; }
    if (player.vx) { player.facing = Math.sign(player.vx); player.runT += 0.25; }

    player.x = Math.max(40, Math.min(worldW - 60, player.x + player.vx));
    player.vy += GRAVITY;
    player.y += player.vy;

    // พื้นหลัก
    player.onGround = false;
    if (player.y + player.h >= GROUND_Y) {
      player.y = GROUND_Y - player.h;
      player.vy = 0; player.onGround = true; player.jumps = 0;
    }
    // แท่นลอย (one-way)
    if (player.vy >= 0) {
      for (const p of platforms) {
        const feet = player.y + player.h;
        if (player.x + player.w > p.x && player.x < p.x + p.w &&
            feet >= p.y && feet - player.vy <= p.y + 6) {
          player.y = p.y - player.h;
          player.vy = 0; player.onGround = true; player.jumps = 0;
          break;
        }
      }
    }

    // ประวัติตำแหน่ง (ทีมงานเดินตาม)
    history.push({ x: player.x, y: player.y });
    if (history.length > 200) history.shift();

    // เก็บ orb
    for (const o of orbs) {
      if (o.collected) continue;
      const dx = (player.x + player.w / 2) - o.x, dy = (player.y + player.h / 2) - o.y;
      if (dx * dx + dy * dy < 42 * 42) {
        o.collected = true; collectedSkills++;
        collectedLog.push({ type: "skill", name: o.skill, zone: o.zone });
        sfx("orb");
        toast(`✦ ได้ทักษะ: <b>${o.skill}</b> <small>(${collectedSkills}/${GAME_INFO.totalSkills})</small>`, "skill");
      }
    }
    // เก็บใบเซอร์
    for (const c of certs) {
      if (c.collected) continue;
      const dx = (player.x + player.w / 2) - c.x, dy = (player.y + player.h / 2) - c.y;
      if (dx * dx + dy * dy < 46 * 46) {
        c.collected = true; collectedCerts++;
        collectedLog.push({ type: "cert", name: c.name, zone: c.zone });
        sfx("cert");
        toast(`📜 ใบรับรอง: <b>${c.name}</b> <small>(${collectedCerts}/${GAME_INFO.totalCerts})</small>`, "cert");
      }
    }

    // monsters
    for (const m of monsters) {
      if (!m.alive) { if (m.squashT > 0) m.squashT--; continue; }
      m.x += m.dir * 1.3;
      if (m.x < m.minX || m.x > m.maxX) m.dir *= -1;
      const px = player.x + player.w / 2, py = player.y + player.h;
      const overlapX = px > m.x - m.w / 2 - 10 && px < m.x + m.w / 2 + 10;
      if (overlapX && py > m.y && py < m.y + m.h && player.vy > 1) {
        // เหยียบสำเร็จ → ได้ทักษะ
        m.alive = false; m.squashT = 30;
        player.vy = JUMP_V * 0.7;
        collectedSkills++;
        collectedLog.push({ type: "skill", name: m.skill, zone: m.zone });
        sfx("stomp");
        toast(`👾 ปราบอุปสรรคสำเร็จ! ได้ทักษะ: <b>${m.skill}</b> <small>(${collectedSkills}/${GAME_INFO.totalSkills})</small>`, "skill");
      } else if (overlapX && py > m.y + 8 && player.y < m.y + m.h && player.hurtT <= 0) {
        // ชนด้านข้าง → กระเด็นเล็กน้อย (ไม่มีตาย — เรซูเม่นี้ล้มแล้วลุกเสมอ)
        player.hurtT = 40;
        player.vy = -6;
        player.x += (px < m.x ? -46 : 46);
        sfx("hurt");
        toast("💥 โดนอุปสรรคชน! กระโดดเหยียบมันสิ", "hurt");
      }
    }

    // เส้นชัย
    if (player.x >= flagX) finishGame();

    // กล้อง
    const target = player.x - W * 0.38;
    camX += (target - camX) * 0.12;
    camX = Math.max(0, Math.min(worldW - W, camX));

    updateHUD();
  }

  // ---------------- Render helpers ----------------
  function lerpColor(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function currentPalettes() {
    // ไล่สีท้องฟ้าตามตำแหน่งกล้อง — เปลี่ยนโซนแล้วฟ้าค่อยๆ เปลี่ยน
    const cx = camX + W / 2;
    let zi = zones.findIndex(z => cx < z.x1);
    if (zi < 0) zi = zones.length - 1;
    const z = zones[zi];
    const t = Math.min(1, Math.max(0, (cx - z.x0) / z.w));
    const next = zones[Math.min(zi + 1, zones.length - 1)];
    const blend = t > 0.75 ? (t - 0.75) / 0.25 : 0;
    return { a: z.level.palette, b: next.level.palette, blend, zi };
  }

  function skyColor(i, pal) {
    return lerpColor(pal.a.sky[i], pal.b.sky[i], pal.blend);
  }

  // ---------------- Background buildings ----------------
  function drawBuildings(z) {
    const lv = z.level, x0 = z.x0, w = z.w;
    ctx.save();
    const night = lv.id === "bangkok-post" || lv.id === "freelance";
    if (lv.kind === "uni") {
      drawUni(x0 + w * 0.28, lv);
      drawUni(x0 + w * 0.72, lv);
    } else if (lv.kind === "school") {
      drawSchool(x0 + w * 0.4, lv);
    } else if (lv.kind === "shop") {
      drawShop(x0 + w * 0.35, lv); drawShop(x0 + w * 0.7, lv);
    } else if (lv.kind === "factory") {
      const n = lv.orgSize > 2000 ? 4 : lv.orgSize > 300 ? 3 : 2;
      for (let i = 0; i < n; i++) drawFactory(x0 + w * ((i + 0.6) / (n + 0.4)), lv, lv.orgSize > 2000 ? 1.25 : 1);
    } else if (lv.kind === "office") {
      for (let i = 0; i < 5; i++) drawTower(x0 + w * (0.12 + i * 0.19), 150 + (i % 3) * 60, night);
    } else if (lv.kind === "home") {
      drawHome(x0 + w * 0.45, lv);
    } else if (lv.kind === "company") {
      drawCompany(x0 + w * 0.42, lv);
    } else if (lv.kind === "bridge") {
      drawCamp(x0 + w * 0.5);
    }
    ctx.restore();
  }

  function drawUni(cx, lv) {
    const y = GROUND_Y;
    ctx.fillStyle = "#D9CDB8"; ctx.fillRect(cx - 150, y - 170, 300, 170);
    ctx.fillStyle = "#B7A88E";
    ctx.beginPath(); ctx.moveTo(cx - 170, y - 170); ctx.lineTo(cx, y - 235); ctx.lineTo(cx + 170, y - 170); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#EFE7D6";
    for (let i = 0; i < 5; i++) ctx.fillRect(cx - 130 + i * 60, y - 155, 18, 155);
    ctx.fillStyle = "#6B5B43"; ctx.fillRect(cx - 26, y - 90, 52, 90);
    ctx.fillStyle = lv.palette.accent;
    ctx.fillRect(cx - 4, y - 300, 6, 66);
    ctx.beginPath(); ctx.moveTo(cx + 2, y - 300); ctx.lineTo(cx + 46, y - 288); ctx.lineTo(cx + 2, y - 276); ctx.closePath(); ctx.fill();
  }

  function drawSchool(cx, lv) {
    const y = GROUND_Y;
    ctx.fillStyle = "#E8C77E"; ctx.fillRect(cx - 190, y - 120, 380, 120);
    ctx.fillStyle = "#B8543A"; ctx.fillRect(cx - 200, y - 145, 400, 28);
    ctx.fillStyle = "#7FB6D9";
    for (let i = 0; i < 7; i++) ctx.fillRect(cx - 170 + i * 52, y - 100, 30, 34);
    ctx.fillStyle = "#8A5B36"; ctx.fillRect(cx - 20, y - 66, 40, 66);
    ctx.fillStyle = "#999"; ctx.fillRect(cx + 230, y - 200, 5, 200);
    ctx.fillStyle = "#E13B3B"; ctx.fillRect(cx + 235, y - 200, 40, 12);
    ctx.fillStyle = "#fff"; ctx.fillRect(cx + 235, y - 188, 40, 12);
    ctx.fillStyle = "#2E5FA3"; ctx.fillRect(cx + 235, y - 176, 40, 12);
  }

  function drawShop(cx, lv) {
    const y = GROUND_Y;
    ctx.fillStyle = "#DCE3EA"; ctx.fillRect(cx - 110, y - 130, 220, 130);
    ctx.fillStyle = lv.palette.accent;
    for (let i = 0; i < 6; i++) ctx.fillRect(cx - 110 + i * 38, y - 148, 30, 20);
    ctx.fillStyle = "#8FD0F0"; ctx.fillRect(cx - 90, y - 100, 80, 60);
    ctx.fillStyle = "#59606B"; ctx.fillRect(cx + 20, y - 92, 46, 92);
    ctx.fillStyle = "#33414F"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("IT SHOP", cx, y - 158);
  }

  function drawFactory(cx, lv, scale) {
    const y = GROUND_Y, s = scale || 1;
    ctx.fillStyle = "#B3B9BF"; ctx.fillRect(cx - 160 * s, y - 130 * s, 320 * s, 130 * s);
    ctx.fillStyle = "#8E969E";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 160 * s + i * 80 * s, y - 130 * s);
      ctx.lineTo(cx - 160 * s + i * 80 * s + 40 * s, y - 170 * s);
      ctx.lineTo(cx - 160 * s + (i + 1) * 80 * s, y - 130 * s);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#7A828A"; ctx.fillRect(cx + 100 * s, y - 230 * s, 26 * s, 230 * s);
    ctx.fillStyle = "rgba(200,205,210,.55)";
    for (let i = 0; i < 3; i++) {
      const t = (tick / 40 + i) % 3;
      ctx.beginPath();
      ctx.arc(cx + 113 * s + t * 14, y - 236 * s - t * 26, (8 + t * 6) * s, 0, 6.29);
      ctx.fill();
    }
    ctx.fillStyle = "#DCE3E8";
    for (let i = 0; i < 5; i++) ctx.fillRect(cx - 140 * s + i * 60 * s, y - 105 * s, 34 * s, 26 * s);
  }

  function drawTower(cx, h, night) {
    const y = GROUND_Y;
    ctx.fillStyle = night ? "#1B2B4A" : "#9FB4CC";
    ctx.fillRect(cx - 55, y - h, 110, h);
    for (let r = 0; r < Math.floor(h / 34); r++)
      for (let c = 0; c < 3; c++) {
        const lit = night && ((r * 3 + c + Math.floor(cx)) % 5 !== 0);
        ctx.fillStyle = night ? (lit ? "#F5D66B" : "#22355A") : "#DCE8F5";
        ctx.fillRect(cx - 40 + c * 30, y - h + 14 + r * 34, 20, 18);
      }
  }

  function drawHome(cx, lv) {
    const y = GROUND_Y;
    ctx.fillStyle = "#C9BBA4"; ctx.fillRect(cx - 100, y - 100, 200, 100);
    ctx.fillStyle = "#8A4A3B";
    ctx.beginPath(); ctx.moveTo(cx - 120, y - 100); ctx.lineTo(cx, y - 160); ctx.lineTo(cx + 120, y - 100); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#F5D66B"; ctx.fillRect(cx - 62, y - 76, 44, 36); // ไฟห้องทำงานยังเปิด
    ctx.fillStyle = "#5C4632"; ctx.fillRect(cx + 22, y - 70, 38, 70);
  }

  function drawCompany(cx, lv) {
    const y = GROUND_Y;
    ctx.fillStyle = "#EAF3FA"; ctx.fillRect(cx - 130, y - 190, 260, 190);
    ctx.fillStyle = lv.palette.accent; ctx.fillRect(cx - 130, y - 190, 260, 16);
    ctx.fillStyle = "#9CD2F0";
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++) ctx.fillRect(cx - 110 + c * 46, y - 160 + r * 38, 32, 24);
    ctx.fillStyle = "#33414F"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("NANODEV CO., LTD.", cx, y - 202);
  }

  function drawCamp(cx) {
    const y = GROUND_Y;
    ctx.fillStyle = "#6B6F4E";
    ctx.beginPath(); ctx.moveTo(cx - 90, y); ctx.lineTo(cx, y - 80); ctx.lineTo(cx + 90, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4E523A";
    ctx.beginPath(); ctx.moveTo(cx - 18, y); ctx.lineTo(cx, y - 34); ctx.lineTo(cx + 18, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#999"; ctx.fillRect(cx + 130, y - 140, 4, 140);
    ctx.fillStyle = "#4E523A"; ctx.fillRect(cx + 134, y - 140, 34, 10);
  }

  // ---------------- Signs ----------------
  function drawSign(z) {
    const lv = z.level;
    if (lv.kind === "bridge") {
      ctx.fillStyle = "rgba(40,44,32,.85)";
      roundRect(z.x0 + 60, 200, 260, 64, 10); ctx.fill();
      ctx.fillStyle = "#E7E3C8"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "left";
      ctx.fillText("🪖 " + lv.place, z.x0 + 78, 228);
      ctx.font = "13px sans-serif"; ctx.fillText(lv.yearLabel + " · " + lv.role, z.x0 + 78, 250);
      return;
    }
    const x = z.x0 + 40;
    ctx.fillStyle = "#7A5B3A"; ctx.fillRect(x + 18, 296, 10, GROUND_Y - 296);
    const isEdu = lv.badge === "edu";
    ctx.fillStyle = isEdu ? "rgba(34,102,68,.92)" : "rgba(30,64,110,.92)";
    roundRect(x - 60, 190, 330, 106, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "left";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(isEdu ? "🎓 สถานศึกษา" : "💼 สถานที่ทำงาน", x - 42, 214);
    ctx.font = "bold 16px sans-serif";
    wrapText(lv.place, x - 42, 238, 300, 19);
    ctx.font = "13px sans-serif"; ctx.fillStyle = "#DCE8F5";
    ctx.fillText(lv.yearLabel, x - 42, 276);
    if (lv.parallel) {
      ctx.fillStyle = "#FFD966"; ctx.font = "bold 12px sans-serif";
      ctx.fillText("⚡ " + lv.parallel, x - 42, 292);
    }
  }

  function wrapText(text, x, y, maxW, lh) {
    const words = text.split(" ");
    let line = "", yy = y;
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = wd; yy += lh; }
      else line = test;
    }
    ctx.fillText(line, x, yy);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------- Entities ----------------
  function drawOrb(o) {
    const bob = Math.sin(tick / 20 + o.phase) * 6;
    const x = o.x, y = o.y + bob;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 16);
    g.addColorStop(0, "#FFFDF0"); g.addColorStop(0.55, "#FFD84D"); g.addColorStop(1, "rgba(255,170,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.29); ctx.fill();
    ctx.fillStyle = "#B4740E"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("✦", x, y + 4);
    // ชื่อทักษะลอยเหนือ orb เมื่อผู้เล่นอยู่ใกล้
    if (Math.abs(player.x - x) < 150) {
      ctx.fillStyle = "rgba(30,30,40,.75)";
      const wtxt = ctx.measureText(o.skill).width + 14;
      roundRect(x - wtxt / 2, y - 40, wtxt, 20, 6); ctx.fill();
      ctx.fillStyle = "#FFE9A8"; ctx.font = "11px sans-serif";
      ctx.fillText(o.skill, x, y - 26);
    }
  }

  function drawCert(c) {
    const bob = Math.sin(tick / 24 + c.phase) * 5;
    const x = c.x, y = c.y + bob;
    ctx.save();
    ctx.shadowColor = "#FFE9A8"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#FDF3D7"; ctx.fillRect(x - 16, y - 12, 32, 24);
    ctx.restore();
    ctx.strokeStyle = "#B4740E"; ctx.lineWidth = 2; ctx.strokeRect(x - 16, y - 12, 32, 24);
    ctx.fillStyle = "#C0392B";
    ctx.beginPath(); ctx.arc(x + 8, y + 6, 4, 0, 6.29); ctx.fill();
    ctx.fillStyle = "rgba(30,30,40,.75)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    if (Math.abs(player.x - x) < 220) {
      const label = "📜 " + c.name;
      const wtxt = ctx.measureText(label).width + 14;
      roundRect(x - wtxt / 2, y - 44, wtxt, 20, 6); ctx.fill();
      ctx.fillStyle = "#FFE9A8"; ctx.fillText(label, x, y - 30);
    }
  }

  function drawMonster(m) {
    if (!m.alive && m.squashT <= 0) return;
    const squish = m.alive ? 1 : Math.max(0.15, m.squashT / 30 * 0.5);
    const h = m.h * squish;
    const wob = m.alive ? Math.sin(tick / 6 + m.phase) * 2 : 0;
    const y = GROUND_Y - h;
    ctx.fillStyle = m.alive ? "#7B4FA6" : "#9B84B5";
    roundRect(m.x - m.w / 2, y + wob * 0.3, m.w, h, 10); ctx.fill();
    if (m.alive) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(m.x - 9 + m.dir * 3, y + 12, 6, 0, 6.29); ctx.arc(m.x + 9 + m.dir * 3, y + 12, 6, 0, 6.29); ctx.fill();
      ctx.fillStyle = "#2B1B3D";
      ctx.beginPath(); ctx.arc(m.x - 9 + m.dir * 5, y + 12, 2.6, 0, 6.29); ctx.arc(m.x + 9 + m.dir * 5, y + 12, 2.6, 0, 6.29); ctx.fill();
      // ป้ายทักษะที่ถืออยู่
      if (Math.abs(player.x - m.x) < 200) {
        ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        const label = "👾 " + m.skill;
        const wtxt = ctx.measureText(label).width + 14;
        ctx.fillStyle = "rgba(60,20,80,.8)";
        roundRect(m.x - wtxt / 2, y - 30, wtxt, 20, 6); ctx.fill();
        ctx.fillStyle = "#E8CCFF"; ctx.fillText(label, m.x, y - 16);
      }
    }
  }

  function drawPlayer() {
    const p = player;
    const x = p.x, y = p.y;
    const run = p.onGround && Math.abs(p.vx) > 0.1;
    const legSwing = run ? Math.sin(p.runT * 2.2) * 8 : 0;
    ctx.save();
    if (p.hurtT > 0 && Math.floor(tick / 3) % 2) ctx.globalAlpha = 0.45;
    ctx.translate(x + p.w / 2, y);
    ctx.scale(p.facing, 1);
    // ขา
    ctx.strokeStyle = "#2B3550"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-5, 38); ctx.lineTo(-5 + legSwing, 54); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 38); ctx.lineTo(6 - legSwing, 54); ctx.stroke();
    // ตัว — เชิ้ตขาว
    ctx.fillStyle = "#F4F6F8"; roundRect(-11, 14, 24, 28, 6); ctx.fill();
    // เนกไท
    ctx.fillStyle = "#B03A48";
    ctx.beginPath(); ctx.moveTo(3, 16); ctx.lineTo(7, 22); ctx.lineTo(3, 34); ctx.lineTo(-1, 22); ctx.closePath(); ctx.fill();
    // แขน
    ctx.strokeStyle = "#E8EBEF"; ctx.lineWidth = 5;
    const armSwing = run ? Math.sin(p.runT * 2.2 + Math.PI) * 7 : 0;
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(10 + armSwing, 32); ctx.stroke();
    // หัว
    ctx.fillStyle = "#F0C29A";
    ctx.beginPath(); ctx.arc(2, 4, 11, 0, 6.29); ctx.fill();
    ctx.fillStyle = "#2B2B2B";
    ctx.beginPath(); ctx.arc(2, -1, 11, Math.PI, 0); ctx.fill();
    ctx.fillRect(-9, -3, 22, 4);
    // ตา
    ctx.fillStyle = "#222";
    ctx.beginPath(); ctx.arc(7, 4, 1.8, 0, 6.29); ctx.fill();
    ctx.restore();
  }

  function drawFollowers() {
    if (curZone < 0) return;
    const lv = zones[curZone] && zones[curZone].level;
    if (!lv || !lv.manages) return;
    const n = Math.min(4, lv.manages);
    for (let i = 0; i < n; i++) {
      const idx = history.length - 1 - (i + 1) * 14;
      if (idx < 0) break;
      const hpos = history[idx];
      const fx = hpos.x, fy = Math.min(hpos.y + 22, GROUND_Y - 34);
      ctx.fillStyle = ["#4A90D9", "#E2A23B", "#5DAE6C", "#C46FB0"][i % 4];
      roundRect(fx, fy, 20, 34, 6); ctx.fill();
      ctx.fillStyle = "#F0C29A";
      ctx.beginPath(); ctx.arc(fx + 10, fy - 4, 8, 0, 6.29); ctx.fill();
      ctx.fillStyle = "#333";
      ctx.beginPath(); ctx.arc(fx + 10, fy - 8, 8, Math.PI, 0); ctx.fill();
    }
    if (lv.manages > 4) {
      ctx.fillStyle = "rgba(30,30,40,.7)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
      const label = "ทีม " + lv.manages + " คน";
      const wtxt = ctx.measureText(label).width + 12;
      roundRect(player.x - wtxt / 2 - 60, GROUND_Y - 110, wtxt, 18, 6); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(label, player.x - 60, GROUND_Y - 97);
    }
  }

  function drawFlag() {
    const y = GROUND_Y;
    ctx.fillStyle = "#888"; ctx.fillRect(flagX, y - 240, 8, 240);
    const wave = Math.sin(tick / 12) * 6;
    ctx.fillStyle = "#1E88C9";
    ctx.beginPath();
    ctx.moveTo(flagX + 8, y - 240);
    ctx.lineTo(flagX + 120 + wave, y - 216);
    ctx.lineTo(flagX + 8, y - 192);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("GOAL", flagX + 26, y - 211);
  }

  // ---------------- Main render ----------------
  function render() {
    const pal = currentPalettes();
    // ท้องฟ้า
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, skyColor(0, pal));
    g.addColorStop(0.55, skyColor(1, pal));
    g.addColorStop(1, skyColor(2, pal));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ดาว (โซนกลางคืน)
    const zid = zones[pal.zi].level.id;
    if (zid === "bangkok-post" || zid === "freelance" || zid === "nida") {
      ctx.fillStyle = "rgba(255,255,255,.8)";
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 211 + 37) % W), sy = (i * 97 + 13) % Math.max(250, Math.round(H * 0.46));
        if (Math.sin(tick / 30 + i) > -0.4) ctx.fillRect(sx, sy, 2, 2);
      }
    }
    // เมฆ
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 0; i < 6; i++) {
      const cx2 = ((i * 520 + tick * 0.2) % (W + 300)) - 150;
      const cy = 60 + (i % 3) * 45;
      ctx.beginPath();
      ctx.arc(cx2, cy, 22, 0, 6.29); ctx.arc(cx2 + 26, cy - 8, 18, 0, 6.29); ctx.arc(cx2 + 50, cy, 20, 0, 6.29);
      ctx.fill();
    }

    ctx.save();
    // จอสูง: เลื่อนโลกลงให้พื้นอยู่ชิดขอบล่าง ฟ้าขยายขึ้นด้านบนเอง
    ctx.translate(-camX, H - 540);

    // อาคาร + ป้าย เฉพาะโซนที่อยู่ในจอ
    for (const z of zones) {
      if (z.x1 < camX - 200 || z.x0 > camX + W + 200) continue;
      drawBuildings(z);
      drawSign(z);
    }

    // พื้น
    ctx.fillStyle = "#5E7C4A"; ctx.fillRect(camX - 50, GROUND_Y, W + 100, 14);
    ctx.fillStyle = "#4A3A28"; ctx.fillRect(camX - 50, GROUND_Y + 14, W + 100, H - GROUND_Y);
    // เส้นแบ่งโซนบนพื้น
    for (const z of zones) {
      if (z.x0 < camX - 50 || z.x0 > camX + W + 50) continue;
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(z.x0, GROUND_Y, 4, 14);
    }

    // แท่นลอย
    for (const p of platforms) {
      if (p.x + p.w < camX || p.x > camX + W) continue;
      ctx.fillStyle = "#8A6B45"; roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = "#6EA255"; roundRect(p.x, p.y, p.w, 6, 4); ctx.fill();
    }

    for (const o of orbs) if (!o.collected && o.x > camX - 60 && o.x < camX + W + 60) drawOrb(o);
    for (const c of certs) if (!c.collected && c.x > camX - 80 && c.x < camX + W + 80) drawCert(c);
    for (const m of monsters) if (m.x > camX - 80 && m.x < camX + W + 80) drawMonster(m);

    drawFlag();
    drawFollowers();
    drawPlayer();

    ctx.restore();
  }

  // ---------------- Loop (fixed 60Hz timestep — ความเร็วเท่ากันทุกจอ) ----------------
  const STEP = 1000 / 60;
  let acc = 0, lastT = performance.now();
  function loop(now) {
    acc += Math.min(now - lastT, 100);
    lastT = now;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }

  buildWorld();
  updateHUD();
  requestAnimationFrame(t => { lastT = t; loop(t); });

  // debug hook สำหรับทดสอบอัตโนมัติ
  window.__pq = { player, zones, get flagX() { return flagX; } };
})();
