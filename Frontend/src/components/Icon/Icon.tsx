const paths = {
  shift:
    'M7 3h10a4 4 0 0 1 4 4v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4ZM3 10h18M8 13.5h.01M16 13.5h.01M8 17l-2 4M16 17l2 4',
  rating: 'M3 20h18M4 20v-6h5v6M9 20V9h6v11M15 20v-4h5v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1.3-4 4.3-6 8-6s6.7 2 8 6',
  feed: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21h4',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  flame: 'M12 3c.8 3 5 5.3 5 10a5 5 0 0 1-10 0c0-2.4 1.2-4 2.5-5 .4 2 1.4 3 2.5 3-.2-2.7-1-5 0-8Z',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
  plus: 'M12 5v14M5 12h14',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z',
  medal: 'M8 3l4 6 4-6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z',
  // Знаки отличия
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01',
  ear: 'M7 10a5 5 0 1 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 .5M10 10a2 2 0 0 1 4 0M20 7c1 1.5 1 4 0 5.5',
  check: 'M4 7l2 2 3-3M4 17l2 2 3-3M12 7h8M12 17h8',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2',
  lens: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 21 21',
  calls: 'M7 8h.01M12 8h.01M17 8h.01M4 4h16v10H9l-5 4Z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z',
} as const;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
