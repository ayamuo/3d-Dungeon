/* 星灯の迷宮 — MIDI再生（BGM用の簡易シンセ）
   ・MIDIファイルを読み込み、WebAudioで楽器の音を合成して鳴らす（音色データは使わないので軽い）
   ・曲の中の「CC111」（RPGツクール式のループ開始の印）から曲の終わりまでを、継ぎ目なく繰り返す
   ・楽器は General MIDI の番号から、ピアノ・ギター・ベース・弦・合唱・金管・打楽器などの系統に分けて音を作る */
"use strict";
const MidiPlayer = (() => {
  /* ── MIDIファイルの読み込み ── */
  function parse(buf) {
    const b = new Uint8Array(buf);
    let p = 0;
    const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
    const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
    const vlq = () => { let v = 0, x; do { x = b[p++]; v = (v << 7) | (x & 0x7f); } while (x & 0x80); return v; };
    const str = n => String.fromCharCode(...b.subarray(p, p + n));
    if (str(4) !== "MThd") throw new Error("MIDIではありません");
    p = 4; const hl = u32(); u16(); const ntr = u16(), div = u16(); p = 8 + hl;
    const ev = [];
    for (let t = 0; t < ntr && p < b.length; t++) {
      if (str(4) !== "MTrk") break;
      p += 4; const len = u32(), end = p + len;
      let tick = 0, run = 0, order = 0;
      while (p < end) {
        tick += vlq();
        let st = b[p];
        if (st < 0x80) st = run; else { p++; if (st < 0xf0) run = st; }
        if (st === 0xff) { const type = b[p++], l = vlq(); const data = b.subarray(p, p + l); p += l;
          if (type === 0x51) ev.push({ tick, k: "tempo", v: (data[0] << 16 | data[1] << 8 | data[2]), o: order++ });
          if (type === 0x2f) ev.push({ tick, k: "eot", o: order++ }); }
        else if (st === 0xf0 || st === 0xf7) { p += vlq(); }
        else {
          const hi = st & 0xf0, ch = st & 0x0f, d1 = b[p++], d2 = (hi === 0xc0 || hi === 0xd0) ? 0 : b[p++];
          if (hi === 0x90 && d2 > 0) ev.push({ tick, k: "on", ch, n: d1, v: d2, o: order++ });
          else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) ev.push({ tick, k: "off", ch, n: d1, o: order++ });
          else if (hi === 0xc0) ev.push({ tick, k: "prog", ch, v: d1, o: order++ });
          else if (hi === 0xb0) ev.push({ tick, k: "cc", ch, c: d1, v: d2, o: order++ });
          else if (hi === 0xe0) ev.push({ tick, k: "bend", ch, v: ((d2 << 7) | d1) - 8192, o: order++ });
        }
      }
      p = end;
    }
    // 同じ時刻なら「音を止める」を「音を鳴らす」より先に処理する
    const rank = { tempo: 0, prog: 1, cc: 2, bend: 3, off: 4, on: 5, eot: 6 };
    ev.sort((a, c) => a.tick - c.tick || rank[a.k] - rank[c.k] || a.o - c.o);
    // テンポ変化を反映して、各イベントの時刻（秒）を求める
    let us = 500000, lastTick = 0, sec = 0;
    for (const e of ev) { sec += (e.tick - lastTick) * us / 1e6 / div; lastTick = e.tick; e.t = sec; if (e.k === "tempo") us = e.v; }
    const loopEv = ev.find(e => e.k === "cc" && e.c === 111);
    const endSec = Math.max(...ev.filter(e => e.k === "eot").map(e => e.t), ev.length ? ev[ev.length - 1].t : 0);
    return { ev: ev.filter(e => e.k !== "eot" && e.k !== "tempo"), loopStart: loopEv ? loopEv.t : 0, loopEnd: endSec };
  }

  /* ── 楽器（General MIDIの番号から系統を決める） ── */
  function patch(prog) {
    if (prog <= 7) return { w: ["triangle", "sine"], a: 0.005, d: 1.2, s: 0.0, r: 0.25, cut: 3500, g: 0.55 };           // ピアノ
    if (prog <= 15) return { w: ["sine", "triangle"], a: 0.003, d: 0.9, s: 0.0, r: 0.3, cut: 5000, g: 0.45 };           // 鉄琴・ベル
    if (prog <= 23) return { w: ["square", "sine"], a: 0.02, d: 0.1, s: 0.8, r: 0.12, cut: 2000, g: 0.28 };             // オルガン
    if (prog === 29 || prog === 30) return { w: ["sawtooth", "square"], a: 0.008, d: 0.3, s: 0.75, r: 0.12, cut: 2300, det: 10, g: 0.2 }; // 歪んだエレキギター
    if (prog <= 31) return { w: ["sawtooth", "triangle"], a: 0.004, d: 0.7, s: 0.05, r: 0.2, cut: 2600, fenv: 1, g: 0.35 }; // ギター
    if (prog <= 39) return { w: ["triangle", "square"], a: 0.006, d: 0.5, s: 0.45, r: 0.1, cut: 900, g: 0.75, mix2: 0.25 }; // ベース
    if (prog === 45) return { w: ["triangle", "sine"], a: 0.003, d: 0.25, s: 0.0, r: 0.1, cut: 2500, g: 0.55 };         // ピチカート
    if (prog === 46) return { w: ["triangle", "sine"], a: 0.003, d: 1.1, s: 0.0, r: 0.4, cut: 4000, g: 0.5 };           // ハープ
    if (prog === 47) return { noiseDrum: "timp" };                                                                        // ティンパニ
    if (prog <= 51) return { w: ["sawtooth", "sawtooth"], a: 0.09, d: 0.3, s: 0.8, r: 0.35, cut: 1900, det: 8, g: 0.22 }; // 弦楽合奏
    if (prog <= 54) return { w: ["triangle", "sine"], a: 0.18, d: 0.3, s: 0.85, r: 0.45, cut: 2200, det: 6, vib: 1, g: 0.35 }; // 合唱
    if (prog === 55) return { w: ["sawtooth", "square"], a: 0.01, d: 0.3, s: 0.2, r: 0.2, cut: 2500, g: 0.3 };          // オーケストラヒット
    if (prog <= 63) return { w: ["sawtooth", "square"], a: 0.03, d: 0.2, s: 0.7, r: 0.15, cut: 2200, fenv: 1, g: 0.25 }; // 金管
    if (prog <= 79) return { w: ["triangle", "sine"], a: 0.04, d: 0.2, s: 0.8, r: 0.15, cut: 3000, vib: 1, g: 0.35 };   // 木管・笛
    if (prog <= 87) return { w: ["square", "sawtooth"], a: 0.01, d: 0.2, s: 0.6, r: 0.1, cut: 3000, g: 0.22 };          // シンセリード
    return { w: ["sawtooth", "triangle"], a: 0.25, d: 0.5, s: 0.7, r: 0.6, cut: 1600, det: 7, g: 0.22 };                 // パッドなど
  }
  const freq = n => 440 * Math.pow(2, (n - 69) / 12);

  /* ── 再生 ── */
  function create(ctx, song, out, look = 0.35) {
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(out);
    let noiseBuf = null;
    const noise = () => {
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
    };
    const chs = Array.from({ length: 16 }, (_, i) => {
      const g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { g.connect(pan); pan.connect(master); } else g.connect(master);
      const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.Q.value = 0.7; flt.frequency.value = 3000; flt.connect(g);
      return { prog: 0, vol: 100 / 127, expr: 1, g, pan, flt, bend: 0, voices: {} };
    });
    const setGain = (c, t) => { c.g.gain.setValueAtTime(c.vol * c.expr, t); };
    chs.forEach(c => setGain(c, ctx.currentTime));

    // 打楽器（10チャンネル目）
    function drum(n, v, t, dest) {
      const g = ctx.createGain(); g.connect(dest);
      const amp = 0.9 * v;
      if (n === 35 || n === 36) { // バスドラム
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(amp * 1.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28); o.connect(g); o.start(t); o.stop(t + 0.3); return;
      }
      if ([41, 43, 45, 47, 48, 50].includes(n)) { // タム
        const f0 = 90 + (n - 41) * 18, o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f0 * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.15);
        g.gain.setValueAtTime(amp * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g); o.start(t); o.stop(t + 0.37); return;
      }
      const s = noise(), f = ctx.createBiquadFilter(); s.connect(f); f.connect(g);
      let len = 0.06, lvl = amp * 0.35;
      if (n === 38 || n === 40 || n === 37 || n === 39) { // スネア・リムショット・手拍子
        f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.7; len = 0.18; lvl = amp * 0.7;
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "triangle"; o.frequency.value = 190; og.gain.setValueAtTime(amp * 0.4, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.12);
      } else if (n === 42 || n === 44) { f.type = "highpass"; f.frequency.value = 7000; len = 0.05; lvl = amp * 0.25; }        // ハイハット（閉）
      else if (n === 46) { f.type = "highpass"; f.frequency.value = 6500; len = 0.3; lvl = amp * 0.25; }                        // ハイハット（開）
      else if ([49, 52, 55, 57].includes(n)) { f.type = "highpass"; f.frequency.value = 4500; len = 1.2; lvl = amp * 0.3; }      // シンバル
      else if ([51, 53, 59].includes(n)) { f.type = "bandpass"; f.frequency.value = 6000; f.Q.value = 1.5; len = 0.5; lvl = amp * 0.18; } // ライド
      else { f.type = "bandpass"; f.frequency.value = 3000; len = 0.08; }
      g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.start(t); s.stop(t + len + 0.02);
    }

    function noteOn(c, ch, n, v, t) {
      if (ch === 9) { drum(n, v / 127, t, c.g); return; }
      const P = patch(c.prog);
      if (P.noiseDrum) { drum(45, v / 127, t, c.g); return; }
      const vg = ctx.createGain();
      vg.connect(c.flt);
      const f0 = freq(n) * Math.pow(2, c.bend / 8192 * 2 / 12);
      const oscs = P.w.map((w, i) => {
        const o = ctx.createOscillator(); o.type = w; o.frequency.setValueAtTime(f0, t);
        if (P.det) o.detune.setValueAtTime(i ? P.det : -P.det, t);
        if (i === 0) o.connect(vg);
        else { const og = ctx.createGain(); og.gain.value = P.mix2 !== undefined ? P.mix2 : 0.5; o.connect(og); og.connect(vg); }
        o.start(t); return o;
      });
      if (P.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = 6; l.connect(lg); oscs.forEach(o => lg.connect(o.detune)); l.start(t + 0.2); oscs.push(l); }
      const peak = P.g * (v / 127) * 0.5;
      vg.gain.setValueAtTime(0.0001, t);
      vg.gain.linearRampToValueAtTime(peak, t + P.a);
      vg.gain.setTargetAtTime(peak * P.s + 0.00001, t + P.a, P.d / 3);
      const key = n; const old = c.voices[key]; if (old) release(old, t);
      c.voices[key] = { oscs, vg, P };
    }
    function release(vc, t) {
      vc.vg.gain.cancelScheduledValues(t);
      vc.vg.gain.setTargetAtTime(0.00001, t, vc.P.r / 3);
      vc.oscs.forEach(o => { try { o.stop(t + vc.P.r * 2 + 0.05); } catch (e) { } });
    }
    function noteOff(c, n, t) { const vc = c.voices[n]; if (vc) { release(vc, t); delete c.voices[n]; } }

    function apply(e, t) {
      const c = chs[e.ch];
      if (e.k === "on") noteOn(c, e.ch, e.n, e.v, t);
      else if (e.k === "off") { if (e.ch !== 9) noteOff(c, e.n, t); }
      else if (e.k === "prog") { c.prog = e.v; const P = patch(e.v); if (P.cut) c.flt.frequency.setValueAtTime(P.cut, t); }
      else if (e.k === "bend") c.bend = e.v;
      else if (e.k === "cc") {
        if (e.c === 7) { c.vol = e.v / 127; setGain(c, t); }
        else if (e.c === 11) { c.expr = e.v / 127; setGain(c, t); }
        else if (e.c === 10 && c.pan) c.pan.pan.setValueAtTime((e.v - 64) / 64, t);
        else if (e.c === 120 || e.c === 123) { Object.keys(c.voices).forEach(n => noteOff(c, +n, t)); }
      }
    }

    // 少し先までの音をまとめて予約していく（ループの継ぎ目でも途切れない）
    const LOOK = look; // 何秒先まで予約するか（動作確認で一気に書き出すときは大きくする）
    let base = 0, i = 0, timer = null;
    const ev = song.ev, loopLen = song.loopEnd - song.loopStart;
    const loopIdx = ev.findIndex(e => e.t >= song.loopStart - 1e-6);
    function pump() {
      const until = ctx.currentTime + LOOK;
      for (let guard = 0; guard < 50000; guard++) {
        if (i >= ev.length || ev[i].t >= song.loopEnd - 1e-6) {
          // 曲の終わりまで来たら、ループ開始位置へ戻る（その時点で鳴っている音は止める）
          const tEnd = base + song.loopEnd;
          if (tEnd > until) return;
          chs.forEach((c, ch) => { if (ch !== 9) Object.keys(c.voices).forEach(n => noteOff(c, +n, tEnd)); });
          base += loopLen; i = loopIdx < 0 ? 0 : loopIdx;
          if (loopLen <= 0.05) return;
          continue;
        }
        const e = ev[i], t = base + e.t;
        if (t > until) return;
        apply(e, Math.max(t, ctx.currentTime));
        i++;
      }
    }
    function start(fadeIn = 0.4, vol = 0.5) {
      base = ctx.currentTime + 0.05; i = 0;
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(vol, ctx.currentTime + fadeIn);
      pump(); timer = setInterval(pump, 60);
    }
    function stop(fade = 0.6) {
      clearInterval(timer); timer = null;
      const t = ctx.currentTime;
      // 鳴っている音をフェードの終わりで確実に止める（音量を下げるだけだと裏で鳴り続けるため）
      chs.forEach(c => Object.keys(c.voices).forEach(n => { const vc = c.voices[n]; vc.oscs.forEach(o => { try { o.stop(t + fade + 0.05); } catch (e) { } }); delete c.voices[n]; }));
      master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => { try { master.disconnect(); } catch (e) { } }, (fade + 2.5) * 1000);
    }
    function volume(v, time = 0.2) { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + time); }
    return { start, stop, volume, pump }; // pump は動作確認用（実際の再生では start が自動で呼び続ける）
  }
  return { parse, create };
})();
