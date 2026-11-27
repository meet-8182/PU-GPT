import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUp,
  CalendarCheck,
  FileText,
  Mail,
  ShieldCheck,
} from 'lucide-react';

export function UniversityResources({ infoStatus, lastReviewed, statusLoading, onFocusChat }) {
  const approvedCount = Number(infoStatus?.approvedCount || 0);
  const contactBlock = infoStatus?.contactBlock || '';

  const approvedLabel = statusLoading
    ? 'Checking approved information…'
    : approvedCount > 0
      ? `${approvedCount} approved ${approvedCount === 1 ? 'document' : 'documents'} available`
      : 'No approved information available yet';

  return (
    <section id="resources" className="pu-resources" aria-labelledby="pu-resources-title">
      <header className="pu-section-head">
        <div className="pu-section-title-row">
          <span className="pu-section-icon" aria-hidden="true">
            <FileText />
          </span>
          <div>
            <span className="pu-landing-eyebrow">Resources</span>
            <h2 id="pu-resources-title" className="pu-section-title">
              Documents &amp; support
            </h2>
          </div>
        </div>
        <p className="pu-section-desc">
          Course documents live behind your student account. University information and contact
          details are available here.
        </p>
      </header>

      <div className="pu-resources-grid">
        <article id="documents" className="pu-resource-card">
          <span className="pu-resource-icon" aria-hidden="true">
            <FileText />
          </span>
          <h3>Course documents</h3>
          <p>
            Sign in to access course material, previous papers, and subject resources shared by
            your teachers.
          </p>
          <Link to="/login" className="pu-resource-action">
            Sign in to documents
            <ArrowRight aria-hidden="true" />
          </Link>
        </article>

        <article className="pu-resource-card">
          <span className="pu-resource-icon" aria-hidden="true">
            <ShieldCheck />
          </span>
          <h3>Approved university information</h3>
          <p>{approvedLabel}</p>
          {lastReviewed && (
            <p className="pu-resource-meta">
              <CalendarCheck aria-hidden="true" />
              Last reviewed {lastReviewed}
            </p>
          )}
          <button type="button" className="pu-resource-action" onClick={onFocusChat}>
            Ask the assistant
            <ArrowUp aria-hidden="true" />
          </button>
        </article>

        <article className="pu-resource-card">
          <span className="pu-resource-icon" aria-hidden="true">
            <Mail />
          </span>
          <h3>Contact &amp; support</h3>
          {contactBlock ? (
            <div className="pu-resource-contact">{contactBlock}</div>
          ) : (
            <p>Contact details will appear here once they are added by the university.</p>
          )}
        </article>
      </div>

      {infoStatus?.disclaimer && (
        <p className="pu-resources-disclaimer">{infoStatus.disclaimer}</p>
      )}
    </section>
  );
}
