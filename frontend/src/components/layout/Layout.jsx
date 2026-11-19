import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useTheme } from '@/context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();

  // On tablets/phones the rail collapses to icons so the content keeps room.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (event) => setIsNarrow(event.matches);
    setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const collapsed = sidebarCollapsed || isNarrow;

  // The Ask screen keeps its own full-height canvas and composer, but uses the
  // same navigation sidebar as every other page.
  if (location.pathname === '/ask') {
    return (
      <div className={`pu-app transition-all duration-300 ${collapsed ? 'pl-16' : 'pl-64'}`}>
        <Sidebar onCollapseChange={setSidebarCollapsed} collapsed={collapsed} />
        <main className="pu-main" role="main">
          <button
            type="button"
            className="pu-theme-pill"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              <Sun className="pu-theme-icon" />
            ) : (
              <Moon className="pu-theme-icon" />
            )}
          </button>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chalkboard">
      <Sidebar onCollapseChange={setSidebarCollapsed} collapsed={collapsed} />
      <Header sidebarCollapsed={collapsed} />
      <main
        className={`pt-16 min-h-screen transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-64'}`}
        role="main"
      >
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
