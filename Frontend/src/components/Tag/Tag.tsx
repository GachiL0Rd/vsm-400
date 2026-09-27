import type { ReactNode } from 'react';
import './Tag.css';

export type TagTone = 'ok' | 'warn' | 'stop' | 'new';

interface TagProps {
  tone: TagTone;
  children: ReactNode;
}

export function Tag({ tone, children }: TagProps) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}
