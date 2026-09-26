import type { ReactNode } from 'react';
import './Section.css';

interface SectionProps {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}

// Число — отдельный узел, как раньше в JSX «До {n}-го». Иначе шейпинг «у» плывёт.
function titleNodes(title: string): ReactNode {
  const match = /^(\D*)(\d+)(.*)$/.exec(title);
  if (!match) return title;
  const [, before, digits, after] = match;
  return (
    <>
      {before}
      {digits}
      {after}
    </>
  );
}

export function Section({ id, title, aside, children }: SectionProps) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <h2 className="section__title" id={id}>
          {titleNodes(title)}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
