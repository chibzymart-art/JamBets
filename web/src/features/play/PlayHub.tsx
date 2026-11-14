import { NavLink, useLocation } from 'react-router-dom';
import { PLAY_TABS, playTabFromPath } from './playTabs';
import './play.css';

/**
 * Play Hub (UI only). User picks, leaderboards and leagues are not live yet,
 * so every tab shows a "coming soon" state. Nothing here reads or writes data.
 */

interface PlayHubProps {
  isSignedIn: boolean;
  onCreateAccount: () => void;
}

function SoonBadge() {
  return <span className="play-soon-badge">Coming soon</span>;
}

function SignupCta({ isSignedIn, onCreateAccount }: PlayHubProps) {
  if (isSignedIn) {
    return (
      <p className="play-cta-note">
        You're signed in, so you're ready. Banter Hub opens here as soon as it launches.
      </p>
    );
  }
  return (
    <div className="play-cta-row">
      <button type="button" className="play-btn-primary" onClick={onCreateAccount}>
        Create a free account
      </button>
      <span className="play-cta-note">Free to play. 18+ only.</span>
    </div>
  );
}

function TodayTab(props: PlayHubProps) {
  return (
    <>
      <section className="play-card play-hero">
        <div className="play-hero-head">
          <h1 className="play-title">Make your own calls</h1>
          <SoonBadge />
        </div>
        <p className="play-lead">
          Pick results on today's matches, beat your friends and the Oddsbanta AI, and climb the weekly leaderboard.
        </p>
        <ol className="play-steps">
          <li>
            <span className="play-step-num">1</span>
            <div>
              <strong>Call it before kickoff</strong>
              <span>Match result, Over/Under 2.5 goals or both teams to score.</span>
            </div>
          </li>
          <li>
            <span className="play-step-num">2</span>
            <div>
              <strong>Calls lock at kickoff</strong>
              <span>Other players' calls stay hidden until the match starts.</span>
            </div>
          </li>
          <li>
            <span className="play-step-num">3</span>
            <div>
              <strong>Score and climb</strong>
              <span>Settled automatically after full time, like our own picks.</span>
            </div>
          </li>
        </ol>
        <SignupCta {...props} />
      </section>

      <section className="play-card">
        <div className="play-section-head">
          <h2 className="play-subtitle">How a call will look</h2>
          <span className="play-preview-tag">Preview</span>
        </div>
        <div className="play-preview-fixture" aria-hidden="true">
          <div className="play-preview-meta">
            <span>League · Kickoff time</span>
            <span className="play-lock">Locks at kickoff</span>
          </div>
          <div className="play-preview-teams">
            <span>Home team</span>
            <span className="play-vs">vs</span>
            <span>Away team</span>
          </div>
          <div className="play-preview-label">Match result</div>
          <div className="play-preview-opts">
            <span className="play-opt">Home</span>
            <span className="play-opt">Draw</span>
            <span className="play-opt">Away</span>
          </div>
        </div>
      </section>
    </>
  );
}

function EmptyTab({
  icon,
  title,
  body,
  children,
  ...props
}: PlayHubProps & { icon: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="play-card play-empty">
      <div className="play-empty-icon" aria-hidden="true">{icon}</div>
      <div className="play-hero-head play-hero-head--center">
        <h1 className="play-title">{title}</h1>
        <SoonBadge />
      </div>
      <p className="play-lead">{body}</p>
      {children}
      <SignupCta {...props} />
    </section>
  );
}

export default function PlayHub(props: PlayHubProps) {
  const location = useLocation();
  const tab = playTabFromPath(location.pathname);

  return (
    <div className="play-hub">
      <nav className="play-tabs" aria-label="Banter Hub sections">
        {PLAY_TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.path}
            end
            className={() => `play-tab ${tab === t.id ? 'active' : ''}`}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="play-body">
        {tab === 'today' && <TodayTab {...props} />}

        {tab === 'picks' && (
          <EmptyTab
            {...props}
            icon="📝"
            title="My Picks"
            body="Your pending and settled calls will show here, with your points, hit rate and current streak."
          />
        )}

        {tab === 'leaderboard' && (
          <EmptyTab
            {...props}
            icon="🏆"
            title="Leaderboard"
            body="Weekly, monthly and all-time tables. The weekly table resets every Monday at 00:00 WAT."
          >
            <table className="play-score-table">
              <caption>Planned scoring</caption>
              <tbody>
                <tr><td>Correct call</td><td>+10</td></tr>
                <tr><td>Wrong call</td><td>0</td></tr>
                <tr><td>Correct when the AI got it wrong</td><td>+5 bonus</td></tr>
              </tbody>
            </table>
          </EmptyTab>
        )}

        {tab === 'leagues' && (
          <EmptyTab
            {...props}
            icon="👥"
            title="Leagues"
            body="Start a private league, share the invite link on WhatsApp or Telegram, and keep your own table and banter wall with friends."
          />
        )}

        {tab === 'profile' && (
          <EmptyTab
            {...props}
            icon="👤"
            title="Your Banter profile"
            body="Choose a handle and an avatar, and show off your badges, form and record against the AI."
          />
        )}

        <p className="play-disclaimer">
          Oddsbanta is an analytics tool, not a bookmaker. Banter Hub is a free game with no stakes. 18+.
        </p>
      </div>
    </div>
  );
}
