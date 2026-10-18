import clsx from "clsx";

type IconProps = { className?: string };

export function IconGrid({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconActivity({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function IconSettings({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

export function IconRain({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 19v-3M12 19v-5M16 19v-2" strokeLinecap="round" />
      <path d="M8.5 14A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 3.5 7.5" />
    </svg>
  );
}

export function IconBox({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  );
}

export function IconBolt({ className }: IconProps) {
  return (
    <svg className={clsx("h-5 w-5", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLogo({ className }: IconProps) {
  return (
    <svg className={clsx("h-8 w-8", className)} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="10" className="fill-violet-500/20" />
      <path
        d="M8 22V10l8 6 8-6v12"
        stroke="url(#logoGrad)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="logoGrad" x1="8" y1="10" x2="24" y2="22">
          <stop stopColor="#c4b5fd" />
          <stop offset="0.5" stopColor="#e879f9" />
          <stop offset="1" stopColor="#6ee7b7" />
        </linearGradient>
      </defs>
    </svg>
  );
}
