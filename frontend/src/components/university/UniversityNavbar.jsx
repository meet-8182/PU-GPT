import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Compass,
  FileText,
  GraduationCap,
  Home,
  Library,
  LogIn,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', href: '#home', icon: Home },
  { id: 'explore', label: 'Explore', href: '#explore', icon: Compass },
  { id: 'documents', label: 'Documents', href: '#documents', icon: FileText },
  { id: 'resources', label: 'Resources', href: '#resources', icon: Library },
  { id: 'about', label: 'About PU', href: '#about', icon: BookOpen },
];

export function UniversityNavbar() {
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('home');

  useEffect(() => {
    const syncFromHash = () => {
      const id = window.location.hash.replace('#', '');
      if (NAV_ITEMS.some((item) => item.id === id)) {
        setActive(id);
      }
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const selectNav = (id) => {
    setActive(id);
    setMenuOpen(false);
  };

  return (
    <header className="pu-landing-nav">
      <div className="pu-landing-nav-inner">
        <a
          href="#home"
          className="pu-landing-brand"
          onClick={() => selectNav('home')}
          aria-label="PU-GPT home"
        >
          <span className="pu-landing-brand-mark" aria-hidden="true">
            <GraduationCap />
          </span>
          <span className="pu-landing-brand-text">
            <span className="pu-landing-brand-title">PU-GPT</span>
            <span className="pu-landing-brand-sub">Parul University</span>
          </span>
        </a>

        <nav className="pu-landing-nav-links" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <a
                key={item.id}
                href={item.href}
                className={`pu-landing-nav-link${isActive ? ' is-active' : ''}`}
                onClick={() => selectNav(item.id)}
                aria-current={isActive ? 'location' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="pu-landing-nav-actions">
          <button
            type="button"
            className="pu-landing-theme"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            <span>{isDark ? 'Light' : 'Dark'}</span>
          </button>

          <Link to="/login" className="pu-landing-login">
            <LogIn aria-hidden="true" />
            <span>Login</span>
          </Link>

          <button
            type="button"
            className="pu-landing-menu-btn"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-controls="pu-landing-mobile-nav"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="pu-landing-mobile-nav" className="pu-landing-mobile">
          <nav aria-label="Mobile navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className={`pu-landing-mobile-link${isActive ? ' is-active' : ''}`}
                  onClick={() => selectNav(item.id)}
                  aria-current={isActive ? 'location' : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="pu-landing-mobile-actions">
            <button
              type="button"
              className="pu-landing-theme is-wide"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <Link to="/login" className="pu-landing-login is-wide" onClick={() => setMenuOpen(false)}>
              <LogIn aria-hidden="true" />
              <span>Login</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
