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
      <aside className="w-64 shrink-0 border-r border-border/80 bg-gradient-to-b from-card/70 via-card/45 to-card/30 backdrop-blur-2xl flex flex-col z-20 shadow-[4px_0_32px_rgba(0,0,0,0.35)]">
        <div className="h-16 flex items-center px-6 border-b border-border/40">
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
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative min-w-0">
        <div className="absolute inset-0 pointer-events-none z-0">
          <img
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
            alt=""
            className="w-full h-full object-cover opacity-[0.07] mix-blend-screen"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div
            className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)_/_0.12),transparent)]"
            aria-hidden
          />
          <div
            className="absolute inset-0 opacity-[0.4] bg-[linear-gradient(to_right,hsl(var(--border)_/_0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)_/_0.35)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_40%,transparent)]"
            aria-hidden
          />
        </div>
        <div className="relative flex-1 overflow-y-auto scroll-smooth z-10 p-4 pb-8 sm:p-6 md:p-8 md:pb-10">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/[0.08] via-primary/[0.02] to-transparent"
            aria-hidden
          />
          <div className="relative mx-auto w-full max-w-7xl rounded-2xl border border-border/50 bg-card/[0.35] shadow-[0_0_0_1px_hsl(var(--foreground)_/_0.03),0_24px_80px_-32px_rgba(0,0,0,0.55)] backdrop-blur-xl ring-1 ring-primary/[0.06]">
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/[0.04] via-transparent to-accent/[0.05]" aria-hidden />
            <div className="relative px-5 py-8 sm:px-8 sm:py-10 md:px-10 md:py-12">
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
