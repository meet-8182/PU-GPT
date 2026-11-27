import { useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  Mail,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

const CORE_QUESTIONS = [
  { label: 'What courses are offered?', icon: BookOpen },
  { label: 'How do I apply for admission?', icon: ClipboardCheck },
  { label: 'What are the placement statistics?', icon: TrendingUp },
  { label: 'Tell me about hostel facilities.', icon: Building2 },
  { label: 'What is campus life like?', icon: Users },
  { label: 'What are the important admission dates?', icon: CalendarDays },
  { label: 'What scholarships are available?', icon: Award },
  { label: 'What are the eligibility criteria?', icon: CheckCircle2 },
];

const EXTRA_QUESTIONS = [
  { label: 'What documents are required for admission?', icon: FileText },
  { label: 'How do I contact the admissions office?', icon: Mail },
  { label: 'Are there research opportunities for students?', icon: Sparkles },
  { label: 'What support services are available for students?', icon: Users },
];

export function SuggestedQuestions({ onAsk, disabled = false }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="pu-suggested" aria-labelledby="pu-suggested-title">
      <div className="pu-suggested-head">
        <div>
          <span className="pu-landing-eyebrow">Start here</span>
          <h3 id="pu-suggested-title">Try these quick questions</h3>
        </div>
        <button
          type="button"
          className="pu-suggested-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="pu-suggested-extra"
        >
          {expanded ? (
            <>
              Show less
              <ChevronUp aria-hidden="true" />
            </>
          ) : (
            <>
              See more
              <ChevronDown aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      <div className="pu-suggested-grid">
        {CORE_QUESTIONS.map((question) => {
          const Icon = question.icon;
          return (
            <button
              key={question.label}
              type="button"
              className="pu-suggested-card"
              onClick={() => onAsk(question.label)}
              disabled={disabled}
            >
              <Icon aria-hidden="true" />
              <span>{question.label}</span>
              <ArrowUp className="pu-suggested-arrow" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {expanded && (
        <div id="pu-suggested-extra" className="pu-suggested-grid pu-suggested-extra">
          {EXTRA_QUESTIONS.map((question) => {
            const Icon = question.icon;
            return (
              <button
                key={question.label}
                type="button"
                className="pu-suggested-card"
                onClick={() => onAsk(question.label)}
                disabled={disabled}
              >
                <Icon aria-hidden="true" />
                <span>{question.label}</span>
                <ArrowRight className="pu-suggested-arrow" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
