import {
  ArrowUp,
  Award,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Dumbbell,
  FileSearch,
  FileText,
  GraduationCap,
  HeartPulse,
  Info,
  Landmark,
  Laptop,
  Network,
  Palette,
  PartyPopper,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'explore',
    eyebrow: 'Discover',
    title: 'Explore Courses',
    description:
      'Browse by degree level or interest. Each card asks the university assistant a real question, so the answer comes from approved university information.',
    icon: GraduationCap,
    groups: [
      {
        label: 'By degree level',
        cards: [
          {
            label: 'Undergraduate programs',
            hint: "Bachelor's degrees and integrated courses",
            question: 'What undergraduate courses are offered at Parul University?',
            icon: BookOpen,
          },
          {
            label: 'Postgraduate programs',
            hint: "Master's degrees and specialisations",
            question: 'What postgraduate courses are offered at Parul University?',
            icon: GraduationCap,
          },
          {
            label: 'Diploma & certificate',
            hint: 'Short-term and skill-focused programs',
            question: 'Does Parul University offer diploma or certificate courses?',
            icon: FileText,
          },
          {
            label: 'Research & doctoral',
            hint: 'PhD and research opportunities',
            question: 'What doctoral and research programs are available at Parul University?',
            icon: FileSearch,
          },
        ],
      },
      {
        label: 'By interest',
        cards: [
          {
            label: 'Engineering & technology',
            hint: 'Technology and applied sciences',
            question: 'Which engineering and technology courses does Parul University offer?',
            icon: Laptop,
          },
          {
            label: 'Computer science & AI',
            hint: 'Computing, data, and artificial intelligence',
            question: 'What computer science and AI courses are offered at Parul University?',
            icon: Network,
          },
          {
            label: 'Business & management',
            hint: 'Management, commerce, and entrepreneurship',
            question: 'What business and management courses are available at Parul University?',
            icon: Briefcase,
          },
          {
            label: 'Design & media',
            hint: 'Creative and communication programs',
            question: 'What design and media courses are available at Parul University?',
            icon: Palette,
          },
        ],
      },
    ],
    note: 'Course lists are answered from university-approved information. If a program is not in the approved sources, the assistant will say so.',
  },
  {
    id: 'admissions',
    eyebrow: 'Apply',
    title: 'Admissions Companion',
    description:
      'Understand the process, requirements, and key dates before you apply. Ask about any step and get an answer from approved university information.',
    icon: ClipboardCheck,
    groups: [
      {
        label: 'Plan your application',
        cards: [
          {
            label: 'Admission process',
            hint: 'Steps from enquiry to enrolment',
            question: 'How do I apply for admission at Parul University?',
            icon: ClipboardCheck,
          },
          {
            label: 'Eligibility criteria',
            hint: 'Requirements for each program',
            question: 'What are the eligibility criteria for admission?',
            icon: CheckCircle2,
          },
          {
            label: 'Fees & payments',
            hint: 'Tuition and application fees',
            question: 'What are the course fees at Parul University?',
            icon: Wallet,
          },
          {
            label: 'Scholarships',
            hint: 'Financial aid and awards',
            question: 'What scholarships are available at Parul University?',
            icon: Award,
          },
          {
            label: 'Important dates',
            hint: 'Intake and deadline information',
            question: 'What are the important admission dates?',
            icon: CalendarDays,
          },
          {
            label: 'Application checklist',
            hint: 'Documents and next steps',
            question: 'What documents are required for admission?',
            icon: FileText,
          },
        ],
      },
    ],
    note: 'Fees, dates, and eligibility are answered from approved university information and can change by intake.',
  },
  {
    id: 'campus',
    eyebrow: 'Student life',
    title: 'Campus Life',
    description:
      'Explore hostels, dining, sports, clubs, facilities, and events. Ask the assistant for the details that matter to you.',
    icon: Users,
    groups: [
      {
        label: 'Life on campus',
        cards: [
          {
            label: 'Hostel facilities',
            hint: 'Rooms, amenities, and rules',
            question: 'Tell me about hostel facilities at Parul University.',
            icon: Building2,
          },
          {
            label: 'Food & dining',
            hint: 'Mess and dining options',
            question: 'What food and dining options are available on campus?',
            icon: Utensils,
          },
          {
            label: 'Sports & fitness',
            hint: 'Teams, grounds, and gym',
            question: 'What sports and fitness facilities are available?',
            icon: Dumbbell,
          },
          {
            label: 'Clubs & activities',
            hint: 'Student clubs and societies',
            question: 'What clubs and student activities are available?',
            icon: Users,
          },
          {
            label: 'Campus facilities',
            hint: 'Library, labs, and support',
            question: 'What facilities are available on campus?',
            icon: Landmark,
          },
          {
            label: 'Events & fests',
            hint: 'Festivals and campus events',
            question: 'What events and festivals are held at Parul University?',
            icon: PartyPopper,
          },
        ],
      },
    ],
    note: 'Facility details are answered from approved university information. Availability can vary by hostel or program.',
  },
  {
    id: 'placements',
    eyebrow: 'Career',
    title: 'Career & Placements',
    description:
      'Learn about placements, career opportunities, internships, and the support available to students.',
    icon: TrendingUp,
    groups: [
      {
        label: 'Build your career',
        cards: [
          {
            label: 'Placement information',
            hint: 'Placement process and outcomes',
            question: 'What are the placement statistics at Parul University?',
            icon: TrendingUp,
          },
          {
            label: 'Career opportunities',
            hint: 'Roles and recruiters',
            question: 'What career opportunities are available after studying at Parul University?',
            icon: Briefcase,
          },
          {
            label: 'Internships',
            hint: 'Practical experience and industry links',
            question: 'Does Parul University offer internships?',
            icon: Network,
          },
          {
            label: 'Placement resources',
            hint: 'Training and career support',
            question: 'What placement and career support resources are available?',
            icon: HeartPulse,
          },
        ],
      },
    ],
    emptyState: {
      title: 'Placement statistics',
      text: 'Official placement figures will be shown here once the university publishes approved data. Until then, ask the assistant for the latest approved details.',
    },
    note: 'Only statistics supported by approved university information are shared.',
  },
];

export function DiscoverySections({ onAsk, disabled = false }) {
  return (
    <div className="pu-landing-sections">
      {SECTIONS.map((section) => {
        const SectionIcon = section.icon;
        return (
          <section
            key={section.id}
            id={section.id}
            className="pu-discovery-section"
            aria-labelledby={`${section.id}-title`}
          >
            <header className="pu-section-head">
              <div className="pu-section-title-row">
                <span className="pu-section-icon" aria-hidden="true">
                  <SectionIcon />
                </span>
                <div>
                  <span className="pu-landing-eyebrow">{section.eyebrow}</span>
                  <h2 id={`${section.id}-title`} className="pu-section-title">
                    {section.title}
                  </h2>
                </div>
              </div>
              <p className="pu-section-desc">{section.description}</p>
            </header>

            {section.groups.map((group) => (
              <div key={group.label} className="pu-card-group">
                <p className="pu-card-group-label">{group.label}</p>
                <div className="pu-discovery-grid">
                  {group.cards.map((card) => {
                    const CardIcon = card.icon;
                    return (
                      <button
                        key={card.label}
                        type="button"
                        className="pu-discovery-card"
                        onClick={() => onAsk(card.question)}
                        disabled={disabled}
                      >
                        <span className="pu-discovery-card-icon" aria-hidden="true">
                          <CardIcon />
                        </span>
                        <span className="pu-discovery-card-copy">
                          <span className="pu-discovery-card-title">{card.label}</span>
                          <span className="pu-discovery-card-sub">{card.hint}</span>
                        </span>
                        <ArrowUp className="pu-discovery-card-arrow" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {section.emptyState && (
              <div className="pu-discovery-empty">
                <span className="pu-discovery-empty-icon" aria-hidden="true">
                  <TrendingUp />
                </span>
                <div>
                  <p className="pu-discovery-empty-title">{section.emptyState.title}</p>
                  <p className="pu-discovery-empty-text">{section.emptyState.text}</p>
                </div>
              </div>
            )}

            {section.note && (
              <p className="pu-discovery-note">
                <Info aria-hidden="true" />
                <span>{section.note}</span>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
