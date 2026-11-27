import {
  ArrowRight,
  ArrowUp,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Compass,
  GraduationCap,
  Mail,
  MapPin,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

// Swap this for a real campus photo when one is available. Keeping the path in
// one place makes the placeholder easy to replace without touching the layout.
const CAMPUS_IMAGE = '/campus-placeholder.svg';

const QUICK_LINKS = [
  { label: 'Admissions', href: '#admissions', icon: ClipboardCheck },
  { label: 'Courses', href: '#explore', icon: GraduationCap },
  { label: 'Placements', href: '#placements', icon: TrendingUp },
  { label: 'Campus Life', href: '#campus', icon: Users },
  { label: 'Events', href: '#campus', icon: CalendarDays },
  { label: 'Contact Us', href: '#resources', icon: Mail },
];

export function DiscoveryPanel({ onFocusChat }) {
  return (
    <aside id="about" className="pu-discovery" aria-labelledby="pu-discovery-title">
      <div className="pu-discovery-intro">
        <span className="pu-landing-badge">
          <Sparkles aria-hidden="true" />
          Welcome to PU-GPT
        </span>

        <h1 id="pu-discovery-title" className="pu-landing-title">
          Your Smart Guide to{' '}
          <span className="pu-landing-gradient-text">Parul University</span>
        </h1>

        <p className="pu-landing-lede">
          Explore courses, admissions, campus life, and university information in one place.
          Every answer is grounded in information approved by Parul University staff.
        </p>

        <div className="pu-landing-hero-actions">
          <a
            href="#chat"
            className="pu-landing-btn pu-landing-btn-primary"
            onClick={onFocusChat}
          >
            Ask the assistant
            <ArrowRight aria-hidden="true" />
          </a>
          <a href="#explore" className="pu-landing-btn pu-landing-btn-ghost">
            Explore courses
            <Compass aria-hidden="true" />
          </a>
        </div>
      </div>

      <figure className="pu-campus-card">
        <img
          src={CAMPUS_IMAGE}
          alt="Illustration of the Parul University campus"
          loading="lazy"
        />
        <figcaption className="pu-campus-location">
          <MapPin aria-hidden="true" />
          Vadodara, Gujarat
        </figcaption>
      </figure>

      <section className="pu-quick-links" aria-labelledby="pu-quick-links-title">
        <h2 id="pu-quick-links-title">Quick Links</h2>
        <div className="pu-quick-grid">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <a key={link.label} href={link.href} className="pu-quick-link">
                <Icon aria-hidden="true" />
                <span>{link.label}</span>
              </a>
            );
          })}
        </div>
      </section>

      <div className="pu-discovery-promo">
        <span className="pu-discovery-promo-icon" aria-hidden="true">
          <MessageSquare />
        </span>
        <div className="pu-discovery-promo-copy">
          <p>Still have questions?</p>
          <span>Just ask anything about Parul University!</span>
        </div>
        <button type="button" onClick={onFocusChat} className="pu-discovery-promo-btn">
          Ask now
          <ArrowUp aria-hidden="true" />
        </button>
      </div>

      <div className="pu-discovery-trust" aria-label="University information sources">
        <span>
          <Building2 aria-hidden="true" />
          University-approved sources
        </span>
        <span className="pu-discovery-trust-dot" aria-hidden="true" />
        <span>No account needed to ask</span>
      </div>
    </aside>
  );
}
