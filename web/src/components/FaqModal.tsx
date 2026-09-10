import React, { useState } from 'react';

interface FaqModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

export const FaqModal: React.FC<FaqModalProps> = ({ isOpen, onClose }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (!isOpen) return null;

  const faqs: FaqItem[] = [
    {
      question: 'What is the Dixon-Coles 250,000 Monte Carlo Engine?',
      answer: 'JamBets uses an advanced bivariate Poisson model with low-scoring correction (Dixon & Coles 1997). For every candidate fixture across 16 world leagues, our engine computes calibrated expected goals (xG), runs 250,000 independent Monte Carlo draws using the PCG64 random generator, and outputs exact empirical probabilities.',
      category: 'Modeling'
    },
    {
      question: 'What does the 🔥 BANGER category mean?',
      answer: 'A BANGER is an ultra-high probability simulation consensus (96.00% to 100.00% simulated outcome). It represents maximum algorithmic confidence where both offensive and defensive parameters strongly converge on the target market outcome.',
      category: 'Categories'
    },
    {
      question: 'How do settlement cycles and live scores work?',
      answer: 'Our automated Phase 7 settlement engine executes every 15 minutes (WAT timezone). It synchronizes live match events and full-time scores from verified sports feeds (ESPN, LiveScore). When a match finishes, each published prediction is settled strictly as WON (thick green), LOST (thick red), or VOID (grey).',
      category: 'Settlement'
    },
    {
      question: 'How are voided or cancelled matches treated?',
      answer: 'If a match is postponed, abandoned, or cancelled by competition organizers, the fixture is automatically marked as VOID. Voided predictions are completely excluded from the win/loss rate denominator and clearly reported in our public audit ledger.',
      category: 'Settlement'
    },
    {
      question: 'Why does JamBets enforce a Zero-Leakage Data Policy?',
      answer: 'JamBets only publishes fixtures that have passed strict multi-source data validation, completed 250,000 Monte Carlo simulation runs, and satisfied our mathematical publication thresholds. Any fixture with incomplete data remains strictly internal and is never published on the prediction UI. We guarantee 100% mathematical integrity with zero speculative leaks.',
      category: 'Integrity'
    }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card faq-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-brand">
            <span className="modal-brand-badge" style={{ background: '#059669' }}>J</span>
            <div>
              <h2 className="modal-title">Frequently Asked Questions</h2>
              <p className="modal-subtitle">Mathematical transparency, simulation rules, and settlement methodology</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="faq-list">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div key={idx} className={`faq-item ${isOpen ? 'active' : ''}`}>
                <button
                  type="button"
                  className="faq-question-btn"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                >
                  <span className="faq-q-text">{faq.question}</span>
                  <span className="faq-icon">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="faq-answer-content">
                    <p>{faq.answer}</p>
                    <span className="faq-cat-tag">Topic: {faq.category}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
