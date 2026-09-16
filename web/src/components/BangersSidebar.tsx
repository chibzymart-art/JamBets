import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatKickoff, getTodayIsoDate } from '../lib/dateUtils';
import { formatPredictionOutcome } from './FixtureCard';

export interface BangersSidebarProps {
  bangersList?: any[];
  predsByFixture?: Map<string, any[]>;
  onSelectFixture?: (fixture: any) => void;
}

export const BangersSidebar: React.FC<BangersSidebarProps> = ({
  bangersList,
  predsByFixture,
  onSelectFixture
}) => {
  const navigate = useNavigate();
  const [internalBangers, setInternalBangers] = useState<any[]>([]);
  const [loadingInternal, setLoadingInternal] = useState<boolean>(false);

  const isExternalProvided = Array.isArray(bangersList);

  useEffect(() => {
    if (isExternalProvided) return;

    let isMounted = true;
    async function loadTodayBangers() {
      try {
        setLoadingInternal(true);
        const todayIso = getTodayIsoDate();
        const startDay = `${todayIso}T00:00:00.000Z`;
        const endDay = `${todayIso}T23:59:59.999Z`;

        const { data: preds, error } = await supabase
          .from('football_predictions_paywall')
          .select(`
            id,
            fixture_id,
            prediction,
            probability,
            confidence_category,
            settlement_status,
            target_kickoff_at,
            football_fixtures (
              id,
              league_code,
              home_team_name,
              away_team_name,
              target_kickoff_at
            )
          `)
          .eq('confidence_category', 'BANGER')
          .gte('target_kickoff_at', startDay)
          .lte('target_kickoff_at', endDay)
          .order('probability', { ascending: false })
          .limit(10);

        if (!error && preds && isMounted) {
          const formatted = preds
            .filter((p: any) => p.football_fixtures)
            .map((p: any) => ({
              id: p.football_fixtures.id,
              league_code: p.football_fixtures.league_code,
              home_team_name: p.football_fixtures.home_team_name,
              away_team_name: p.football_fixtures.away_team_name,
              target_kickoff_at: p.football_fixtures.target_kickoff_at || p.target_kickoff_at,
              bangerPred: {
                prediction: p.prediction,
                probability: p.probability
              }
            }));
          setInternalBangers(formatted);
        }
      } catch (err) {
        console.warn('Could not fetch sidebar bangers:', err);
      } finally {
        if (isMounted) setLoadingInternal(false);
      }
    }

    loadTodayBangers();
    return () => { isMounted = false; };
  }, [isExternalProvided]);

  const displayList: any[] = isExternalProvided ? bangersList : internalBangers;

  const handleTileClick = (bf: any) => {
    if (onSelectFixture) {
      onSelectFixture(bf);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="dashboard-left-sidebar-col">
      <aside className="bangers-sidebar-card">
        <div className="bangers-sidebar-header">
          <div className="bangers-header-top">
            <span className="bangers-header-title">DAILY 90%+ BANGERS</span>
            <span className="bangers-count-badge">
              {displayList.length} Active
            </span>
          </div>
          <div className="bangers-header-sub">Top Algorithmic Locks</div>
        </div>

        <div className="bangers-list-box">
          {loadingInternal && displayList.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Synchronizing 90%+ locks...
            </div>
          ) : displayList.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No bangers in queue yet. High-probability consensus appears as matches approach kickoff.
            </div>
          ) : (
            displayList.map((bf) => {
              const time = formatKickoff(bf.target_kickoff_at);
              let bangerPred = bf.bangerPred;
              if (!bangerPred && predsByFixture) {
                const pList = predsByFixture.get(bf.id) || [];
                bangerPred = pList.find((p: any) => p.confidence_category === 'BANGER');
              }

              return (
                <div
                  key={bf.id}
                  className="banger-item-tile"
                  onClick={() => handleTileClick(bf)}
                  title="Click to view full simulation signals"
                >
                  <div className="banger-item-meta">
                    <span>{bf.league_code}</span>
                    <span>{time.timeStr} WAT</span>
                  </div>
                  <div className="banger-item-teams">
                    {bf.home_team_name} vs {bf.away_team_name}
                  </div>
                  <div className="banger-item-bottom">
                    <span className="banger-pred-text">
                      {bangerPred ? formatPredictionOutcome(bangerPred.prediction || '') : '🔥 BANGER'}
                    </span>
                    <span className="banger-prob-badge">
                      {bangerPred && bangerPred.probability
                        ? `${(bangerPred.probability * 100).toFixed(1)}%`
                        : '96%+'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
