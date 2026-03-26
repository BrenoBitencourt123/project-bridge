import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, LayoutDashboard, Package, BarChart3, Settings, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Projetos', icon: LayoutDashboard, path: '/' },
  { label: 'Assets', icon: Package, path: '/assets' },
  { label: 'Analytics', icon: BarChart3, path: '/analytics' },
  { label: 'Configurações', icon: Settings, path: '/settings' },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <aside
      className={cn(
        'relative flex h-screen flex-col border-r bg-card transition-all duration-200',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className={cn('flex h-14 items-center border-b px-3', collapsed ? 'justify-center' : 'gap-2 px-4')}>
        <Zap className="h-5 w-5 shrink-0 text-primary" />
        {!collapsed && <span className="text-sm font-bold">Atlas Studio</span>}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2 pt-3">
        {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const active = location.pathname === path;
          const btn = (
            <Button
              key={path}
              variant="ghost"
              onClick={() => navigate(path)}
              className={cn(
                'w-full justify-start gap-3 px-3',
                collapsed && 'justify-center px-0',
                active && 'bg-primary/10 text-primary hover:bg-primary/15'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="text-sm">{label}</span>}
            </Button>
          );

          if (collapsed) {
            return (
              <Tooltip key={path} delayDuration={0}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }
          return btn;
        })}
      </nav>

      {/* Logout */}
      <div className="border-t p-2">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={signOut} className="w-full text-muted-foreground hover:text-destructive">
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="ghost" onClick={signOut} className="w-full justify-start gap-3 px-3 text-muted-foreground hover:text-destructive">
            <LogOut className="h-4 w-4" />
            <span className="text-sm">Sair</span>
          </Button>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}
