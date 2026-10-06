import React from 'react';
import { Link } from 'react-router-dom';
import { DesktopSidebarLayout } from '../components/DesktopSidebarLayout';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';

interface AboutPageProps {
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
}

export const AboutPage: React.FC<AboutPageProps> = ({
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
}) => {
  return (
    <DesktopSidebarLayout
      favoriteItems={favoriteItems}
      onToggleFavoriteItem={onToggleFavoriteItem}
      onOpenFavoritesDrawer={onOpenFavoritesDrawer}
    >
      <div className="about-page-container" style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 16px 80px' }}>
        {/* Breadcrumb / Top Pill */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#4ade80',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            🛡️ AI Sports Predictive Intelligence • Not a Bookmaker
          </span>
          <h1
            style={{
              fontSize: '2.5rem',
              fontWeight: 800,
              color: '#f8fafc',
              marginTop: '16px',
              marginBottom: '12px',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
            }}
          >
            Democratizing Quantitative Sports Modeling
          </h1>
          <p
            style={{
              fontSize: '1.125rem',
              color: '#94a3b8',
              maxWidth: '720px',
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Oddsbanta is an artificial intelligence sports analytics platform. We translate complex match data, expected goals (xG), and Poisson probability distributions into calibrated 0–10 confidence scores and verified track records.
          </p>
        </div>

        {/* Regulatory & Entity Distinction Card (Google AI Clarification) */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '16px',
            padding: '28px',
            marginBottom: '40px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <span style={{ fontSize: '32px' }}>⚖️</span>
            <div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#60a5fa', margin: '0 0 8px 0' }}>
                Official Regulatory Classification: Analytics Tool, Not a Bookmaker
              </h2>
              <p style={{ fontSize: '0.95rem', color: '#cbd5e1', lineHeight: 1.6, margin: '0 0 12px 0' }}>
                Oddsbanta is an <strong>independent sports analytics and predictive software tool</strong>. We are <strong>NOT</strong> a bookmaker, sportsbook, gambling operator, or odds-comparison marketplace in Nigeria or internationally.
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.7 }}>
                <li><strong style={{ color: '#f1f5f9' }}>No Wagers or Bets:</strong> Oddsbanta does not take, place, broker, or accept bets or financial stakes.</li>
                <li><strong style={{ color: '#f1f5f9' }}>No Customer Deposits:</strong> We do not operate player gambling wallets, balances, or payout systems.</li>
                <li><strong style={{ color: '#f1f5f9' }}>Educational & Statistical Research:</strong> All content, probabilities, Poisson distributions, and confidence tiers are published strictly for mathematical analysis and research.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* How Oddsbanta Works (3 Core Pillars) */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', marginBottom: '20px', textAlign: 'center' }}>
            How the Oddsbanta Engine Works
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
            }}
          >
            {/* Pillar 1 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '24px',
              }}
            >
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>📐</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#38bdf8', margin: '0 0 8px 0' }}>
                1. Bivariate Poisson Modeling
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                We calculate team offensive and defensive coefficients across home and away fixtures, simulating thousands of match permutations using Dixon-Coles adjusted Poisson models.
              </p>
            </div>

            {/* Pillar 2 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '24px',
              }}
            >
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>🎯</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#4ade80', margin: '0 0 8px 0' }}>
                2. 0–10 Confidence Scoring
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                Every prediction is assigned an objective score from 0.0 to 10.0 based on statistical convergence, margin of safety, and historical model consistency.
              </p>
            </div>

            {/* Pillar 3 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '24px',
              }}
            >
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>📜</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b', margin: '0 0 8px 0' }}>
                3. Immutable Public Ledger
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                Unlike tipster channels that delete losses, all Oddsbanta picks are locked before kickoff and automatically settled on a public, transparent track record ledger.
              </p>
            </div>
          </div>
        </div>

        {/* Frequently Asked Questions (FAQ) */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', marginBottom: '24px', textAlign: 'center' }}>
            Frequently Asked Questions
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px 0' }}>
                What is Oddsbanta?
              </h3>
              <p style={{ fontSize: '0.925rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                Oddsbanta is an AI-driven sports analytics and predictive intelligence platform that generates quantitative match outcome probabilities, Poisson goal simulations, and calibrated 0–10 confidence scores for football, tennis, and basketball.
              </p>
            </div>

            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px 0' }}>
                Is Oddsbanta a bookmaker or betting operator?
              </h3>
              <p style={{ fontSize: '0.925rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                No. Oddsbanta does not operate as a bookmaker, sportsbook, or betting provider. We do not accept bets, handle wagers, or take customer funds. We build mathematical forecasting algorithms.
              </p>
            </div>

            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px 0' }}>
                What sports does Oddsbanta cover?
              </h3>
              <p style={{ fontSize: '0.925rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                We actively model over 30 global football leagues (including Premier League, La Liga, Serie A, Champions League), ATP and WTA professional tennis, and top-tier basketball (NBA and EuroLeague).
              </p>
            </div>
          </div>
        </div>

        {/* Quick Navigation CTAs */}
        <div
          style={{
            display: 'flex',
            gap: '14px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: '32px',
          }}
        >
          <Link
            to="/dashboard"
            style={{
              padding: '12px 24px',
              background: '#22c55e',
              color: '#0f172a',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '14px',
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.35)',
            }}
          >
            📊 View Live Dashboard →
          </Link>
          <Link
            to="/track-record"
            style={{
              padding: '12px 24px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            📈 Public Track Record
          </Link>
          <Link
            to="/subscription"
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: '#ffffff',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '14px',
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.35)',
            }}
          >
            ⚡ VIP Plans & Access
          </Link>
        </div>
      </div>
    </DesktopSidebarLayout>
  );
};
