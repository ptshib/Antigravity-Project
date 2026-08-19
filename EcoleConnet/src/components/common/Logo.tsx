import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark' | 'white';
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ variant = 'dark', size = 'md', showSubtitle = false }) => {
  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  };

  const textSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl font-extrabold'
  };

  const textColor = variant === 'white' ? 'text-white' : variant === 'light' ? 'text-slate-100' : 'text-slate-900';

  return (
    <div className="flex items-center gap-3 select-none">
      <div className={`relative flex items-center justify-center rounded-xl bg-gradient-to-tr from-blue-900 via-blue-700 to-amber-500 shadow-md p-2 text-white ${iconSizes[size]}`}>
        {/* SVG Icon combining Graduation Cap + Connected Nodes */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" />
          <circle cx="6" cy="17" r="1" fill="currentColor" />
          <circle cx="18" cy="17" r="1" fill="currentColor" />
        </svg>
      </div>
      <div>
        <div className={`font-bold tracking-tight ${textSizes[size]} ${textColor} flex items-center gap-1`}>
          <span>École</span>
          <span className="text-amber-500 font-extrabold">Connect</span>
        </div>
        {showSubtitle && (
          <p className="text-[11px] font-medium text-slate-400 -mt-1 tracking-wide">
            par PaTShi-Digital
          </p>
        )}
      </div>
    </div>
  );
};
