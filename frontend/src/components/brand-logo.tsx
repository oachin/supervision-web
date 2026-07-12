import Image from 'next/image';
import { cn } from '@/lib/utils';

type BrandLogoProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizes = {
  sm: { icon: 34, text: 'text-[1.05rem]', gap: 'gap-2.5' },
  md: { icon: 44, text: 'text-[1.35rem]', gap: 'gap-3' },
  lg: { icon: 58, text: 'text-[1.85rem]', gap: 'gap-4' },
};

export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  const { icon, text, gap } = sizes[size];

  return (
    <div className={cn('flex items-center', gap, className)}>
      <Image
        src="/logo-havet-icon.png"
        alt=""
        width={icon}
        height={icon}
        priority={size === 'lg'}
        aria-hidden
        className="shrink-0"
        style={{ width: icon, height: 'auto' }}
      />
      <span
        className={cn(
          'whitespace-nowrap font-serif leading-none tracking-tight text-white',
          text,
        )}
      >
        Havet{' '}
        <span className="inline-flex items-baseline">
          Di
          <span className="bg-gradient-to-br from-[#5ce1e6] to-[#7b5cbf] bg-clip-text font-serif text-transparent">
            g
          </span>
          ital
          <sup className="ml-0.5 text-[0.45em] font-normal text-violet-400">®</sup>
        </span>
      </span>
    </div>
  );
}
