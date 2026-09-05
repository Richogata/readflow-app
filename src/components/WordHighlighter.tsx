'use client';

import { useEffect, useRef } from 'react';

export default function WordHighlighter({
  words, index, textSize,
}: {
  words: string[];
  index: number;
  textSize: number;
}) {
  const activeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [index]);

  return (
    <div className="leading-relaxed font-body select-none text-ink dark:text-paper tracking-[0.01em]" style={{ fontSize: `${textSize}px`, lineHeight: 1.75 }}>
      {words.map((w, i) => (
        <span
          key={i}
          ref={i === index ? activeRef : null}
          className={`focus-word mr-[0.28em] ${i === index ? 'is-active font-medium' : i < index ? 'is-read' : ''}`}
        >
          {w}
        </span>
      ))}
    </div>
  );
}
