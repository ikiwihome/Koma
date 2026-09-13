import React, { useId } from 'react';

export type AppLogoVariant = 'titlebar' | 'sidebar';

interface AppLogoProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  variant?: AppLogoVariant;
  label?: string;
}

const variantClassNames: Record<AppLogoVariant, string> = {
  titlebar: 'w-5 h-5 rounded shadow-sm shadow-accent/15',
  sidebar: 'w-10 h-10 rounded-xl shadow-lg shadow-accent/20',
};

/**
 * Unified Koma application logo.
 *
 * The mark is based on the repository branding SVG: a clapperboard badge
 * with a stylized K path, so shell chrome and navigation can share one logo.
 */
export const AppLogo: React.FC<AppLogoProps> = ({
  variant = 'sidebar',
  label = 'Koma',
  className,
  ...props
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const bgId = `${idPrefix}-app-logo-bg`;
  const clapperId = `${idPrefix}-app-logo-clapper`;
  const bodyId = `${idPrefix}-app-logo-body`;
  const letterId = `${idPrefix}-app-logo-letter`;

  return (
    <div
      role="img"
      aria-label={label}
      className={[variantClassNames[variant], 'relative shrink-0 overflow-hidden', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <svg
        className="block h-full w-full"
        viewBox="0 0 1024 1024"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={bgId} x1="120" y1="120" x2="892" y2="920" gradientUnits="userSpaceOnUse">
            <stop stopColor="#11172C" />
            <stop offset="1" stopColor="#090D18" />
          </linearGradient>
          <linearGradient id={clapperId} x1="250" y1="228" x2="770" y2="762" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8D57FF" />
            <stop offset="1" stopColor="#23D3FF" />
          </linearGradient>
          <linearGradient id={bodyId} x1="278" y1="420" x2="746" y2="786" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1B2544" />
            <stop offset="1" stopColor="#11182E" />
          </linearGradient>
          <linearGradient id={letterId} x1="370" y1="400" x2="670" y2="720" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#D5E9FF" />
          </linearGradient>
        </defs>

        <rect width="1024" height="1024" rx="220" fill={`url(#${bgId})`} />

        <g transform="translate(0 8)">
          <rect
            x="262"
            y="292"
            width="500"
            height="116"
            rx="30"
            transform="rotate(-10 262 292)"
            fill={`url(#${clapperId})`}
          />
          <path d="M294 276L375 262" stroke="#D8C4FF" strokeWidth="20" strokeLinecap="round" />
          <path d="M418 254L499 240" stroke="#D8C4FF" strokeWidth="20" strokeLinecap="round" />
          <path d="M542 232L623 218" stroke="#D8C4FF" strokeWidth="20" strokeLinecap="round" />
          <path d="M666 210L731 199" stroke="#D8C4FF" strokeWidth="20" strokeLinecap="round" />

          <rect
            x="238"
            y="372"
            width="548"
            height="400"
            rx="56"
            fill={`url(#${bodyId})`}
            stroke={`url(#${clapperId})`}
            strokeWidth="24"
          />

          <path
            d="M360 454C360 441.85 369.85 432 382 432H445C457.15 432 467 441.85 467 454V562L590 439.25C594.13 435.13 599.73 432.81 605.56 432.81H675.42C695.08 432.81 704.94 456.45 691.11 470.43L569.41 593.43L697.25 677.75C711.66 687.25 704.93 709.5 687.67 709.5H620.12C615.85 709.5 611.66 708.26 608.08 705.94L503.42 638.08L467 674.38V688C467 700.15 457.15 710 445 710H382C369.85 710 360 700.15 360 688V454Z"
            fill={`url(#${letterId})`}
          />
        </g>

        <path d="M784 248L800 287L839 303L800 319L784 358L768 319L729 303L768 287L784 248Z" fill="#FFB547" />
      </svg>
    </div>
  );
};
