import { Music, Image, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STEPS = [
  { label: 'Áudio', icon: Music },
  { label: 'Revisão', icon: Image },
  { label: 'Export', icon: Download },
];

interface StepperHeaderProps {
  currentStep: number;
  maxStep: number;
  onStepChange: (step: number) => void;
}

export function StepperHeader({ currentStep, maxStep, onStepChange }: StepperHeaderProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentStep;
        const isReachable = i <= maxStep;
        return (
          <Button
            key={i}
            variant={isActive ? 'default' : 'ghost'}
            size="sm"
            disabled={!isReachable}
            onClick={() => onStepChange(i)}
            className={cn(
              'flex-shrink-0 gap-1.5 text-xs',
              isActive && 'shadow-md',
              !isReachable && 'opacity-40',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{step.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
