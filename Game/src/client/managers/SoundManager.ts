import { node } from '../dom';
import type { ObservableSnapshot } from '../protocol';

/** Owns the signal synthesizer and its volume control. */
export class SoundManager {
  readonly control: HTMLLabelElement;
  private readonly slider: HTMLInputElement;
  private readonly onVolume = (): void => {
    this.volume = Number(this.slider.value);
  };
  private volume = 0.2;
  private audio: AudioContext | null = null;

  constructor() {
    this.control = node('label', 'sound-control', 'Звук: ');
    this.slider = node('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1';
    this.slider.step = '0.05';
    this.slider.value = String(this.volume);
    this.slider.setAttribute('aria-label', 'Громкость сигналов');
    this.slider.addEventListener('input', this.onVolume);
    this.control.append(this.slider);
  }

  sync(previous: ObservableSnapshot | null, current: ObservableSnapshot, full: boolean): void {
    if (full && previous?.sessionId === current.sessionId) return;
    const oldCues = full ? [] : (previous?.cues ?? []);
    if (
      current.cues.some(
        (cue) =>
          !oldCues.some((old) => old.id === cue.id) &&
          (cue.kind === 'call' || cue.kind === 'fire' || cue.kind === 'whistle'),
      )
    ) {
      this.beep();
    }
  }

  destroy(): void {
    this.slider.removeEventListener('input', this.onVolume);
    this.control.remove();
    const audio = this.audio;
    this.audio = null;
    if (audio !== null) void audio.close().catch(() => undefined);
  }

  private beep(): void {
    if (this.volume <= 0) return;
    try {
      this.audio ??= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 590;
      gain.gain.value = this.volume * 0.09;
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + 0.13);
    } catch {
      // Browsers may block audio before a user gesture. The cue remains visible in the HUD.
    }
  }
}
