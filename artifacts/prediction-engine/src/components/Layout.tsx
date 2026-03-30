import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Activity,
  BarChart2,
  FileText,
  FileBadge,
  Network,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/simulations", label: "Simulations", icon: Activity },
  { href: "/monte-carlo", label: "Monte Carlo", icon: BarChart2 },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/policies", label: "Policies", icon: FileBadge },
  { href: "/groups", label: "Groups", icon: Network },
  { href: "/events", label: "Events", icon: AlertTriangle },
  { href: "/architecture", label: "Architecture", icon: Boxes },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
              <img 
                src={`${import.meta.env.BASE_URL}images/logo.png`} 
                alt="Logo" 
                className="w-full h-full object-cover rounded-lg opacity-90"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            </div>
            <span className="font-bold tracking-tight text-lg bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              Predictive.AI
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group text-sm font-medium",
                  isActive 
                    ? "bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-primary/20" 
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground hover:translate-x-1"
                )}
              >
                <Icon className={cn("w-5 h-5 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
                )}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border/50">
          <div className="bg-secondary/30 rounded-xl p-4 border border-border/50 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <div className="text-xs text-muted-foreground font-mono">System Online</div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="" 
            className="w-full h-full object-cover opacity-10 mix-blend-screen"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-6 md:p-8 z-10">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
