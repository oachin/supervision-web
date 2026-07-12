import Image from 'next/image';
import { cn } from '@/lib/utils';

type BrandLogoProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizes = {
  sm: { width: 140, height: 36, className: 'h-9 w-auto' },
  md: { width: 200, height: 52, className: 'h-12 w-auto' },
  lg: { width: 280, height: 72, className: 'h-[4.5rem] w-auto' },
};

export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  const { width, height, className: sizeClass } = sizes[size];

  return (
    <Image
      src="/logo-havet-digital.png"
      alt="Havet Digital"
      width={width}
      height={height}
      priority={size === 'lg'}
      className={cn(sizeClass, className)}
    />
  );
}
