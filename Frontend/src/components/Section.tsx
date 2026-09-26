import type { ReactNode } from 'react';
import './Section.css';

interface SectionProps {
  id: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

export function Section({ id, title, aside, children }: SectionProps) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <h2 className="section__title" id={id}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
