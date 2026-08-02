'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  buildOutageStations,
  RADIO_BAND,
  RADIO_CAPTURE,
  RADIO_INITIAL_FREQ,
  RADIO_STATION_META,
  type RadioStation,
} from '@/lib/radio';
import styles from './radio.module.css';

// 受信機の中身（Issue #32、docs/mocks/04-night-radio.html の移植）。
// 声: speechSynthesis / 空電・時報・チャイム: WebAudio。どちらもブラウザ標準で、
// サーバー側の音声コストはゼロ。
//
// **原稿（station.segments）は決してレンダーしない。** 放送は音にしか存在しない。

const BAND_SPAN = RADIO_BAND.hi - RADIO_BAND.lo;
/** ツマミを270度回すとバンド全域を掃ける（モックで実機検証済みの比） */
const KNOB_SWEEP_DEG = 270;
/** 針が落ち着いてから放送が立ち上がるまでの間 */
const LOCK_DELAY_MS = 700;
/** 段落の間の既定値 */
const DEFAULT_SEGMENT_GAP_MS = 400;
const DEFAULT_LOOP_GAP_MS = 5000;
/** 無操作でこの時間が経つと部屋が暗くなる */
const IDLE_DIM_MS = 14000;
/** はじめて同調してから囁きが出るまで／消えるまで */
const WHISPER_DELAY_MS = 7000;
const WHISPER_SHOW_MS = 6000;
/** キーボードでの微調整の刻み（MHz） */
const FINE_STEP = 0.1;

/** ダイヤル盤に刷ってある局。原稿の到着を待たずに帯へ並ぶ（筐体の一部） */
const STATIONS = Object.values(RADIO_STATION_META).sort((a, b) => a.freq - b.freq);

type StationMeta = (typeof STATIONS)[number];

/** 帯の左端からの位置（%） */
/**
 * 目盛を盤の左右から少し内側に寄せる（%）。両端いっぱいに刷ると、
 * 中央揃えの周波数表示（76・94）が盤の overflow: hidden で切れる
 */
const DIAL_INSET_PCT = 3.5;

/** 帯の左端からの位置（%）。目盛・局マーク・針で共有する */
function positionOf(freq: number): number {
  return DIAL_INSET_PCT + ((freq - RADIO_BAND.lo) / BAND_SPAN) * (100 - DIAL_INSET_PCT * 2);
}

/** 盤上の横位置（0〜1）を周波数へ戻す。`positionOf` の逆写像 */
function freqAt(ratio: number): number {
  const inner = (ratio * 100 - DIAL_INSET_PCT) / (100 - DIAL_INSET_PCT * 2);
  return RADIO_BAND.lo + inner * BAND_SPAN;
}

function clamp(freq: number): number {
  return Math.min(RADIO_BAND.hi, Math.max(RADIO_BAND.lo, freq));
}

type AudioEngine = {
  ctx: AudioContext;
  master: GainNode;
  noiseGain: GainNode;
  whistleOsc: OscillatorNode;
  whistleGain: GainNode;
};

/** 電源投入時にだけ作る（自動再生の許しはユーザー操作の内側でしか得られない） */
function createAudioEngine(): AudioEngine | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  // 空電: 帯域を絞ったホワイトノイズをループさせる
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1300;
  bandpass.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  source.connect(bandpass).connect(noiseGain).connect(master);
  source.start();

  // 搬送波のうなり: 局に近づくほど低く、離れるほど高く鳴る
  const whistleOsc = ctx.createOscillator();
  whistleOsc.type = 'sine';
  const whistleGain = ctx.createGain();
  whistleGain.gain.value = 0;
  whistleOsc.connect(whistleGain).connect(master);
  whistleOsc.start();

  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return { ctx, master, noiseGain, whistleOsc, whistleGain };
}

export function RadioSet({ programs }: { programs: Promise<RadioStation[]> }) {
  const [power, setPower] = useState(false);
  const [freq, setFreq] = useState(RADIO_INITIAL_FREQ);
  const [stations, setStations] = useState<RadioStation[] | null>(null);
  const [whispering, setWhispering] = useState(false);

  const audioRef = useRef<AudioEngine | null>(null);
  /** 番組の世代。回すと進行中の番組が黙る */
  const tokenRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  /** ChromeがonendごとにUtteranceを回収することがあるためGC対策で保持する */
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<{
    day: SpeechSynthesisVoice | null;
    night: SpeechSynthesisVoice | null;
  }>({ day: null, night: null });
  /** ツマミを掴んだときの角度。±180の折り返し判定に使う */
  const knobAngleRef = useRef<number | null>(null);
  /** 丸める前の周波数。0.1刻みの表示値に丸めると、細かいドラッグの動きが失われるため */
  const rawFreqRef = useRef(RADIO_INITIAL_FREQ);
  const vuNeedleRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const whisperedRef = useRef(false);
  const lockedRef = useRef<StationMeta | null>(null);

  /**
   * 同調中の局。`freq` が同じ局の同調幅内で動くあいだ**同一の参照を返す**のが重要で、
   * これにより微調整では放送が途切れず、局から離れたときだけ番組が止まる
   */
  const locked = useMemo(
    () => STATIONS.find((station) => Math.abs(station.freq - freq) < RADIO_CAPTURE) ?? null,
    [freq]
  );
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // ---- 原稿の到着（筐体は待たない） ----
  useEffect(() => {
    let cancelled = false;
    void programs.then(
      (list) => {
        if (!cancelled) setStations(list);
      },
      () => {
        // loadPrograms は reject しない契約だが、届かなければ休止を告げる
        if (!cancelled) setStations(buildOutageStations());
      }
    );
    return () => {
      cancelled = true;
    };
  }, [programs]);

  // ---- 音響 ----
  const beep = useCallback((frequency: number, at: number, duration: number, gain: number) => {
    const engine = audioRef.current;
    if (!engine) return;
    const osc = engine.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const envelope = engine.ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + 0.015);
    envelope.gain.setValueAtTime(gain, at + duration - 0.03);
    envelope.gain.linearRampToValueAtTime(0, at + duration);
    osc.connect(envelope).connect(engine.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }, []);

  /** 時報: プ・プ・プ・ポーン */
  const playJihou = useCallback(() => {
    const engine = audioRef.current;
    if (!engine) return;
    const t = engine.ctx.currentTime + 0.2;
    beep(440, t, 0.1, 0.06);
    beep(440, t + 1, 0.1, 0.06);
    beep(440, t + 2, 0.1, 0.06);
    beep(880, t + 3, 0.9, 0.07);
  }, [beep]);

  /** 深夜便のチャイム: 柔らかい二音 */
  const playChime = useCallback(() => {
    const engine = audioRef.current;
    if (!engine) return;
    const t = engine.ctx.currentTime + 0.1;
    beep(659.25, t, 1.6, 0.035);
    beep(523.25, t + 0.7, 2.0, 0.03);
  }, [beep]);

  /** 破壊的変更のお知らせ */
  const playAlert = useCallback(() => {
    const engine = audioRef.current;
    if (!engine) return;
    const t = engine.ctx.currentTime;
    beep(988, t, 0.12, 0.05);
    beep(988, t + 0.25, 0.12, 0.05);
  }, [beep]);

  /** 同調の具合にあわせて空電と搬送波を整える */
  useEffect(() => {
    const engine = audioRef.current;
    if (!engine) return;
    const t = engine.ctx.currentTime;
    const distance = Math.min(...STATIONS.map((station) => Math.abs(station.freq - freq)));
    const noise = !power ? 0 : locked ? 0.016 : Math.min(0.13, 0.05 + distance * 0.03);
    engine.noiseGain.gain.setTargetAtTime(noise, t, 0.25);
    const beating = !locked && distance < 2.6;
    engine.whistleOsc.frequency.setTargetAtTime(120 + distance * 850, t, 0.08);
    engine.whistleGain.gain.setTargetAtTime(
      power && beating ? 0.018 * (1 - distance / 2.6) : 0,
      t,
      0.15
    );
  }, [power, freq, locked]);

  // ---- 声 ----
  const pickVoices = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const japanese = synth.getVoices().filter((voice) => voice.lang?.startsWith('ja'));
    // 音声一覧が空の環境（読み込み前・音声が入っていない端末）では既定音声に任せる
    if (japanese.length === 0) return;
    const day = japanese.find((voice) => /Nanami|Google/i.test(voice.name)) ?? japanese[0];
    voicesRef.current = { day, night: japanese.find((voice) => voice !== day) ?? day };
  }, []);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    pickVoices();
    synth.addEventListener('voiceschanged', pickVoices);
    return () => synth.removeEventListener('voiceschanged', pickVoices);
  }, [pickVoices]);

  const stopSpeaking = useCallback(() => {
    tokenRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // 実装差で例外を投げるブラウザがある。止められなくても後段の世代チェックが効く
    }
  }, []);

  /** 原稿を1段落ずつ読む。世代が変わっていたら即座に降りる */
  const speakFrom = useCallback(
    (station: RadioStation, token: number) => {
      const step = (index: number) => {
        if (token !== tokenRef.current) return;
        if (index >= station.segments.length) {
          if (station.loop) {
            timerRef.current = window.setTimeout(
              () => step(0),
              station.loopGap ?? DEFAULT_LOOP_GAP_MS
            );
          }
          return;
        }
        const segment = station.segments[index];
        timerRef.current = window.setTimeout(() => {
          if (token !== tokenRef.current) return;
          if (segment.alert) playAlert();
          const next = () => step(index + 1);
          const synth = window.speechSynthesis;
          // 音声合成が無い環境でも間だけは進める（放送は止めない）
          if (!synth) {
            next();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(segment.text);
          utterance.lang = 'ja-JP';
          const voice = station.night ? voicesRef.current.night : voicesRef.current.day;
          if (voice) utterance.voice = voice;
          utterance.rate = station.rate;
          utterance.pitch = station.pitch;
          utterance.onend = next;
          utterance.onerror = next;
          utterRef.current = utterance;
          try {
            synth.speak(utterance);
          } catch {
            next();
          }
        }, segment.pre ?? DEFAULT_SEGMENT_GAP_MS);
      };
      step(0);
    },
    [playAlert]
  );

  const startBroadcast = useCallback(
    (station: RadioStation, token: number) => {
      if (station.signal === 'jihou') playJihou();
      else if (station.signal === 'chime') playChime();
      timerRef.current = window.setTimeout(() => speakFrom(station, token), station.openingGap);
    },
    [playChime, playJihou, speakFrom]
  );

  /**
   * 放送の生死。`locked` は同じ局のあいだ参照が変わらないので、
   * 微調整では再実行されず、局から離れた瞬間にcleanupが放送を黙らせる
   */
  useEffect(() => {
    if (!power || !locked || !stations) return;
    const station = stations.find((candidate) => candidate.id === locked.id);
    if (!station) return;
    const token = (tokenRef.current += 1);
    const timer = window.setTimeout(() => startBroadcast(station, token), LOCK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      stopSpeaking();
    };
  }, [power, locked, stations, startBroadcast, stopSpeaking]);

  // ---- VUメーター: 声のあいだだけ針が生きる ----
  useEffect(() => {
    const needle = vuNeedleRef.current;
    if (!power) {
      if (needle) needle.style.transform = 'rotate(-48deg)';
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let level = 0;
    let target = 0;
    let nextJitter = 0;
    const loop = (time: number) => {
      if (time > nextJitter) {
        nextJitter = time + 90 + Math.random() * 90;
        const synth = window.speechSynthesis;
        if (synth?.speaking && !synth.paused) {
          target = 0.45 + Math.random() * 0.42;
        } else {
          target = lockedRef.current ? 0.06 : 0.13 + Math.random() * 0.05;
        }
      }
      level += (target - level) * (reduced ? 0.08 : 0.18);
      if (needle) needle.style.transform = `rotate(${(-48 + level * 88).toFixed(1)}deg)`;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [power]);

  // ---- 消灯と、ひとことだけの囁き ----
  useEffect(() => {
    const resetIdle = () => {
      if (dimRef.current) dimRef.current.style.opacity = '0';
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        if (dimRef.current && power && lockedRef.current) dimRef.current.style.opacity = '0.85';
      }, IDLE_DIM_MS);
    };
    resetIdle();
    window.addEventListener('pointerdown', resetIdle);
    window.addEventListener('pointermove', resetIdle);
    return () => {
      window.removeEventListener('pointerdown', resetIdle);
      window.removeEventListener('pointermove', resetIdle);
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [power]);

  useEffect(() => {
    if (!power || !locked || whisperedRef.current) return;
    whisperedRef.current = true;
    const show = window.setTimeout(() => {
      setWhispering(true);
      window.setTimeout(() => setWhispering(false), WHISPER_SHOW_MS);
    }, WHISPER_DELAY_MS);
    return () => window.clearTimeout(show);
  }, [power, locked]);

  // ---- 退出時（クライアント遷移・タブを閉じる）は放送を止める ----
  useEffect(() => {
    const teardown = () => {
      stopSpeaking();
      const engine = audioRef.current;
      audioRef.current = null;
      if (engine) void engine.ctx.close().catch(() => {});
    };
    window.addEventListener('pagehide', teardown);
    return () => {
      window.removeEventListener('pagehide', teardown);
      teardown();
    };
  }, [stopSpeaking]);

  // ---- 同調の操作 ----
  const tune = useCallback((raw: number) => {
    const clamped = clamp(raw);
    rawFreqRef.current = clamped;
    // 表示・読み上げ・キーボード操作の基準を安定させるため0.1刻みに丸める
    setFreq(Math.round(clamped * 10) / 10);
  }, []);

  const togglePower = () => {
    const next = !power;
    setPower(next);
    if (!next) {
      stopSpeaking();
      if (dimRef.current) dimRef.current.style.opacity = '0';
      return;
    }
    if (!audioRef.current) {
      audioRef.current = createAudioEngine();
    } else if (audioRef.current.ctx.state === 'suspended') {
      void audioRef.current.ctx.resume().catch(() => {});
    }
    // iOSの音声エンジンはユーザー操作内の同期speak()でしか解錠されない
    // （ctx.resume()と同格の儀式）。以後のsetTimeout経由の発話が通るようになる
    try {
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
    } catch {
      // 解錠に失敗しても受信機は動く（音声だけが出ない）
    }
    pickVoices();
  };

  const tuneFromDial = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    tune(freqAt((event.clientX - rect.left) / rect.width));
  };

  const angleOf = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      (Math.atan2(
        event.clientY - (rect.top + rect.height / 2),
        event.clientX - (rect.left + rect.width / 2)
      ) *
        180) /
      Math.PI
    );
  };

  const onKnobMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (knobAngleRef.current === null) return;
    const angle = angleOf(event);
    let delta = angle - knobAngleRef.current;
    // -180/+180の折り返しをまたいだ回転
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
    knobAngleRef.current = angle;
    tune(rawFreqRef.current + (delta / KNOB_SWEEP_DEG) * BAND_SPAN);
  };

  const onKnobKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!power) return;
    // 再描画を挟まない連続入力（キーリピート）でも取りこぼさないよう、
    // レンダー時の `freq` ではなく同期更新されるrefを起点にする
    const current = Math.round(rawFreqRef.current * 10) / 10;
    const seekUp = () => STATIONS.find((station) => station.freq > current + 1e-6);
    const seekDown = () => [...STATIONS].reverse().find((station) => station.freq < current - 1e-6);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = current + FINE_STEP;
        break;
      case 'ArrowLeft':
        next = current - FINE_STEP;
        break;
      case 'ArrowUp':
        next = seekUp()?.freq ?? null;
        break;
      case 'ArrowDown':
        next = seekDown()?.freq ?? null;
        break;
      case 'Home':
        next = RADIO_BAND.lo;
        break;
      case 'End':
        next = RADIO_BAND.hi;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== null) tune(next);
  };

  // ---- 描画 ----
  const ticks = useMemo(() => {
    const marks: { key: string; left: number; height: number; label: number | null }[] = [];
    for (let f = RADIO_BAND.lo; f <= RADIO_BAND.hi; f += 0.5) {
      const value = Math.round(f * 10) / 10;
      const major = Number.isInteger(value);
      marks.push({
        key: `t${value}`,
        left: positionOf(value),
        height: major ? 14 : 8,
        label: major && value % 2 === 0 ? value : null,
      });
    }
    return marks;
  }, []);

  const fraction = (freq - RADIO_BAND.lo) / BAND_SPAN;
  const displayFreq = freq.toFixed(1);

  return (
    <>
      <div className={`${styles.unit} ${power ? styles.on : ''}`}>
        <div className={styles.cabinet}>
          <div className={styles.facepanel}>
            <div
              className={styles.dial}
              onPointerDown={(event) => {
                if (!power) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                tuneFromDial(event);
              }}
              onPointerMove={(event) => {
                if (!power || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                tuneFromDial(event);
              }}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.key}
                  className={styles.tick}
                  style={{ left: `${tick.left}%`, height: `${tick.height}px` }}
                />
              ))}
              {ticks
                .filter((tick) => tick.label !== null)
                .map((tick) => (
                  <span
                    key={`n${tick.label}`}
                    className={styles.freqnum}
                    style={{ left: `${tick.left}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              {STATIONS.map((station) => (
                <div
                  key={`m${station.id}`}
                  className={styles.stmark}
                  style={{ left: `${positionOf(station.freq)}%` }}
                />
              ))}
              {STATIONS.map((station) => (
                <span
                  key={`s${station.id}`}
                  className={styles.stname}
                  style={{ left: `${positionOf(station.freq)}%` }}
                >
                  {station.short}
                </span>
              ))}
              <div
                className={styles.needle}
                style={{ left: `calc(${positionOf(freq).toFixed(2)}% - 1px)` }}
              />
            </div>

            <div className={styles.meters}>
              <div className={styles.vu}>
                <div className={styles.arc} />
                <div className={styles.redzone} />
                <div className={styles.vneedle} ref={vuNeedleRef} />
                <div className={styles.vlabel}>VU</div>
              </div>
              <div className={styles.nixiebox}>
                <div className={styles.nixie} aria-hidden="true">
                  {power ? (locked ? locked.name : displayFreq) : ''}
                </div>
                <div className={styles.bandlabel}>JORR&nbsp;&nbsp;FM 76–95</div>
              </div>
            </div>

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.power}
                aria-pressed={power}
                aria-label="電源"
                onClick={togglePower}
              >
                <span className={styles.pwPlate}>
                  <span className={styles.pwSwitch} />
                  <span className={styles.pwLabel}>POWER</span>
                </span>
                <span className={styles.tag} aria-hidden="true">
                  受信には、いちど
                  <br />
                  触れてください。
                </span>
              </button>

              {/* ツマミだけが回り、銘板（TUNING）は面板に留まる */}
              <div className={styles.knobPlate}>
                <div
                  className={styles.knob}
                  role="slider"
                  aria-label="同調"
                  aria-valuemin={RADIO_BAND.lo}
                  aria-valuemax={RADIO_BAND.hi}
                  aria-valuenow={freq}
                  aria-valuetext={
                    locked
                      ? `${displayFreq}メガヘルツ ${locked.name}`
                      : `${displayFreq}メガヘルツ 受信できません`
                  }
                  aria-disabled={!power}
                  tabIndex={0}
                  style={{
                    transform: `rotate(${(fraction * KNOB_SWEEP_DEG - 135).toFixed(1)}deg)`,
                  }}
                  onPointerDown={(event) => {
                    if (!power) return;
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      // ポインタ捕捉に失敗しても、要素上のドラッグは追える
                    }
                    knobAngleRef.current = angleOf(event);
                  }}
                  onPointerMove={onKnobMove}
                  onPointerUp={() => {
                    knobAngleRef.current = null;
                  }}
                  onPointerCancel={() => {
                    knobAngleRef.current = null;
                  }}
                  onKeyDown={onKnobKeyDown}
                >
                  <span className={styles.dot} />
                </div>
                <span className={styles.klabel}>TUNING</span>
              </div>
            </div>
          </div>
          <div className={styles.nameplate}>
            REPORADAR&nbsp;RADIO&nbsp;&middot;&nbsp;MODEL&nbsp;JORR-1974
          </div>
        </div>
        {/* 受信機に閉じ込めない。紙面へ戻る道を筐体の外へ一行だけ置く */}
        <p className={styles.exit}>
          <Link href="/">日刊 RepoRadar 一面へ</Link>
        </p>
      </div>

      {/* 受信状態だけを読み上げ環境へ伝える。原稿は決して入れない */}
      <p className={styles.srOnly} role="status">
        {power && locked ? `受信中 ${locked.name}` : ''}
      </p>

      <div className={styles.dim} ref={dimRef} aria-hidden="true" />
      <p className={`${styles.whisper} ${whispering ? styles.show : ''}`}>
        もう、画面を見なくてもいい。
      </p>
    </>
  );
}
