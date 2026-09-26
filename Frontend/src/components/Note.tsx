import type { ReactNode } from 'react';
import './Note.css';

type Tone = 'neutral' | 'ok' | 'warn';

interface NoteProps {
  tone?: Tone;
  /** С заголовком тон несёт сам заголовок, полоса не нужна. */
  title?: string;
  source?: string;
  children: ReactNode;
}

export function Note({ tone = 'neutral', title, source, children }: NoteProps) {
  const toneClass = tone === 'neutral' ? '' : ` note--${tone}`;
  return (
    <div className={`note${toneClass}${title ? '' : ' note--bar'}`}>
      {title && <b className="note__title">{title}</b>}
      <p>{children}</p>
      {source && <span className="label">{source}</span>}
    </div>
  );
}
